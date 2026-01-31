import express from 'express';
import session from 'express-session';
import cors from 'cors';
import fs from 'fs';
import yaml from 'yaml';
import path from 'path';

const app = express();

// Load configuration
const configPath = path.join(__dirname, '../../config/config.yaml');
const config = yaml.parse(fs.readFileSync(configPath, 'utf8'));

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Vite dev server
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: config.server.sessionTimeout,
    httpOnly: true,
    secure: false // Set to true in production with HTTPS
  }
}));

// Extend session type
declare module 'express-session' {
  interface SessionData {
    user?: {
      username: string;
      dn: string;
      isAdmin: boolean;
    };
  }
}

// Simple in-memory mock for now (will be replaced with LDAP)
const mockUsers = {
  admin: {
    password: config.admin.password,
    dn: 'cn=admin,dc=rco,dc=university,dc=edu',
    isAdmin: true
  }
};

// Auth routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  const user = mockUsers[username as keyof typeof mockUsers];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.user = {
    username,
    dn: user.dn,
    isAdmin: user.isAdmin
  };

  res.json({
    success: true,
    user: {
      username,
      isAdmin: user.isAdmin
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({
    username: req.session.user.username,
    isAdmin: req.session.user.isAdmin
  });
});

// Mock groups endpoint
app.get('/api/groups', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Mock data
  res.json({
    groups: [
      { cn: 'test-group-1', description: 'Test Group 1', gidNumber: 300001, memberCount: 5 },
      { cn: 'test-group-2', description: 'Test Group 2', gidNumber: 300002, memberCount: 3 },
      { cn: '389ers-admins', description: 'Admin Group', gidNumber: 300000, memberCount: 1 }
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = config.server.port || 8088;
app.listen(PORT, () => {
  console.log(`🚀 RCO Group Manager API listening on port ${PORT}`);
  console.log(`📁 Config loaded from: ${configPath}`);
  console.log(`🔗 Frontend dev server: http://localhost:5173`);
});
