# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RCO Group Manager** (389ers) is a web frontend for managing Unix POSIX groups on 389 Directory Server for HPC systems. Users are replicated from Enterprise AD; groups/memberships are managed here and (eventually) synced back to AD.

## Architecture

```
React Frontend (Vite, port 5173 dev)
        ↓ /api proxy
Express API (port 8088)
        ↓ LDAP bind
Directory Server (port 10389)
```

- **Frontend**: `src/client/` - React 18 + TypeScript + Tailwind CSS
- **Backend**: `src/server/` - Express with session auth, YAML config loader
- **Config**: `config/config.yaml` - LDAP connection, GID range (300000-400000), session settings, initial admin credentials

## Build Commands

```bash
npm install              # Install dependencies
npm run dev              # Start frontend + backend with hot reload
npm run dev:server       # Backend only (tsx watch)
npm run dev:client       # Frontend only (Vite)
npm run build            # Production build (client + server)
npm start                # Run production build
npm run lint             # ESLint - currently broken, no eslint config file exists in the repo
```

There is no test framework configured.

**Node 18 compatibility**: the dev box runs Node 18. `postcss.config.cjs` and `tailwind.config.cjs` must keep the `.cjs` extension and `module.exports` — `package.json` has no `"type": "module"`, and Node 18 (unlike 22) won't reparse a `.js` config containing `export` syntax. For the same reason, toolchain upgrades need a Node-18 check: Vite 8 requires Node `^20.19 || >=22.12` and hard-fails the build here.

## Docker Setup

```bash
docker-compose up -d     # Start LDAP + web app
docker-compose ps        # Check status
docker-compose down      # Stop services
docker-compose down -v   # Stop and wipe LDAP data volumes
```

**Important**: `docker-compose.yml` runs `osixia/openldap` (plain OpenLDAP), not actual 389 Directory Server, as the dev/prod LDAP backend. This is a stand-in — schema and behavior (e.g. `posixGroup`/`memberUid` vs `groupOfNames`/`member`) may not exactly match a real 389 DS instance. A real 389 DS build exists separately under `./install/` (see below) for when server-accurate testing is needed.

First-time setup requires importing AD-exported users via LDIF. `scripts/init-ldap.ldif` is tracked; the user LDIF is *generated* by the PowerShell exporters in `scripts/` (`Export-ADUsers.ps1`, `Export-ADGroups.ps1`) and is not in the repo. Import order matters — users before groups (group `member`/`managedBy` reference user DNs).

## Directory Backends

The app resolves users and groups through a `DirectoryBackend` (`src/server/directory/`), selected by the `DIRECTORY_BACKEND` env var. Routes never talk to LDAP or parse DNs directly.

| Backend | Value | Source | Writable |
|---------|-------|--------|----------|
| LDAP | `ldap` (default) | Service-account bind to 389 DS / OpenLDAP | Yes |
| AD | `ad` | Service-account bind to Active Directory | Yes, but gated — see below |
| NSS | `nss` | `getent(1)`, following `nsswitch.conf` — local files and/or SSSD against Active Directory | **No** |

`CONFIG_FILE` selects which config file to load (absolute, or relative to the repo root), so each deployment keeps its own — e.g. `CONFIG_FILE=config/config.ad.yaml DIRECTORY_BACKEND=ad`.

### `AdBackend` (`src/server/directory/ad-backend.ts`)

AD is not schema-compatible with 389 DS, which is why this is a separate class rather than a config layer over `LdapBackend`:

- Login attribute is `sAMAccountName`, not `uid`.
- A user's RDN is their display name (`CN=Jane Smith`), so **a member DN cannot be parsed to recover the login** — the `/^uid=([^,]+),/` trick used on the 389 DS path is invalid here. `resolveMember` does a base-scope DN lookup instead.
- Groups are `objectClass=group` with DN-based `member`. There is no `posixGroup`/`memberUid` unless RFC2307/IDMU has extended the schema.
- Creating a group requires `sAMAccountName` and `groupType` (default `-2147483646`, global security).
- `managedBy` is single-valued in AD, unlike the multi-valued treatment the 389 DS path assumes.

`ad.writeGidNumber` defaults to false; enabling it on a stock AD causes an object class violation (LDAP error 65) because `gidNumber` is not in the schema.

### AD write safety

Writes are opt-in and checked before anything reaches the network, in `AdBackend.assertWritable`. `ad.safety.writeEnabled` defaults to false, so `backend.writable` is false and the routes' existing 501 guard blocks every mutation. Beyond that: `allowedOus` (empty refuses all writes), `protectedNames`, and `requireTls` (refuses cleartext writes).

Note that plain `ldap://` writes are commonly rejected by the DC itself with LDAP error 8 when *LDAP server signing requirements* is set to *Require signing*. That is server policy; no app-side setting bypasses it.

`backendErrorResponse` in `directory/backend.ts` maps backend failures to useful HTTP responses — unreachable directory to 503, safety refusals to 403, and LDAP result codes to 403/502 with a hint. Without it these all collapse into an opaque 500, which is painful to diagnose against a remote directory. Route handlers call it before falling through to their generic 500.

`NssBackend` shells out to `getent passwd` / `getent group` via `execFile` (no shell, names validated against a strict charset). Because it goes through NSS, the same code reads local `/etc/passwd` on a dev box and Active Directory on an SSSD-joined host — no LDAP credentials, no service account, inheriting the host's existing Kerberos/SSSD authentication.

**NSS is read-only.** `getent` cannot write, so create/update/delete group and add/remove member all return **501** with an explanatory body. Managing groups requires `DIRECTORY_BACKEND=ldap`.

Other NSS constraints worth knowing:
- **Unix groups don't nest**, so resolved membership is always flat and `direct: true`.
- **No `managedBy` attribute.** Delegation uses a naming convention instead: members of `<group><NSS_ADMIN_SUFFIX>` (default `<group>-adm`) may manage `<group>`. Being a *member* of a group grants no management rights.
- **Search relies on enumeration.** SSSD ships `enumerate = false` for AD providers (enumerating 100k users is expensive), so substring search returns little or nothing there. The backend always also attempts an exact-name lookup and merges it in, so typing a full account name keeps working. Enabling `enumerate = true` in `sssd.conf` restores substring search at a real performance cost.

### NSS environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `NSS_ADMIN_SUFFIX` | `-adm` | Suffix identifying a group's manager group |
| `NSS_GROUP_PREFIX` | *(empty)* | Only surface groups with this prefix (e.g. `grp-`), hiding per-user private groups |
| `NSS_MIN_UID` / `NSS_MIN_GID` | `1000` | Hide system accounts |
| `NSS_MAX_ID` | `65000` | Hide the `nobody`/`nogroup` sentinels at 65534 |

### Auth modes

`AUTH_MODE=local` trusts the OS identity of the process owner and populates the session from `os.userInfo()`, with no login prompt — for running the tool as yourself on a workstation already authenticated via SSSD/Kerberos. It binds to `127.0.0.1` by default (override with `BIND_HOST`); **only safe on loopback**, since it grants the app's identity to anyone who can reach the port. `LOCAL_ADMIN=true` forces the admin flag on.

`AUTH_MODE=password` (default) accepts the local `admin` account from `config.yaml`, then falls back to verifying the password with an LDAP bind as that user (see Authorization Model below).

`REQUIRE_LOGIN=ldaps` hardens the site to directory-verified logins only. It suppresses **both** other ways in — the passwordless local-trust session and the shared `config.yaml` admin account — so a successful LDAPS bind becomes the only path to a session. It composes with either `AUTH_MODE`, and because it removes the local-trust risk, `AUTH_MODE=local` no longer forces the loopback bind default.

Since nothing remains to fall back to, a misconfiguration here does not degrade — it locks everyone out. The server therefore validates the preconditions at startup and **exits rather than serving a site nobody can enter**: the URL must be `ldaps://`, and with the NSS backend either `upnSuffix` or `bindDnTemplate` must be set (NSS synthesizes a placeholder `uid=<name>` DN that cannot be bound with). A missing `tlsCaCert` warns rather than exits, since the system trust store may suffice — though an internal AD root usually is not in it.

```bash
NODE_ENV=production DIRECTORY_BACKEND=nss REQUIRE_LOGIN=ldaps \
  LDAP_AUTH_URL=ldaps://dc1.example.edu:636 \
  LDAP_CA_CERT=~/.ldap-cert.pem LDAP_UPN_SUFFIX=example.edu \
  node dist/server/index.js
```

```bash
# Read-only UI against AD via SSSD, running as the current user
NODE_ENV=production DIRECTORY_BACKEND=nss AUTH_MODE=local NSS_GROUP_PREFIX=grp- \
  node dist/server/index.js
```

`GET /api/health` reports the active backend, whether it is writable, and the auth mode.

### Config loading

`config/config.yaml` is gitignored (it holds the LDAP bind password), so `src/server/index.ts` falls back to the tracked `config/config.yaml.example` when it is absent. That is sufficient for the NSS backend, which uses nothing from the `ldap:` section. The LDAP backend exits with instructions rather than starting on placeholder credentials. If neither file exists the server exits.

## Key Configuration

| Setting | Value |
|---------|-------|
| Base DN | `dc=rco,dc=university,dc=edu` |
| LDAP Port | 10389 |
| Web App Port | 8088 |
| GID Range | 300000-400000 |
| Session Timeout | 1 hour |
| Default web login | `admin` / `changeme` (from `config.yaml`, must change in production) |

`src/server/index.ts` overrides `config.yaml`'s LDAP settings from `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_BASE_DN` env vars when set (used by `docker-compose.yml`); it also re-derives `groups.baseDN`, `users.baseDN`, and `groups.adminGroup` from `LDAP_BASE_DN` when that override is present.

## Source Structure

```
src/
├── client/src/
│   ├── main.tsx              # React entry
│   ├── App.tsx               # Auth state, switches between Login/Dashboard
│   ├── components/
│   │   ├── Login.tsx         # Login form
│   │   ├── Dashboard.tsx     # Group management UI
│   │   ├── MemberList.tsx    # Group members table
│   │   ├── UserSearch.tsx    # Debounced user search
│   │   ├── BulkAddModal.tsx  # Bulk member addition
│   │   └── GroupForm.tsx     # Create/edit group form
│   ├── hooks/useDebounce.ts
│   └── index.css             # Tailwind directives
└── server/
    ├── index.ts              # Express entry: config load, backend selection, session, auth routes, route mounting
    ├── types/ldap.ts          # Shared TypeScript interfaces (LdapUser, LdapGroup, AppConfig, ...)
    ├── directory/
    │   ├── backend.ts         # DirectoryBackend interface + ReadOnlyBackendError (the seam routes code against)
    │   ├── ldap-backend.ts    # LDAP implementation (writable)
    │   └── nss.ts             # NssBackend: getent(1) via execFile (read-only)
    ├── ldap/client.ts         # Singleton LDAP client wrapper (search/add/modify/delete, filter/DN escaping)
    ├── auth/authorization.ts  # canManageGroup / admin-group / nested-group-membership checks
    ├── audit/logger.ts        # Appends JSON-lines audit entries to permissions-changes.log
    ├── middleware/auth.ts     # requireAuth / requireAdmin session guards
    └── routes/
        ├── users.ts           # User search API
        ├── groups.ts          # Group CRUD + GID allocation
        ├── members.ts         # Add/remove/list direct members
        └── resolved.ts        # Recursive nested-group member resolution with breadcrumb paths
```

## Build System

- **Two TypeScript configs**: `tsconfig.json` (client/Vite) and `tsconfig.server.json` (server/CommonJS)
- **Vite proxy**: Dev server proxies `/api` → `localhost:8088`
- **Output**: `dist/client/` (static) + `dist/server/` (Node.js)

## LDAP Schema Duality

Groups are handled as **either** `posixGroup` (member UIDs in `memberUid`) **or** `groupOfNames` (member DNs in `member`) — the codebase checks which attribute is populated and branches accordingly (`memberUid.length > 0` → posixGroup path). New groups are always created as `posixGroup`, but existing/imported groups may be `groupOfNames`.

The branch lives in two layers, and changing member-resolution logic means touching both:
- **Writes** are centralized in `directory/ldap-backend.ts` (`usesMemberUid()` picks the attribute for add/remove).
- **Reads** still branch at the call sites: `routes/groups.ts`, `routes/members.ts`, `routes/resolved.ts`, and `auth/authorization.ts` each pick between `memberUid` and `member` themselves. Routes never parse DNs, though — `backend.resolveMember()` accepts either form.

## Authorization Model

- Groups have a `managedBy` attribute for delegation; `AuthorizationService.canManageGroup` grants access if the user is a direct or nested member of any DN in `managedBy`, or a member of the super-admin group `cn=389ers-admins`.
- **Authorization is expressed in login names, not DNs**, because NSS-sourced accounts have no DN. `authorization.ts` pulls RDN values out of references (`rdnValue`) so full DNs and the bare `cn=name`/`uid=name` forms NSS emits both work. `isMemberOf` recurses through nested groups with a `visited` set guarding circular membership.
- Session-based auth with httpOnly cookies (`isAdmin` flag drives create/delete group authorization; per-group management uses `canManageGroup`).
- `POST /api/auth/login` tries the local `admin` account from `config.yaml` first, then verifies the password by **binding to the directory as that user** (`auth/ldap-auth.ts`).

### LDAP user authentication

`authenticateUser()` opens a **short-lived connection per attempt**. It deliberately does not reuse the `LdapClient` singleton: that connection is bound as the service account and shared across concurrent requests, so re-binding it as an end user would swap the effective identity out from under unrelated in-flight operations.

The bind identity is derived in this order — `ldap.bindDnTemplate`, then `ldap.upnSuffix` (AD-style `<login>@<suffix>`), then a DN lookup through the directory backend. Logins are restricted to `[A-Za-z0-9._-]` rather than escaped per-context, which closes DN- and filter-injection in one move.

Two failure modes are easy to get wrong:
- **An empty password is rejected before any bind is attempted.** A simple bind with a DN and an empty password is an *unauthenticated bind* (RFC 4513 §5.1.2): AD returns success while granting nothing, so it would otherwise read as a valid login.
- **Only LDAP result code 49** (`invalidCredentials`) maps to a 401. Anything else is an operational fault and returns 503, so an unreachable DC is never reported to users as a wrong password. Internally the reason is logged; the client always sees a generic `Invalid credentials` so the endpoint cannot enumerate accounts.

The session id is regenerated on successful login (session fixation).

**Certificate chains.** AD typically presents leaf + intermediate but not the root. OpenLDAP's CLI tools accept that partial chain, but Node, Java, and Python do not — they build to a self-signed root or fail with `unable to get issuer certificate`. `ldaps-init` therefore pulls the published root from the forest's Configuration NC (`CN=Certification Authorities,CN=Public Key Services,CN=Services,<configurationNamingContext>`) and appends it, dropping expired generations of renewed CA keys. Note the Configuration NC lives under the **forest root**, which may differ from the domain NC — read it from the RootDSE rather than assuming.

## Related Documentation

- [docs/QA.md](./docs/QA.md) - Full requirements specification (Q&A format capturing design decisions)
- [docs/BUILD.md](./docs/BUILD.md) - 389 DS build guide
- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md) - Quick start
- [docs/PYTHON_ISSUES.md](./docs/PYTHON_ISSUES.md) - Python/build troubleshooting
- [scripts/README.md](./scripts/README.md) - PowerShell AD→LDIF export scripts (`Export-ADUsers.ps1`, `Export-ADGroups.ps1`) and the full AD export/import workflow

## 389 Directory Server Locations

A native 389 DS build (distinct from the `osixia/openldap` container docker-compose uses) lives here:

| Component | Path |
|-----------|------|
| Source code | `../389-ds-base` |
| Build directory | `../389-ds-build` |
| Installation | `./install/` |
| Server binary | `./install/sbin/ns-slapd` |
| Instance config | `./install/etc/dirsrv/slapd-localhost/` |
| Instance data | `./install/var/lib/dirsrv/slapd-localhost/` |
| Logs | `./install/var/log/dirsrv/slapd-localhost/` |

### Starting 389 DS

```bash
# Set library path and start
LD_LIBRARY_PATH=./install/lib:./install/lib/dirsrv \
  ./install/sbin/ns-slapd -D ./install/etc/dirsrv/slapd-localhost
```

### Credentials

- **Root DN**: `cn=Directory Manager`
- **Password**: `password`

## Related Repositories

| Repository | Path | Description |
|------------|------|--------------|
| 389-ds-base | `../389-ds-base` | 389 Directory Server source |
| 389ds.github.io | `../389ds.github.io` | 389 DS documentation |
