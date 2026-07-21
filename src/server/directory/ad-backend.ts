import { DirectoryBackend, ReadOnlyBackendError } from './backend';
import { LdapClient, createChange } from '../ldap/client';
import { LdapUser, LdapGroup, AppConfig, AdConfig } from '../types/ldap';

// Global security group. See AdConfig.groupType for other scopes.
const DEFAULT_GROUP_TYPE = -2147483646;

export class AdWriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdWriteBlockedError';
  }
}

// Active Directory backend.
//
// AD differs from 389 DS in ways that go beyond attribute names, which is why
// this is a separate implementation rather than a config layer over LdapBackend:
//
//   - The login name is sAMAccountName, not uid.
//   - A user's RDN is their display name (CN=Jane Smith), so a member DN cannot
//     be parsed to recover the login. Members are resolved by DN lookup.
//   - Groups are objectClass=group with member (DNs); posixGroup/memberUid does
//     not exist unless RFC2307/IDMU has extended the schema.
//   - Creating a group requires sAMAccountName and groupType.
//   - managedBy is single-valued.
export class AdBackend implements DirectoryBackend {
  readonly kind = 'ad' as const;

  private ad: AdConfig;
  private loginAttr: string;

  constructor(private client: LdapClient, private config: AppConfig) {
    this.ad = config.ad || {};
    this.loginAttr = this.ad.loginAttribute || 'sAMAccountName';
  }

  // Writes are opt-in. Until safety.writeEnabled is set, the routes' existing
  // read-only guard returns 501 and nothing can be modified.
  get writable(): boolean {
    return this.ad.safety?.writeEnabled === true;
  }

  describe(): string {
    const tls = this.config.ldap.url.startsWith('ldaps://') ? 'TLS' : 'PLAINTEXT';
    return `Active Directory (${this.config.ldap.url}, ${tls}, base ${this.config.groups.baseDN})`;
  }

  private userAttrs(): string[] {
    return [
      'dn', this.loginAttr, 'cn', 'displayName', 'sn', 'givenName', 'mail',
      'uidNumber', 'gidNumber', 'unixHomeDirectory', 'loginShell',
    ];
  }

  private toUser(e: Record<string, unknown>): LdapUser {
    const login = String(e[this.loginAttr] ?? '');
    return {
      dn: String(e.dn),
      uid: login,
      cn: String(e.displayName ?? e.cn ?? login),
      sn: e.sn as string | undefined,
      givenName: e.givenName as string | undefined,
      mail: e.mail as string | undefined,
      uidNumber: Number(e.uidNumber ?? 0),
      gidNumber: Number(e.gidNumber ?? 0),
      homeDirectory: e.unixHomeDirectory as string | undefined,
      loginShell: e.loginShell as string | undefined,
    };
  }

  private toGroup(e: Record<string, unknown>): LdapGroup {
    const norm = (v: unknown): string[] =>
      !v ? [] : Array.isArray(v) ? (v as string[]) : [v as string];
    return {
      dn: String(e.dn),
      cn: String(e.cn ?? e[this.loginAttr] ?? ''),
      gidNumber: Number(e.gidNumber ?? 0),
      description: (e.description as string) || '',
      member: norm(e.member),
      memberUid: [], // AD has no memberUid; membership is DN-based
      managedBy: norm(e.managedBy),
    };
  }

  async searchUsers(query: string, limit: number): Promise<LdapUser[]> {
    const q = this.client.escapeFilter(query);
    const filter =
      `(&(objectCategory=person)(objectClass=user)` +
      `(|(${this.loginAttr}=*${q}*)(displayName=*${q}*)(cn=*${q}*)(mail=*${q}*)))`;
    const rows = await this.client.search<Record<string, unknown>>(this.config.users.baseDN, {
      scope: 'sub',
      filter,
      attributes: this.userAttrs(),
      sizeLimit: limit,
    });
    return rows.map((r) => this.toUser(r));
  }

  async getUser(login: string): Promise<LdapUser | null> {
    const q = this.client.escapeFilter(login);
    const rows = await this.client.search<Record<string, unknown>>(this.config.users.baseDN, {
      scope: 'sub',
      filter: `(&(objectCategory=person)(objectClass=user)(${this.loginAttr}=${q}))`,
      attributes: this.userAttrs(),
      sizeLimit: 1,
    });
    return rows.length ? this.toUser(rows[0]) : null;
  }

  async searchGroups(query: string, limit: number): Promise<LdapGroup[]> {
    let filter = '(objectClass=group)';
    if (query) {
      const q = this.client.escapeFilter(query);
      filter = `(&(objectClass=group)(|(cn=*${q}*)(${this.loginAttr}=*${q}*)(description=*${q}*)))`;
    }
    const rows = await this.client.search<Record<string, unknown>>(this.config.groups.baseDN, {
      scope: 'sub',
      filter,
      attributes: ['dn', 'cn', this.loginAttr, 'description', 'member', 'managedBy', 'gidNumber'],
      sizeLimit: limit,
    });
    return rows.map((r) => this.toGroup(r));
  }

  async getGroup(name: string): Promise<LdapGroup | null> {
    const q = this.client.escapeFilter(name);
    const rows = await this.client.search<Record<string, unknown>>(this.config.groups.baseDN, {
      scope: 'sub',
      filter: `(&(objectClass=group)(|(cn=${q})(${this.loginAttr}=${q})))`,
      attributes: ['dn', 'cn', this.loginAttr, 'description', 'member', 'managedBy', 'gidNumber'],
      sizeLimit: 1,
    });
    return rows.length ? this.toGroup(rows[0]) : null;
  }

  // AD member values are DNs whose RDN is the display name, so the login can
  // only be recovered by reading the entry.
  async resolveMember(memberRef: string): Promise<LdapUser | null> {
    try {
      const rows = await this.client.search<Record<string, unknown>>(memberRef, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: this.userAttrs(),
      });
      if (!rows.length) return null;
      const user = this.toUser(rows[0]);
      return user.uid ? user : null; // groups nested as members have no login
    } catch {
      return null;
    }
  }

  async getManagers(group: LdapGroup): Promise<string[]> {
    return group.managedBy;
  }

  async getUsedGids(): Promise<number[]> {
    if (!this.ad.writeGidNumber) return [];
    const rows = await this.client.search<Record<string, unknown>>(this.config.groups.baseDN, {
      scope: 'sub',
      filter: '(&(objectClass=group)(gidNumber=*))',
      attributes: ['gidNumber'],
      sizeLimit: 10000,
    });
    return rows.map((r) => Number(r.gidNumber)).filter((n) => !Number.isNaN(n));
  }

  // Refuse any write whose target sits outside the configured OU allowlist, or
  // whose name is on the protected list. Checked before every mutation.
  private assertWritable(targetDN: string, name: string): void {
    if (!this.writable) throw new ReadOnlyBackendError('ad (writeEnabled is false)');

    const safety = this.ad.safety || {};

    if (safety.requireTls !== false && !this.config.ldap.url.startsWith('ldaps://')) {
      throw new AdWriteBlockedError(
        'Refusing to write over a non-TLS connection. Use ldaps://, or set ' +
        'ad.safety.requireTls: false to allow cleartext writes.'
      );
    }

    const allowed = safety.allowedOus || [];
    if (allowed.length === 0) {
      throw new AdWriteBlockedError(
        'ad.safety.allowedOus is empty. Refusing to write anywhere in the directory; ' +
        'list the OU subtrees this app may modify.'
      );
    }
    const target = targetDN.toLowerCase();
    if (!allowed.some((ou) => target.endsWith(ou.toLowerCase()))) {
      throw new AdWriteBlockedError(
        `Refusing to write to ${targetDN}: outside ad.safety.allowedOus.`
      );
    }

    const protectedNames = (safety.protectedNames || []).map((n) => n.toLowerCase());
    if (protectedNames.includes(name.toLowerCase())) {
      throw new AdWriteBlockedError(`Refusing to modify protected group "${name}".`);
    }
  }

  async createGroup(
    cn: string,
    gidNumber: number,
    description: string,
    memberLogins: string[]
  ): Promise<string> {
    const groupDN = `CN=${cn},${this.config.groups.baseDN}`;
    this.assertWritable(groupDN, cn);

    const entry: Record<string, string | string[] | number> = {
      objectClass: ['top', 'group'],
      cn,
      // sAMAccountName is mandatory for AD groups and must be unique in the
      // domain; it is what the group is known by to Windows clients.
      sAMAccountName: cn,
      groupType: this.ad.groupType ?? DEFAULT_GROUP_TYPE,
      description,
    };

    // Only set POSIX attributes when the schema actually has them.
    if (this.ad.writeGidNumber) entry.gidNumber = gidNumber;

    // AD membership is DN-based, so logins must be resolved before the add.
    const memberDNs: string[] = [];
    for (const login of memberLogins) {
      const u = await this.getUser(login);
      if (u) memberDNs.push(u.dn);
    }
    if (memberDNs.length) entry.member = memberDNs;

    await this.client.add(groupDN, entry);
    return groupDN;
  }

  async setGroupDescription(group: LdapGroup, description: string): Promise<void> {
    this.assertWritable(group.dn, group.cn);
    await this.client.modify(
      group.dn,
      createChange('replace', { type: 'description', values: [description] })
    );
  }

  async deleteGroup(group: LdapGroup): Promise<void> {
    this.assertWritable(group.dn, group.cn);
    await this.client.delete(group.dn);
  }

  private async loginsToDNs(logins: string[]): Promise<string[]> {
    const dns: string[] = [];
    for (const login of logins) {
      const u = await this.getUser(login);
      if (u) dns.push(u.dn);
    }
    return dns;
  }

  async addMembers(group: LdapGroup, logins: string[]): Promise<void> {
    this.assertWritable(group.dn, group.cn);
    const values = await this.loginsToDNs(logins);
    if (!values.length) return;
    await this.client.modify(group.dn, createChange('add', { type: 'member', values }));
  }

  async removeMembers(group: LdapGroup, logins: string[]): Promise<void> {
    this.assertWritable(group.dn, group.cn);
    const values = await this.loginsToDNs(logins);
    if (!values.length) return;
    await this.client.modify(group.dn, createChange('delete', { type: 'member', values }));
  }
}
