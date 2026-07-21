// LDAP User representation (from AD sync)
export interface LdapUser {
  dn: string;
  uid: string;
  cn: string;
  sn?: string;
  givenName?: string;
  mail?: string;
  uidNumber: number;
  gidNumber: number;
  homeDirectory?: string;
  loginShell?: string;
  gecos?: string;
}

// LDAP Group representation (POSIX group)
export interface LdapGroup {
  dn: string;
  cn: string;
  gidNumber: number;
  description?: string;
  member: string[]; // Array of user DNs (groupOfNames style)
  memberUid: string[]; // Array of UIDs (posixGroup style)
  managedBy: string[]; // Array of user DNs who can manage this group
}

// Paginated search results wrapper
export interface SearchResult<T> {
  entries: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Group with resolved member details
export interface GroupWithMembers extends LdapGroup {
  memberUsers: LdapUser[];
  canManage: boolean;
}

// Member with breadcrumb path (for nested group resolution)
export interface ResolvedMember {
  user: LdapUser;
  path: string[]; // Breadcrumb path showing how membership was derived
  direct: boolean; // True if directly in the group
}

// Audit log entry types
export type AuditAction =
  | 'add_member'
  | 'remove_member'
  | 'create_group'
  | 'delete_group'
  | 'modify_group';

export interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  actor: string; // DN of user performing action
  target: string; // DN of group affected
  details: Record<string, unknown>;
}

// API request/response types
export interface CreateGroupRequest {
  cn: string;
  description: string;
  members?: string[]; // UIDs of initial members
}

export interface UpdateGroupRequest {
  description?: string;
}

export interface AddMembersRequest {
  members: string[]; // UIDs to add
}

export interface RemoveMembersRequest {
  members: string[]; // UIDs to remove
}

// Config types
export interface LdapConfig {
  url: string;
  baseDN: string;
  bindDN: string;
  bindPassword: string;
}

export interface GroupsConfig {
  baseDN: string;
  gidMin: number;
  gidMax: number;
  adminGroup: string;
}

export interface UsersConfig {
  baseDN: string;
}

// Active Directory specifics. Only read when DIRECTORY_BACKEND=ad.
export interface AdConfig {
  // Login attribute. sAMAccountName is the pre-Windows-2000 account name and
  // is what users actually type; AD has no `uid` unless RFC2307/IDMU is set up.
  loginAttribute?: string;

  // groupType bitmask for newly created groups. Defaults to a global security
  // group. Common values:
  //   -2147483646  global security
  //   -2147483644  domain local security
  //   -2147483640  universal security
  groupType?: number;

  // Write POSIX gidNumber on new groups. Requires the RFC2307/IDMU schema
  // extension; leave false on a stock AD or group creation will fail with a
  // constraint violation.
  writeGidNumber?: boolean;

  safety?: {
    // Master switch. Left false, every mutating route returns 501 — the same
    // guard the NSS backend uses. Turn on deliberately.
    writeEnabled?: boolean;

    // Writes are refused unless the target DN sits under one of these
    // subtrees. Prevents a bug or a bad request from touching, say,
    // CN=Domain Admins.
    allowedOus?: string[];

    // Group names that may never be modified or deleted, matched case
    // insensitively against cn and sAMAccountName.
    protectedNames?: string[];

    // Refuse to bind over a non-TLS connection. Plain ldap:// sends the bind
    // password in cleartext, so this defaults to on and must be switched off
    // knowingly.
    requireTls?: boolean;
  };
}

export interface AppConfig {
  server: {
    port: number;
    sessionSecret: string;
    sessionTimeout: number;
  };
  ldap: LdapConfig;
  groups: GroupsConfig;
  users: UsersConfig;
  audit: {
    logFile: string;
  };
  admin: {
    username: string;
    password: string;
  };
  ad?: AdConfig;
}
