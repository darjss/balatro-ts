# balatro-ts plan

Benchmark LLMs playing Balatro on a headless simulator. One TypeScript process runs the game engine
in WASM, the agent loop on fold, and many games at once as Effect fibers.

## Stack

| Piece       | Choice                                                                         | Why                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Toolchain   | Vite+ (`vp`), pnpm workspaces                                                  | `vp check`, `vp test`, `vp run` cover format, lint, typecheck, tests and tasks                                               |
| Effect      | `effect` 4.0.x                                                                 | services, layers, schema, concurrency, `effect/unstable/cli`                                                                 |
| Agent loop  | `@humanlayer/fold-core` 0.1.x                                                  | Effect-native sessions, `defineTool` with Schema params, auto-compaction, event log, `StopController`                        |
| Game engine | [balatro-rs](https://github.com/evanofslack/balatro-rs) core, compiled to WASM | scoring, shop, jokers, boss blinds, real seed algorithm for shops. Measured 800k random actions/s from Node                  |
| Models      | cliproxy at `http://127.0.0.1:8317/v1`                                         | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`. fold's `openaiModel` uses `/v1/responses`, which cliproxy serves with tool calls |

## Layout

```
packages/sim/          Rust crate + TS wrapper
  Cargo.toml           cdylib, depends on balatro-rs by git rev, getrandom "js" feature
  src/lib.rs           wasm-bindgen exports: new(seed), actions(), act(action), state(), preview(cards)
  wasm/                wasm-bindgen --target nodejs output (gitignored, built by `vp run sim#build`)
  ts/Game.ts           Game service + SimGame layer, Effect Schema for state and actions
apps/bench/
  src/agent.ts         fold agent: system prompt, `act` and `preview` tools
  src/run.ts           one game = one fold Session
  src/bench.ts         model x seed matrix, concurrency, results.jsonl
  src/cli.ts           `vp run bench -- --models ... --seeds ... --concurrency ...`
docs/plan.md
```

The scaffold's `apps/website` and `packages/utils` get deleted in step 1.

## How one game runs

1. `SimGame.layer` creates a game for the seed. Red deck, White stake.
2. `Session.open` with a fresh fold agent. First message: the seed and "play until the run ends".
3. The model calls `act` with a list of actions. The handler applies them in order and stops at the
   first illegal one. It returns what applied, what failed and why, and the new state as compact text.
4. Blind select and cash out are actions like any other, so the model can batch
   `cash_out, buy, buy, next_round, select_blind` in one call. Shop clicks were 74% of calls in a
   BalatroBench Gemini 3 Pro run, so batching is the main time saver.
5. When the game ends, the handler calls `StopController.requestStop` and the session ends.
6. fold's auto-compaction keeps a 300-action run inside the context window.
7. A budget guard ends the game as `budget_exhausted` after N calls or M minutes.

## Tools

- `act({ actions: Action[] })`. `Action` is an Effect Schema tagged union: `select_blind`,
  `skip_blind`, `play { cards }`, `discard { cards }`, `sort_hand`, `cash_out`,
  `buy_joker { slot }`, `buy_consumable { slot }`, `buy_voucher`, `buy_pack { slot }`,
  `pick_pack_card { index }`, `skip_pack`, `use_consumable { index, cards }`, `sell_joker { index }`,
  `sell_consumable { index }`, `reroll`, `next_round`. Card indices refer to the hand as shown.
  The WASM wrapper turns `play { cards }` into balatro-rs `SelectCard` calls plus `Play`.
- `preview({ cards })` returns the exact score with a chips x mult trace, using
  `calc_score_traced`. A bench flag turns it on or off, since it shifts the test from arithmetic to
  strategy.

## Prompt and state

Written from scratch. Nothing is copied from balatrollm.

- System prompt: the rules that matter (blinds, hands, chips x mult, economy and interest, shop,
  packs, consumables) and the output contract. Aim for under 2k tokens so it caches well.
- Joker, tarot, planet, spectral, voucher and boss text comes from balatro-rs (`desc()`,
  `description()`), so the prompt never describes a joker the sim doesn't implement.
- State text is rendered in TS from the decoded state: ante, round, blind and target, score so far,
  hands and discards left, money, hand with indices, jokers in order, consumables, and the shop when
  open.

## Results

- Per game: fold JSONL event log under `runs/<bench-id>/<model>/<seed>-<n>.jsonl`.
- Per bench: `runs/<bench-id>/results.jsonl`, one row per game: model, seed, won, ante, round,
  calls, failed actions, input/output tokens, seconds, end reason.
- `vp run bench:report` prints wins, average round with std dev, calls per run and minutes per run
  for each model.

## Build order

1. Delete the scaffold demo. Add `effect`, `@effect/platform-node`, `@humanlayer/fold-core` with
   `vp add`, pinned to exact versions.
2. `packages/sim` Rust side: wasm-bindgen exports, `rng_mode: Real`, seeds as 7-char strings,
   `overflow-checks = true` in the release profile. Build task in `vite.config.ts`.
3. `packages/sim` TS side: `Game` service, state and action schemas, `SimGame` layer. Check it with a
   script that plays 1,000 random games through the service.
4. Greedy baseline bot: always select the blind, play the highest-scoring hand by `preview`, never
   shop. That gives the floor every model has to beat, and it runs in seconds.
5. Agent: system prompt, state renderer, `act` and `preview` tools, one game end to end on
   `gpt-6-luna`.
6. Bench runner and report. Then the real run: 3 models x 5 seeds x 3.
7. Later, only if wanted: a `RealGame` layer that talks to the balatrobot mod over JSON-RPC, so a
   few real-game runs can check whether the sim keeps the same model ranking.

## Known gaps and risks

- balatro-rs implements 74 of 150 jokers, no skip tags, Red deck and White stake only. Scores rank
  models against each other on this sim. They are not comparable to BalatroBench.
- balatro-rs has no action to reorder jokers, and joker order changes scores in the real game.
- `RngMode::Real` matches shop and pack contents only. Deck shuffles and probability rolls use
  balatro-rs's own RNG, so a seed deals different hands than the real game.
- On wasm32 `usize` is 32-bit and balatro-rs keeps scores in `usize`. Scores above 4,294,967,295
  would wrap silently in release builds. `overflow-checks = true` makes that a loud panic. The real
  fix is `u64` scores upstream.
- fold is 0.1.x and its README already lists one breaking API change. Pin it exactly.
- fold-core 0.1.33 peers on `effect` 4.0.0 exactly. Latest is 4.0.6. Pin effect to what fold
  accepts.
- fold's JSONL event log lives in `@humanlayer/fold-agent`, which also pulls the coding-agent
  providers and `photon-node`. Either accept that dependency or write a small JSONL `EventLog`
  layer.
- cliproxy subscription rate limits cap concurrency, not the sim.
