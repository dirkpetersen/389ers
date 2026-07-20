import { LdapUser, LdapGroup } from '../types/ldap';

// A directory backend abstracts *where* users and groups come from.
//
// - 'ldap' binds to 389 DS / OpenLDAP with a service account and can write.
// - 'nss'  resolves through getent(1), so it inherits whatever the host is
//          configured for in nsswitch.conf: local files, or SSSD against
//          Active Directory. NSS is read-only by design.
export interface DirectoryBackend {
  readonly kind: 'ldap' | 'nss';

  // False when the backend cannot create/modify/delete groups. Routes must
  // reject write attempts with 501 rather than failing deeper in the stack.
  readonly writable: boolean;

  // Human-readable description of where data is coming from, for /api/health.
  describe(): string;

  searchUsers(query: string, limit: number): Promise<LdapUser[]>;
  getUser(login: string): Promise<LdapUser | null>;

  searchGroups(query: string, limit: number): Promise<LdapGroup[]>;
  getGroup(name: string): Promise<LdapGroup | null>;

  // DNs of the groups/users permitted to manage `group`. For LDAP this is the
  // managedBy attribute; for NSS it is a naming convention (see NssBackend).
  getManagers(group: LdapGroup): Promise<string[]>;

  // Resolve a member reference (a uid for posixGroup/NSS, or a DN for
  // groupOfNames) to a user, without callers having to parse DNs themselves.
  resolveMember(memberRef: string): Promise<LdapUser | null>;

  getUsedGids(): Promise<number[]>;

  createGroup(cn: string, gidNumber: number, description: string, memberLogins: string[]): Promise<string>;
  setGroupDescription(group: LdapGroup, description: string): Promise<void>;
  deleteGroup(group: LdapGroup): Promise<void>;
  addMembers(group: LdapGroup, logins: string[]): Promise<void>;
  removeMembers(group: LdapGroup, logins: string[]): Promise<void>;
}

export class ReadOnlyBackendError extends Error {
  constructor(backendKind: string) {
    super(
      `The '${backendKind}' directory backend is read-only. ` +
      `Group management requires a writable backend (set DIRECTORY_BACKEND=ldap).`
    );
    this.name = 'ReadOnlyBackendError';
  }
}
