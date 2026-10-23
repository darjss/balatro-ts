import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { createOpenAI } from "@ai-sdk/openai"
import { valibotSchema } from "@ai-sdk/valibot"
import { generateText, hasToolCall, stepCountIs, tool, type LanguageModelUsage } from "ai"
import * as v from "valibot"
import { Action, bestPlays, newGame, phaseOf, runActions, scorePlay, settle, type StepResult } from "./game.ts"
import { SYSTEM, turnPrompt } from "./prompt.ts"
import { render } from "./view.ts"

export type Reasoning = "none" | "low" | "medium" | "high" | "xhigh"

export type GameOpts = {
  model: string
  seed: string
  rep: number
  dir: string
  reasoning: Reasoning
  maxTurns: number
  baseURL: string
  apiKey: string
}

export type End = "won" | "lost" | "aborted" | "budget"

export type GameResult = {
  model: string
  seed: string
  rep: number
  end: End
  ante: number
  round: number
  turns: number
  calls: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
  ms: number
  error?: string
}

const MAX_ERRORS = 3
const HISTORY = 12

const brief = (r: StepResult) => {
  const { type, ...rest } = r.action
  const args = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ""
  return `${type}${args}${r.ok ? "" : ` FAILED: ${r.error}`}`
}

export const playGame = async (o: GameOpts): Promise<GameResult> => {
  const provider = createOpenAI({ baseURL: o.baseURL, apiKey: o.apiKey })
  const G = newGame(o.seed)
  settle(G)
  mkdirSync(o.dir, { recursive: true })
  const logFile = join(o.dir, "turns.jsonl")
  const started = Date.now()
  const totals = { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }
  const add = (u: LanguageModelUsage) => {
    totals.inputTokens += u.inputTokens ?? 0
    totals.outputTokens += u.outputTokens ?? 0
    totals.reasoningTokens += u.outputTokenDetails.reasoningTokens ?? 0
    totals.cachedTokens += u.inputTokenDetails.cacheReadTokens ?? 0
  }

  let notes = ""
  let feedback = ""
  const history: string[] = []
  let errors = 0
  let turn = 0
  let end: End | undefined
  let error: string | undefined

  while (!end) {
    const phase = phaseOf(G)
    if (phase === "won" || phase === "lost") {
      end = phase
      break
    }
    if (phase === "busy") throw new Error(`engine stuck in state ${G.STATE}`)
    if (turn >= o.maxTurns) {
      end = "budget"
      break
    }
    turn++
    const state = render(G)
    let acted: { results: StepResult[]; dropped: number } | undefined
    const t0 = Date.now()

    const tools = {
      calculate: tool({
        description:
          "Exact score of playing the given hand cards now, simulated on the game engine. Omit cards to get the top 5 plays from the current hand. Only works while selecting a hand.",
        inputSchema: valibotSchema(v.object({ cards: v.optional(v.array(v.pipe(v.number(), v.integer()))) })),
        execute: async ({ cards }) => {
          if (phaseOf(G) !== "hand") return { error: "calculate only works while selecting a hand" }
          try {
            return cards && cards.length > 0 ? scorePlay(G, cards) : { best: bestPlays(G) }
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) }
          }
        },
      }),
      act: tool({
        description:
          "Run actions in order. Stops after the first failure, and after any action that reveals new information. Optionally replace your notes.",
        inputSchema: valibotSchema(
          v.object({
            actions: v.pipe(v.array(Action), v.minLength(1)),
            notes: v.optional(v.pipe(v.string(), v.maxLength(1500))),
          }),
        ),
        execute: async ({ actions, notes: next }) => {
          if (acted) return { error: "only one act call per turn" }
          if (next !== undefined) notes = next
          acted = runActions(G, actions)
          return { results: acted.results.map(brief), dropped: acted.dropped }
        },
      }),
    }

    let entry: Record<string, unknown>
    try {
      const res = await generateText({
        model: provider(o.model),
        instructions: SYSTEM,
        prompt: turnPrompt(state, history, notes, feedback),
        tools,
        toolChoice: "required",
        stopWhen: [hasToolCall("act"), stepCountIs(8)],
        reasoning: o.reasoning,
        providerOptions: { openai: { promptCacheKey: `balatro-${o.model}-${o.seed}-${o.rep}`, store: false } },
        maxRetries: 3,
        timeout: 600_000,
      })
      totals.calls += res.steps.length
      add(res.totalUsage)
      entry = {
        steps: res.steps.map((s) => ({
          calls: s.toolCalls.map((c) => ({ tool: c.toolName, input: c.input })),
          results: s.toolResults.map((r) => r.output),
          text: s.text || undefined,
        })),
        usage: res.totalUsage,
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      entry = { error }
    }

    const ok = acted?.results.some((r) => r.ok) ?? false
    if (acted) {
      for (const r of acted.results) history.push(`T${turn} ${brief(r)}`)
      history.splice(0, Math.max(0, history.length - HISTORY))
      const fail = acted.results.find((r) => !r.ok)
      feedback = [fail ? `Action failed: ${brief(fail)}` : "", acted.dropped > 0 ? `${acted.dropped} later actions were not run.` : ""]
        .filter(Boolean)
        .join(" ")
    } else feedback = error ? `Your last turn errored: ${error}` : "You did not call act last turn. You must call act."
    errors = ok ? 0 : errors + 1
    if (ok) error = undefined

    appendFileSync(logFile, `${JSON.stringify({ turn, phase, ms: Date.now() - t0, state, notes, ...entry })}\n`)
    if (errors >= MAX_ERRORS) end = "aborted"
  }

  const rr = G.GAME.round_resets
  return { model: o.model, seed: o.seed, rep: o.rep, end, ante: rr.ante, round: G.GAME.round, turns: turn, ...totals, ms: Date.now() - started, ...(error ? { error } : {}) }
}
