# balatro-ts plan

Benchmark LLMs playing Balatro on a headless simulator. One Node process runs the engine and many
games at once. Plain TypeScript, AI SDK 7 and valibot. No build step: Node runs the `.ts` files
directly with type stripping.

## Stack

| Piece       | Choice                                          | Why                                                                                                     |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Toolchain   | Vite+ (`vp`), pnpm workspaces                   | `vp check --fix` formats, lints and typechecks                                                          |
| Game engine | port of [ArnoStar/BalatroEngine][arno] (Python) | all 150 jokers, every deck, stake, tag, voucher and boss, and the game's own RNG, so seeds match 1.0.1o |
| Agent loop  | `ai` 7 `generateText` with tools                | one stateless call per decision, tool loop inside it for `calculate`                                    |
| Schemas     | valibot + `@ai-sdk/valibot`                     | one schema validates tool input and types the action union                                              |
| Models      | cliproxy at `http://127.0.0.1:8317/v1`          | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna` over the Responses API                                       |

Effect was dropped. The engine is a synchronous state machine, an Effect loop costs 20 to 250x per
step for nothing, and the harness is one `generateText` call in a loop.

[arno]: https://github.com/ArnoStar/BalatroEngine

## Layout

```
packages/engine/       line-by-line port of BalatroEngine, see docs/porting.md
  src/data/            game_data.json (from BalatroEngine), descriptions.json (from balatro-rs, MIT)
  src/rng.ts           LuaJIT Tausworthe PRNG, pseudohash, pseudoseed
  src/game.ts ...      one file per Python module
apps/bench/
  src/game.ts          engine adapter: phases, Action schema keyed by card id, calculator
  src/view.ts          state as compact text
  src/prompt.ts        system prompt and per-turn prompt
  src/agent.ts         one game: turn loop, tools, JSONL log
  src/bench.ts         model x seed x rep with a worker pool, resumable
  src/baseline.ts      greedy no-LLM bot
  src/report.ts        per-model table
  src/cli.ts           bench | baseline | report
```

## How one game runs

1. `new Game(seed, { deck: "b_red", stake: 1 }).start_run()`.
2. Each turn renders the state and calls `generateText` with the rules as `instructions` and a
   prompt of the model's notes, the last 12 actions, the last failure and the state.
3. The model may call `calculate` any number of times, then must call `act` once. The turn ends on
   `act` or after 8 steps.
4. `act` runs a batch of actions. It stops at the first illegal one, and after any action that
   reveals new information (play, discard, reroll, pick, use, blind choice). Buys, sells, moves and
   `end_shop` batch freely. Cash out happens on its own.
5. The game ends on win, loss, 3 turns in a row with no successful action, or the turn budget.

Every turn is a fresh prompt, so context never grows and every model sees the same input.

## Calculator

`calculate({ cards })` clones the game, swaps the clone's RNG for a fresh seed and plays the cards
on the real engine. The deterministic part of the score is exact. Luck (Lucky Cards, Bloodstone,
Space Joker) is sampled over 4 trials and returned as min and max, so the tool never leaks the real
future rolls. With no cards it scores every 1 to 5 card subset of the hand and returns the top 5.

## Results

- Per game: `runs/<bench>/<model>/<seed>-<rep>/turns.jsonl`, one line per turn with the state,
  tool calls, results and token usage.
- Per bench: `runs/<bench>/results.jsonl`, one row per game: end, ante, round, turns, calls,
  tokens, ms.
- `node src/cli.ts report <bench>` prints wins, average ante and round, turns and minutes per model.

## Verification

The port is checked by replaying fuzzed traces from the Python engine (random and greedy play, with
cheats to reach late antes, all decks) and diffing the full `snapshot()` after every action.

## Known gaps

- BalatroEngine targets 1.0.1o. Later patches changed some jokers.
- No animations or UI timing, so anything in the real game that depends on frame timing is absent.
