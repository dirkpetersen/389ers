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
}
