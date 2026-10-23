// Lua-table and Lua-number semantics for a line-by-line port of the game's Lua.
// Ported from ArnoStar/BalatroEngine (balatro/lua.py).

// Game data and card abilities are open-ended Lua tables. Missing keys read as
// undefined, like nil. Never store undefined: delete the key instead.
// oxlint-disable-next-line typescript/no-explicit-any
export type T = Record<string, any>;

export const isPlainTable = (v: unknown): v is T =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** `copy_table` from misc_functions.lua: deep copy of tables and arrays, other objects by reference. */
export const copy_table = <V>(obj: V): V => {
  if (Array.isArray(obj)) return obj.map(copy_table) as V;
  if (isPlainTable(obj)) {
    const out: T = {};
    for (const [k, v] of Object.entries(obj)) out[k] = copy_table(v);
    return out as V;
  }
  return obj;
};

/** Lua `math.floor`, which passes inf and nan through. */
export const floor = (x: number) => (Number.isFinite(x) ? Math.floor(x) : x);

/** Lua `a % b` for numbers: `a - floor(a/b)*b`. */
export const lua_mod = (a: number, b: number) => (b === 0 ? Number.NaN : a - Math.floor(a / b) * b);

/** Lua truthiness: only nil and false are false. */
export const truthy = (v: unknown) => v != null && v !== false;

/** `next(t)` on a table. */
export const nonempty = (t: T | undefined | null) => t != null && Object.keys(t).length > 0;

/** Python `round()`: half to even. */
export const round_half_even = (x: number) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** C printf `%.<p>g`. */
export const format_g = (x: number, p: number) => {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [mant, expStr] = x.toExponential(p - 1).split("e");
  const e = Number(expStr);
  if (e < -4 || e >= p) {
    const m = mant!.includes(".") ? mant!.replace(/0+$/, "").replace(/\.$/, "") : mant!;
    const sign = e < 0 ? "-" : "+";
    return `${m}e${sign}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  const fixed = x.toFixed(Math.max(0, p - 1 - e));
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
};
