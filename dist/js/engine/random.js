const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_RANGE = 4294967296;

export function hashString(text) {
  let hash = FNV_OFFSET_BASIS;
  for (const character of text) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function randomFor(...parts) {
  return createRandom(hashString(parts.join('|')));
}

export function signedNoise(...parts) {
  return randomFor(...parts)() * 2 - 1;
}

export function createSessionSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
