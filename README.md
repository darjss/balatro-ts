# balatro-ts

A headless, seed-exact Balatro engine in TypeScript, and a harness that benchmarks LLMs playing it.

```sh
vp install
cd apps/bench
node src/cli.ts baseline                       # greedy bot, no LLM, a few seconds
node src/cli.ts bench --name first --reps 3    # 3 models x 5 seeds x 3 through cliproxy
node src/cli.ts report first
```

Options: `--models`, `--seeds`, `--reps`, `--concurrency`, `--reasoning`, `--max-turns`,
`--base-url`. The API key comes from `BALATRO_API_KEY`.

## Engine

`packages/engine` is a line-by-line TypeScript port of
[ArnoStar/BalatroEngine](https://github.com/ArnoStar/BalatroEngine), a Python port of Balatro
1.0.1o's Lua. It uses the game's own PRNG, so a seed deals the same cards, shops and packs as the
real game. All credit for the engine logic goes to ArnoStar.

Joker, consumable, voucher, tag and boss text comes from
[balatro-rs](https://github.com/evanofslack/balatro-rs) (MIT).

```ts
import { Game } from "@balatro-ts/engine";

const G = new Game("AAAAAAA", { deck: "b_red", stake: 1 }).start_run();
G.do({ cmd: "select_blind" });
G.do({ cmd: "play", cards: [0, 1, 2, 3, 4] });
```

See [docs/plan.md](docs/plan.md) for the harness design and [docs/porting.md](docs/porting.md) for
port conventions.
