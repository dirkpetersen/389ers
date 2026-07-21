import express from 'express';
import session from 'express-session';
import cors from 'cors';
import os from 'os';
import path from 'path';

import { LdapClient } from './ldap/client';
import { AuthorizationService } from './auth/authorization';
import { authenticateUser, LdapAuthError, LdapAuthOptions } from './auth/ldap-auth';
import { initAuditLogger } from './audit/logger';
import { loadConfig, ldapBackendProblems, productionWarnings } from './config';

import { DirectoryBackend } from './directory/backend';
import { NssBackend } from './directory/nss';
import { LdapBackend } from './directory/ldap-backend';

import { createUserRoutes } from './routes/users';
import { createGroupRoutes } from './routes/groups';
import { createMemberRoutes } from './routes/members';
import { createResolvedRoutes } from './routes/resolved';

const app = express();

// Configuration is env-first (see config.ts): every setting has an environment
// variable and config.yaml is optional, because PaaS deployments run from a git
// checkout where a gitignored YAML file cannot travel with the code.
const { config, yamlSource } = loadConfig(path.join(__dirname, '../../config'));

// DIRECTORY_BACKEND=nss  -> resolve users/groups via getent(1), which follows
//                           nsswitch.conf (local files, or SSSD against AD).
// DIRECTORY_BACKEND=ldap -> bind to 389 DS / OpenLDAP with a service account.
const backendKind = (process.env.DIRECTORY_BACKEND || 'ldap').toLowerCase();

// AUTH_MODE=local trusts the OS identity of the process owner instead of
// prompting for a password. Intended for running the tool as yourself on a
// workstation that is already authenticated (SSSD/Kerberos), mirroring the
// trusted-local-user model. Only safe when bound to loopback.
const authMode = (process.env.AUTH_MODE || 'password').toLowerCase();

// REQUIRE_LOGIN=ldaps hardens the site to directory-verified logins only: it
// suppresses the passwordless local-trust session AND the shared admin account
// from config.yaml, so the only way in is a successful LDAPS bind. Intended for
// when the app is reachable by anyone but should only admit real accounts.
const ldapsOnlyLogin = (process.env.REQUIRE_LOGIN || '').toLowerCase() === 'ldaps';

// Local mode normally binds to loopback because it grants the app's identity to
// anyone who can reach the port. Requiring a login removes that specific risk,
// so the loopback default no longer needs to be forced.
const bindHost = process.env.BIND_HOST
  || (authMode === 'local' && !ldapsOnlyLogin ? '127.0.0.1' : '0.0.0.0');

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
  // The LDAP backend needs a reachable directory and real credentials. Report
  // everything that is missing at once rather than one failure per restart.
  const problems = ldapBackendProblems(config);
  if (problems.length) {
    console.error(
      `DIRECTORY_BACKEND=ldap is not configured:\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n\nSet these as environment variables, or create config/config.yaml` +
      (yamlSource ? ` (currently reading ${yamlSource})` : '') +
      `.\nAlternatively run the read-only NSS backend with DIRECTORY_BACKEND=nss.`
    );
    process.exit(1);
  }
  ldapClient = LdapClient.getInstance(config.ldap);
  backend = new LdapBackend(ldapClient, config);
}

const authService = new AuthorizationService(backend, config);

// Password verification binds as the end user. The identity is derived from a
// DN template or a UPN suffix when configured; otherwise it falls back to
// looking the DN up through the backend with the service account.
const ldapAuthOptions: LdapAuthOptions = {
  url: process.env.LDAP_AUTH_URL || config.ldap.url,
  caCertFile: config.ldap.tlsCaCert,
  bindDnTemplate: config.ldap.bindDnTemplate,
  upnSuffix: config.ldap.upnSuffix,
  resolveDn: async (login) => (await backend.getUser(login))?.dn ?? null,
};

// With REQUIRE_LOGIN=ldaps there is no fallback credential, so a misconfigured
// directory does not degrade — it locks everyone out. Check the preconditions
// at startup and refuse to run rather than serving a site nobody can enter.
if (ldapsOnlyLogin) {
  const problems: string[] = [];

  if (!ldapAuthOptions.url.startsWith('ldaps://')) {
    problems.push(
      `LDAP URL is '${ldapAuthOptions.url}', which is not ldaps://. Passwords would cross ` +
      `the network unencrypted. Set ldap.url or LDAP_AUTH_URL to an ldaps:// URL.`
    );
  }

  // NSS synthesizes a placeholder DN ("uid=<name>") that cannot be bound with,
  // so the backend-lookup strategy is not usable there.
  if (!config.ldap.upnSuffix && !config.ldap.bindDnTemplate && backendKind === 'nss') {
    problems.push(
      `The NSS backend cannot supply a bindable DN. Set ldap.upnSuffix ` +
      `(LDAP_UPN_SUFFIX, e.g. "example.edu") or ldap.bindDnTemplate (LDAP_BIND_DN_TEMPLATE).`
    );
  }

  if (!config.ldap.tlsCaCert) {
    console.warn(
      `REQUIRE_LOGIN=ldaps: no ldap.tlsCaCert set, falling back to the system trust store. ` +
      `An internal AD root is usually absent from it; run ldaps-init and set LDAP_CA_CERT.`
    );
  }

  if (problems.length) {
    console.error(
      `REQUIRE_LOGIN=ldaps cannot be satisfied:\n` +
      problems.map((p) => `  - ${p}`).join('\n')
    );
    process.exit(1);
  }
}

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
// REQUIRE_LOGIN=ldaps opts out: that trust is exactly what it exists to remove.
if (authMode === 'local' && !ldapsOnlyLogin) {
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
  if (authMode === 'local' && !ldapsOnlyLogin) {
    return res.json({ success: true, user: req.session.user });
  }

  const { username, password } = req.body;

  // The config.yaml admin is a shared static credential; REQUIRE_LOGIN=ldaps
  // exists precisely to keep it from being a way in.
  if (!ldapsOnlyLogin && username === config.admin.username && password === config.admin.password) {
    req.session.user = {
      username,
      dn: `cn=${username},${config.ldap.baseDN}`,
      isAdmin: true,
    };
    return res.json({ success: true, user: { username, isAdmin: true } });
  }

  // Verify the password by binding to the directory as the user.
  try {
    const { dn } = await authenticateUser(username, password, ldapAuthOptions);
    const isAdmin = await resolveIsAdmin(username);

    // Issue a fresh session id now that the privilege level has changed, so a
    // session id an attacker planted pre-login cannot be reused post-login.
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve()))
    );
    req.session.user = { username, dn, isAdmin };

    return res.json({ success: true, user: { username, isAdmin } });
  } catch (err) {
    // Log the real reason for operators, but tell the client only that the
    // credentials were rejected: distinguishing "no such user" from "wrong
    // password" here would turn the login form into an account enumerator.
    if (err instanceof LdapAuthError) {
      console.warn(`Login failed for '${username}': ${err.reason} (${err.message})`);
      if (err.reason === 'unavailable' || err.reason === 'config') {
        return res.status(503).json({ error: 'Directory unavailable' });
      }
    } else {
      console.error('Login error:', err);
    }
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
    requireLogin: ldapsOnlyLogin ? 'ldaps' : null,
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
    requireLogin: ldapsOnlyLogin ? 'ldaps' : null,
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

  // PORT wins over config.yaml: PaaS hosts (appmotel, Heroku, Cloud Run) assign
  // a port at deploy time and expect the process to bind exactly that.
  const PORT = parseInt(process.env.PORT || '', 10) || config.server.port || 8088;
  app.listen(PORT, bindHost, () => {
    console.log(`RCO Group Manager API listening on http://${bindHost}:${PORT}`);
    console.log(`Directory backend: ${backend.describe()}`);
    console.log(`Writable: ${backend.writable}`);
    const localTrust = authMode === 'local' && !ldapsOnlyLogin;
    console.log(`Auth mode: ${authMode}${localTrust ? ` (as ${os.userInfo().username})` : ''}`);
    for (const w of productionWarnings(config, ldapsOnlyLogin)) console.warn(`WARNING: ${w}`);
    if (ldapsOnlyLogin) {
      console.log(`REQUIRE_LOGIN=ldaps: directory bind required; local-trust and the config.yaml admin are disabled`);
    }
  });
}

start();
