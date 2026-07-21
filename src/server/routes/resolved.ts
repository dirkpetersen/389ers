import { Router } from 'express';
import { DirectoryBackend , backendErrorResponse } from '../directory/backend';
import { LdapGroup, ResolvedMember } from '../types/ldap';
import { requireAuth } from '../middleware/auth';

export function createResolvedRoutes(backend: DirectoryBackend): Router {
  const router = Router();

  // Flattened membership with breadcrumb paths, following nested groups.
  // GET /api/groups/:cn/resolved
  router.get('/:cn/resolved', requireAuth, async (req, res) => {
    try {
      const group = await backend.getGroup(req.params.cn);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }

      const resolved = new Map<string, ResolvedMember>();
      await resolveInto(backend, group, [group.cn], resolved, new Set<string>());

      res.json({ members: Array.from(resolved.values()) });
    } catch (err) {
      console.error('Resolve members error:', err);
      const mapped = backendErrorResponse(err);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      res.status(500).json({ error: 'Failed to resolve members' });
    }
  });

  return router;
}

function record(
  resolved: Map<string, ResolvedMember>,
  login: string,
  member: ResolvedMember
): void {
  const existing = resolved.get(login);
  // Keep the shortest path to a user, but never downgrade a direct membership.
  if (!existing || member.path.length < existing.path.length) {
    resolved.set(login, {
      ...member,
      direct: (existing?.direct ?? false) || member.direct,
    });
  }
}

async function resolveInto(
  backend: DirectoryBackend,
  group: LdapGroup,
  path: string[],
  resolved: Map<string, ResolvedMember>,
  visitedGroups: Set<string>
): Promise<void> {
  const groupKey = group.cn.toLowerCase();
  if (visitedGroups.has(groupKey)) return; // circular nesting guard
  visitedGroups.add(groupKey);

  const isDirect = path.length === 1;

  // posixGroup / NSS style: memberUid holds bare login names. These are always
  // users, never nested groups.
  for (const login of group.memberUid) {
    const user = await backend.resolveMember(login);
    if (user) record(resolved, user.uid, { user, path: [...path], direct: isDirect });
  }

  // groupOfNames style: member holds DNs, which may point at users or groups.
  for (const ref of group.member) {
    const userMatch = ref.match(/^uid=([^,]+)/i);
    if (userMatch) {
      const user = await backend.resolveMember(ref);
      if (user) record(resolved, user.uid, { user, path: [...path], direct: isDirect });
      continue;
    }

    const groupMatch = ref.match(/^cn=([^,]+)/i);
    if (groupMatch) {
      const nested = await backend.getGroup(groupMatch[1]);
      if (nested) {
        await resolveInto(backend, nested, [...path, nested.cn], resolved, visitedGroups);
      }
    }
  }
}
