# Python Build Issues & Solutions

## Issues Encountered

During 389 DS installation, we encountered several Python-related build issues when trying to install `lib389` (the Python management library):

### 1. Missing `clang` Compiler

**Error:**
```
error: command 'clang' failed: No such file or directory
```

**Root Cause:** The `python-ldap` dependency tries to compile C extensions using `clang`, which wasn't installed.

**Solution:** Install clang or ensure gcc is used:
```bash
sudo apt-get install clang
# OR force use of gcc
export CC=gcc
```

### 2. Python Version Mismatch

**Error:**
```
Using cached python_ldap-3.4.5.tar.gz (388 kB)
Building wheel for python-ldap (pyproject.toml): finished with status 'error'
```

**Root Cause:** Python 3.14t (free-threaded build) was detected, which has limited package support.

**Observed:**
- System has both Python 3.12.3 (standard) and Python 3.14t (experimental)
- pip was defaulting to 3.14t for some operations

**Solution:** Explicitly use Python 3.12:
```bash
python3.12 -m pip install <package>
```

### 3. Setuptools Deprecation Warnings

**Warning:**
```
SetuptoolsDeprecationWarning: `project.license` as a TOML table is deprecated
```

**Root Cause:** The lib389 pyproject.toml uses deprecated license format.

**Impact:** Non-breaking warning, doesn't affect functionality.

**Solution:** Not required for our use case, but could be fixed in upstream.

### 4. Build Isolation Issues

**Error:**
```
× installing build dependencies did not run successfully.
Building wheel for python-ldap (pyproject.toml): started
Building wheel for python-ldap (pyproject.toml): finished with status 'error'
```

**Root Cause:** pip's build isolation creates temporary environments that may use wrong Python version or miss system libraries.

**Solution:** Skip lib389 Python CLI tools for now - not needed for web app.

## Current Status

**✅ Working:**
- 389 DS server built and installed successfully
- C core and plugins working
- Rust plugins compiled
- Server binaries available in `./install/`

**⚠️ Skipped (Not Needed):**
- lib389 Python CLI tools (dsconf, dsctl, dsidm, dscreate)
- Python management API

**Why It's OK:**
- Web app doesn't use lib389
- Web app connects directly to LDAP via ldapjs (Node.js)
- Server can be configured manually or via LDAP tools
- Production deployment won't need Python management tools

## Workarounds for Future

If lib389 CLI tools are needed later:

### Option 1: Use Docker
```bash
docker run -it 389ds/dirsrv:latest dscreate --help
```

### Option 2: Install from System Packages
```bash
sudo apt-get install 389-ds-base python3-lib389
```

### Option 3: Fix Python Environment
```bash
# Remove Python 3.14t, use only 3.12
sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1

# Install build dependencies
sudo apt-get install python3.12-dev libldap2-dev libsasl2-dev

# Install lib389 with explicit Python version
python3.12 -m pip install --user lib389
```

### Option 4: Manual LDAP Configuration
Use standard LDAP tools instead:
```bash
# Create instance
ldapadd -x -D "cn=Directory Manager" -W -f instance-config.ldif

# Manage entries
ldapsearch -x -b "dc=rco,dc=university,dc=edu"
ldapmodify -x -D "cn=Directory Manager" -W -f changes.ldif
```

## Recommendations

1. **Don't spend time fixing lib389 Python issues** - The web app is the primary interface
2. **Document manual LDAP configuration** - For initial setup
3. **Consider systemd service** - Can start ns-slapd without lib389
4. **Use web UI for management** - That's what we're building!

## Prevention for Future Builds

Add to BUILD.md under prerequisites:

```bash
# Ensure using standard Python 3.12, not experimental builds
python3 --version  # Should show 3.12.x, not 3.14t

# Install Python LDAP dependencies before attempting pip install
sudo apt-get install python3-dev libldap2-dev libsasl2-dev clang

# If lib389 needed, use system package:
sudo apt-get install python3-lib389
```

## Impact Assessment

**Critical Path:** ❌ No - Python issues don't block web app
**Workaround Available:** ✅ Yes - Manual LDAP configuration
**Production Impact:** ❌ None - Web app is primary interface
**Development Impact:** ⚠️ Minor - Manual instance creation needed

## Files Affected

- `/home/dp/gh/389/389-ds-base/src/lib389/` - Uninstalled
- No CLI tools: `dscreate`, `dsconf`, `dsctl`, `dsidm`
- Server binaries unaffected: `ns-slapd` works fine
