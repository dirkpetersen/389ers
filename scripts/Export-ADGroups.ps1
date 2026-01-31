<#
.SYNOPSIS
    Export Active Directory groups to LDIF format for 389 Directory Server import

.DESCRIPTION
    This script exports all group objects from the current Active Directory domain
    to LDIF format compatible with 389 Directory Server. It includes group memberships
    and POSIX group attributes.

.PARAMETER OutputPath
    Path where the LDIF file will be saved. Defaults to .\ad-groups-export.ldif

.PARAMETER BaseDN
    Target base DN in 389 DS. Defaults to dc=rco,dc=university,dc=edu

.PARAMETER StartingGidNumber
    Starting GID number for groups. Defaults to 300000 (per requirements)

.EXAMPLE
    .\Export-ADGroups.ps1
    Exports all groups to ad-groups-export.ldif using default settings

.EXAMPLE
    .\Export-ADGroups.ps1 -OutputPath "C:\exports\groups.ldif" -StartingGidNumber 300000
    Exports to specific path with custom starting GID

.NOTES
    Requires Active Directory PowerShell module
    Run with appropriate AD permissions to read group objects
    Script automatically detects current domain
    Groups must be within GID range 300000-400000 per requirements
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$OutputPath = ".\ad-groups-export.ldif",

    [Parameter(Mandatory=$false)]
    [string]$BaseDN = "dc=rco,dc=university,dc=edu",

    [Parameter(Mandatory=$false)]
    [string]$GroupOU = "ou=Groups",

    [Parameter(Mandatory=$false)]
    [int]$StartingGidNumber = 300000,

    [Parameter(Mandatory=$false)]
    [int]$MaxGidNumber = 400000
)

# Import Active Directory module
try {
    Import-Module ActiveDirectory -ErrorAction Stop
    Write-Host "✓ Active Directory module loaded" -ForegroundColor Green
}
catch {
    Write-Error "Failed to load Active Directory module. Ensure RSAT tools are installed."
    exit 1
}

# Get current domain information
try {
    $domain = Get-ADDomain
    $domainDN = $domain.DistinguishedName
    $domainName = $domain.DNSRoot
    Write-Host "✓ Connected to domain: $domainName" -ForegroundColor Green
    Write-Host "  Domain DN: $domainDN" -ForegroundColor Cyan
}
catch {
    Write-Error "Failed to connect to Active Directory domain."
    exit 1
}

# Get all groups with members
Write-Host "`nRetrieving groups from Active Directory..." -ForegroundColor Yellow

$groups = Get-ADGroup -Filter * -Properties `
    Name, `
    SamAccountName, `
    Description, `
    Members, `
    ManagedBy, `
    DistinguishedName, `
    GroupCategory, `
    GroupScope

$groupCount = $groups.Count
Write-Host "✓ Retrieved $groupCount groups" -ForegroundColor Green

# Initialize LDIF content
$ldifContent = @"
# LDIF Export of Active Directory Groups
# Domain: $domainName
# Export Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Total Groups: $groupCount
# Target DN: $GroupOU,$BaseDN
# GID Range: $StartingGidNumber - $MaxGidNumber
#
# Import instructions:
# ldapadd -x -D "cn=Directory Manager" -W -f $OutputPath
#

# Create Groups OU if not exists
dn: $GroupOU,$BaseDN
objectClass: organizationalUnit
objectClass: top
ou: Groups
description: Container for group accounts

"@

# Counter for gidNumber assignment
$gidNumber = $StartingGidNumber

# Build username to DN mapping for member resolution
Write-Host "`nBuilding user DN mapping..." -ForegroundColor Yellow
$userDNMap = @{}
$allUsers = Get-ADUser -Filter * -Properties SamAccountName, DistinguishedName
foreach ($user in $allUsers) {
    if ($user.SamAccountName) {
        $userDNMap[$user.DistinguishedName] = "uid=$($user.SamAccountName),ou=People,$BaseDN"
    }
}
Write-Host "✓ Mapped $($userDNMap.Count) users" -ForegroundColor Green

# Build group DN mapping for nested groups
Write-Host "Building group DN mapping..." -ForegroundColor Yellow
$groupDNMap = @{}
foreach ($group in $groups) {
    if ($group.SamAccountName) {
        $groupDNMap[$group.DistinguishedName] = "cn=$($group.SamAccountName),$GroupOU,$BaseDN"
    }
}
Write-Host "✓ Mapped $($groupDNMap.Count) groups" -ForegroundColor Green

# Process each group
Write-Host "`nProcessing groups..." -ForegroundColor Yellow
$progressCount = 0
$skippedGroups = 0

foreach ($group in $groups) {
    $progressCount++
    if ($progressCount % 50 -eq 0) {
        Write-Host "  Processed $progressCount / $groupCount groups..." -ForegroundColor Cyan
    }

    # Check if we've exceeded max GID
    if ($gidNumber -gt $MaxGidNumber) {
        Write-Warning "Reached maximum GID number ($MaxGidNumber). Remaining groups will be skipped."
        $skippedGroups = $groupCount - $progressCount + 1
        break
    }

    # Extract group name
    $groupName = $group.SamAccountName
    if ([string]::IsNullOrWhiteSpace($groupName)) {
        Write-Warning "Skipping group with no SamAccountName: $($group.DistinguishedName)"
        $skippedGroups++
        continue
    }

    # Build DN for 389 DS
    $groupDN = "cn=$groupName,$GroupOU,$BaseDN"

    # Description
    $description = if ($group.Description) {
        $group.Description -replace '[\r\n]+', ' '
    } else {
        "Group $groupName"
    }

    # Get group members
    $members = @()
    if ($group.Members) {
        foreach ($memberDN in $group.Members) {
            # Check if member is a user
            if ($userDNMap.ContainsKey($memberDN)) {
                $members += $userDNMap[$memberDN]
            }
            # Check if member is a group (nested group)
            elseif ($groupDNMap.ContainsKey($memberDN)) {
                $members += $groupDNMap[$memberDN]
            }
            else {
                # Try to resolve the member
                try {
                    $memberObj = Get-ADObject -Identity $memberDN -Properties objectClass, SamAccountName -ErrorAction SilentlyContinue
                    if ($memberObj) {
                        if ($memberObj.objectClass -contains "user") {
                            $members += "uid=$($memberObj.SamAccountName),ou=People,$BaseDN"
                        }
                        elseif ($memberObj.objectClass -contains "group") {
                            $members += "cn=$($memberObj.SamAccountName),$GroupOU,$BaseDN"
                        }
                    }
                }
                catch {
                    Write-Warning "Could not resolve member: $memberDN"
                }
            }
        }
    }

    # Get managedBy (for delegation)
    $managedBy = ""
    if ($group.ManagedBy) {
        if ($userDNMap.ContainsKey($group.ManagedBy)) {
            $managedBy = $userDNMap[$group.ManagedBy]
        }
        elseif ($groupDNMap.ContainsKey($group.ManagedBy)) {
            $managedBy = $groupDNMap[$group.ManagedBy]
        }
    }

    # Assign gidNumber
    $currentGidNumber = $gidNumber
    $gidNumber++

    # Build LDIF entry
    $ldifContent += @"
# Group: $groupName (GID: $currentGidNumber)
dn: $groupDN
objectClass: top
objectClass: groupOfNames
objectClass: posixGroup
cn: $groupName
gidNumber: $currentGidNumber
description: $description
"@

    # Add members (groupOfNames requires at least one member)
    if ($members.Count -gt 0) {
        foreach ($memberDN in $members) {
            $ldifContent += "member: $memberDN`n"
        }
    }
    else {
        # groupOfNames requires at least one member, use a placeholder
        $ldifContent += "member: cn=nobody`n"
    }

    # Add managedBy for delegation
    if ($managedBy) {
        $ldifContent += "managedBy: $managedBy`n"
    }

    $ldifContent += "`n"
}

Write-Host "✓ Processed $progressCount groups" -ForegroundColor Green
if ($skippedGroups -gt 0) {
    Write-Host "⚠ Skipped $skippedGroups groups" -ForegroundColor Yellow
}

# Create admin group if not exists
if ($groupDNMap.Keys -notcontains "cn=389ers-admins,$GroupOU,$BaseDN") {
    Write-Host "`nCreating 389ers-admins group..." -ForegroundColor Yellow
    $ldifContent += @"
# Admin Group
dn: cn=389ers-admins,$GroupOU,$BaseDN
objectClass: top
objectClass: groupOfNames
objectClass: posixGroup
cn: 389ers-admins
gidNumber: 300000
description: RCO Group Manager administrators
member: cn=admin,$BaseDN

"@
    Write-Host "✓ Added 389ers-admins group" -ForegroundColor Green
}

# Write LDIF to file
try {
    $ldifContent | Out-File -FilePath $OutputPath -Encoding UTF8 -Force
    Write-Host "`n✓ LDIF file created successfully" -ForegroundColor Green
    Write-Host "  Output file: $OutputPath" -ForegroundColor Cyan
    Write-Host "  File size: $([math]::Round((Get-Item $OutputPath).Length / 1KB, 2)) KB" -ForegroundColor Cyan
}
catch {
    Write-Error "Failed to write LDIF file: $_"
    exit 1
}

# Display import instructions
Write-Host "`n" -NoNewline
Write-Host "=" -ForegroundColor Cyan -NoNewline
Write-Host "=".PadRight(70, '=') -ForegroundColor Cyan
Write-Host "  IMPORT INSTRUCTIONS" -ForegroundColor Yellow
Write-Host "=".PadRight(72, '=') -ForegroundColor Cyan

Write-Host "`nTo import into 389 Directory Server:" -ForegroundColor White
Write-Host "  ldapadd -x -D `"cn=Directory Manager`" -W -f $OutputPath" -ForegroundColor Green

Write-Host "`nOr using ldapmodify for updates:" -ForegroundColor White
Write-Host "  ldapmodify -x -D `"cn=Directory Manager`" -W -f $OutputPath" -ForegroundColor Green

Write-Host "`nTo verify groups after import:" -ForegroundColor White
Write-Host "  ldapsearch -x -b `"$GroupOU,$BaseDN`" -LLL '(objectClass=posixGroup)'" -ForegroundColor Green

Write-Host "`n" -NoNewline
Write-Host "=" -ForegroundColor Cyan -NoNewline
Write-Host "=".PadRight(70, '=') -ForegroundColor Cyan

# Summary statistics
Write-Host "`n" -NoNewline
Write-Host "EXPORT SUMMARY" -ForegroundColor Yellow
Write-Host "  Domain: $domainName" -ForegroundColor White
Write-Host "  Groups exported: $($progressCount - $skippedGroups)" -ForegroundColor White
if ($skippedGroups -gt 0) {
    Write-Host "  Groups skipped: $skippedGroups" -ForegroundColor Yellow
}
Write-Host "  Starting gidNumber: $StartingGidNumber" -ForegroundColor White
Write-Host "  Ending gidNumber: $($gidNumber - 1)" -ForegroundColor White
Write-Host "  GID range available: $($MaxGidNumber - $gidNumber + 1)" -ForegroundColor White
Write-Host "  Target Base DN: $BaseDN" -ForegroundColor White
Write-Host "  Group Container: $GroupOU,$BaseDN" -ForegroundColor White
Write-Host "`n✓ Export complete!" -ForegroundColor Green
