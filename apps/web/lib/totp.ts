import { createHmac } from 'crypto';

const DIGITS = 4;
const STEP = 30; // seconds

function _totpAt(secretHex: string, counter: number): string {
  const key = Buffer.from(secretHex, 'hex');
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % Math.pow(10, DIGITS)).padStart(DIGITS, '0');
}

/** Secret must be a hex-encoded string (20 bytes = 40 hex chars). */
export function totpGenerate(secret: string): string {
  const counter = Math.floor(Date.now() / 1000 / STEP);
  return _totpAt(secret, counter);
}

/** Returns the current time window index (useful for attendance deduplication). */
export function totpWindow(): number {
  return Math.floor(Date.now() / 1000 / STEP);
}

/** Verify a TOTP code allowing ±skew windows. Returns true if valid. */
export function totpVerify(secret: string, code: string, skew = 1): boolean {
  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let delta = -skew; delta <= skew; delta++) {
    if (_totpAt(secret, counter + delta) === code) return true;
  }
  return false;
}
