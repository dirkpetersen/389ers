import { Request, Response, NextFunction } from 'express';

// Extend session type
declare module 'express-session' {
  interface SessionData {
    user?: {
      username: string;
      dn: string;
      isAdmin: boolean;
    };
  }
}

// Middleware to require authentication
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}

// Middleware to require admin access
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  if (!req.session.user.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// Current user's login name. This is the identifier authorization is keyed on,
// because NSS-sourced accounts have no DN.
export function getLogin(req: Request): string | null {
  return req.session.user?.username || null;
}

// Helper to get current user DN from session (LDAP backend only)
export function getUserDN(req: Request): string | null {
  return req.session.user?.dn || null;
}

// Helper to check if current user is admin
export function isAdmin(req: Request): boolean {
  return req.session.user?.isAdmin || false;
}
