// Bit-exact port of Balatro's RNG: pseudohash, pseudoseed streams and LuaJIT's
// Tausworthe math.random. Ported from ArnoStar/BalatroEngine (balatro/rng.py).

import { format_g } from "./lua.ts";

const MASK64 = 0xffffffffffffffffn;
const buf = new DataView(new ArrayBuffer(8));

const d2u = (d: number) => {
  buf.setFloat64(0, d, true);
  return buf.getBigUint64(0, true);
};

const u2d = (u: bigint) => {
  buf.setBigUint64(0, u, true);
  return buf.getFloat64(0, true);
};

const toDouble = (r: bigint) => u2d((r & 0x000fffffffffffffn) | 0x3ff0000000000000n) - 1.0;

const gen0 = (z: bigint) =>
  ((((z << 31n) & MASK64) ^ z) >> 45n) ^ (((z & 0xfffffffffffffffen) << 18n) & MASK64);
const gen1 = (z: bigint) =>
  ((((z << 19n) & MASK64) ^ z) >> 30n) ^ (((z & 0xffffffffffffffc0n) << 28n) & MASK64);
const gen2 = (z: bigint) =>
  ((((z << 24n) & MASK64) ^ z) >> 48n) ^ (((z & 0xfffffffffffffe00n) << 7n) & MASK64);
const gen3 = (z: bigint) =>
  ((((z << 21n) & MASK64) ^ z) >> 39n) ^ (((z & 0xfffffffffffe0000n) << 8n) & MASK64);

/** LuaJIT 2.1 `math.random` / `math.randomseed` (Tausworthe, period 2^223). */
export class LuaJITRandom {
  u0 = 0n;
  u1 = 0n;
  u2 = 0n;
  u3 = 0n;

  constructor(seed = 0.0) {
    this.seed(seed);
  }

  seed(d: number) {
    const u = [0n, 0n, 0n, 0n];
    let r = 0x11090601;
    for (let i = 0; i < 4; i++) {
      const m = 1n << BigInt(r & 255);
      r >>= 8;
      d = d * Math.PI + Math.E;
      let v = d2u(d);
      if (v < m) v += m;
      u[i] = v;
    }
    [this.u0, this.u1, this.u2, this.u3] = u as [bigint, bigint, bigint, bigint];
    for (let i = 0; i < 10; i++) this.step();
  }

  step() {
    this.u0 = gen0(this.u0);
    this.u1 = gen1(this.u1);
    this.u2 = gen2(this.u2);
    this.u3 = gen3(this.u3);
    return this.u0 ^ this.u1 ^ this.u2 ^ this.u3;
  }

  /** `math.random()`: a double in [0, 1). */
  random() {
    return toDouble(this.step());
  }

  /** `math.random(m)` -> [1, m], `math.random(m, n)` -> [m, n]. */
  randint(m: number, n?: number) {
    const d = this.random();
    if (n === undefined) return Math.floor(d * m) + 1;
    return Math.floor(d * (n - m + 1.0)) + m;
  }
}

/** `math.randomseed(seed); return math.random()`. */
export const seeded_random = (seed: number) => new LuaJITRandom(seed).random();

/** `pseudohash(str)` from misc_functions.lua (bytes right to left). */
export const pseudohash = (s: string) => {
  let num = 1.0;
  for (let i = s.length; i > 0; i--) {
    // Lua: 1.1239285023/0 = inf, inf % 1 = nan, and the game keeps running on the NaN stream.
    if (num === 0.0) return Number.NaN;
    num = ((1.1239285023 / num) * (s.charCodeAt(i - 1) & 0xff) * Math.PI + Math.PI * i) % 1;
  }
  return num;
};

// math.abs(tonumber(string.format("%.13f", (2.134453429141 + v*1.72431234) % 1)))
const advance = (value: number) =>
  Math.abs(Number(((2.134453429141 + value * 1.72431234) % 1).toFixed(13)));

/** Lua's number -> string conversion (`%.14g`) for building RNG keys. */
export const lua_tostring = (x: unknown): string => {
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "number") {
    if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
    return format_g(x, 14);
  }
  return String(x);
};

/** `pseudoseed(key, predict_seed)`: first value of a stream, no state. */
export const predict_pseudoseed = (key: string, seed: string) =>
  (advance(pseudohash(key + seed)) + pseudohash(seed)) / 2;

/** The `G.GAME.pseudorandom` table plus the helpers that use it. */
export class PseudoRandom {
  readonly seed: string;
  readonly hashed_seed: number;
  readonly state: Map<string, number>;
  // shared generator for multi-draw operations (shuffles, ...)
  readonly lua = new LuaJITRandom(0.0);

  constructor(seed: string, state?: ReadonlyMap<string, number>) {
    this.seed = seed;
    this.hashed_seed = pseudohash(seed);
    this.state = new Map(state);
  }

  pseudoseed(key: string) {
    let v = this.state.get(key);
    if (v === undefined) v = pseudohash(key + this.seed);
    v = advance(v);
    this.state.set(key, v);
    return (v + this.hashed_seed) / 2;
  }

  /** The value `pseudoseed(key)` would return, without advancing. */
  peek(key: string) {
    const v = this.state.get(key) ?? pseudohash(key + this.seed);
    return (advance(v) + this.hashed_seed) / 2;
  }

  /** `pseudorandom(key)` -> float in [0, 1). */
  random(key: string | number) {
    return seeded_random(typeof key === "string" ? this.pseudoseed(key) : key);
  }

  /** `pseudorandom(key, min, max)`. */
  randint(key: string | number, lo: number, hi: number) {
    this.lua.seed(typeof key === "string" ? this.pseudoseed(key) : key);
    return this.lua.randint(lo, hi);
  }

  /** `pseudorandom_element` for a Lua array (already in its sorted order). */
  element<V>(items: readonly V[], seed: number): V {
    this.lua.seed(seed);
    return items[this.lua.randint(items.length) - 1]!;
  }

  /** 0-based index chosen by `pseudorandom_element` over n sorted entries. */
  element_index(n: number, seed: number) {
    this.lua.seed(seed);
    return this.lua.randint(n) - 1;
  }

  /** `pseudoshuffle`: in-place Fisher-Yates with Lua's 1-based indices. Caller pre-sorts. */
  shuffle<V>(items: V[], seed: number) {
    this.lua.seed(seed);
    for (let i = items.length; i > 1; i--) {
      const j = this.lua.randint(i);
      [items[i - 1], items[j - 1]] = [items[j - 1]!, items[i - 1]!];
    }
  }

  copy() {
    return new PseudoRandom(this.seed, this.state);
  }
}

export const sorted_by_sort_id = <V extends { sort_id: number }>(items: Iterable<V>) =>
  [...items].sort((a, b) => a.sort_id - b.sort_id);

/** `random_string` from misc_functions.lua (generates run seeds). */
export const random_string = (length: number, seed: number) => {
  const rng = new LuaJITRandom(seed);
  let out = "";
  for (let i = 0; i < length; i++) {
    let c: number;
    if (rng.random() > 0.7) c = rng.randint(49, 57);
    else if (rng.random() > 0.45) c = rng.randint(65, 78);
    else c = rng.randint(80, 90);
    out += String.fromCharCode(c);
  }
  return out.toUpperCase();
};

export const SEED_ALPHABET = "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/** Seeds typed in the game are upper-cased; '0' is not part of the alphabet. */
export const normalize_seed = (seed: string) => seed.toUpperCase().replaceAll("0", "O");
