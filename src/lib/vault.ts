/**
 * Password vault cryptography (Web Crypto only, no libraries).
 *
 * - A random 256-bit vault key encrypts every entry with AES-256-GCM.
 * - The vault key is stored in Firestore only after being encrypted with a key derived from the master
 *   passphrase (PBKDF2-SHA256), so the server never sees it and any device can unlock with the passphrase.
 * - On each device the vault key is also kept encrypted with a key derived from the pattern, in local storage.
 *   Drawing the pattern unlocks it. A pattern is short, so treat it as a screen lock, not as the real secret.
 */
import type { GenRules, PwSecret } from './types';

const PASS_ITERATIONS = 310_000;
const PATTERN_ITERATIONS = 600_000;
const te = new TextEncoder();
const td = new TextDecoder();

export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const buf = (u: Uint8Array) => u as unknown as BufferSource;

async function derive(secret: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', buf(te.encode(secret)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const aesKey = (vk: Uint8Array) => crypto.subtle.importKey('raw', buf(vk), 'AES-GCM', false, ['encrypt', 'decrypt']);

export interface Wrapped {
  salt: string;
  iv: string;
  wrapped: string;
}

async function wrap(vk: Uint8Array, secret: string, iterations: number): Promise<Wrapped> {
  const salt = rand(16);
  const iv = rand(12);
  const key = await derive(secret, salt, iterations);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(vk));
  return { salt: b64(salt), iv: b64(iv), wrapped: b64(ct) };
}

/** Throws when the secret is wrong (AES-GCM authentication fails). */
async function unwrap(w: Wrapped, secret: string, iterations: number): Promise<Uint8Array> {
  const key = await derive(secret, unb64(w.salt), iterations);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(unb64(w.iv)) }, key, buf(unb64(w.wrapped)));
  return new Uint8Array(pt);
}

/** Make a new vault: a fresh vault key, plus that key encrypted with the master passphrase. */
export async function createVault(passphrase: string) {
  const vk = rand(32);
  return { vk, forServer: await wrap(vk, passphrase, PASS_ITERATIONS) };
}

export const unlockWithPassphrase = (w: Wrapped, passphrase: string) => unwrap(w, passphrase, PASS_ITERATIONS);
export const wrapForDevice = (vk: Uint8Array, pattern: string) => wrap(vk, pattern, PATTERN_ITERATIONS);
export const unlockWithPattern = (w: Wrapped, pattern: string) => unwrap(w, pattern, PATTERN_ITERATIONS);

/** Encrypt one entry's secret fields. Every save uses a new random IV. */
export async function encryptSecret(vk: Uint8Array, secret: PwSecret) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, await aesKey(vk), buf(te.encode(JSON.stringify(secret))));
  return { data_enc: b64(ct), iv: b64(iv) };
}

export async function decryptSecret(vk: Uint8Array, data_enc: string, iv: string): Promise<PwSecret> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(unb64(iv)) }, await aesKey(vk), buf(unb64(data_enc)));
  return JSON.parse(td.decode(pt)) as PwSecret;
}

/**
 * Keyed fingerprint of a password (HMAC-SHA256 with the vault key). Equal fingerprints mean equal passwords,
 * so reused passwords can be found without comparing plain text; without the key it reveals nothing.
 */
export async function fingerprint(vk: Uint8Array, password: string) {
  const key = await crypto.subtle.importKey('raw', buf(vk), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf(te.encode(password))));
  return Array.from(sig, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- generator

const SETS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digits: '23456789',
  symbols: '!#$%&*?@',
};
export const DEFAULT_RULES: GenRules = { length: 16, upper: true, lower: true, digits: true, symbols: true };

/** Unbiased random index below n, from the cryptographic random source. */
function randomBelow(n: number) {
  const limit = Math.floor(0x100000000 / n) * n;
  const box = new Uint32Array(1);
  do crypto.getRandomValues(box);
  while (box[0] >= limit);
  return box[0] % n;
}

/** Random password that follows the rules and contains at least one character from every chosen set. */
export function generatePassword(rules: GenRules): string {
  const sets = (['upper', 'lower', 'digits', 'symbols'] as const).filter((k) => rules[k]).map((k) => SETS[k]);
  if (!sets.length) return '';
  const length = Math.max(rules.length, sets.length);
  const pool = sets.join('');
  const chars = sets.map((s) => s[randomBelow(s.length)]);
  while (chars.length < length) chars.push(pool[randomBelow(pool.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** 1 Weak .. 4 Strong, from length and character variety. Short passwords and "Word2024!" shapes are always weak. */
export function strength(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  if (pw.length < 8 || /^[A-Za-z][a-z]+\d{1,4}[^A-Za-z0-9]{0,2}$/.test(pw)) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const score = Math.floor(pw.length / 6) + kinds - 2;
  return Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
}
export const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/** Example accounts shown in the design; added to a new vault only when the user asks for them. */
export const SAMPLE_ACCOUNTS: { account_name: string; category: string; username: string; password: string }[] = [
  { account_name: 'Maybank2u', category: 'Bank', username: 'razin.m', password: 'Kq7#vT2!pLx9' },
  { account_name: 'Gmail', category: 'Social', username: 'razin@example.com', password: 'Sunset2024!' },
  { account_name: 'Shopee', category: 'Shopping', username: 'razin_m', password: 'Sunset2024!' },
  { account_name: 'GitHub', category: 'Work', username: 'razin-dev', password: 'g8$Wm!eR4q' },
  { account_name: 'Instagram', category: 'Social', username: '@razin', password: 'Sunset2024!' },
  { account_name: 'ASNB myASNB', category: 'Bank', username: 'razin.m', password: 'Tz3!hP9w#K' },
];
