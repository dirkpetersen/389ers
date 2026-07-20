import { DirectoryBackend } from './backend';
import { LdapClient, createChange } from '../ldap/client';
import { LdapUser, LdapGroup, AppConfig } from '../types/ldap';

// Wraps the existing service-account LDAP client in the DirectoryBackend
// interface. Behaviour is intentionally identical to the pre-refactor routes.
export class LdapBackend implements DirectoryBackend {
  readonly kind = 'ldap' as const;
  readonly writable = true;

  constructor(private client: LdapClient, private config: AppConfig) {}

  describe(): string {
    return `LDAP (${this.config.ldap.url}, base ${this.config.ldap.baseDN})`;
  }

  async searchUsers(query: string, limit: number): Promise<LdapUser[]> {
    const q = this.client.escapeFilter(query);
    const filter = `(|(uid=*${q}*)(cn=*${q}*)(mail=*${q}*))`;
    return this.client.searchUsers(this.config.users.baseDN, filter, limit);
  }

  async getUser(login: string): Promise<LdapUser | null> {
    return this.client.getUserByUid(this.config.users.baseDN, login);
  }

  async searchGroups(query: string, limit: number): Promise<LdapGroup[]> {
    let filter = '(objectClass=posixGroup)';
    if (query) {
      const q = this.client.escapeFilter(query);
      filter = `(&(objectClass=posixGroup)(|(cn=*${q}*)(description=*${q}*)))`;
    }
    return this.client.searchGroups(this.config.groups.baseDN, filter, limit);
  }

  async getGroup(name: string): Promise<LdapGroup | null> {
    return this.client.getGroupByCn(this.config.groups.baseDN, name);
  }

  async getManagers(group: LdapGroup): Promise<string[]> {
    return group.managedBy;
  }

  // posixGroup memberUid values are bare uids; groupOfNames member values are
  // full DNs of the form uid=<login>,ou=People,...
  async resolveMember(memberRef: string): Promise<LdapUser | null> {
    const dnMatch = memberRef.match(/^uid=([^,]+),/i);
    const login = dnMatch ? dnMatch[1] : memberRef;
    return this.getUser(login);
  }

  async getUsedGids(): Promise<number[]> {
    return this.client.getUsedGids(this.config.groups.baseDN);
  }

  async createGroup(cn: string, gidNumber: number, description: string, memberLogins: string[]): Promise<string> {
    const groupDN = `cn=${cn},${this.config.groups.baseDN}`;
    const entry: Record<string, string | string[] | number> = {
      objectClass: ['top', 'posixGroup'],
      cn,
      gidNumber,
      description,
    };
    if (memberLogins.length > 0) entry.memberUid = memberLogins;
    await this.client.add(groupDN, entry);
    return groupDN;
  }

  async setGroupDescription(group: LdapGroup, description: string): Promise<void> {
    await this.client.modify(
      group.dn,
      createChange('replace', { type: 'description', values: [description] })
    );
  }

  async deleteGroup(group: LdapGroup): Promise<void> {
    await this.client.delete(group.dn);
  }

  // Chooses memberUid vs member based on how the group is already populated,
  // matching the posixGroup/groupOfNames duality described in CLAUDE.md.
  private usesMemberUid(group: LdapGroup): boolean {
    return group.memberUid.length > 0 || group.member.length === 0;
  }

  private async toMemberValues(group: LdapGroup, logins: string[]): Promise<string[]> {
    if (this.usesMemberUid(group)) return logins;
    const dns: string[] = [];
    for (const login of logins) {
      const user = await this.getUser(login);
      if (user) dns.push(user.dn);
    }
    return dns;
  }

  async addMembers(group: LdapGroup, logins: string[]): Promise<void> {
    const values = await this.toMemberValues(group, logins);
    if (values.length === 0) return;
    await this.client.modify(
      group.dn,
      createChange('add', { type: this.usesMemberUid(group) ? 'memberUid' : 'member', values })
    );
  }

  async removeMembers(group: LdapGroup, logins: string[]): Promise<void> {
    const values = await this.toMemberValues(group, logins);
    if (values.length === 0) return;
    await this.client.modify(
      group.dn,
      createChange('delete', { type: this.usesMemberUid(group) ? 'memberUid' : 'member', values })
    );
  }
}
