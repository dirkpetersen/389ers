# RCO Group Manager (389ers)

Web-based frontend for managing Unix POSIX groups on 389 Directory Server for HPC systems at My lovely University.

<img width="1251" height="838" alt="RCO Group Manager screenshot" src="https://github.com/user-attachments/assets/9e3c63c4-6718-4658-8308-c76ae85f5871" />

## Quick Start

### Prerequisites

- Docker and docker-compose
- Node.js 18+ (for development mode only)

### Option 1: Docker (Recommended for Production)

```bash
docker-compose up -d
```

Open http://localhost:8088 and login with `admin` / `changeme`

### Option 2: Development Mode (Hot Reload)

```bash
# Start LDAP in Docker
docker-compose up -d 389-ds

# Wait for healthy status
docker-compose ps

# Install deps and start dev server
npm install
npm run dev
```

Open http://localhost:5173 and login with `admin` / `changeme`

### Option 3: Read-only against Active Directory (no LDAP setup)

On a Linux host already joined to AD with SSSD, the app can read the directory
through `getent(1)` using the machine's existing authentication — no LDAP
server, no bind credentials, no Docker:

```bash
npm install && npm run build
NODE_ENV=production DIRECTORY_BACKEND=nss AUTH_MODE=local NSS_GROUP_PREFIX=grp- npm start
```

Open http://127.0.0.1:8088 — you are signed in automatically as the OS user
running the process. This mode is **read-only**; see
[Directory Backends](#directory-backends) below.

### First Time Setup: Import Users (LDAP backend only)

On first run, bootstrap the directory structure, admin group, and a few test
accounts:

```bash
docker cp scripts/init-ldap.ldif 389-ds-localhost:/tmp/
docker exec 389-ds-localhost ldapadd -x -H ldap://localhost:389 \
  -D "cn=admin,dc=rco,dc=university,dc=edu" -w password \
  -f /tmp/init-ldap.ldif -c
```

To load real users instead, generate an LDIF from your own directory with
[`scripts/Export-ADUsers.ps1`](./scripts/README.md) and import it the same way.
Generated exports are **not** committed to this repository — they contain real
names and email addresses, and `.gitignore` deliberately excludes them.

Data persists in Docker volumes across restarts.

### Troubleshooting

**Port 8088 in use:** Kill existing process or use dev mode (port 5173)
```bash
lsof -i :8088
kill <PID>
```

**LDAP connection errors:** Restart the containers
```bash
docker-compose restart
```

**Reset everything (loses data):**
```bash
docker-compose down -v
docker-compose up -d
```

## Architecture

```
React Frontend (Vite, port 5173 dev / 8088 prod)
        |
        | /api proxy
        v
Express API (port 8088)
        |
        +-- DIRECTORY_BACKEND=ldap --> 389 DS / OpenLDAP (port 10389)   [read-write]
        |
        +-- DIRECTORY_BACKEND=nss  --> getent(1) -> nsswitch.conf        [read-only]
                                          |
                                          +-- local files
                                          +-- SSSD --> Active Directory
```

## Directory Backends

The API resolves users and groups through a pluggable backend, selected with the
`DIRECTORY_BACKEND` environment variable.

### `ldap` (default) — 389 DS / OpenLDAP

Binds with a service account from `config/config.yaml`. Full read-write: create,
rename, and delete groups, and add or remove members.

### `nss` — Active Directory via SSSD

Resolves through `getent(1)`, so it follows whatever the host's `nsswitch.conf`
is configured for. On an AD-joined Linux host running SSSD, that means the app
reads Active Directory **using the machine's existing authentication** — no bind
DN, no service-account password, no LDAP configuration in this app at all.

```bash
npm run build
NODE_ENV=production \
DIRECTORY_BACKEND=nss \
AUTH_MODE=local \
NSS_GROUP_PREFIX=grp- \
  npm start
```

Then open http://127.0.0.1:8088 — `AUTH_MODE=local` signs you in as the OS user
running the process, so there is no login prompt.

The same command works on a machine that is *not* AD-joined; `getent` simply
resolves against local `/etc/passwd` and `/etc/group` instead, which is handy for
development.

> **This backend is read-only.** `getent` cannot write to the directory, so
> creating or deleting groups and adding or removing members all return HTTP 501.
> Use `DIRECTORY_BACKEND=ldap` to manage groups.

Verify which backend is live at any time:

```bash
curl -s http://127.0.0.1:8088/api/health
```

#### Things to know about the NSS backend

- **Unix groups do not nest**, so resolved membership is always flat.
- **There is no `managedBy` attribute.** Delegation is expressed by naming
  convention: members of `<group>-adm` may manage `<group>`. Being a member of a
  group grants no management rights on its own.
- **Search depends on directory enumeration.** SSSD ships with
  `enumerate = false` for AD providers, because enumerating a large domain is
  expensive, so substring search will return little or nothing there. The backend
  always also tries an exact-name lookup, so searching for a full account name
  keeps working. Set `enumerate = true` in `sssd.conf` to restore substring
  search, at a real performance cost on large domains.

#### NSS environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NSS_ADMIN_SUFFIX` | `-adm` | Suffix identifying a group's manager group |
| `NSS_GROUP_PREFIX` | *(empty)* | Only show groups with this prefix, hiding per-user private groups |
| `NSS_MIN_UID` / `NSS_MIN_GID` | `1000` | Hide system accounts |
| `NSS_MAX_ID` | `65000` | Hide the `nobody` / `nogroup` sentinels at 65534 |

### Authentication modes

| `AUTH_MODE` | Behaviour |
|-------------|-----------|
| `password` (default) | Local `admin` account from `config.yaml`. LDAP bind-as-user is not yet implemented. |
| `local` | Trusts the OS identity of the process owner; no login prompt. Binds to `127.0.0.1` only. |

`AUTH_MODE=local` grants the running user's identity to anyone who can reach the
port, so it binds to loopback by default. Override with `BIND_HOST` only if you
have put real authentication in front of it.

## Configuration

| Setting | Value |
|---------|-------|
| Base DN | `dc=rco,dc=university,dc=edu` |
| LDAP Port | 10389 |
| Web App Port | 8088 (prod) / 5173 (dev) |
| GID Range | 300000-400000 |

### Default Credentials

| Service | Username | Password |
|---------|----------|----------|
| Web App | `admin` | `changeme` |
| LDAP Admin | `cn=admin,dc=rco,dc=university,dc=edu` | `password` |

## Available Scripts

```bash
npm run dev          # Start dev servers (frontend + backend)
npm run dev:server   # Start API server only
npm run dev:client   # Start frontend only
npm run build        # Build for production
npm start            # Run production build
npm run lint         # Currently broken — no ESLint config file exists in the repo
```

There is no test framework configured.

## Project Structure

```
389ers/
├── src/
│   ├── server/           # Express API (TypeScript)
│   │   ├── index.ts      # Entry point: config, backend selection, auth routes
│   │   ├── directory/    # Pluggable backends (LDAP / NSS) — see above
│   │   ├── ldap/         # LDAP client wrapper
│   │   ├── routes/       # API routes (users, groups, members, resolved)
│   │   ├── auth/         # Authorization (canManageGroup, nested membership)
│   │   ├── audit/        # Audit logging
│   │   ├── middleware/   # Session guards
│   │   └── types/        # Shared TypeScript interfaces
│   └── client/           # React frontend
│       └── src/
│           ├── App.tsx
│           ├── components/
│           └── hooks/
├── config/
│   └── config.yaml       # LDAP settings (gitignored — see below)
├── scripts/              # PowerShell AD→LDIF export, LDAP bootstrap fixture
├── docs/                 # Requirements, build guide, troubleshooting
├── docker-compose.yml    # Docker services
├── Dockerfile            # Web app container
└── package.json
```

`config/config.yaml` is gitignored because it holds the LDAP bind password, so a
fresh clone will not have one. The server falls back to the tracked
`config/config.yaml.example`, which is enough for the NSS backend — it reads only
the non-LDAP settings (port, session, GID range). The LDAP backend needs real
credentials and will exit with instructions if only the example is present:

```bash
cp config/config.yaml.example config/config.yaml   # then fill in your LDAP settings
```

## Documentation

- **[docs/BUILD.md](./docs/BUILD.md)** - Building 389 DS from source
- **[docs/QA.md](./docs/QA.md)** - Complete requirements
- **[docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)** - Quick start guide
- **[docs/PYTHON_ISSUES.md](./docs/PYTHON_ISSUES.md)** - Python/build troubleshooting
- **[scripts/README.md](./scripts/README.md)** - PowerShell AD→LDIF export workflow
- **[CLAUDE.md](./CLAUDE.md)** - Project architecture

## Features

- Pluggable directory backends: 389 DS / OpenLDAP (read-write) or Active
  Directory via SSSD (read-only)
- Login/logout with session management, or passwordless local-OS-identity mode
- Group listing with search
- Create/edit/delete groups *(LDAP backend only)*
- Member management *(LDAP backend only)*
- User search with debounce
- Bulk member operations
- Nested group resolution with breadcrumb paths
- Delegated management via `managedBy` (LDAP) or `<group>-adm` convention (NSS)
- Audit logging
- University orange/black theming

## Security

**Development:**
- Simple password-based authentication
- Session cookies (HTTP only)

**Production TODO:**
- SAML/SSO integration
- HTTPS required
- Rate limiting

## University Colors

- **Orange:** #D73F09
- **Black:** #000000
- **Gray:** #4A4A4A

---

**Status:** Development
**Last Updated:** 2026-07-20
