import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { valibotSchema } from "@ai-sdk/valibot";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import * as v from "valibot";
import {
  brief,
  calculateTool,
  errorMessage,
  MAX_ERRORS,
  openaiModel,
  usageTotals,
  waitOutQuota,
  type End,
  type GameOpts,
  type GameResult,
} from "./agent.ts";
import { Action, newGame, phaseOf, runActions, settle } from "./game.ts";
import { CHAT_SYSTEM, COMPACT, resumePrompt } from "./prompt.ts";
import { render } from "./view.ts";

/** Steps per request. The loop re-enters after each one, so a failed request loses at most this many. */
const CHUNK = 30;
/** Compact early if one ante runs long. */
const MAX_CONTEXT = 80_000;

/**
 * One conversation per game: act returns the new state, the model keeps calling tools. At the end
 * of each ante the model writes a summary and the conversation restarts from it.
 */
export const playChat = async (o: GameOpts, model = openaiModel(o)): Promise<GameResult> => {
  const G = newGame(o.seed);
  settle(G);
  mkdirSync(o.dir, { recursive: true });
  const log = (entry: Record<string, unknown>) =>
    appendFileSync(join(o.dir, "turns.jsonl"), `${JSON.stringify(entry)}\n`);
  const started = Date.now();
  const { totals, add } = usageTotals();
  const ante = () => G.GAME.round_resets.ante as number;
  const common = {
    model,
    instructions: CHAT_SYSTEM,
    reasoning: o.reasoning,
    providerOptions: {
      openai: { promptCacheKey: `balatro-chat-${o.model}-${o.seed}-${o.rep}`, store: false },
    },
    maxRetries: 3,
    timeout: 600_000,
  };

  let messages: ModelMessage[] = [{ role: "user", content: `${render(G)}\n\nThe run starts.` }];
  let turn = 0;
  let errors = 0;
  let quotaHits = 0;
  let waited = 0;
  let compactedAt = ante();
  let lastInput = 0;
  let end: End | undefined;
  let error: string | undefined;

  const tools = {
    calculate: calculateTool(G),
    act: tool({
      description:
        "Run actions in order. Stops after the first failure, and after any action that reveals new information. Returns the results and the new state.",
      inputSchema: valibotSchema(v.object({ actions: v.pipe(v.array(Action), v.minLength(1)) })),
      execute: async ({ actions }) => {
        turn++;
        const phase = phaseOf(G);
        const state = render(G);
        const r = runActions(G, actions);
        errors = r.results.some((x) => x.ok) ? 0 : errors + 1;
        const now = phaseOf(G);
        if (now === "won" || now === "lost") end = now;
        else if (errors >= MAX_ERRORS) end = "aborted";
        else if (turn >= o.maxTurns) end = "budget";
        const results = r.results.map(brief);
        log({ turn, phase, state, actions, results });
        return end
          ? { results, game_over: end }
          : { results, dropped: r.dropped, state: render(G) };
      },
    }),
  };

  const compactDue = () =>
    (phaseOf(G) === "blind_select" && ante() > compactedAt) || lastInput > MAX_CONTEXT;

  while (!end) {
    try {
      const res = await generateText({
        ...common,
        messages,
        tools,
        toolChoice: "required",
        stopWhen: [
          stepCountIs(CHUNK),
          ({ steps }) => {
            lastInput = steps.at(-1)?.usage.inputTokens ?? 0;
            return end !== undefined || compactDue();
          },
        ],
      });
      quotaHits = 0;
      add(res.totalUsage, res.steps.length);
      messages.push(...res.response.messages);
      log({ kind: "request", steps: res.steps.length, usage: res.totalUsage });
      if (res.steps.at(-1)?.toolCalls.length === 0)
        messages.push({ role: "user", content: `Call a tool.\n\n${render(G)}` });

      if (!end && compactDue()) {
        const sum = await generateText({
          ...common,
          messages: [...messages, { role: "user", content: COMPACT }],
        });
        add(sum.totalUsage, 1);
        log({ kind: "compact", ante: ante(), context: lastInput, summary: sum.text });
        messages = [{ role: "user", content: resumePrompt(sum.text, render(G)) }];
        compactedAt = ante();
        lastInput = 0;
      }
    } catch (e) {
      error = errorMessage(e);
      const wait = await waitOutQuota(o, error, quotaHits);
      if (wait > 0) {
        quotaHits++;
        waited += wait;
      } else if (++errors >= MAX_ERRORS) end = "aborted";
      log({ kind: "error", error });
      // whatever the lost request did to the game, the model picks up from the real state
      messages.push({
        role: "user",
        content: `The last request failed. Current state:\n\n${render(G)}`,
      });
      continue;
    }
    error = undefined;
  }

  return {
    model: o.model,
    seed: o.seed,
    rep: o.rep,
    end,
    ante: ante(),
    round: G.GAME.round,
    turns: turn,
    ...totals,
    ms: Date.now() - started - waited,
    ...(error ? { error } : {}),
  };
};
