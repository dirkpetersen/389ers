# Q&A - Project Requirements

This document captures the questions and answers that shaped the 389ers (RCO Group Manager) project requirements.

## Technology Stack

**Q: What language/framework for the web backend API?**
A: Node.js/TypeScript with Express or Fastify. Chosen for tight integration with React frontend and excellent LDAP libraries.

**Q: What frontend framework?**
A: React with Tailwind CSS for modern, responsive UI with great visuals.

**Q: Should the web app run in a container or directly on the host?**
A: Runs as a `--user` systemd service as the current user.

## 389 Directory Server Setup

**Q: Is the 389 DS already installed, or do we need to set it up from scratch?**
A: Set up from scratch.

**Q: What's the base DN / suffix for the directory?**
A: `dc=rco,dc=university,dc=edu`

**Q: What authentication will the web app use to bind to 389 DS?**
A: Service account with DN/password.

**Q: What should the service account DN be?**
A: To be determined during setup (e.g., `cn=admin,dc=rco,dc=university,dc=edu`).

**Q: Should we create a self-signed cert for 389 DS?**
A: Out of scope for development purposes.

**Q: Any specific password policy requirements?**
A: Not yet.

## Data Model

**Q: What LDAP objectClasses for groups?**
A: AD-compatible schema. Using `groupOfNames` with `managedBy` attribute for delegation.

**Q: What's the target OU structure?**
A:
- 389 DS: `dc=rco,dc=university,dc=edu`
- AD sync target: `ou=rco,dc=onid,dc=university,dc=edu`

**Q: What's the GID range?**
A: 300000-400000

## AD Integration

**Q: Is the AD replication bidirectional sync automated, or manual export/import?**
A: Automated.

**Q: What OU in AD receives the replicated groups?**
A: `ou=rco,dc=onid,dc=university,dc=edu`

**Q: How often should sync happen?**
A:
- Groups TO AD: Immediately and asynchronously when changes happen in the web app
- Users FROM AD: Once a day or 4 times a day (scheduled)

**Q: For the PowerShell export script - what AD server/domain should it connect to?**
A: Runs on a Windows computer using the currently logged-in domain (no special configuration).

**Q: Which user attributes need to be synced from AD?**
A: uid, cn, mail, uidNumber, gidNumber, unixHomeDirectory

## Authentication & Authorization

**Q: How do users authenticate to the web app?**
A: Local accounts initially, SAML later.

**Q: Should there be a default admin user created on first run?**
A: Yes, username `admin` with password seeded from YAML config, must be changed on first login.

**Q: Who can manage groups?**
A: Role-based:
- The `managedBy` attribute on each group lists users/groups who can manage that group's membership
- The user who creates a group is automatically added to `managedBy` and can add others
- A super-admin group (`cn=389ers-admins,ou=Groups,dc=rco,dc=university,dc=edu`) can manage all groups
- Additional rules TBD

**Q: Can users create new groups, or only manage membership of existing groups?**
A: Users can create new groups.

**Q: When a new group is created, what's the process for assigning the initial managedBy?**
A: The user who created the group is added to `managedBy` and has the ability to add others.

**Q: Should there be a "request access" workflow?**
A: Later - noted on roadmap.

## Web Application

**Q: What port should the web app run on?**
A: 8088

**Q: Should it support HTTPS from the start?**
A: No, HTTP is fine for testing. Will be behind reverse proxy in production.

**Q: Session timeout?**
A: 1 hour

## UI Design

**Q: Color scheme preference?**
A: My lovely University orange/black theming (no official university logo/branding).

**Q: Main page interface style?**
A: Split-panel with search-centric design. Groups on left, details on right. Search-first but also allows browsing within search results.

**Q: How many groups and users approximately?**
A: ~100,000 users, ~10,000 groups. Requires virtualized lists and search - cannot load all at once.

**Q: Nested group display (Page 2 - resolved membership)?**
A: Both:
- Tree view showing the hierarchy
- Flat list with "via Group X → Group Y" breadcrumb showing path

**Q: Bulk operations?**
A: Yes, both:
- Add multiple users to a group at once (paste a list)
- Add one user to multiple groups at once
- Accepts space, comma, or newline separated lists

**Q: Group creation fields?**
A:
- Group name (cn) - required
- Description - required
- Initial members - optional
- Everything else - optional

**Q: Project name for the UI?**
A: "RCO Group Manager"

## Audit & Logging

**Q: Should the app track who made what changes and when?**
A: Yes, stored in local file `permissions-changes.log`. Format: who made what changes and when (e.g., "user jsmith added bsmith to group-x at 2024-01-31 10:30")

**Q: When a group change syncs to AD and fails?**
A: Both logged and retried automatically, and shown to the user in the UI. (Lower priority - focus on beautiful functioning UI first)

## Local Configuration (YAML)

The following will be configurable in YAML files:
- 389 DS connection info (host, port, bind DN)
- GID range (300000-400000)
- AD sync target OU
- Admin group DN
- Web app port
- Initial admin credentials

## Future Roadmap (Out of Scope for Now)

- Python CLI tools that connect to the API
- SAML authentication
- Request access workflow
- TLS/HTTPS configuration
- Password policies

## Related Repositories

- `../389-ds-base` - 389 Directory Server source code
- `../389ds.github.io` - 389 Directory Server documentation
