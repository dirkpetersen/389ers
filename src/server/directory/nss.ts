import { execFile } from 'child_process';
import { DirectoryBackend, ReadOnlyBackendError } from './backend';
import { LdapUser, LdapGroup, AppConfig } from '../types/ldap';

// Names we are willing to hand to getent. Deliberately strict: execFile does
// not use a shell so there is no injection risk, but a leading '-' would be
// parsed as an option, and anything else is not a plausible account name.
// Backslash and '@' are allowed for AD forms (DOMAIN\user, user@realm).
const SAFE_NAME = /^[A-Za-z0-9._@\\-]{1,256}$/;

function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.startsWith('-');
}

function getent(database: string, key?: string): Promise<string | null> {
  const args = key ? [database, key] : [database];
  return new Promise((resolve) => {
    execFile('getent', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      // getent exits 2 when the key is not found; treat every failure as "no
      // data" rather than throwing, so a missing account is not a 500.
      if (err) return resolve(null);
      resolve(stdout);
    });
  });
}

// Run `id -nG <user>`, which reports supplementary *and* primary groups. This
// works under SSSD even when enumeration is disabled, unlike scraping the full
// group table, so it is the reliable way to get a user's groups against AD.
function idGroups(login: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('id', ['-nG', '--', login], (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.trim().split(/\s+/).filter(Boolean));
    });
  });
}

function parsePasswdLine(line: string): LdapUser | null {
  const f = line.split(':');
  if (f.length < 7) return null;
  const [name, , uid, gid, gecos, home, shell] = f;
  const uidNumber = Number(uid);
  const gidNumber = Number(gid);
  if (!name || Number.isNaN(uidNumber)) return null;

  // GECOS is comma-separated (full name, office, phones). Only the first field
  // is a display name, and local accounts often leave it as ",,,".
  const fullName = (gecos || '').split(',')[0].trim();

  return {
    dn: `uid=${name}`,
    uid: name,
    cn: fullName || name,
    gecos: gecos || undefined,
    uidNumber,
    gidNumber,
    homeDirectory: home || undefined,
    loginShell: shell || undefined,
  };
}

function parseGroupLine(line: string): LdapGroup | null {
  const f = line.split(':');
  if (f.length < 4) return null;
  const [name, , gid, membersCsv] = f;
  const gidNumber = Number(gid);
  if (!name || Number.isNaN(gidNumber)) return null;

  return {
    dn: `cn=${name}`,
    cn: name,
    gidNumber,
    description: '',
    member: [],
    memberUid: membersCsv ? membersCsv.split(',').filter(Boolean) : [],
    managedBy: [],
  };
}

export class NssBackend implements DirectoryBackend {
  readonly kind = 'nss' as const;
  readonly writable = false;

  private config: AppConfig;

  // Suffix convention used to locate a group's manager group, mirroring the
  // grp-<name>-adm pattern already present in the directory.
  private adminSuffix: string;

  // Ignore system accounts so the UI is not flooded with daemon users. The
  // upper bound excludes the nobody/nogroup sentinels at 65534.
  private minUid: number;
  private minGid: number;
  private maxId: number;

  // Optional group-name prefix (e.g. "grp-"), so a directory full of
  // per-user private groups and machine accounts only surfaces the groups
  // this tool is meant to manage. Empty string disables the filter.
  private groupPrefix: string;

  constructor(
    config: AppConfig,
    opts: {
      adminSuffix?: string;
      minUid?: number;
      minGid?: number;
      maxId?: number;
      groupPrefix?: string;
    } = {}
  ) {
    this.config = config;
    this.adminSuffix = opts.adminSuffix ?? '-adm';
    this.minUid = opts.minUid ?? 1000;
    this.minGid = opts.minGid ?? 1000;
    this.maxId = opts.maxId ?? 65000;
    this.groupPrefix = opts.groupPrefix ?? '';
  }

  describe(): string {
    return 'NSS (getent) — resolves via nsswitch.conf: local files and/or SSSD/Active Directory';
  }

  async getUser(login: string): Promise<LdapUser | null> {
    if (!isSafeName(login)) return null;
    const out = await getent('passwd', login);
    if (!out) return null;
    return parsePasswdLine(out.trim().split('\n')[0]);
  }

  async getGroup(name: string): Promise<LdapGroup | null> {
    if (!isSafeName(name)) return null;
    const out = await getent('group', name);
    if (!out) return null;
    return parseGroupLine(out.trim().split('\n')[0]);
  }

  // Enumerate the whole table and substring-match locally.
  //
  // Important caveat for Active Directory: SSSD ships with `enumerate = false`
  // for AD providers (enumerating 100k users is very expensive), so this list
  // will be empty or partial there. We therefore always *also* attempt an exact
  // lookup of the query and merge it in, so typing a full account name keeps
  // working even when enumeration returns nothing.
  private async enumerateAndMatch<T extends { name: string; extra: string[] }>(
    database: 'passwd' | 'group',
    query: string,
    limit: number,
    parse: (line: string) => (LdapUser | LdapGroup) | null,
    nameOf: (item: LdapUser | LdapGroup) => string,
    haystack: (item: LdapUser | LdapGroup) => string[],
    minId: number,
    idOf: (item: LdapUser | LdapGroup) => number
  ): Promise<(LdapUser | LdapGroup)[]> {
    const needle = query.toLowerCase();
    const found = new Map<string, LdapUser | LdapGroup>();

    const out = await getent(database);
    if (out) {
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const item = parse(line);
        if (!item) continue;
        if (idOf(item) < minId || idOf(item) > this.maxId) continue;
        if (database === 'group' && !nameOf(item).startsWith(this.groupPrefix)) continue;
        if (!haystack(item).some((h) => h.toLowerCase().includes(needle))) continue;
        found.set(nameOf(item), item);
        if (found.size >= limit) break;
      }
    }

    // Exact-name fallback for the enumeration-disabled case.
    if (found.size < limit && isSafeName(query)) {
      const exactOut = await getent(database, query);
      if (exactOut) {
        const item = parse(exactOut.trim().split('\n')[0]);
        if (item && !found.has(nameOf(item))) found.set(nameOf(item), item);
      }
    }

    return Array.from(found.values());
  }

  async searchUsers(query: string, limit: number): Promise<LdapUser[]> {
    const results = await this.enumerateAndMatch(
      'passwd',
      query,
      limit,
      parsePasswdLine,
      (u) => (u as LdapUser).uid,
      (u) => [(u as LdapUser).uid, (u as LdapUser).cn, (u as LdapUser).gecos || ''],
      this.minUid,
      (u) => (u as LdapUser).uidNumber
    );
    return results as LdapUser[];
  }

  async searchGroups(query: string, limit: number): Promise<LdapGroup[]> {
    const results = await this.enumerateAndMatch(
      'group',
      query,
      limit,
      parseGroupLine,
      (g) => (g as LdapGroup).cn,
      (g) => [(g as LdapGroup).cn],
      this.minGid,
      (g) => (g as LdapGroup).gidNumber
    );
    return results as LdapGroup[];
  }

  // NSS member lists hold plain login names, never DNs.
  async resolveMember(memberRef: string): Promise<LdapUser | null> {
    return this.getUser(memberRef);
  }

  // Unix groups carry no managedBy attribute, so delegation is expressed by
  // convention: members of "<group><adminSuffix>" may manage "<group>".
  async getManagers(group: LdapGroup): Promise<string[]> {
    const adminGroup = await this.getGroup(`${group.cn}${this.adminSuffix}`);
    if (!adminGroup) return [];
    return adminGroup.memberUid.map((uid) => `uid=${uid}`);
  }

  // Used by the UI to decide what a given user may manage.
  async getGroupsForUser(login: string): Promise<string[]> {
    if (!isSafeName(login)) return [];
    return idGroups(login);
  }

  async getUsedGids(): Promise<number[]> {
    const out = await getent('group');
    if (!out) return [];
    const gids: number[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const g = parseGroupLine(line);
      if (g) gids.push(g.gidNumber);
    }
    return gids;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  async createGroup(): Promise<string> {
    throw new ReadOnlyBackendError(this.kind);
  }
  async setGroupDescription(): Promise<void> {
    throw new ReadOnlyBackendError(this.kind);
  }
  async deleteGroup(): Promise<void> {
    throw new ReadOnlyBackendError(this.kind);
  }
  async addMembers(): Promise<void> {
    throw new ReadOnlyBackendError(this.kind);
  }
  async removeMembers(): Promise<void> {
    throw new ReadOnlyBackendError(this.kind);
  }
}
