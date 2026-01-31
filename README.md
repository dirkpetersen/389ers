# RCO Group Manager (389ers)

Web-based frontend for managing Unix POSIX groups on 389 Directory Server for HPC systems at Oregon State University.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- 389 Directory Server (see BUILD.md)
- Ports 8088 (API) and 5173 (frontend) available

### Installation

```bash
# Install dependencies
npm install

# Start development servers
npm run dev
```

### Access the Application

1. Open browser to http://localhost:5173
2. Login with default credentials:
   - **Username:** `admin`
   - **Password:** `changeme`

## 📚 Documentation

- **[BUILD.md](./BUILD.md)** - Building 389 Directory Server from source
- **[QA.md](./QA.md)** - Complete requirements and Q&A
- **[CLAUDE.md](./CLAUDE.md)** - Project architecture and guidance
- **[PYTHON_ISSUES.md](./PYTHON_ISSUES.md)** - Python build issues and solutions

## 🏗️ Architecture

```
┌─────────────────────┐
│   React Frontend    │  Port 5173 (dev) - Tailwind CSS
│  (Vite dev server)  │  Oregon State orange/black theme
└──────────┬──────────┘
           │
           │ HTTP/JSON
           ▼
┌─────────────────────┐
│  Express API Server │  Port 8088
│  (Node.js/TypeScript)│  Session-based auth
└──────────┬──────────┘
           │
           │ LDAP
           ▼
┌─────────────────────┐
│ 389 Directory Server│  Port 10389
│  dc=rco,dc=university│  LMDB backend
└─────────────────────┘
```

## 🎨 Features

**Current (Demo Mode):**
- ✅ Login/logout with session management
- ✅ Group listing with search
- ✅ Split-panel UI (groups left, details right)
- ✅ OSU orange/black theming
- ✅ Mock data for testing

**Coming Soon:**
- [ ] Real LDAP integration
- [ ] User search and bulk operations
- [ ] Group creation and editing
- [ ] Nested group resolution
- [ ] Member management
- [ ] Audit logging
- [ ] SAML authentication

## 🛠️ Development

### Project Structure

```
389ers/
├── src/
│   ├── server/           # Express API (TypeScript)
│   │   └── index.ts
│   └── client/           # React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── Login.tsx
│       │   │   └── Dashboard.tsx
│       │   └── main.tsx
│       └── index.html
├── config/
│   └── config.yaml      # LDAP connection settings
├── install/             # 389 DS binaries (gitignored)
└── package.json
```

### Available Scripts

```bash
npm run dev          # Start dev servers (frontend + backend)
npm run dev:server   # Start API server only
npm run dev:client   # Start frontend only
npm run build        # Build for production
npm start            # Run production build
npm run lint         # Lint TypeScript code
```

### Configuration

Edit `config/config.yaml`:

```yaml
server:
  port: 8088
  sessionSecret: "change-me-in-production"
  sessionTimeout: 3600000  # 1 hour

ldap:
  url: "ldap://localhost:10389"
  baseDN: "dc=rco,dc=university,dc=edu"
  bindDN: "cn=Directory Manager"
  bindPassword: "password"
```

## 🔐 Security

**Current (Development):**
- Simple password-based authentication
- Session cookies (HTTP only)
- CORS enabled for localhost

**Production TODO:**
- SAML/SSO integration
- HTTPS required
- Secure session secrets
- Rate limiting
- Audit logging to file

## 🧪 Testing

```bash
# Currently using mock data
# Real LDAP integration coming next
```

## 📦 Deployment

### systemd User Service

```ini
[Unit]
Description=RCO Group Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/dp/gh/389/389ers
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

Install:
```bash
systemctl --user enable 389ers
systemctl --user start 389ers
```

## 🎯 Roadmap

### Phase 1: MVP (Current)
- [x] Project setup
- [x] Authentication UI
- [x] Basic group listing
- [x] Split-panel layout
- [ ] Real LDAP integration

### Phase 2: Core Features
- [ ] Group CRUD operations
- [ ] User search (virtualized for 100k users)
- [ ] Member management
- [ ] Bulk operations
- [ ] Audit logging

### Phase 3: Advanced
- [ ] Nested group resolution
- [ ] managedBy delegation
- [ ] AD sync monitoring
- [ ] SAML authentication
- [ ] Python CLI tools

## 🐛 Known Issues

1. **Python lib389 not installed** - See PYTHON_ISSUES.md for details
   - CLI tools (dscreate, dsconf) unavailable
   - Manual LDAP configuration required
   - Does not affect web app functionality

2. **Mock data only** - Real LDAP integration pending

3. **No instance created** - Need to manually create 389 DS instance

## 🤝 Contributing

1. Follow existing code style (ESLint configured)
2. Use TypeScript strict mode
3. Test with both admin and non-admin users
4. Document new configuration options

## 📄 License

See LICENSE file for details.

## 🏫 Oregon State University

Colors used:
- **OSU Orange:** #D73F09
- **OSU Orange Dark:** #B33507
- **OSU Black:** #000000
- **OSU Gray:** #4A4A4A

No official OSU branding used per requirements.

## 🔗 Related Projects

- [389 Directory Server](https://github.com/389ds/389-ds-base)
- [389 Documentation](https://github.com/389ds/389ds.github.io)

---

**Status:** 🟢 Development - Web app functional with mock data
**Last Updated:** 2026-01-31
