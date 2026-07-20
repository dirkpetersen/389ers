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

## Docker Setup

```bash
docker-compose up -d     # Start LDAP + web app
docker-compose ps        # Check status
docker-compose down      # Stop services
docker-compose down -v   # Stop and wipe LDAP data volumes
```

**Important**: `docker-compose.yml` runs `osixia/openldap` (plain OpenLDAP), not actual 389 Directory Server, as the dev/prod LDAP backend. This is a stand-in — schema and behavior (e.g. `posixGroup`/`memberUid` vs `groupOfNames`/`member`) may not exactly match a real 389 DS instance. A real 389 DS build exists separately under `./install/` (see below) for when server-accurate testing is needed.

First-time setup requires importing AD-exported users via LDIF (see `scripts/ad-users-export.ldif`, `scripts/init-ldap.ldif`); import order matters — users before groups (group `member`/`managedBy` reference user DNs).

## Directory Backends

The app resolves users and groups through a `DirectoryBackend` (`src/server/directory/`), selected by the `DIRECTORY_BACKEND` env var. Routes never talk to LDAP or parse DNs directly.

| Backend | Value | Source | Writable |
|---------|-------|--------|----------|
| LDAP | `ldap` (default) | Service-account bind to 389 DS / OpenLDAP | Yes |
| NSS | `nss` | `getent(1)`, following `nsswitch.conf` — local files and/or SSSD against Active Directory | **No** |

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

`AUTH_MODE=password` (default) uses the local `admin` account from `config.yaml`. LDAP bind-as-user is still unimplemented (see Authorization Model below).

```bash
# Read-only UI against AD via SSSD, running as the current user
NODE_ENV=production DIRECTORY_BACKEND=nss AUTH_MODE=local NSS_GROUP_PREFIX=grp- \
  node dist/server/index.js
```

`GET /api/health` reports the active backend, whether it is writable, and the auth mode.

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
    ├── index.ts              # Express entry: config load, session, auth routes, route mounting
    ├── types/ldap.ts          # Shared TypeScript interfaces (LdapUser, LdapGroup, AppConfig, ...)
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

Groups are handled as **either** `posixGroup` (member UIDs in `memberUid`) **or** `groupOfNames` (member DNs in `member`) — the codebase checks which attribute is populated and branches accordingly (`memberUid.length > 0` → posixGroup path). This dual handling is duplicated across `routes/groups.ts`, `routes/members.ts`, `routes/resolved.ts`, and `auth/authorization.ts`; when changing member-resolution logic, update all of them consistently. New groups are always created as `posixGroup` (`routes/groups.ts`'s `POST /`), but existing/imported groups may be `groupOfNames`.

## Authorization Model

- Groups have a `managedBy` attribute for delegation; `AuthorizationService.canManageGroup` grants access if the user is a direct or nested member of any DN in `managedBy`, or a member of the super-admin group `cn=389ers-admins`.
- Session-based auth with httpOnly cookies (`isAdmin` flag drives create/delete group authorization; per-group management uses `canManageGroup`).
- **Login is only partially implemented**: `POST /api/auth/login` checks the local `admin`/`changeme` account from `config.yaml`; real LDAP user authentication (binding as the user to verify their password) is stubbed out and always returns 401. Don't assume LDAP-authenticated users can log in yet.

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
