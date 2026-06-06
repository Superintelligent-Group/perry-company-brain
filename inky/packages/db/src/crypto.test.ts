import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret } from './crypto.js';

// A fixed 32-byte (hex-64) key, injected so the test touches no global env.
const ENV = { INKY_DB_ENCRYPTION_KEY: 'a'.repeat(64) } as NodeJS.ProcessEnv;

test('encrypt → decrypt round-trips the plaintext', () => {
  const secret = 'https://discord.com/api/webhooks/123/abcDEF';
  assert.equal(decryptSecret(encryptSecret(secret, ENV), ENV), secret);
});

test('ciphertext is not the plaintext and uses a fresh IV each time', () => {
  const secret = 'https://discord.com/api/webhooks/1/x';
  const a = encryptSecret(secret, ENV);
  const b = encryptSecret(secret, ENV);
  assert.ok(!a.includes(secret));
  assert.notEqual(a, b); // random IV → different ciphertext for the same input
});

test('tampering with the ciphertext fails authentication', () => {
  const payload = encryptSecret('top-secret', ENV);
  const [iv, tag, ct] = payload.split(':');
  const flipped = ct!.slice(0, -2) + (ct!.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => decryptSecret([iv, tag, flipped].join(':'), ENV));
});

test('a wrong key fails to decrypt', () => {
  const payload = encryptSecret('top-secret', ENV);
  assert.throws(() => decryptSecret(payload, { INKY_DB_ENCRYPTION_KEY: 'b'.repeat(64) } as NodeJS.ProcessEnv));
});

test('a missing key throws a clear error', () => {
  assert.throws(() => encryptSecret('x', {} as NodeJS.ProcessEnv), /INKY_DB_ENCRYPTION_KEY is not set/);
});

test('a wrong-length key is rejected', () => {
  assert.throws(
    () => encryptSecret('x', { INKY_DB_ENCRYPTION_KEY: 'tooshort' } as NodeJS.ProcessEnv),
    /32 bytes/,
  );
});
