import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import type { Reasoning } from "./agent.ts"
import { greedy } from "./baseline.ts"
import { readResults, runBench } from "./bench.ts"
import { printReport } from "./report.ts"

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string", default: "bench" },
    models: { type: "string", default: "gpt-6-astra,gpt-6.1-sol,gpt-6-luna" },
    seeds: { type: "string", default: "AAAAAAA,BBBBBBB,CCCCCCC,DDDDDDD,EEEEEEE" },
    reps: { type: "string", default: "3" },
    concurrency: { type: "string", default: "6" },
    reasoning: { type: "string", default: "medium" },
    "max-turns": { type: "string", default: "500" },
    "base-url": { type: "string", default: process.env.BALATRO_BASE_URL ?? "http://127.0.0.1:8317/v1" },
  },
})

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)
const REASONING = ["none", "low", "medium", "high", "xhigh"] as const
const isReasoning = (s: string): s is Reasoning => REASONING.some((r) => r === s)

const apiKey = () =>
  process.env.BALATRO_API_KEY ?? readFileSync(join(homedir(), "dev/scratchpad/tools/cliproxyapi/api-key.txt"), "utf8").split("\n")[0]!.trim()

switch (positionals[0]) {
  case "bench": {
    if (!isReasoning(values.reasoning)) throw new Error(`--reasoning must be one of ${REASONING.join(", ")}`)
    await runBench({
      name: values.name,
      models: list(values.models),
      seeds: list(values.seeds),
      reps: Number(values.reps),
      concurrency: Number(values.concurrency),
      reasoning: values.reasoning,
      maxTurns: Number(values["max-turns"]),
      baseURL: values["base-url"],
      apiKey: apiKey(),
    })
    printReport(readResults(join("runs", values.name)))
    break
  }
  case "baseline": {
    const results = list(values.seeds).map((seed) => greedy(seed))
    for (const r of results) console.log(`${r.seed}: ${r.end} at ante ${r.ante} round ${r.round}, ${r.turns} turns, ${r.ms} ms`)
    printReport(results)
    break
  }
  case "report":
    printReport(readResults(join("runs", positionals[1] ?? values.name)))
    break
  default:
    console.log("usage: node src/cli.ts bench|baseline|report [name] [--models a,b] [--seeds A,B] [--reps 3] [--concurrency 6] [--reasoning medium]")
    process.exitCode = 1
}
