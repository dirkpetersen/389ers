import { LdapUser, LdapGroup } from '../types/ldap';

// A directory backend abstracts *where* users and groups come from.
//
// - 'ldap' binds to 389 DS / OpenLDAP with a service account and can write.
// - 'nss'  resolves through getent(1), so it inherits whatever the host is
//          configured for in nsswitch.conf: local files, or SSSD against
//          Active Directory. NSS is read-only by design.
export interface DirectoryBackend {
  readonly kind: 'ldap' | 'ad' | 'nss';

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
    // The remedy differs per backend, and pointing someone at the wrong one
    // wastes real time when the directory is remote.
    const remedy = backendKind.startsWith('ad')
      ? 'Set ad.safety.writeEnabled: true in the config to allow writes, ' +
        'after confirming ad.safety.allowedOus is scoped correctly.'
      : backendKind === 'nss'
        ? 'getent(1) cannot write to a directory. Use DIRECTORY_BACKEND=ldap or ' +
          'DIRECTORY_BACKEND=ad to manage groups.'
        : 'Group management requires a writable backend.';
    super(`The '${backendKind}' directory backend is read-only. ${remedy}`);
    this.name = 'ReadOnlyBackendError';
  }
}

// Map a backend error to an HTTP response. Safety refusals and LDAP server
// rejections carry information the caller needs — without this they collapse
// into an opaque 500 and are painful to diagnose against a remote directory.
export function backendErrorResponse(
  err: unknown
): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof Error)) return null;

  if (err.name === 'ReadOnlyBackendError') {
    return { status: 501, body: { error: 'Read-only directory backend', detail: err.message } };
  }

  if (err.name === 'AdWriteBlockedError') {
    return { status: 403, body: { error: 'Blocked by directory safety policy', detail: err.message } };
  }

  // The directory being unreachable is by far the most common failure when
  // pointing this at a new server, and "Failed to create group" gives no clue.
  const sysCode = (err as { code?: unknown }).code;
  if (
    /not connected/i.test(err.message) ||
    sysCode === 'ECONNREFUSED' || sysCode === 'ETIMEDOUT' ||
    sysCode === 'ENOTFOUND' || sysCode === 'EHOSTUNREACH'
  ) {
    return {
      status: 503,
      body: {
        error: 'Directory server unreachable',
        detail: err.message,
        hint: 'Check the ldap.url host/port, that the DC is listening, and that no firewall blocks 389/636.',
      },
    };
  }

  // ldapjs surfaces the server's own rejection, which is far more useful than
  // "failed to create group" — e.g. insufficient access, constraint violation
  // from a missing schema attribute, or a DC refusing an unsigned bind.
  const ldapCode = (err as { code?: number }).code;
  if (typeof ldapCode === 'number') {
    const status = ldapCode === 50 || ldapCode === 8 ? 403 : 502;
    return {
      status,
      body: {
        error: 'Directory server rejected the operation',
        detail: err.message,
        ldapCode,
        hint: ldapCode === 8
          ? 'Server requires a stronger authentication method — typically LDAP signing or TLS. Try ldaps://.'
          : ldapCode === 50
            ? 'The bind account lacks permission to write here.'
            : ldapCode === 65
              ? 'Object class violation: the directory schema does not accept these attributes (e.g. gidNumber without RFC2307/IDMU).'
              : undefined,
      },
    };
  }

  return null;
}
