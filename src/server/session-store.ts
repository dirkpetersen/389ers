import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Store, SessionData } from 'express-session';

/**
 * A session store that keeps sessions in files instead of in process memory.
 *
 * express-session's default MemoryStore holds sessions in a plain object, so
 * every session is destroyed when the process exits. On a PaaS the process is
 * restarted routinely — deploys, health-check respawns, host moves — and each
 * restart silently invalidates every logged-in user: their cookie survives, but
 * the session it points at is gone, so the next request 401s and the SPA drops
 * them back to the login form. Persisting to disk makes a login outlive the
 * process that issued it.
 *
 * One file per session, named by a hash of the session id: session ids are
 * attacker-supplied, and hashing keeps them out of the filesystem entirely
 * rather than trying to sanitize them into safe filenames.
 */
export class FileSessionStore extends Store {
  private dir: string;
  private pruneTimer: NodeJS.Timeout;

  constructor(dir: string, pruneIntervalMs = 15 * 60 * 1000) {
    super();
    this.dir = path.resolve(dir);
    // Sessions are bearer credentials: anyone who can read the file can forge
    // the logged-in state it describes, so keep the directory owner-only.
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.prune();
    // Expired sessions are also rejected on read; this only reclaims the disk
    // of sessions that are never requested again. unref so it cannot hold the
    // event loop open and keep the process from exiting.
    this.pruneTimer = setInterval(() => this.prune(), pruneIntervalMs);
    this.pruneTimer.unref();
  }

  private fileFor(sid: string): string {
    return path.join(this.dir, crypto.createHash('sha256').update(sid).digest('hex') + '.json');
  }

  private static expiryOf(session: SessionData): number {
    const expires = session.cookie?.expires;
    if (!expires) return Infinity;
    return new Date(expires).getTime();
  }

  get(sid: string, callback: (err: any, session?: SessionData | null) => void): void {
    const file = this.fileFor(sid);
    fs.readFile(file, 'utf8', (err, raw) => {
      // A missing file is "no such session", not a failure: reporting it as an
      // error would surface as a 500 instead of a login prompt.
      if (err) return callback(err.code === 'ENOENT' ? null : err, null);

      let session: SessionData;
      try {
        session = JSON.parse(raw);
      } catch {
        // A truncated or corrupt file is likewise treated as no session.
        fs.unlink(file, () => callback(null, null));
        return;
      }

      if (FileSessionStore.expiryOf(session) <= Date.now()) {
        fs.unlink(file, () => callback(null, null));
        return;
      }

      callback(null, session);
    });
  }

  set(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    const file = this.fileFor(sid);
    let raw: string;
    try {
      raw = JSON.stringify(session);
    } catch (err) {
      return callback?.(err);
    }

    // Write-then-rename: a crash mid-write leaves the previous session intact
    // rather than a half-written file that reads back as corrupt.
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFile(tmp, raw, { mode: 0o600 }, (err) => {
      if (err) return callback?.(err);
      fs.rename(tmp, file, (renameErr) => {
        if (renameErr) fs.unlink(tmp, () => callback?.(renameErr));
        else callback?.();
      });
    });
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    fs.unlink(this.fileFor(sid), (err) => {
      callback?.(err && err.code !== 'ENOENT' ? err : undefined);
    });
  }

  /**
   * express-session calls touch on every request that carries an existing
   * session, to slide the expiry window forward. Rewriting the file each time
   * would mean a disk write per request for no gain, so skip writes that move
   * the expiry by less than a minute.
   */
  touch(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    const file = this.fileFor(sid);
    fs.readFile(file, 'utf8', (err, raw) => {
      if (err) return callback?.(err.code === 'ENOENT' ? undefined : err);

      try {
        const stored: SessionData = JSON.parse(raw);
        const moved = FileSessionStore.expiryOf(session) - FileSessionStore.expiryOf(stored);
        if (moved < 60 * 1000) return callback?.();
      } catch {
        // Fall through and rewrite the file.
      }

      this.set(sid, session, callback);
    });
  }

  /** Delete sessions whose expiry has passed. */
  private prune(): void {
    fs.readdir(this.dir, (err, names) => {
      if (err) return;
      const now = Date.now();
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(this.dir, name);
        fs.readFile(file, 'utf8', (readErr, raw) => {
          if (readErr) return;
          try {
            if (FileSessionStore.expiryOf(JSON.parse(raw)) <= now) fs.unlink(file, () => {});
          } catch {
            fs.unlink(file, () => {});
          }
        });
      }
    });
  }
}
