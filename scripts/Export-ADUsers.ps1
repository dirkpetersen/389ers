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
    [string]$OutputPath = ".\ad-users-export.ldif",

    [Parameter(Mandatory=$false)]
    [string]$BaseDN = "dc=rco,dc=university,dc=edu",

    [Parameter(Mandatory=$false)]
    [string]$UserOU = "ou=People",

    [Parameter(Mandatory=$false)]
    [int]$StartingUidNumber = 10000
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
Write-Host "✓ Retrieved $userCount users" -ForegroundColor Green

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

    # Build LDIF entry
    $ldifContent += @"
# User: $cn ($username)
dn: $userDN
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
uid: $username
cn: $cn
sn: $sn
"@

    if ($givenName) {
        $ldifContent += "givenName: $givenName`n"
    }

    if ($mail) {
        $ldifContent += "mail: $mail`n"
    }

    $ldifContent += @"
uidNumber: $currentUidNumber
gidNumber: $gidNumber
homeDirectory: $homeDirectory
loginShell: /bin/bash
"@

    if ($userPrincipalName) {
        $ldifContent += "userPrincipalName: $userPrincipalName`n"
    }

    if ($description) {
        # Escape special characters in LDIF
        $escapedDescription = $description -replace '[\r\n]+', ' '
        $ldifContent += "description: $escapedDescription`n"
    }

    if ($title) {
        $ldifContent += "title: $title`n"
    }

    if ($departmentNumber) {
        $ldifContent += "departmentNumber: $departmentNumber`n"
    }

    if ($telephoneNumber) {
        $ldifContent += "telephoneNumber: $telephoneNumber`n"
    }

    if ($employeeNumber) {
        $ldifContent += "employeeNumber: $employeeNumber`n"
    }

    # Add shadow account attributes (password aging)
    $ldifContent += @"
shadowLastChange: 0
shadowMin: 0
shadowMax: 99999
shadowWarning: 7

"@
}

Write-Host "✓ Processed all $userCount users" -ForegroundColor Green

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
Write-Host "`n✓ Export complete!" -ForegroundColor Green
