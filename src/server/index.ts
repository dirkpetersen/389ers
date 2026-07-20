import express from 'express';
import session from 'express-session';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import yaml from 'yaml';
import path from 'path';

import { LdapClient } from './ldap/client';
import { AuthorizationService } from './auth/authorization';
import { initAuditLogger } from './audit/logger';
import { AppConfig } from './types/ldap';

import { DirectoryBackend } from './directory/backend';
import { NssBackend } from './directory/nss';
import { LdapBackend } from './directory/ldap-backend';

import { createUserRoutes } from './routes/users';
import { createGroupRoutes } from './routes/groups';
import { createMemberRoutes } from './routes/members';
import { createResolvedRoutes } from './routes/resolved';

const app = express();

// Load configuration
const configPath = path.join(__dirname, '../../config/config.yaml');
const config: AppConfig = yaml.parse(fs.readFileSync(configPath, 'utf8'));

// Override with environment variables if set (for Docker)
if (process.env.LDAP_URL) config.ldap.url = process.env.LDAP_URL;
if (process.env.LDAP_BIND_DN) config.ldap.bindDN = process.env.LDAP_BIND_DN;
if (process.env.LDAP_BIND_PASSWORD) config.ldap.bindPassword = process.env.LDAP_BIND_PASSWORD;
if (process.env.LDAP_BASE_DN) {
  config.ldap.baseDN = process.env.LDAP_BASE_DN;
  config.groups.baseDN = `ou=Groups,${process.env.LDAP_BASE_DN}`;
  config.users.baseDN = `ou=People,${process.env.LDAP_BASE_DN}`;
  config.groups.adminGroup = `cn=389ers-admins,ou=Groups,${process.env.LDAP_BASE_DN}`;
}

// DIRECTORY_BACKEND=nss  -> resolve users/groups via getent(1), which follows
//                           nsswitch.conf (local files, or SSSD against AD).
// DIRECTORY_BACKEND=ldap -> bind to 389 DS / OpenLDAP with a service account.
const backendKind = (process.env.DIRECTORY_BACKEND || 'ldap').toLowerCase();

// AUTH_MODE=local trusts the OS identity of the process owner instead of
// prompting for a password. Intended for running the tool as yourself on a
// workstation that is already authenticated (SSSD/Kerberos), mirroring the
// trusted-local-user model. Only safe when bound to loopback.
const authMode = (process.env.AUTH_MODE || 'password').toLowerCase();
const bindHost = process.env.BIND_HOST || (authMode === 'local' ? '127.0.0.1' : '0.0.0.0');

initAuditLogger(config.audit.logFile);

let backend: DirectoryBackend;
let ldapClient: LdapClient | null = null;

if (backendKind === 'nss') {
  backend = new NssBackend(config, {
    adminSuffix: process.env.NSS_ADMIN_SUFFIX || '-adm',
    minUid: parseInt(process.env.NSS_MIN_UID || '1000', 10),
    minGid: parseInt(process.env.NSS_MIN_GID || '1000', 10),
    maxId: parseInt(process.env.NSS_MAX_ID || '65000', 10),
    groupPrefix: process.env.NSS_GROUP_PREFIX || '',
  });
} else {
  ldapClient = LdapClient.getInstance(config.ldap);
  backend = new LdapBackend(ldapClient, config);
}

const authService = new AuthorizationService(backend, config);

declare module 'express-session' {
  interface SessionData {
    user?: {
      username: string;
      dn: string;
      isAdmin: boolean;
    };
  }
}

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(session({
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: config.server.sessionTimeout,
    httpOnly: true,
    secure: false,
  },
}));

// Resolve whether a login should be treated as an app admin.
async function resolveIsAdmin(login: string): Promise<boolean> {
  if (process.env.LOCAL_ADMIN === 'true') return true;
  try {
    return await authService.isAdminGroupMember(login);
  } catch {
    return false;
  }
}

// In local mode, populate the session from the OS user running the process.
if (authMode === 'local') {
  const osUser = os.userInfo().username;
  app.use(async (req, _res, next) => {
    if (!req.session.user) {
      req.session.user = {
        username: osUser,
        dn: `uid=${osUser}`,
        isAdmin: await resolveIsAdmin(osUser),
      };
    }
    next();
  });
}

app.post('/api/auth/login', async (req, res) => {
  if (authMode === 'local') {
    return res.json({ success: true, user: req.session.user });
  }

  const { username, password } = req.body;

  if (username === config.admin.username && password === config.admin.password) {
    req.session.user = {
      username,
      dn: `cn=${username},${config.ldap.baseDN}`,
      isAdmin: true,
    };
    return res.json({ success: true, user: { username, isAdmin: true } });
  }

  // NOTE: LDAP bind-as-user is still not implemented; see CLAUDE.md.
  try {
    const user = await backend.getUser(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    return res.status(401).json({ error: 'LDAP authentication not fully implemented' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Failed to logout' });
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    username: req.session.user.username,
    isAdmin: req.session.user.isAdmin,
    authMode,
    backend: backend.kind,
    writable: backend.writable,
  });
});

app.use('/api/users', createUserRoutes(backend));
app.use('/api/groups', createGroupRoutes(backend, authService, config));
app.use('/api/groups', createMemberRoutes(backend, authService));
app.use('/api/groups', createResolvedRoutes(backend));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    backend: backend.kind,
    writable: backend.writable,
    source: backend.describe(),
    authMode,
  });
});

if (process.env.NODE_ENV === 'production') {
  const clientPath = path.join(__dirname, '../client');
  app.use(express.static(clientPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientPath, 'index.html'));
    }
  });
}

async function start() {
  if (ldapClient) {
    try {
      await ldapClient.connect();
      console.log('Connected to LDAP server');
    } catch (err) {
      console.error('Failed to connect to LDAP server:', err);
      console.log('Server will start anyway - LDAP operations will fail until connection is restored');
    }
  }

  const PORT = config.server.port || 8088;
  app.listen(PORT, bindHost, () => {
    console.log(`RCO Group Manager API listening on http://${bindHost}:${PORT}`);
    console.log(`Directory backend: ${backend.describe()}`);
    console.log(`Writable: ${backend.writable}`);
    console.log(`Auth mode: ${authMode}${authMode === 'local' ? ` (as ${os.userInfo().username})` : ''}`);
  });
}

start();
