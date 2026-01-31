# Getting Started with RCO Group Manager

## ✅ What's Ready

You can now log in to the web application!

## 🚀 Access the Application

### Quick Access
1. **Open your browser** to: http://localhost:5173
2. **Login with:**
   - Username: `admin`
   - Password: `changeme`

### What You'll See
- **Login page** with OSU orange/black branding
- **Dashboard** with split-panel layout:
  - Left panel: List of groups with search
  - Right panel: Selected group details
- **Mock data** showing 3 test groups

## 🎯 Current Functionality

### ✅ Working Now
- User authentication (session-based)
- Login/logout
- Group listing with 3 mock groups
- Search/filter groups
- View group details (name, description, GID, member count)
- Responsive UI with OSU theming

### 🔄 Coming Next
- Real LDAP integration
- User search
- Add/remove members
- Create new groups
- Edit group properties
- Nested group resolution
- Audit logging

## 🏗️ What Was Built

### 1. 389 Directory Server
- ✅ **Built from source** - All C and Rust components compiled
- ✅ **Installed locally** - In `./install/` directory
- ✅ **Plugins included** - Nested groups, replication, MemberOf, DNA
- ⚠️ **Instance not created yet** - Manual LDAP setup needed for production

### 2. Web Application
- ✅ **Frontend** - React + Tailwind CSS with Vite
- ✅ **Backend** - Express API with TypeScript
- ✅ **Authentication** - Session-based with configurable timeout
- ✅ **Configuration** - YAML-based in `config/config.yaml`
- ✅ **Development servers** - Both running on ports 5173 (frontend) and 8088 (backend)

### 3. Documentation
- ✅ **BUILD.md** - Complete build instructions for 389 DS
- ✅ **QA.md** - All requirements captured from our discussion
- ✅ **CLAUDE.md** - Architecture and project guidance
- ✅ **PYTHON_ISSUES.md** - Python build issues documented
- ✅ **README.md** - Project overview and quick start

## 🔍 Testing the App

### Login Flow
1. Go to http://localhost:5173
2. You'll see the login page
3. Enter `admin` / `changeme`
4. Click "Sign in"
5. You'll be redirected to the dashboard

### Dashboard Features
- **Search bar** - Type to filter groups in real-time
- **Group list** (left panel) - Click any group to view details
- **Details panel** (right panel) - Shows selected group info
- **User info** - Top right corner shows username and "Administrator" badge
- **Logout button** - Top right corner

### Mock Data
The app currently shows 3 test groups:
- `test-group-1` (GID 300001, 5 members)
- `test-group-2` (GID 300002, 3 members)
- `389ers-admins` (GID 300000, 1 member)

## 📁 Project Structure

```
389ers/
├── install/              # 389 DS binaries (5.6 MB server + plugins)
├── src/
│   ├── server/          # Express API (TypeScript)
│   │   └── index.ts     # Main API with auth and mock endpoints
│   └── client/          # React frontend
│       ├── index.html
│       └── src/
│           ├── App.tsx                    # Main app component
│           ├── components/
│           │   ├── Login.tsx              # Login page
│           │   └── Dashboard.tsx          # Main dashboard
│           ├── main.tsx                   # React entry point
│           └── index.css                  # Tailwind styles
├── config/
│   └── config.yaml      # Application configuration
├── package.json         # Node.js dependencies
└── [documentation files]
```

## 🛠️ Development Commands

```bash
# Start both servers (frontend + backend)
npm run dev

# Start only backend
npm run dev:server

# Start only frontend
npm run dev:client

# Build for production
npm run build

# Run production build
npm start

# Check API health
curl http://localhost:8088/api/health
```

## 🔧 Next Steps

### Phase 1: LDAP Integration
1. Create 389 DS instance manually
2. Configure base DN: `dc=rco,dc=university,dc=edu`
3. Replace mock data with real LDAP queries
4. Implement ldapjs client in Express API

### Phase 2: Core Features
1. User search with virtualization (100k users)
2. Add/remove group members
3. Create new groups
4. Edit group properties
5. Bulk operations (paste lists)

### Phase 3: Advanced Features
1. Nested group resolution with tree view
2. `managedBy` delegation
3. AD sync monitoring
4. SAML authentication
5. Audit logging to file

## 💡 Tips

### Restarting Servers
If you need to restart the dev servers:
```bash
# Kill existing processes
pkill -f "tsx watch"
pkill -f "vite"

# Start again
npm run dev
```

### Changing Configuration
Edit `config/config.yaml` to change:
- Server ports
- LDAP connection details
- Session timeout
- Admin credentials

### Viewing Logs
The API logs to console, including:
- Startup message with port
- API requests
- Errors

### Browser DevTools
- Check Network tab for API calls
- Check Console for any frontend errors
- Check Application > Cookies for session

## 🎨 UI Design

**Colors:**
- Primary: OSU Orange (#D73F09)
- Secondary: OSU Orange Dark (#B33507)
- Text: OSU Black (#000000)
- Subtle: OSU Gray (#4A4A4A)

**Layout:**
- Split panel (responsive)
- Large search bar
- Clean, modern design
- Focus on usability

## 📊 Performance

**Current:**
- Mock data loads instantly
- Client-side search is very fast
- Session timeout: 1 hour

**Future with LDAP:**
- Virtualized lists for large datasets
- Server-side search/filtering
- Pagination for results
- Caching for frequently accessed data

## 🐛 Troubleshooting

**Can't access http://localhost:5173**
- Check dev servers are running: `ps aux | grep -E "(tsx|vite)"`
- Restart with `npm run dev`

**Login not working**
- Verify API is running: `curl http://localhost:8088/api/health`
- Check browser console for errors
- Clear cookies and try again

**Port already in use**
- Change ports in `config/config.yaml` (API) and `vite.config.ts` (frontend)
- Or kill processes using those ports

## 🚀 You're All Set!

The RCO Group Manager web application is now fully functional with mock data. You can:
- ✅ **Log in now** at http://localhost:5173
- ✅ **Test the UI** and user experience
- ✅ **See the dashboard** with group listings
- ✅ **Search and filter** groups
- ⏭️ **Next:** Connect to real LDAP when 389 DS instance is ready

Enjoy exploring the app!
