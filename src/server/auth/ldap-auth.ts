import ldap from 'ldapjs';
import fs from 'fs';

// Verifying a password means binding to the directory *as that user*.
//
// This deliberately does not reuse the shared LdapClient singleton: that
// connection is bound as the service account and is used concurrently by every
// request, so re-binding it as an end user would swap the effective identity
// out from under unrelated in-flight operations. Each attempt therefore gets a
// short-lived connection of its own, unbound in a finally block.

export class LdapAuthError extends Error {
  readonly reason: 'invalid-credentials' | 'unknown-user' | 'config' | 'unavailable';

  constructor(reason: LdapAuthError['reason'], message: string) {
    super(message);
    this.name = 'LdapAuthError';
    this.reason = reason;
  }
}

export interface LdapAuthOptions {
  url: string;
  // PEM bundle used to verify the server certificate on ldaps:// URLs.
  // Omit to fall back to the system trust store.
  caCertFile?: string;
  // Identity strategies, tried in this order. The first one configured wins.
  bindDnTemplate?: string; // e.g. "uid={login},ou=People,dc=example,dc=edu"
  upnSuffix?: string;      // AD: binds as "<login>@<suffix>"
  // Last resort: look the DN up with the service account (the LDAP backend).
  resolveDn?: (login: string) => Promise<string | null>;
  timeoutMs?: number;
}

// Logins are interpolated into DN templates and, via resolveDn, into search
// filters. Rather than escape per-context, restrict the character set up front
// to what real POSIX/sAMAccountName logins use — anything else cannot be a
// valid account here, so rejecting it costs nothing and closes the injection
// path entirely.
const SAFE_LOGIN = /^[A-Za-z0-9._-]{1,64}$/;

let cachedCa: { file: string; pem: Buffer } | null = null;

function loadCa(file: string): Buffer {
  if (cachedCa && cachedCa.file === file) return cachedCa.pem;
  let pem: Buffer;
  try {
    pem = fs.readFileSync(file);
  } catch (err) {
    throw new LdapAuthError('config', `cannot read CA certificate ${file}: ${(err as Error).message}`);
  }
  cachedCa = { file, pem };
  return pem;
}

// Resolve the login to the identity we will actually bind with.
async function bindIdentity(login: string, opts: LdapAuthOptions): Promise<string> {
  if (opts.bindDnTemplate) return opts.bindDnTemplate.replace(/\{login\}/g, login);
  if (opts.upnSuffix) return `${login}@${opts.upnSuffix.replace(/^@/, '')}`;

  if (opts.resolveDn) {
    const dn = await opts.resolveDn(login);
    // No such account. Kept distinct from a bad password for the audit log, but
    // callers must still surface a single generic message to the client so the
    // API cannot be used to enumerate valid logins.
    if (!dn) throw new LdapAuthError('unknown-user', `no directory entry for '${login}'`);
    return dn;
  }

  throw new LdapAuthError(
    'config',
    'no way to derive a bind identity: set ldap.bindDnTemplate or ldap.upnSuffix, or use the LDAP backend'
  );
}

/**
 * Verify a login/password pair by binding to the directory.
 * Resolves with the identity that bound successfully; throws LdapAuthError otherwise.
 */
export async function authenticateUser(
  login: string,
  password: string,
  opts: LdapAuthOptions
): Promise<{ dn: string }> {
  if (!login || !SAFE_LOGIN.test(login)) {
    throw new LdapAuthError('invalid-credentials', 'malformed login');
  }

  // A simple bind carrying a DN but an empty password is an *unauthenticated*
  // bind (RFC 4513 §5.1.2): AD and most servers return success while granting
  // nothing, so an empty password would otherwise read as a valid login.
  if (typeof password !== 'string' || password.length === 0) {
    throw new LdapAuthError('invalid-credentials', 'empty password');
  }

  const timeout = opts.timeoutMs ?? 10_000;
  const identity = await bindIdentity(login, opts);

  const tlsOptions = opts.url.startsWith('ldaps://') && opts.caCertFile
    ? { ca: [loadCa(opts.caCertFile)] } // rejectUnauthorized defaults to true; leave it there
    : undefined;

  const client = ldap.createClient({
    url: opts.url,
    timeout,
    connectTimeout: timeout,
    reconnect: false, // one-shot probe; a dropped connection should fail, not retry
    tlsOptions,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };

      const timer = setTimeout(
        () => done(new LdapAuthError('unavailable', `bind timed out after ${timeout}ms`)),
        timeout
      );

      // Without a listener, ldapjs surfaces connection failures as an
      // unhandled 'error' event and takes the process down.
      client.on('error', (err: Error) => done(new LdapAuthError('unavailable', err.message)));
      client.on('connectError', (err: Error) => done(new LdapAuthError('unavailable', err.message)));

      client.bind(identity, password, (err) => {
        if (!err) return done();
        // 49 = invalidCredentials. Anything else is an operational fault and
        // should not be reported to the user as a wrong password.
        const code = (err as { code?: number }).code;
        done(code === 49
          ? new LdapAuthError('invalid-credentials', 'bind rejected')
          : new LdapAuthError('unavailable', err.message));
      });
    });

    return { dn: identity };
  } finally {
    // unbind() can itself throw if the socket is already gone; destroy() is the
    // unconditional teardown, and leaking sockets here would be a slow leak on
    // every failed login.
    try {
      client.unbind(() => client.destroy());
    } catch {
      client.destroy();
    }
  }
}
