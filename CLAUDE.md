# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Related Repositories

This project is part of a larger 389 Directory Server ecosystem. See CLAUDE.md in each for details:

| Repository | Path | Description |
|------------|------|-------------|
| **389-ds-base** | `../389-ds-base` | 389 Directory Server source code |
| **389ds.github.io** | `../389ds.github.io` | 389 Directory Server documentation |
| **389ers** (this repo) | `.` | Web frontend for group management |

## Project Overview

**RCO Group Manager** (389ers) is a web-based frontend for managing Unix POSIX groups on 389 Directory Server for HPC systems at My lovely University. The system provides compliance-driven user authorization separate from Enterprise Active Directory.

## Architecture

```
┌─────────────────────┐         ┌─────────────────────┐
│   Enterprise AD     │         │    Other LDAP       │
│  (onid.university) │         │    Clients          │
└─────────┬───────────┘         └──────────┬──────────┘
          │                                │
          │ Users (scheduled)              │ Read-only
          │ Groups (async)                 │ port 10389
          ▼                                ▼
┌─────────────────────────────────────────────────────┐
│              389 Directory Server                    │
│         dc=rco,dc=university,dc=edu                │
│         systemd --user service, port 10389          │
└─────────────────────┬───────────────────────────────┘
                      │ LDAP bind
                      │ (service account)
                      ▼
┌─────────────────────────────────────────────────────┐
│              Node.js/TypeScript API                  │
│              Express/Fastify, port 8088             │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              React + Tailwind Frontend              │
│              "RCO Group Manager"                    │
└─────────────────────────────────────────────────────┘
```

### Data Flow
- Users replicated FROM Enterprise AD into 389 DS (scheduled: 1-4x daily)
- Groups/memberships managed in web app, synced TO AD immediately and asynchronously
- AD sync target OU: `ou=rco,dc=onid,dc=university,dc=edu`
- 389 DS serves as authoritative source for other LDAP clients on port 10389

## Tech Stack

- **Frontend**: React + Tailwind CSS (My lovely University orange/black theme)
- **Backend**: Node.js/TypeScript with Express or Fastify
- **Directory**: 389 Directory Server
- **Config**: Local YAML files
- **Audit**: `permissions-changes.log` (local file)

## Key Configuration

| Setting | Value |
|---------|-------|
| 389 DS Base DN | `dc=rco,dc=university,dc=edu` |
| 389 DS Port | 10389 |
| Web App Port | 8088 |
| GID Range | 300000-400000 |
| AD Sync Target | `ou=rco,dc=onid,dc=university,dc=edu` |
| Session Timeout | 1 hour |

## Authorization Model

- Groups have `managedBy` attribute (AD-compatible) listing users/groups who can manage membership
- Group creator is automatically added to `managedBy`
- Super-admin group `cn=389ers-admins` can manage all groups
- Initial local admin account seeded from YAML config

## UI Design Principles

- **Split-panel layout**: Groups list on left, details on right
- **Search-centric**: Large search bar, virtualized results (100k users, 10k groups)
- **Two main views**:
  1. Group/user management: add users to groups, view memberships
  2. Resolved membership: nested groups expanded with tree view + breadcrumb paths
- **Bulk operations**: Paste space/comma/newline separated lists of users or groups

## Build Commands

```bash
# Install dependencies
npm install

# Development server (frontend + backend)
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run tests
npm test

# Run single test file
npm test -- path/to/test.ts

# Lint
npm run lint
```

## systemd User Service

```bash
# Install service
systemctl --user enable 389ers
systemctl --user start 389ers

# View logs
journalctl --user -u 389ers -f
```

## Project Structure (Planned)

```
389ers/
├── config/
│   └── config.yaml          # LDAP connection, GID range, ports
├── src/
│   ├── api/                  # Express/Fastify routes
│   ├── ldap/                 # 389 DS client wrapper
│   ├── sync/                 # AD sync logic
│   └── web/                  # React frontend
├── scripts/
│   └── Export-ADUsers.ps1   # PowerShell AD export script
├── permissions-changes.log   # Audit log
├── QA.md                     # Full Q&A requirements document
└── CLAUDE.md                 # This file
```

## LDAP Schema

Groups use AD-compatible objectClasses with:
- `groupOfNames` for group membership
- `managedBy` attribute for delegation
- `member` attribute holds user DNs

User attributes synced from AD: `uid`, `cn`, `mail`, `uidNumber`, `gidNumber`, `unixHomeDirectory`

## See Also

- [QA.md](./QA.md) - Complete Q&A document with all project requirements
