import { Router } from 'express';
import { DirectoryBackend, ReadOnlyBackendError } from '../directory/backend';
import { AuthorizationService } from '../auth/authorization';
import { LdapUser, AddMembersRequest, RemoveMembersRequest } from '../types/ldap';
import { requireAuth, getLogin, isAdmin } from '../middleware/auth';
import { logAddMember, logRemoveMember } from '../audit/logger';

export function createMemberRoutes(
  backend: DirectoryBackend,
  authService: AuthorizationService
): Router {
  const router = Router();

  function requireWritable(res: import('express').Response): boolean {
    if (backend.writable) return true;
    res.status(501).json({
      error: 'Read-only directory backend',
      detail: new ReadOnlyBackendError(backend.kind).message,
      backend: backend.kind,
    });
    return false;
  }

  // List members of a group, resolved to user objects
  // GET /api/groups/:cn/members
  router.get('/:cn/members', requireAuth, async (req, res) => {
    try {
      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const refs = group.memberUid.length > 0 ? group.memberUid : group.member;
      const resolved = await Promise.all(refs.map((r) => backend.resolveMember(r)));
      const members = resolved.filter((u): u is LdapUser => u !== null);

      res.json({ members });
    } catch (err) {
      console.error('List members error:', err);
      res.status(500).json({ error: 'Failed to list members' });
    }
  });

  // Add members to a group
  // POST /api/groups/:cn/members
  router.post('/:cn/members', requireAuth, async (req, res) => {
    try {
      if (!requireWritable(res)) return;

      const login = getLogin(req)!;
      const body: AddMembersRequest = req.body;

      if (!Array.isArray(body.members) || body.members.length === 0) {
        return res.status(400).json({ error: 'members array is required' });
      }

      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      if (!(await authService.canManageGroup(login, group, isAdmin(req)))) {
        return res.status(403).json({ error: 'Not authorized to manage this group' });
      }

      const current = new Set(
        [...group.memberUid, ...group.member].map((m) => {
          const dn = m.match(/^uid=([^,]+)/i);
          return (dn ? dn[1] : m).toLowerCase();
        })
      );

      const added: string[] = [];
      const notFound: string[] = [];
      const alreadyMember: string[] = [];

      for (const uid of body.members) {
        if (!(await backend.getUser(uid))) {
          notFound.push(uid);
        } else if (current.has(uid.toLowerCase())) {
          alreadyMember.push(uid);
        } else {
          added.push(uid);
        }
      }

      if (added.length > 0) {
        await backend.addMembers(group, added);
        for (const uid of added) logAddMember(login, group.dn, uid);
      }

      res.json({ success: true, added, notFound, alreadyMember });
    } catch (err) {
      console.error('Add members error:', err);
      res.status(500).json({ error: 'Failed to add members' });
    }
  });

  // Remove members from a group
  // DELETE /api/groups/:cn/members
  router.delete('/:cn/members', requireAuth, async (req, res) => {
    try {
      if (!requireWritable(res)) return;

      const login = getLogin(req)!;
      const body: RemoveMembersRequest = req.body;

      if (!Array.isArray(body.members) || body.members.length === 0) {
        return res.status(400).json({ error: 'members array is required' });
      }

      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      if (!(await authService.canManageGroup(login, group, isAdmin(req)))) {
        return res.status(403).json({ error: 'Not authorized to manage this group' });
      }

      const current = new Set(
        [...group.memberUid, ...group.member].map((m) => {
          const dn = m.match(/^uid=([^,]+)/i);
          return (dn ? dn[1] : m).toLowerCase();
        })
      );

      const removed: string[] = [];
      const notMember: string[] = [];

      for (const uid of body.members) {
        if (current.has(uid.toLowerCase())) removed.push(uid);
        else notMember.push(uid);
      }

      if (removed.length > 0) {
        await backend.removeMembers(group, removed);
        for (const uid of removed) logRemoveMember(login, group.dn, uid);
      }

      res.json({ success: true, removed, notFound: [], notMember });
    } catch (err) {
      console.error('Remove members error:', err);
      res.status(500).json({ error: 'Failed to remove members' });
    }
  });

  return router;
}
