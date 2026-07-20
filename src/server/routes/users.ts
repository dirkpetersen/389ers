import { Router } from 'express';
import { DirectoryBackend } from '../directory/backend';
import { LdapUser, SearchResult } from '../types/ldap';
import { requireAuth } from '../middleware/auth';

export function createUserRoutes(backend: DirectoryBackend): Router {
  const router = Router();

  // Search users by login, display name, or mail
  // GET /api/users?q=search&pageSize=50
  router.get('/', requireAuth, async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);

      if (query.length < 2) {
        const empty: SearchResult<LdapUser> = {
          entries: [], total: 0, page: 1, pageSize, hasMore: false,
        };
        return res.json(empty);
      }

      // Fetch one extra to detect whether more results exist.
      const users = await backend.searchUsers(query, pageSize + 1);

      const hasMore = users.length > pageSize;
      if (hasMore) users.pop();

      const result: SearchResult<LdapUser> = {
        entries: users,
        total: users.length,
        page: 1,
        pageSize,
        hasMore,
      };
      res.json(result);
    } catch (err) {
      console.error('User search error:', err);
      res.status(500).json({ error: 'Failed to search users' });
    }
  });

  // Get single user by login
  // GET /api/users/:uid
  router.get('/:uid', requireAuth, async (req, res) => {
    try {
      const user = await backend.getUser(req.params.uid);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    } catch (err) {
      console.error('Get user error:', err);
      res.status(500).json({ error: 'Failed to get user' });
    }
  });

  return router;
}
