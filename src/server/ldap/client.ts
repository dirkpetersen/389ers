import fs from 'fs';
import ldap, { Client, SearchOptions, SearchEntry, Change } from 'ldapjs';
import { LdapConfig, LdapUser, LdapGroup } from '../types/ldap';

// Singleton LDAP client wrapper
let clientInstance: LdapClient | null = null;

export class LdapClient {
  private client: Client | null = null;
  private config: LdapConfig;
  private connected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(config: LdapConfig) {
    this.config = config;
  }

  static getInstance(config?: LdapConfig): LdapClient {
    if (!clientInstance) {
      if (!config) {
        throw new Error('LdapClient must be initialized with config first');
      }
      clientInstance = new LdapClient(config);
    }
    return clientInstance;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.client) {
        resolve();
        return;
      }

      // An ldaps:// URL against an internal CA needs that CA supplied
      // explicitly: the issuing root is virtually never in the system trust
      // store, and AD typically presents leaf + intermediate without it.
      // rejectUnauthorized stays at its secure default.
      const tlsOptions = this.config.url.startsWith('ldaps://') && this.config.tlsCaCert
        ? { ca: [fs.readFileSync(this.config.tlsCaCert)] }
        : undefined;

      this.client = ldap.createClient({
        url: this.config.url,
        reconnect: true,
        timeout: this.config.timeoutMs ?? 30000,
        connectTimeout: 10000,
        tlsOptions,
      });

      this.client.on('error', (err) => {
        console.error('LDAP client error:', err);
        this.connected = false;
        this.scheduleReconnect();
      });

      this.client.on('connectError', (err) => {
        console.error('LDAP connect error:', err);
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('LDAP client connected');
      });

      // Bind to LDAP server
      this.client.bind(this.config.bindDN, this.config.bindPassword, (err) => {
        if (err) {
          console.error('LDAP bind error:', err);
          reject(err);
          return;
        }
        this.connected = true;
        console.log('LDAP bind successful');
        resolve();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        await this.connect();
      } catch (err) {
        console.error('LDAP reconnect failed:', err);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  private ensureConnected(): void {
    if (!this.client || !this.connected) {
      throw new Error('LDAP client not connected');
    }
  }

  async search<T>(baseDN: string, options: SearchOptions): Promise<T[]> {
    this.ensureConnected();

    // Active Directory refuses to return more than MaxPageSize entries (1000 by
    // default) and answers with SizeLimitExceeded rather than truncating, so a
    // plain sizeLimit search fails outright on any large container. Page through
    // instead and stop collecting once the caller's limit is met.
    const { sizeLimit, ...rest } = options;
    const max = sizeLimit && sizeLimit > 0 ? sizeLimit : Infinity;

    return new Promise((resolve, reject) => {
      const entries: T[] = [];

      this.client!.search(baseDN, { ...rest, paged: { pageSize: 1000 } }, (err, res) => {
        if (err) {
          reject(err);
          return;
        }

        res.on('searchEntry', (entry: SearchEntry) => {
          if (entries.length < max) entries.push(this.entryToObject<T>(entry));
        });

        res.on('error', (err: Error) => {
          // A server that enforces its own limit has still given us usable
          // results; returning them beats failing the whole request.
          if (err.name === 'SizeLimitExceededError') resolve(entries.slice(0, max));
          else reject(err);
        });

        res.on('end', () => {
          resolve(entries.slice(0, max));
        });
      });
    });
  }

  private entryToObject<T>(entry: SearchEntry): T {
    const obj: Record<string, unknown> = {
      dn: entry.dn.toString(),
    };

    for (const attr of entry.attributes) {
      const name = attr.type;
      const values = attr.values;

      // Single value attributes
      if (values.length === 1) {
        // Convert numeric strings to numbers for known numeric fields
        if (['uidNumber', 'gidNumber'].includes(name)) {
          obj[name] = parseInt(values[0], 10);
        } else {
          obj[name] = values[0];
        }
      } else {
        // Multi-value attributes
        obj[name] = values;
      }
    }

    return obj as T;
  }

  async add(dn: string, entry: Record<string, string | string[] | number>): Promise<void> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client!.add(dn, entry, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async modify(dn: string, changes: Change | Change[]): Promise<void> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client!.modify(dn, changes, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async delete(dn: string): Promise<void> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client!.del(dn, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async exists(dn: string): Promise<boolean> {
    try {
      const results = await this.search(dn, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['dn'],
      });
      return results.length > 0;
    } catch {
      return false;
    }
  }

  // The attribute holding the login name. RFC2307 directories use uid; Active
  // Directory has no uid attribute at all and uses sAMAccountName.
  get loginAttr(): string {
    return this.config.loginAttr || 'uid';
  }

  // Convenience method for searching users
  async searchUsers(baseDN: string, filter: string, limit = 50, scope: 'sub' | 'base' = 'sub'): Promise<LdapUser[]> {
    const attributes = [
      'dn', 'uid', 'cn', 'sn', 'givenName', 'mail',
      'uidNumber', 'gidNumber', 'homeDirectory', 'loginShell', 'gecos'
    ];
    if (!attributes.includes(this.loginAttr)) attributes.push(this.loginAttr);

    const results = await this.search<LdapUser & Record<string, unknown>>(baseDN, {
      scope,
      filter,
      attributes,
      sizeLimit: limit,
    });

    // Surface the configured login attribute as `uid` so the rest of the app
    // stays schema-agnostic.
    return results.map((u) => ({
      ...u,
      uid: u.uid ?? (u[this.loginAttr] as string | undefined) ?? '',
    }));
  }

  // Convenience method for searching groups
  async searchGroups(baseDN: string, filter: string, limit = 100): Promise<LdapGroup[]> {
    const results = await this.search<Partial<LdapGroup> & { dn: string; cn: string; gidNumber: number; memberUid?: string | string[] }>(baseDN, {
      scope: 'sub',
      filter,
      attributes: ['dn', 'cn', 'gidNumber', 'description', 'member', 'memberUid', 'managedBy'],
      sizeLimit: limit,
    });

    // Normalize member, memberUid, and managedBy to arrays
    // posixGroup uses memberUid, groupOfNames uses member
    return results.map(g => ({
      ...g,
      member: this.normalizeToArray(g.member),
      memberUid: this.normalizeToArray(g.memberUid),
      managedBy: this.normalizeToArray(g.managedBy),
    })) as LdapGroup[];
  }

  // Get a single user by UID
  async getUserByUid(baseDN: string, uid: string): Promise<LdapUser | null> {
    const results = await this.searchUsers(
      baseDN, `(${this.loginAttr}=${this.escapeFilter(uid)})`, 1
    );
    return results.length > 0 ? results[0] : null;
  }

  // Get a single group by CN
  async getGroupByCn(baseDN: string, cn: string): Promise<LdapGroup | null> {
    const results = await this.searchGroups(baseDN, `(cn=${this.escapeFilter(cn)})`, 1);
    return results.length > 0 ? results[0] : null;
  }

  // Get all GIDs currently in use
  async getUsedGids(baseDN: string): Promise<number[]> {
    const groups = await this.searchGroups(baseDN, '(objectClass=posixGroup)', 10000);
    return groups.map(g => g.gidNumber);
  }

  private normalizeToArray(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value as string];
  }

  // Escape LDAP filter special characters
  escapeFilter(str: string): string {
    return str
      .replace(/\\/g, '\\5c')
      .replace(/\*/g, '\\2a')
      .replace(/\(/g, '\\28')
      .replace(/\)/g, '\\29')
      .replace(/\0/g, '\\00');
  }

  // Escape DN special characters
  escapeDN(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/\+/g, '\\+')
      .replace(/"/g, '\\"')
      .replace(/</g, '\\<')
      .replace(/>/g, '\\>')
      .replace(/;/g, '\\;')
      .replace(/=/g, '\\=');
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.client) {
      this.client.unbind();
      this.client = null;
    }
    this.connected = false;
    clientInstance = null;
  }
}

// Helper to create ldap.Change objects
export function createChange(
  operation: 'add' | 'delete' | 'replace',
  modification: { type: string; values: string[] }
): Change {
  return new ldap.Change({
    operation,
    modification,
  });
}

export default LdapClient;
