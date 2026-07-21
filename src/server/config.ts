import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { AppConfig } from './types/ldap';

// Configuration resolves from environment variables first, then an optional
// config.yaml, then defaults. Env-first because PaaS hosts (appmotel, Heroku,
// containers) deploy from a git checkout and inject configuration as env vars —
// a gitignored YAML file cannot travel with the deployment.
//
// Every setting has an env var, so config.yaml is entirely optional.

const str = (key: string): string | undefined => {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
};

const int = (key: string): number | undefined => {
  const v = str(key);
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
};

// Secrets belong in files rather than the environment where possible: env vars
// are visible in /proc/<pid>/environ, leak into crash dumps and child
// processes, and are often echoed by process listings and logging.
const secret = (key: string): string | undefined => {
  const file = str(`${key}_FILE`);
  if (file) {
    try {
      // Trailing newline is the usual shape of a password file and would
      // otherwise be sent as part of the password.
      return fs.readFileSync(file, 'utf8').replace(/\s+$/, '');
    } catch (err) {
      throw new Error(`cannot read ${key}_FILE (${file}): ${(err as Error).message}`);
    }
  }
  return str(key);
};

export interface LoadedConfig {
  config: AppConfig;
  /** Path of the YAML file used, or null when configured purely from env. */
  yamlSource: string | null;
}

export function loadConfig(configDir: string): LoadedConfig {
  const configPath = path.join(configDir, 'config.yaml');
  const examplePath = path.join(configDir, 'config.yaml.example');

  // The example is a template of placeholders, not a usable config. It is read
  // for structure only, and never counts as having supplied real values.
  let fromYaml: Partial<AppConfig> = {};
  let yamlSource: string | null = null;
  for (const p of [configPath, examplePath]) {
    if (fs.existsSync(p)) {
      fromYaml = yaml.parse(fs.readFileSync(p, 'utf8')) ?? {};
      yamlSource = p === configPath ? p : null;
      break;
    }
  }

  const y = fromYaml as AppConfig;
  const baseDN = str('LDAP_BASE_DN') ?? y.ldap?.baseDN ?? '';

  const config: AppConfig = {
    server: {
      port: int('PORT') ?? y.server?.port ?? 8088,
      sessionSecret: secret('SESSION_SECRET') ?? y.server?.sessionSecret ?? 'change-me-in-production',
      sessionTimeout: int('SESSION_TIMEOUT') ?? y.server?.sessionTimeout ?? 3600000,
    },
    ldap: {
      url: str('LDAP_URL') ?? y.ldap?.url ?? '',
      baseDN,
      bindDN: str('LDAP_BIND_DN') ?? y.ldap?.bindDN ?? '',
      bindPassword: secret('LDAP_BIND_PASSWORD') ?? y.ldap?.bindPassword ?? '',
      tlsCaCert: str('LDAP_CA_CERT') ?? y.ldap?.tlsCaCert,
      upnSuffix: str('LDAP_UPN_SUFFIX') ?? y.ldap?.upnSuffix,
      bindDnTemplate: str('LDAP_BIND_DN_TEMPLATE') ?? y.ldap?.bindDnTemplate,
      groupFilter: str('LDAP_GROUP_FILTER') ?? y.ldap?.groupFilter ?? '(objectClass=posixGroup)',
      // person is satisfied by inetOrgPerson (389 DS) and by user (AD).
      userFilter: str('LDAP_USER_FILTER') ?? y.ldap?.userFilter ?? '(objectClass=person)',
      loginAttr: str('LDAP_LOGIN_ATTR') ?? y.ldap?.loginAttr ?? 'uid',
      timeoutMs: int('LDAP_TIMEOUT_MS') ?? y.ldap?.timeoutMs ?? 30000,
    },
    groups: {
      baseDN: str('GROUPS_BASE_DN') ?? y.groups?.baseDN ?? (baseDN && `ou=Groups,${baseDN}`) ?? '',
      gidMin: int('GID_MIN') ?? y.groups?.gidMin ?? 300000,
      gidMax: int('GID_MAX') ?? y.groups?.gidMax ?? 400000,
      adminGroup: str('ADMIN_GROUP') ?? y.groups?.adminGroup ?? (baseDN && `cn=389ers-admins,ou=Groups,${baseDN}`) ?? '',
    },
    users: {
      // Active Directory has no ou=People — accounts live scattered across the
      // OU tree — so USERS_BASE_DN is usually set to the domain root there.
      baseDN: str('USERS_BASE_DN') ?? y.users?.baseDN ?? (baseDN && `ou=People,${baseDN}`) ?? '',
    },
    audit: {
      logFile: str('AUDIT_LOG') ?? y.audit?.logFile ?? './permissions-changes.log',
    },
    admin: {
      username: str('ADMIN_USERNAME') ?? y.admin?.username ?? 'admin',
      password: secret('ADMIN_PASSWORD') ?? y.admin?.password ?? '',
    },
  };

  return { config, yamlSource };
}

/**
 * Reasons the LDAP backend cannot run with this configuration.
 * Empty array means it is usable.
 */
export function ldapBackendProblems(c: AppConfig): string[] {
  const problems: string[] = [];
  if (!c.ldap.url) problems.push('LDAP_URL (or ldap.url) is not set');
  if (!c.ldap.baseDN) problems.push('LDAP_BASE_DN (or ldap.baseDN) is not set');
  if (!c.ldap.bindDN) problems.push('LDAP_BIND_DN (or ldap.bindDN) is not set');

  // 'changeme' is the placeholder shipped in config.yaml.example; reaching the
  // directory with it would fail anyway, but failing here says why.
  if (!c.ldap.bindPassword || c.ldap.bindPassword === 'changeme') {
    problems.push(
      'no LDAP bind password — set LDAP_BIND_PASSWORD_FILE (preferred) or LDAP_BIND_PASSWORD'
    );
  }
  if (c.ldap.url.startsWith('ldaps://') && !c.ldap.tlsCaCert) {
    problems.push(
      'LDAPS URL with no CA certificate — set LDAP_CA_CERT (ldaps-init writes one to ~/.ldap-cert.pem)'
    );
  }
  return problems;
}

/** Settings that are unsafe to leave at their defaults in production. */
export function productionWarnings(c: AppConfig, adminAccountDisabled = false): string[] {
  const warnings: string[] = [];
  if (c.server.sessionSecret === 'change-me-in-production') {
    warnings.push(
      'SESSION_SECRET is the shipped default — session cookies can be forged. ' +
      'Set SESSION_SECRET_FILE or SESSION_SECRET.'
    );
  }
  if (c.admin.password === 'changeme' && !adminAccountDisabled) {
    warnings.push(
      'ADMIN_PASSWORD is the shipped default. Set ADMIN_PASSWORD, or disable the ' +
      'account entirely with REQUIRE_LOGIN=ldaps.'
    );
  }
  return warnings;
}
