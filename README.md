# RCO Group Manager (389ers)

Web-based frontend for managing Unix POSIX groups on 389 Directory Server for HPC systems at My lovely University.

<img width="1251" height="838" alt="RCO Group Manager screenshot" src="https://github.com/user-attachments/assets/9e3c63c4-6718-4658-8308-c76ae85f5871" />

## Quick Start — Active Directory over LDAPS (default)

On a Linux host joined to AD with SSSD, this is the whole setup. No LDAP server
to run, no service account, no Docker.

### 1. Install prerequisites

```bash
# Ubuntu/Debian
sudo apt-get install ldap-utils openssl
# RHEL/AlmaLinux
sudo yum install openldap-clients openssl
```

Node.js 18+ is also required.

### 2. Configure the host for LDAPS

```bash
sudo ./ldaps-init -v
```

This discovers your domain controllers from `/etc/sssd/sssd.conf` (or
`/etc/krb5.conf`), fetches the CA chain including the root AD publishes, and
writes `~/.ldaprc` with every DC, your base DN, and your bind DN. `sudo` is
needed to read `sssd.conf`; the config is still written to *your* home
directory. You are prompted for your password and offered the option to save it
to `~/.ldappass` (mode `600`) once the bind actually succeeds.

Verify it worked — this needs no `-D` or `-H`, since `~/.ldaprc` now carries them:

```bash
ldapsearch -x -y ~/.ldappass "(sAMAccountName=$USER)" cn mail
```

### 3. Run the app

```bash
npm install && npm run build

NODE_ENV=production DIRECTORY_BACKEND=nss REQUIRE_LOGIN=ldaps \
  LDAP_AUTH_URL=$(awk '/^URI/{print $2}' ~/.ldaprc) \
  LDAP_CA_CERT=~/.ldap-cert.pem \
  LDAP_UPN_SUFFIX=example.edu \
  npm start
```

Open http://localhost:8088 and log in with your **directory** account.
`REQUIRE_LOGIN=ldaps` means a successful LDAPS bind is the only way in — the
shared `admin`/`changeme` account is disabled. Set `LDAP_UPN_SUFFIX` to your AD
domain (the part after `@` in your `user@domain` login).

This mode is **read-only** — group management needs a writable backend, see
[Directory Backends](#directory-backends). Full detail, including certificate
chain handling and every option, is in **[docs/LDAPS.md](./docs/LDAPS.md)**.

<details>
<summary><b>Variant: trust the local OS user instead of prompting</b></summary>

Drop `REQUIRE_LOGIN` to sign in automatically as the OS user running the
process — convenient on a workstation you already own. This binds to
`127.0.0.1` only, because it grants the app's identity to anyone who can reach
the port:

```bash
NODE_ENV=production DIRECTORY_BACKEND=nss AUTH_MODE=local NSS_GROUP_PREFIX=grp- npm start
```
</details>

## Alternative Setups

<details>
<summary><b>Docker with a local 389 DS / OpenLDAP (read-write)</b></summary>

Needed if you want to **manage** groups rather than only read them.

```bash
docker-compose up -d
```

Open http://localhost:8088 and log in with `admin` / `changeme`.
**Change that password before exposing the app** — see [Configuration](#configuration).
</details>

<details>
<summary><b>Development mode (hot reload)</b></summary>

```bash
docker-compose up -d 389-ds   # start LDAP
docker-compose ps             # wait for healthy status
npm install
npm run dev
```

Open http://localhost:5173 and log in with `admin` / `changeme`.
</details>

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
        +-- DIRECTORY_BACKEND=ad   --> Active Directory (LDAP/LDAPS)     [read-write, gated]
        |
        +-- DIRECTORY_BACKEND=nss  --> getent(1) -> nsswitch.conf        [read-only]
                                          |
                                          +-- local files
                                          +-- SSSD --> Active Directory
```

## Directory Backends

The API resolves users and groups through a pluggable backend, selected with the
`DIRECTORY_BACKEND` environment variable. `CONFIG_FILE` selects which config
file to load, so each deployment can keep its own.

### `ldap` (default) — 389 DS / OpenLDAP

Binds with a service account from `config/config.yaml`. Full read-write: create,
rename, and delete groups, and add or remove members.

### `ad` — Active Directory over LDAP (read-write)

Binds to a domain controller directly. Use this when you need to **create and
modify groups** in AD — the `nss` backend below can only read.

```bash
cp config/config.ad.yaml.example config/config.ad.yaml   # then edit it
CONFIG_FILE=config/config.ad.yaml DIRECTORY_BACKEND=ad npm start
```

AD is not schema-compatible with 389 DS, so this is a separate backend rather
than a config switch:

| | 389 DS / OpenLDAP | Active Directory |
|---|---|---|
| Login attribute | `uid` | `sAMAccountName` |
| Group class | `posixGroup` | `group` |
| Membership | `memberUid` (login names) | `member` (DNs) |
| User RDN | `uid=jsmith` | `CN=Jane Smith` — login not derivable from the DN |
| Required on create | `cn`, `gidNumber` | `cn`, `sAMAccountName`, `groupType` |
| `managedBy` | multi-valued | single-valued |

#### Plain LDAP vs LDAPS

The example config ships with plain `ldap://`. Two consequences:

1. **The bind password and every group change cross the network in cleartext.**
2. **Your DC may refuse writes outright.** If the policy *Domain controller:
   LDAP server signing requirements* is set to *Require signing* — the
   recommended hardening since Microsoft ADV190023, and the default in many
   environments — a cleartext simple bind is rejected with LDAP error 8
   (`strongerAuthRequired`). No application setting works around that; the fix
   is `ldaps://` on port 636.

Plain LDAP is reasonable against a lab DC or an isolated segment. For real
accounts, use `ldaps://` and set `ad.safety.requireTls: true`.

#### Write safety

Writing to AD has a far larger blast radius than writing to a lab 389 DS, so
writes are gated. Under `ad.safety`:

| Key | Default | Effect |
|-----|---------|--------|
| `writeEnabled` | `false` | While false every mutating endpoint returns 501 |
| `allowedOus` | *(empty)* | Writes refused unless the target DN is under one of these subtrees; empty refuses everything |
| `protectedNames` | — | Names that can never be modified or deleted |
| `requireTls` | `true` | Refuses to write over a non-TLS connection |

Every guard is checked before the request reaches the network. Directory
rejections are surfaced with the LDAP result code and a hint rather than a bare
500 — error 8 points at signing/TLS, 50 at bind-account permissions, 65 at a
schema mismatch (typically `writeGidNumber: true` on an AD without RFC2307/IDMU).

#### POSIX attributes

Stock AD has no `gidNumber`. `ad.writeGidNumber` defaults to `false`; turning it
on without the RFC2307/IDMU schema extension makes group creation fail with an
object class violation.

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

- **[docs/LDAPS.md](./docs/LDAPS.md)** - LDAPS setup, `ldaps-init`, and app authentication
- **[docs/BUILD.md](./docs/BUILD.md)** - Building 389 DS from source
- **[docs/QA.md](./docs/QA.md)** - Complete requirements
- **[docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)** - Quick start guide
- **[docs/PYTHON_ISSUES.md](./docs/PYTHON_ISSUES.md)** - Python/build troubleshooting
- **[scripts/README.md](./scripts/README.md)** - PowerShell AD→LDIF export workflow
- **[CLAUDE.md](./CLAUDE.md)** - Project architecture

## Features

- Pluggable directory backends: 389 DS / OpenLDAP, Active Directory over LDAP
  (both read-write), or Active Directory via SSSD (read-only)
- Login/logout with session management, or passwordless local-OS-identity mode
- Group listing with search
- Create/edit/delete groups *(LDAP and AD backends)*
- Member management *(LDAP and AD backends)*
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
