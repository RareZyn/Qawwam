/** The unlocked vault key lives only in memory. What is kept on the device is the key encrypted with the pattern. */
import { useSyncExternalStore } from 'react';
import type { Wrapped } from './vault';

let vk: Uint8Array | null = null;
const subs = new Set<() => void>();

export const getVk = () => vk;
export function setVk(k: Uint8Array | null) {
  vk = k;
  subs.forEach((f) => f());
}
export const useVk = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => vk,
  );

const wrapKey = (uid: string) => `qw_vault_${uid}`;
export function loadDeviceWrap(uid: string): Wrapped | null {
  try {
    return JSON.parse(localStorage.getItem(wrapKey(uid)) ?? 'null') as Wrapped | null;
  } catch {
    return null;
  }
}
export const saveDeviceWrap = (uid: string, w: Wrapped) => localStorage.setItem(wrapKey(uid), JSON.stringify(w));
export const clearDeviceWrap = (uid: string) => localStorage.removeItem(wrapKey(uid));

// Wrong-pattern lockout: after 5 misses in a row the wait doubles each time (30 s, 1 min, 2 min ... up to 1 hour).
const failKey = (uid: string) => `qw_vault_fail_${uid}`;
export const MAX_TRIES = 5;

export function failState(uid: string): { fails: number; until: number } {
  try {
    return JSON.parse(localStorage.getItem(failKey(uid)) ?? '') as { fails: number; until: number };
  } catch {
    return { fails: 0, until: 0 };
  }
}
export function lockoutMs(fails: number) {
  return fails >= MAX_TRIES ? Math.min(3600_000, 30_000 * 2 ** (fails - MAX_TRIES)) : 0;
}
export function recordFail(uid: string, now = Date.now()) {
  const fails = failState(uid).fails + 1;
  const wait = lockoutMs(fails);
  const s = { fails, until: wait ? now + wait : 0 };
  localStorage.setItem(failKey(uid), JSON.stringify(s));
  return s;
}
export const clearFails = (uid: string) => localStorage.removeItem(failKey(uid));
