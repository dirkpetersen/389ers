<#
.SYNOPSIS
    Export Active Directory users to LDIF format for 389 Directory Server import

.DESCRIPTION
    This script exports all user objects from the current Active Directory domain
    to LDIF format compatible with 389 Directory Server. It includes all relevant
    POSIX attributes required for Unix authentication.

.PARAMETER OutputPath
    Path where the LDIF file will be saved. Defaults to .\ad-users-export.ldif

.PARAMETER BaseDN
    Target base DN in 389 DS. Defaults to dc=rco,dc=university,dc=edu

.EXAMPLE
    .\Export-ADUsers.ps1
    Exports all users to ad-users-export.ldif using default settings

.EXAMPLE
    .\Export-ADUsers.ps1 -OutputPath "C:\exports\users.ldif" -BaseDN "dc=example,dc=com"
    Exports to specific path with custom base DN

.NOTES
    Requires Active Directory PowerShell module
    Run with appropriate AD permissions to read user objects
    Script automatically detects current domain
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [string]$BaseDN = "dc=rco,dc=university,dc=edu",

    [Parameter(Mandatory=$false)]
    [string]$UserOU = "ou=People",

    [Parameter(Mandatory=$false)]
    [int]$StartingUidNumber = 10000
)

# Set default OutputPath to script directory
if (-not $OutputPath) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $OutputPath = Join-Path $scriptDir "ad-users-export.ldif"
}

# Import Active Directory module
try {
    Import-Module ActiveDirectory -ErrorAction Stop
    Write-Host "Active Directory module loaded" -ForegroundColor Green
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
    Write-Host " Connected to domain: $domainName" -ForegroundColor Green
    Write-Host "  Domain DN: $domainDN" -ForegroundColor Cyan
}
catch {
    Write-Error "Failed to connect to Active Directory domain."
    exit 1
}

# Get all enabled users with required attributes
Write-Host "`nRetrieving users from Active Directory..." -ForegroundColor Yellow

$users = Get-ADUser -Filter 'Enabled -eq $true' -Properties `
    SamAccountName, `
    DisplayName, `
    GivenName, `
    Surname, `
    EmailAddress, `
    EmployeeID, `
    DistinguishedName, `
    UserPrincipalName, `
    Description, `
    Title, `
    Department, `
    telephoneNumber, `
    HomeDirectory, `
    HomeDrive

$userCount = $users.Count
Write-Host " Retrieved $userCount users" -ForegroundColor Green

# Initialize LDIF content
$ldifContent = @"
# LDIF Export of Active Directory Users
# Domain: $domainName
# Export Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Total Users: $userCount
# Target DN: $UserOU,$BaseDN
#
# Import instructions:
# ldapadd -x -D "cn=Directory Manager" -W -f $OutputPath
#

# Create People OU if not exists
dn: $UserOU,$BaseDN
objectClass: organizationalUnit
objectClass: top
ou: People
description: Container for user accounts

"@

# Counter for uidNumber assignment
$uidNumber = $StartingUidNumber

# Process each user
Write-Host "`nProcessing users..." -ForegroundColor Yellow
$progressCount = 0

foreach ($user in $users) {
    $progressCount++
    if ($progressCount % 100 -eq 0) {
        Write-Host "  Processed $progressCount / $userCount users..." -ForegroundColor Cyan
    }

    # Extract username (sAMAccountName)
    $username = $user.SamAccountName
    if ([string]::IsNullOrWhiteSpace($username)) {
        Write-Warning "Skipping user with no sAMAccountName: $($user.DistinguishedName)"
        continue
    }

    # Build DN for 389 DS
    $userDN = "uid=$username,$UserOU,$BaseDN"

    # Common Name (use DisplayName or construct from name parts)
    $cn = if ($user.DisplayName) {
        $user.DisplayName
    } elseif ($user.GivenName -and $user.Surname) {
        "$($user.GivenName) $($user.Surname)"
    } else {
        $username
    }

    # Given Name (first name)
    $givenName = if ($user.GivenName) { $user.GivenName } else { $username }

    # Surname (last name)
    $sn = if ($user.Surname) { $user.Surname } else { $username }

    # Email
    $mail = if ($user.EmailAddress) { $user.EmailAddress } else { "" }

    # Home Directory (Unix format)
    $homeDirectory = if ($user.HomeDirectory) {
        # Convert Windows path to Unix path if needed
        $user.HomeDirectory -replace '\\', '/'
    } else {
        "/home/$username"
    }

    # Employee ID (can be used as employeeNumber)
    $employeeNumber = if ($user.EmployeeID) { $user.EmployeeID } else { "" }

    # Description
    $description = if ($user.Description) { $user.Description } else { "User account" }

    # Title
    $title = if ($user.Title) { $user.Title } else { "" }

    # Department
    $departmentNumber = if ($user.Department) { $user.Department } else { "" }

    # Phone
    $telephoneNumber = if ($user.telephoneNumber) { $user.telephoneNumber } else { "" }

    # User Principal Name
    $userPrincipalName = if ($user.UserPrincipalName) { $user.UserPrincipalName } else { "$username@$domainName" }

    # Assign uidNumber and gidNumber
    $currentUidNumber = $uidNumber
    $gidNumber = $uidNumber  # Use same as uidNumber for primary group
    $uidNumber++

    # Build LDIF entry - each entry MUST be separated by a blank line
    # Using StringBuilder-style approach with explicit newlines
    $entry = @()
    $entry += "# User: $cn ($username)"
    $entry += "dn: $userDN"
    $entry += "objectClass: top"
    $entry += "objectClass: person"
    $entry += "objectClass: organizationalPerson"
    $entry += "objectClass: inetOrgPerson"
    $entry += "objectClass: posixAccount"
    $entry += "uid: $username"
    $entry += "cn: $cn"
    $entry += "sn: $sn"

    if ($givenName) {
        $entry += "givenName: $givenName"
    }

    if ($mail) {
        $entry += "mail: $mail"
    }

    $entry += "uidNumber: $currentUidNumber"
    $entry += "gidNumber: $gidNumber"
    $entry += "homeDirectory: $homeDirectory"
    $entry += "loginShell: /bin/bash"

    if ($description) {
        # Escape special characters in LDIF
        $escapedDescription = $description -replace '[\r\n]+', ' '
        $entry += "description: $escapedDescription"
    }

    # Add entry with blank line separator (LDIF requires blank line between entries)
    $ldifContent += "`n" + ($entry -join "`n") + "`n"
}

Write-Host " Processed all $userCount users" -ForegroundColor Green

# Write LDIF to file (UTF-8 without BOM for LDAP compatibility)
try {
    # Use .NET to write UTF-8 without BOM
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($OutputPath, $ldifContent, $utf8NoBom)
    Write-Host " LDIF file created successfully" -ForegroundColor Green
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

Write-Host "`nTo test the file before import:" -ForegroundColor White
Write-Host "  ldapsearch -x -b `"$UserOU,$BaseDN`" -LLL" -ForegroundColor Green

Write-Host "`n" -NoNewline
Write-Host "=" -ForegroundColor Cyan -NoNewline
Write-Host "=".PadRight(70, '=') -ForegroundColor Cyan

# Summary statistics
Write-Host "`n" -NoNewline
Write-Host "EXPORT SUMMARY" -ForegroundColor Yellow
Write-Host "  Domain: $domainName" -ForegroundColor White
Write-Host "  Users exported: $userCount" -ForegroundColor White
Write-Host "  Starting uidNumber: $StartingUidNumber" -ForegroundColor White
Write-Host "  Ending uidNumber: $($uidNumber - 1)" -ForegroundColor White
Write-Host "  Target Base DN: $BaseDN" -ForegroundColor White
Write-Host "  User Container: $UserOU,$BaseDN" -ForegroundColor White
Write-Host " Export complete!" -ForegroundColor Green
