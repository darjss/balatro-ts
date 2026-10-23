import type { GameResult } from "./agent.ts";
import { bestPlays, newGame, phaseOf, runActions, settle, type Action } from "./game.ts";

/** No-LLM floor: always fight the blind, play the highest scoring hand, buy nothing. */
export const greedy = (seed: string, rep = 0): GameResult => {
  const started = Date.now();
  const G = newGame(seed);
  settle(G);
  let turns = 0;
  for (let phase = phaseOf(G); phase !== "won" && phase !== "lost"; phase = phaseOf(G)) {
    const action: Action =
      phase === "blind_select"
        ? { type: "select_blind" }
        : phase === "hand"
          ? { type: "play", cards: bestPlays(G, 1)[0]!.cards }
          : phase === "shop"
            ? { type: "end_shop" }
            : phase === "pack"
              ? { type: "skip_pack" }
              : (() => {
                  throw new Error(`engine stuck in state ${G.STATE}`);
                })();
    const { results } = runActions(G, [action]);
    if (!results[0]?.ok) throw new Error(`greedy action failed: ${JSON.stringify(results[0])}`);
    turns++;
  }
  return {
    model: "greedy",
    seed,
    rep,
    end: phaseOf(G) === "won" ? "won" : "lost",
    ante: G.GAME.round_resets.ante,
    round: G.GAME.round,
    turns,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    ms: Date.now() - started,
  };
};
