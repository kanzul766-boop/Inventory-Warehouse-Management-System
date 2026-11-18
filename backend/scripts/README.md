# First-admin bootstrap

This operator-only script creates an admin directly through the existing Mongoose connection. It is not an API endpoint. It refuses to run when any admin exists or when the supplied username/email is already in use. It hashes the password with bcryptjs using the authentication system's 12 salt rounds.

Run it once, serially, from a trusted machine with `backend/.env` configured for the intended database. The existing environment loader also requires valid `MONGODB_URI`, `JWT_SECRET`, and `IMAGEKIT_PRIVATE_KEY` values there. Do not use a production database unless that is explicitly the intended target. The script creates one new user and does not update existing users.

The script requires these process environment variables:

- `BOOTSTRAP_ADMIN_USERNAME` — non-empty; at most 50 characters.
- `BOOTSTRAP_ADMIN_EMAIL` — valid email; at most 254 characters.
- `BOOTSTRAP_ADMIN_PASSWORD` — 8–72 UTF-8 bytes.

On Windows PowerShell, collect the password without putting it in command history, then clear the process variables after execution:

```powershell
Set-Location -LiteralPath 'C:\path\to\backend'
$env:BOOTSTRAP_ADMIN_USERNAME = Read-Host 'Admin username'
$env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'Admin email'
$securePassword = Read-Host 'Admin password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:BOOTSTRAP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    npm run bootstrap:admin
} finally {
    Remove-Item Env:\BOOTSTRAP_ADMIN_USERNAME, Env:\BOOTSTRAP_ADMIN_EMAIL, Env:\BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $securePassword.Dispose()
}
```

After success, verify admin login and access to `GET /api/users`. Keep the password in an approved password manager. The script deliberately prints neither username/email nor password/hash/token.
