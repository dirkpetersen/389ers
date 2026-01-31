# PowerShell Export Scripts

These scripts export Active Directory users and groups to LDIF format for import into 389 Directory Server.

## Prerequisites

- **Windows computer** with Active Directory module installed
- **RSAT Tools** (Remote Server Administration Tools)
- **PowerShell 5.1+** or PowerShell Core 7+
- **Domain credentials** with read access to AD

## Installation

### Install RSAT Tools (Windows 10/11)

```powershell
# Run as Administrator
Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
```

### Verify Installation

```powershell
Import-Module ActiveDirectory
Get-Command -Module ActiveDirectory
```

## Scripts

### 1. Export-ADUsers.ps1

Exports all enabled users from Active Directory with POSIX attributes.

**Features:**
- Exports all enabled user accounts
- Includes POSIX attributes (uidNumber, gidNumber, homeDirectory)
- Assigns sequential uidNumbers starting from 10000
- Creates LDIF-formatted output
- Includes relevant attributes: mail, givenName, sn, telephoneNumber, etc.

**Usage:**

```powershell
# Basic usage (current domain)
.\Export-ADUsers.ps1

# Custom output path
.\Export-ADUsers.ps1 -OutputPath "C:\exports\users.ldif"

# Custom base DN
.\Export-ADUsers.ps1 -BaseDN "dc=example,dc=com"

# Custom starting UID
.\Export-ADUsers.ps1 -StartingUidNumber 20000

# All options
.\Export-ADUsers.ps1 `
    -OutputPath "C:\exports\users.ldif" `
    -BaseDN "dc=rco,dc=university,dc=edu" `
    -UserOU "ou=People" `
    -StartingUidNumber 10000
```

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| OutputPath | .\ad-users-export.ldif | Output LDIF file path |
| BaseDN | dc=rco,dc=university,dc=edu | Target base DN in 389 DS |
| UserOU | ou=People | OU for users |
| StartingUidNumber | 10000 | Starting UID number |

**Output:**

Creates an LDIF file with:
- People OU definition
- User entries with posixAccount objectClass
- uidNumber and gidNumber assignments
- homeDirectory (/home/username)
- shadowAccount attributes for password aging

### 2. Export-ADGroups.ps1

Exports all groups from Active Directory with members and POSIX group attributes.

**Features:**
- Exports all AD groups
- Includes group memberships (user and nested groups)
- Assigns gidNumbers in range 300000-400000
- Resolves group managers (managedBy)
- Handles nested group references
- Creates admin group (389ers-admins)

**Usage:**

```powershell
# Basic usage (current domain)
.\Export-ADGroups.ps1

# Custom output path
.\Export-ADGroups.ps1 -OutputPath "C:\exports\groups.ldif"

# Custom GID range
.\Export-ADGroups.ps1 -StartingGidNumber 300000 -MaxGidNumber 400000

# All options
.\Export-ADGroups.ps1 `
    -OutputPath "C:\exports\groups.ldif" `
    -BaseDN "dc=rco,dc=university,dc=edu" `
    -GroupOU "ou=Groups" `
    -StartingGidNumber 300000 `
    -MaxGidNumber 400000
```

**Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| OutputPath | .\ad-groups-export.ldif | Output LDIF file path |
| BaseDN | dc=rco,dc=university,dc=edu | Target base DN in 389 DS |
| GroupOU | ou=Groups | OU for groups |
| StartingGidNumber | 300000 | Starting GID number |
| MaxGidNumber | 400000 | Maximum GID number |

**Output:**

Creates an LDIF file with:
- Groups OU definition
- Group entries with posixGroup objectClass
- gidNumber assignments (300000-400000 range)
- Member DNs (users and nested groups)
- managedBy attribute for delegation
- 389ers-admins admin group

## Complete Export Workflow

### Step 1: Export on Windows

```powershell
# Export users
.\Export-ADUsers.ps1 -OutputPath "C:\exports\users.ldif"

# Export groups
.\Export-ADGroups.ps1 -OutputPath "C:\exports\groups.ldif"
```

### Step 2: Transfer Files to Linux

```bash
# Using SCP
scp username@windowshost:C:/exports/*.ldif /home/dp/gh/389/389ers/ldif/

# Or copy via network share
cp /mnt/share/exports/*.ldif /home/dp/gh/389/389ers/ldif/
```

### Step 3: Import into 389 DS

```bash
# Import base DN structure first (if needed)
ldapadd -x -D "cn=Directory Manager" -W << EOF
dn: dc=rco,dc=university,dc=edu
objectClass: top
objectClass: domain
dc: rco

dn: ou=People,dc=rco,dc=university,dc=edu
objectClass: organizationalUnit
ou: People

dn: ou=Groups,dc=rco,dc=university,dc=edu
objectClass: organizationalUnit
ou: Groups
EOF

# Import users
ldapadd -x -D "cn=Directory Manager" -W -f users.ldif

# Import groups
ldapadd -x -D "cn=Directory Manager" -W -f groups.ldif
```

## Exported Attributes

### User Attributes

| LDAP Attribute | AD Source | Description |
|----------------|-----------|-------------|
| uid | sAMAccountName | Username |
| cn | DisplayName | Common name |
| sn | Surname | Last name |
| givenName | GivenName | First name |
| mail | EmailAddress | Email address |
| uidNumber | Generated | Unix UID (10000+) |
| gidNumber | Generated | Primary GID |
| homeDirectory | HomeDirectory | Unix home path |
| loginShell | (fixed) | /bin/bash |
| userPrincipalName | UserPrincipalName | UPN |
| description | Description | User description |
| title | Title | Job title |
| departmentNumber | Department | Department |
| telephoneNumber | telephoneNumber | Phone |
| employeeNumber | EmployeeID | Employee ID |

### Group Attributes

| LDAP Attribute | AD Source | Description |
|----------------|-----------|-------------|
| cn | sAMAccountName | Group name |
| gidNumber | Generated | Unix GID (300000-400000) |
| description | Description | Group description |
| member | Members | Group members (DNs) |
| managedBy | ManagedBy | Group manager (DN) |

## Scheduling Automated Exports

### Using Task Scheduler

Create a scheduled task to run exports daily:

```powershell
# Create scheduled task
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-File C:\scripts\Export-ADUsers.ps1 -OutputPath C:\exports\users.ldif"

$trigger = New-ScheduledTaskTrigger -Daily -At 3am

Register-ScheduledTask -TaskName "Export AD Users" `
    -Action $action `
    -Trigger $trigger `
    -User "DOMAIN\ServiceAccount" `
    -Password "password"
```

### Using a Batch Script

```batch
@echo off
REM Export AD to LDIF daily
cd C:\scripts
PowerShell.exe -ExecutionPolicy Bypass -File Export-ADUsers.ps1 -OutputPath C:\exports\users-%date:~-4,4%%date:~-10,2%%date:~-7,2%.ldif
PowerShell.exe -ExecutionPolicy Bypass -File Export-ADGroups.ps1 -OutputPath C:\exports\groups-%date:~-4,4%%date:~-10,2%%date:~-7,2%.ldif
```

## Troubleshooting

### "Cannot find module ActiveDirectory"

Install RSAT tools:
```powershell
Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
```

### "Access Denied"

Run PowerShell with domain credentials:
```powershell
$cred = Get-Credential
Import-Module ActiveDirectory
# Use -Credential $cred with Get-ADUser/Get-ADGroup
```

### "Execution Policy Restricted"

Allow script execution:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### LDIF Import Errors

**"Invalid syntax":**
- Check for special characters in descriptions
- Ensure DNs are properly formatted

**"Constraint violation":**
- Ensure base DN exists first
- Check uidNumber/gidNumber uniqueness

**"No such object":**
- Create OUs before importing entries
- Import users before groups (for member references)

## Best Practices

1. **Test first** - Run on small OUs before full export
2. **Review output** - Check LDIF file before importing
3. **Backup** - Backup 389 DS before large imports
4. **Incremental** - Import users first, then groups
5. **Validate** - Verify imports with ldapsearch
6. **Schedule** - Automate regular exports (daily/weekly)
7. **Monitor** - Check for export failures
8. **Clean data** - Remove disabled accounts before export

## Security Notes

- Scripts read AD with current user credentials
- No passwords are exported (LDAP bind needed separately)
- LDIF files contain email addresses and names (protect accordingly)
- Use service accounts with minimal read-only AD permissions
- Store LDIF exports securely
- Delete old exports after import

## Example Output

### User LDIF Entry
```ldif
dn: uid=jsmith,ou=People,dc=rco,dc=university,dc=edu
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
uid: jsmith
cn: John Smith
sn: Smith
givenName: John
mail: jsmith@university.edu
uidNumber: 10001
gidNumber: 10001
homeDirectory: /home/jsmith
loginShell: /bin/bash
```

### Group LDIF Entry
```ldif
dn: cn=research-team,ou=Groups,dc=rco,dc=university,dc=edu
objectClass: top
objectClass: groupOfNames
objectClass: posixGroup
cn: research-team
gidNumber: 300001
description: Research Team Members
member: uid=jsmith,ou=People,dc=rco,dc=university,dc=edu
member: uid=bjones,ou=People,dc=rco,dc=university,dc=edu
managedBy: uid=jsmith,ou=People,dc=rco,dc=university,dc=edu
```

## Support

For issues or questions:
1. Check script output for error messages
2. Review LDIF file syntax
3. Verify AD connectivity
4. Check RSAT installation
5. Consult main project documentation
