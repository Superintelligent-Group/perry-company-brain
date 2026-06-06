/**
 * Encryption-at-rest for the one sensitive column we store per tenant: the Discord
 * webhook URL (anyone holding it can post to the channel). The boring, zero-dep,
 * correct choice — AES-256-GCM (authenticated; tampering fails to decrypt) from
 * node:crypto, with one app-level key from env. Not KMS/libsodium: a single
 * symmetric key at rest is the right scope for now (revisit if we need per-tenant
 * keys or HSM). The key is injected (env arg) so it's unit-tested without globals.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

/** The 256-bit key from INKY_DB_ENCRYPTION_KEY (hex-64 or base64). Generate one
 *  with `openssl rand -hex 32`. Only needed when actually (de)crypting. */
function loadKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = env.INKY_DB_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'INKY_DB_ENCRYPTION_KEY is not set — required to encrypt/decrypt stored secrets ' +
        '(e.g. Discord webhook URLs). Generate one: `openssl rand -hex 32`.',
    );
  }
  const key = raw.length === 64 ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('INKY_DB_ENCRYPTION_KEY must decode to 32 bytes (a 64-char hex or base64 256-bit key).');
  }
  return key;
}

/** Encrypt to a self-describing `iv:tag:ciphertext` string (each part base64). */
export function encryptSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, loadKey(env), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** Decrypt an `iv:tag:ciphertext` payload; throws on a bad key or tampering. */
export function decryptSecret(payload: string, env: NodeJS.ProcessEnv = process.env): string {
  const [ivB64, tagB64, ctB64] = payload.split(':');
  if (!ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error('malformed encrypted secret (expected iv:tag:ciphertext).');
  }
  const decipher = createDecipheriv(ALGO, loadKey(env), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
