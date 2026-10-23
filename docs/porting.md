# Porting the engine

`packages/engine` is a TypeScript port of [ArnoStar/BalatroEngine](https://github.com/ArnoStar/BalatroEngine)
(Python), which is itself a close port of Balatro 1.0.1o's Lua. The goal is the same numbers as the
Python engine after every action, checked by replaying recorded Python traces.

The engine is plain synchronous TypeScript. Effect lives at the boundary (`Engine` service, Schema
for actions), not inside the rules.

## Files and names

- One TS file per Python module: `balatro/flow.py` becomes `src/flow.ts`. Keep the order of
  functions and the comments that explain game behavior.
- Keep every Python and Lua name exactly: `G.GAME.round_resets.blind_ante`,
  `card.ability.x_mult`, `play_cards_from_highlighted`, `_remove_eaten`. No camelCase renames.
  This keeps the port checkable line by line against the Python and the Lua.
- Export every top-level Python name under the same name. Other files import them by that name
  with a `.ts` extension: `import { Card } from "./card.ts"`.
- Classes stay classes (`Card`, `CardArea`, `Blind`, `Tag`, `Back`, `Game`).

## Mixins

Python's `class Game(PoolsMixin, FlowMixin, ShopMixin, PacksMixin, ActionsMixin)` becomes:

```ts
// flow.ts
import type { Game } from "./game.ts"
export const FlowMixin = {
  advance(this: Game) { ... },
  play_cards_from_highlighted(this: Game) { ... },
}
```

```ts
// game.ts
type Methods<M> = { [K in keyof M]: M[K] }
export interface Game extends Methods<typeof PoolsMixin>, Methods<typeof FlowMixin> /* ... */ {}
export class Game { ... }
Object.assign(Game.prototype, PoolsMixin, FlowMixin, ShopMixin, PacksMixin, ActionsMixin)
```

Mixin files import `Game` as a type only. Runtime imports between modules are fine in a cycle as
long as nothing is used at module top level, so the Python's lazy `from .x import y` inside a
function becomes a normal top-level import.

Python module functions that take `self: Card` (`calculate_joker`, `use_consumeable`, `redeem`)
stay module functions with `self: Card` as the first parameter.

## Lua tables

- `T(...)` tables and game data are plain objects typed `T` from `lua.ts`. Missing keys read as
  `undefined`, which is nil.
- `t.k = None` on a `T` deletes the key: write `delete t.k`. Never store `undefined` in a table,
  because `nonempty()` and `Object.keys` would see it.
- `t.get(k)` and `t.k` both become `t.k`. `k in t` on a T becomes `t[k] != null`.
- JSON `null` and `undefined` both mean nil. Test with `== null` / `!= null`.
- `copy_table` is in `lua.ts`. Shallow `copy.copy(t)` becomes `{ ...t }`.
- `G.rng.state` is a `Map<string, number>`. Any Python dict keyed by ints or by `id(obj)` becomes a
  `Map`, since JS objects reorder integer-like keys.

## Python semantics that differ in JS

| Python                                           | TypeScript                                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `if lst:` / `if d:` on a list or plain dict      | `if (lst.length > 0)` / `if (Object.keys(d).length > 0)`. `[]` and `{}` are truthy in JS                                          |
| `if t:` on a `T`                                 | always true, same as JS objects                                                                                                   |
| `x or y`, `x and y`                              | `\|\|` / `&&` only when the falsy values agree. `0`, `""`, `[]` differ, so check each case                                        |
| `a // b`                                         | `Math.floor(a / b)`                                                                                                               |
| `a % b` that can be negative                     | `lua_mod(a, b)`                                                                                                                   |
| `int(x)`                                         | `Math.trunc(x)`                                                                                                                   |
| `round(x)`                                       | `round_half_even(x)`                                                                                                              |
| `math.floor` that can see inf or nan             | `floor` from `lua.ts`                                                                                                             |
| `"%.17g" % x`, `"%.14g" % x`                     | `format_g(x, 17)`, `format_g(x, 14)`                                                                                              |
| `str(x)` of a float inside a string              | check the case. Python prints `1.0`, JS prints `1`. RNG keys use `lua_tostring`                                                   |
| `sorted(xs, key=...)`                            | `[...xs].sort(cmp)` with an explicit comparator. Tuples compare element by element. Strings compare with `<`, not `localeCompare` |
| `deque`                                          | array with `push`, `unshift`, `shift`                                                                                             |
| `None` attribute on a class (`self.shop = None`) | `undefined` field                                                                                                                 |
| `raise IllegalAction(msg)`                       | `throw new IllegalAction(msg)` (`actions.ts`)                                                                                     |
| `isinstance(x, int)` vs `float`                  | JS has one number type. Check what the branch needs                                                                               |
| `enumerate`, `zip`, `range`                      | plain loops                                                                                                                       |
| `list.pop(i)`, `insert(i, x)`, `lst[-1]`         | `splice`, `splice`, `.at(-1)`                                                                                                     |
| `getattr(self, name)`                            | an explicit switch over the area names                                                                                            |

## Syntax limits

Node runs the TS directly with type stripping, so only erasable syntax: no `enum` (use
`as const` objects), no parameter properties, no `namespace`. `tsconfig.json` sets
`erasableSyntaxOnly`.

Types: give classes real field types. Use `T` only for genuinely open Lua tables (abilities,
configs, contexts, game data). No `as any`.

## Checking a file

`vp check --fix` from the repo root formats, lints and typechecks. While other modules are still
missing, the only errors left should be imports of modules that don't exist yet.
