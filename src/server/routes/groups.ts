import { Router } from 'express';
import { DirectoryBackend, ReadOnlyBackendError } from '../directory/backend';
import { AuthorizationService } from '../auth/authorization';
import { AppConfig, CreateGroupRequest, UpdateGroupRequest } from '../types/ldap';
import { requireAuth, getLogin, isAdmin } from '../middleware/auth';
import { logCreateGroup, logDeleteGroup, logModifyGroup } from '../audit/logger';

export function createGroupRoutes(
  backend: DirectoryBackend,
  authService: AuthorizationService,
  config: AppConfig
): Router {
  const router = Router();

  // Reject writes early on read-only backends (e.g. NSS/getent) so the client
  // gets an explanatory 501 instead of a confusing failure further down.
  function requireWritable(res: import('express').Response): boolean {
    if (backend.writable) return true;
    res.status(501).json({
      error: 'Read-only directory backend',
      detail: new ReadOnlyBackendError(backend.kind).message,
      backend: backend.kind,
    });
    return false;
  }

  // List/search groups
  // GET /api/groups?q=search
  router.get('/', requireAuth, async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const login = getLogin(req)!;
      const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);

      const groups = await backend.searchGroups(query, limit);

      const result = await Promise.all(
        groups.map(async (group) => ({
          cn: group.cn,
          description: group.description || '',
          gidNumber: group.gidNumber,
          memberCount: group.memberUid.length || group.member.length,
          canManage: await authService.canManageGroup(login, group, isAdmin(req)),
        }))
      );

      res.json({ groups: result, backend: backend.kind, writable: backend.writable });
    } catch (err) {
      console.error('Group list error:', err);
      res.status(500).json({ error: 'Failed to list groups' });
    }
  });

  // Get single group with members
  // GET /api/groups/:cn
  router.get('/:cn', requireAuth, async (req, res) => {
    try {
      const login = getLogin(req)!;

      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const canManage = await authService.canManageGroup(login, group, isAdmin(req));

      // memberUid holds logins, member holds DNs; the backend resolves either.
      const refs = group.memberUid.length > 0 ? group.memberUid : group.member;
      const resolved = await Promise.all(refs.map((r) => backend.resolveMember(r)));
      const members = resolved
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map((u) => ({ uid: u.uid, cn: u.cn, mail: u.mail }));

      res.json({
        dn: group.dn,
        cn: group.cn,
        gidNumber: group.gidNumber,
        description: group.description || '',
        memberCount: members.length,
        members,
        managedBy: await backend.getManagers(group),
        canManage,
        writable: backend.writable,
      });
    } catch (err) {
      console.error('Get group error:', err);
      res.status(500).json({ error: 'Failed to get group' });
    }
  });

  // Create new group
  // POST /api/groups
  router.post('/', requireAuth, async (req, res) => {
    try {
      if (!requireWritable(res)) return;

      const login = getLogin(req)!;
      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required to create groups' });
      }

      const body: CreateGroupRequest = req.body;
      if (!body.cn || !body.description) {
        return res.status(400).json({ error: 'cn and description are required' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(body.cn)) {
        return res.status(400).json({ error: 'Group name must be alphanumeric with hyphens/underscores only' });
      }

      if (await backend.getGroup(body.cn)) {
        return res.status(409).json({ error: 'Group already exists' });
      }

      // Allocate the lowest free GID in the configured range.
      const usedGids = new Set(await backend.getUsedGids());
      let gidNumber: number | null = null;
      for (let gid = config.groups.gidMin; gid <= config.groups.gidMax; gid++) {
        if (!usedGids.has(gid)) {
          gidNumber = gid;
          break;
        }
      }
      if (gidNumber === null) {
        return res.status(503).json({ error: 'No available GID numbers in range' });
      }

      // Keep only members that actually resolve.
      const memberLogins: string[] = [];
      for (const uid of body.members || []) {
        if (await backend.getUser(uid)) memberLogins.push(uid);
      }

      const groupDN = await backend.createGroup(body.cn, gidNumber, body.description, memberLogins);
      logCreateGroup(login, groupDN, body.cn, gidNumber);

      res.status(201).json({
        cn: body.cn,
        dn: groupDN,
        gidNumber,
        description: body.description,
        memberCount: memberLogins.length,
      });
    } catch (err) {
      console.error('Create group error:', err);
      res.status(500).json({ error: 'Failed to create group' });
    }
  });

  // Update group
  // PUT /api/groups/:cn
  router.put('/:cn', requireAuth, async (req, res) => {
    try {
      if (!requireWritable(res)) return;

      const login = getLogin(req)!;
      const body: UpdateGroupRequest = req.body;

      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      if (!(await authService.canManageGroup(login, group, isAdmin(req)))) {
        return res.status(403).json({ error: 'Not authorized to manage this group' });
      }
      if (body.description === undefined) {
        return res.status(400).json({ error: 'No changes specified' });
      }

      await backend.setGroupDescription(group, body.description);
      logModifyGroup(login, group.dn, { description: body.description });

      res.json({ success: true });
    } catch (err) {
      console.error('Update group error:', err);
      res.status(500).json({ error: 'Failed to update group' });
    }
  });

  // Delete group
  // DELETE /api/groups/:cn
  router.delete('/:cn', requireAuth, async (req, res) => {
    try {
      if (!requireWritable(res)) return;

      const login = getLogin(req)!;
      if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Admin access required to delete groups' });
      }

      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      if (group.dn.toLowerCase() === config.groups.adminGroup.toLowerCase()) {
        return res.status(403).json({ error: 'Cannot delete the admin group' });
      }

      await backend.deleteGroup(group);
      logDeleteGroup(login, group.dn, group.cn);

      res.json({ success: true });
    } catch (err) {
      console.error('Delete group error:', err);
      res.status(500).json({ error: 'Failed to delete group' });
    }
  });

  return router;
}
