import { DirectoryBackend } from '../directory/backend';
import { AppConfig, LdapGroup } from '../types/ldap';

// Pull the RDN value out of a reference. Accepts full DNs
// ("cn=389ers-admins,ou=Groups,dc=...") and the bare "cn=name" / "uid=name"
// forms the NSS backend emits, since Unix accounts have no DN.
function rdnValue(ref: string, attr: 'cn' | 'uid'): string | null {
  const m = ref.match(new RegExp(`^${attr}=([^,]+)`, 'i'));
  return m ? m[1] : null;
}

// Authorization is expressed in terms of login names rather than DNs, because
// NSS-sourced accounts have no DN at all.
export class AuthorizationService {
  constructor(private backend: DirectoryBackend, private config: AppConfig) {}

  // Membership test following nested groups. Handles posixGroup (memberUid
  // holds logins), groupOfNames (member holds DNs), and NSS (memberUid holds
  // logins; Unix groups are never nested).
  async isMemberOf(login: string, groupName: string, visited = new Set<string>()): Promise<boolean> {
    const key = groupName.toLowerCase();
    if (visited.has(key)) return false; // circular membership guard
    visited.add(key);

    const group = await this.backend.getGroup(groupName);
    if (!group) return false;

    if (group.memberUid.some((m) => m.toLowerCase() === login.toLowerCase())) {
      return true;
    }

    for (const ref of group.member) {
      const memberUid = rdnValue(ref, 'uid');
      if (memberUid && memberUid.toLowerCase() === login.toLowerCase()) return true;

      const nestedCn = rdnValue(ref, 'cn');
      if (nestedCn && (await this.isMemberOf(login, nestedCn, visited))) return true;
    }

    return false;
  }

  async isAdminGroupMember(login: string): Promise<boolean> {
    const adminCn = rdnValue(this.config.groups.adminGroup, 'cn');
    if (!adminCn) return false;
    return this.isMemberOf(login, adminCn);
  }

  // `sessionIsAdmin` carries the admin flag already established at login, so
  // per-group checks agree with the isAdmin(req) gate used by create/delete.
  // Without it an admin session would still see canManage=false on every group
  // whenever the configured admin group is absent from the directory.
  async canManageGroup(login: string, group: LdapGroup, sessionIsAdmin = false): Promise<boolean> {
    if (sessionIsAdmin) return true;
    if (await this.isAdminGroupMember(login)) return true;

    const managers = await this.backend.getManagers(group);
    for (const ref of managers) {
      const managerUid = rdnValue(ref, 'uid');
      if (managerUid && managerUid.toLowerCase() === login.toLowerCase()) return true;

      const managerCn = rdnValue(ref, 'cn');
      if (managerCn && (await this.isMemberOf(login, managerCn))) return true;
    }

    return false;
  }
}
