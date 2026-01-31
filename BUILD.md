# Building 389 Directory Server

This document describes how to build 389 Directory Server from source for the RCO Group Manager project.

## Prerequisites

### System Packages

Install all required dependencies:

```bash
# Core build tools
sudo apt-get update
sudo apt-get install -y \
    autoconf automake libtool pkg-config build-essential make gcc g++ git

# LDAP and directory server dependencies
sudo apt-get install -y \
    libldap2-dev \
    libsasl2-dev \
    libsasl2-modules \
    libsasl2-modules-gssapi-mit

# NSS/NSPR (Mozilla crypto libraries)
sudo apt-get install -y \
    libnspr4-dev \
    libnss3-dev \
    libnss3-tools

# Database backends
sudo apt-get install -y \
    liblmdb-dev \
    libdb-dev

# SSL/TLS and Kerberos (for AD passthrough auth)
sudo apt-get install -y \
    libssl-dev \
    libkrb5-dev \
    krb5-user \
    libgssapi-krb5-2

# PAM (for authentication modules)
sudo apt-get install -y \
    libpam0g-dev

# Regular expressions and internationalization
sudo apt-get install -y \
    libpcre3-dev \
    libicu-dev

# Event handling
sudo apt-get install -y \
    libevent-dev

# JSON support
sudo apt-get install -y \
    libjson-c-dev

# Systemd integration
sudo apt-get install -y \
    libsystemd-dev

# Password strength checking
sudo apt-get install -y \
    libcrack2-dev \
    cracklib-runtime

# Python (for lib389 management library and tests)
sudo apt-get install -y \
    python3 \
    python3-dev \
    python3-pip \
    python3-setuptools \
    python3-ldap \
    python3-pytest \
    python3-pytest-html

# Documentation tools
sudo apt-get install -y \
    doxygen \
    rsync

# Additional libraries for nested groups and replication
sudo apt-get install -y \
    libattr1-dev \
    libtalloc-dev

# LDAP client tools (useful for testing)
sudo apt-get install -y \
    ldap-utils

# Install Python lib389 dependencies
sudo pip3 install --upgrade \
    python-ldap \
    pytest \
    pytest-html \
    pyasn1 \
    pyasn1-modules \
    argcomplete \
    argparse-manpage
```

### Rust Toolchain

389 DS requires Rust for modern plugin components:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
```

## Build Process

### 1. Out-of-Tree Build Directory

Create a separate build directory to keep source clean:

```bash
mkdir -p /home/dp/gh/389/389-ds-build
cd /home/dp/gh/389/389-ds-build
```

### 2. Generate Configure Script

```bash
cd /home/dp/gh/389/389-ds-base
autoreconf -fiv
```

### 3. Configure

```bash
cd /home/dp/gh/389/389-ds-build
/home/dp/gh/389/389-ds-base/configure \
    --enable-debug \
    --with-openldap \
    --prefix=/home/dp/gh/389/389ers/install
```

**Configuration options:**
- `--enable-debug` - Debug symbols for development
- `--with-openldap` - Use system OpenLDAP libraries
- `--prefix` - Install to local directory within 389ers repo
- Net-SNMP is NOT required (monitoring excluded for simplicity)

### 4. Build

```bash
cd /home/dp/gh/389/389-ds-build
source $HOME/.cargo/env  # Load Rust environment
make -j$(nproc)
```

Build compiles:
- C core server (`ns-slapd`)
- 35+ C plugins (replication, ACL, MemberOf, etc.)
- 3 Rust plugins (entryuuid, entryuuid_syntax, pwdchan)
- Python lib389 management library
- CLI tools (dsconf, dsctl, dsidm, dscreate)

### 5. Install

```bash
cd /home/dp/gh/389/389-ds-build
make install
```

Installs to `/home/dp/gh/389/389ers/install/`:
- `bin/` - Client tools and utilities
- `sbin/` - Server binaries (ns-slapd)
- `lib/dirsrv/` - Core libraries (libslapd.so)
- `lib/dirsrv/plugins/` - All plugins
- `share/dirsrv/schema/` - LDAP schema files (~50 LDIF files)
- Python lib389 installed to system

## What Gets Built

### Rust Components

Rust is used for memory-safe plugin development:
- **slapi_r_plugin** - Safe Rust bindings for SLAPI (plugin API)
- **entryuuid** - UUID generation plugin
- **entryuuid_syntax** - UUID syntax validation
- **pwdchan** - Password channel plugin for secure password operations

### Key Features Included

- **Nested Groups** - Core groupOfNames functionality
- **AD Passthrough Auth** - Kerberos/GSSAPI support via libkrb5
- **Multi-master Replication** - Full replication plugin
- **LMDB Backend** - Modern database backend (preferred over BDB)
- **MemberOf Plugin** - Automatic group membership tracking
- **DNA Plugin** - Distributed Numeric Assignment (GID allocation)

## Installed Binaries

**Server:**
- `sbin/ns-slapd` - Main directory server daemon (5.6 MB)

**Client Tools:**
- `bin/dbscan` - Database inspection tool
- `bin/ldclt` - LDAP load testing tool
- `bin/pwdhash` - Password hashing utility
- `bin/ds-replcheck` - Replication consistency checker

**Management (Python):**
- `dsconf` - Configure running instances
- `dsctl` - Control instances (start/stop/status)
- `dsidm` - Identity management (users/groups)
- `dscreate` - Create new instances

## Excluded Components

- **Net-SNMP** - Monitoring/SNMP support excluded
- **CMocka** - C unit test framework (tests not built)
- **Cockpit** - Web UI included but may not be used
- **SystemD** - System integration disabled (using --user service)

## Build Time

- Full build: ~5-10 minutes on modern hardware
- Rust compilation: ~2-3 minutes (first time, downloads 70+ crates)
- Parallel build uses all CPU cores (`-j$(nproc)`)

## Automation

The `install-deps.sh` script in `/home/dp/gh/389/389-ds-build/` can be updated and used for CI/CD:

```bash
#!/bin/bash
set -e

# Install all system dependencies
sudo apt-get update && sudo apt-get install -y [all packages above]

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

# Build 389 DS
cd /home/dp/gh/389/389-ds-base
autoreconf -fiv

mkdir -p /home/dp/gh/389/389-ds-build
cd /home/dp/gh/389/389-ds-build

/home/dp/gh/389/389-ds-base/configure \
    --enable-debug \
    --with-openldap \
    --prefix=/home/dp/gh/389/389ers/install

make -j$(nproc)
make install
```

## Troubleshooting

**Missing cargo/rustc:**
```bash
source $HOME/.cargo/env
```

**Missing dependencies:**
```bash
# Run configure to see what's missing
./configure --enable-debug --with-openldap --prefix=/path/to/install 2>&1 | grep -i "not found"
```

**Build directory pollution:**
```bash
# Start fresh
cd /home/dp/gh/389/389-ds-build
make clean
# Or delete and recreate
rm -rf /home/dp/gh/389/389-ds-build
mkdir -p /home/dp/gh/389/389-ds-build
```

## Next Steps

After building, see:
- `INSTANCE.md` - Creating and configuring a 389 DS instance
- `CONFIG.md` - Configuring for RCO Group Manager
- `README.md` - Overall project documentation
