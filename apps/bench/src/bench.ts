import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { playGame, type GameOpts, type GameResult } from "./agent.ts";

export type BenchOpts = Omit<GameOpts, "model" | "seed" | "rep" | "dir"> & {
  name: string;
  models: string[];
  seeds: string[];
  reps: number;
  concurrency: number;
};

export const readResults = (dir: string): GameResult[] => {
  const file = join(dir, "results.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

const key = (r: { model: string; seed: string; rep: number }) => `${r.model}/${r.seed}/${r.rep}`;

/** Every model x seed x rep, a fixed number at a time. Re-running the same bench resumes it. */
export const runBench = async ({ name, models, seeds, reps, concurrency, ...game }: BenchOpts) => {
  const dir = join("runs", name);
  mkdirSync(dir, { recursive: true });
  const done = new Set(readResults(dir).map(key));
  const queue = models
    .flatMap((model) =>
      seeds.flatMap((seed) => Array.from({ length: reps }, (_, rep) => ({ model, seed, rep }))),
    )
    .filter((t) => !done.has(key(t)))
    // interleave models so a slow model does not hold all workers at the end
    .sort((a, b) => a.rep - b.rep || seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
  console.log(`${name}: ${queue.length} games to run, ${done.size} already done`);

  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const runDir = join(dir, t.model, `${t.seed}-${t.rep}`);
      const result = await playGame({ ...game, ...t, dir: runDir }).catch((e): GameResult => ({
        ...t,
        end: "aborted",
        ante: 0,
        round: 0,
        turns: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
        ms: 0,
        error: String(e),
      }));
      appendFileSync(join(dir, "results.jsonl"), `${JSON.stringify(result)}\n`);
      console.log(
        `${key(t)}: ${result.end} at ante ${result.ante} round ${result.round}, ${result.turns} turns, ${(result.ms / 60000).toFixed(1)} min${result.error ? ` (${result.error})` : ""}`,
      );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
};
