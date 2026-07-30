# Offline Attendance Security Audit

## Device Identity

### Attendance Device ID
- **Storage**: SQLite `app_settings` table, key `attendance_device_id`
- **Format**: `MWD-{timestamp}-{randomhex}` (56 chars total)
- **Persistence**: Survives app restarts, cleared on uninstall
- **Security**: Not a secret; used only for deduplication

### Device Key (Student Relay Signatures)
- **Storage**: `react-native-keychain` with `SECURE_HARDWARE` level
- **Format**: 256-bit hex string (64 characters)
- **Platform**: Android StrongBox / iOS Secure Enclave
- **Rotation**: Never rotated; cleared only on sign-out
- **Registration**: POST to `/api/student/register-device`

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Device ID spoofing | Not a security boundary; only for deduplication |
| Relay signature forgery | 256-bit key in hardware-backed Keychain |
| Replay attacks | Session nonce + timestamp validation |
| SQLite tampering | Not applicable; client-side only |
| Man-in-the-middle | TLS 1.3 on all API calls |

## Backend Validation

The backend validates:
1. Device key format (64 hex chars)
2. Device key registration status
3. Session nonce matches active session
4. Timestamp within tolerance window
5. BLE beacon version byte

## Recommendations

1. Consider adding HMAC to offline records for integrity verification
2. Implement device key rotation on suspicious activity
3. Add rate limiting to `/api/attendance/offline/submit`
4. Log failed device key registration attempts for audit
