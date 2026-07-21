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

  private get userFilter(): string {
    return this.config.ldap.userFilter || '(objectClass=person)';
  }

  async searchUsers(query: string, limit: number): Promise<LdapUser[]> {
    const q = this.client.escapeFilter(query);
    const attr = this.client.loginAttr;
    const filter = `(&${this.userFilter}(|(${attr}=*${q}*)(cn=*${q}*)(mail=*${q}*)))`;
    return this.client.searchUsers(this.config.users.baseDN, filter, limit);
  }

  async getUser(login: string): Promise<LdapUser | null> {
    const l = this.client.escapeFilter(login);
    const users = await this.client.searchUsers(
      this.config.users.baseDN,
      `(&${this.userFilter}(${this.client.loginAttr}=${l}))`,
      1
    );
    return users.length > 0 ? users[0] : null;
  }

  // Which entries count as manageable groups. Configurable because Active
  // Directory has no posixGroup objects — it puts gidNumber on `group` entries
  // instead — so a fixed (objectClass=posixGroup) finds nothing there.
  private get groupFilter(): string {
    return this.config.ldap.groupFilter || '(objectClass=posixGroup)';
  }

  async searchGroups(query: string, limit: number): Promise<LdapGroup[]> {
    let filter = this.groupFilter;
    if (query) {
      const q = this.client.escapeFilter(query);
      filter = `(&${this.groupFilter}(|(cn=*${q}*)(description=*${q}*)))`;
    }
    return this.client.searchGroups(this.config.groups.baseDN, filter, limit);
  }

  async getGroup(name: string): Promise<LdapGroup | null> {
    const cn = this.client.escapeFilter(name);
    const groups = await this.client.searchGroups(
      this.config.groups.baseDN,
      `(&${this.groupFilter}(cn=${cn}))`,
      1
    );
    return groups.length > 0 ? groups[0] : null;
  }

  async getManagers(group: LdapGroup): Promise<string[]> {
    return group.managedBy;
  }

  // memberUid holds bare login names; member holds full DNs. The DN form
  // varies by directory (uid=... on 389 DS, CN=... on AD), so read the entry at
  // that DN rather than parsing it. Returns null when the DN is not a user —
  // which is how callers detect a nested group.
  async resolveMember(memberRef: string): Promise<LdapUser | null> {
    if (memberRef.includes('=')) {
      try {
        const found = await this.client.searchUsers(memberRef, this.userFilter, 1, 'base');
        if (found.length > 0) return found[0];
      } catch {
        // No such object, or not readable: fall through to the RDN heuristic.
      }
      const rdn = memberRef.match(/^[a-zA-Z]+=([^,]+)/);
      return rdn ? this.getUser(rdn[1]) : null;
    }
    return this.getUser(memberRef);
  }

  async getUsedGids(): Promise<number[]> {
    const groups = await this.client.searchGroups(this.config.groups.baseDN, this.groupFilter, 10000);
    return groups.map((g) => g.gidNumber).filter((g): g is number => typeof g === 'number');
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
