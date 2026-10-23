import { Game, IllegalAction, PseudoRandom, get_poker_hand_info, type Card, type CardArea } from "@balatro-ts/engine"
import * as v from "valibot"

export const newGame = (seed: string) => new Game(seed, { deck: "b_red", stake: 1 }).start_run()

export type Phase = "blind_select" | "hand" | "shop" | "pack" | "won" | "lost" | "busy"

export const phaseOf = (G: Game): Phase => {
  const S = G.STATES
  if (G.GAME.won) return "won"
  if (G.STATE === S.GAME_OVER) return "lost"
  if (G.STATE === S.BLIND_SELECT && G.blind_select) return "blind_select"
  if (G.STATE === S.SELECTING_HAND) return "hand"
  if (G.STATE === S.SHOP && G.shop) return "shop"
  if (G.in_pack() && G.pack_cards && G.pack_cards.cards.length > 0) return "pack"
  return "busy"
}

/** Cash out happens on its own: the round-end screen has no decision in it. */
export const settle = (G: Game) => {
  if (G.STATE === G.STATES.ROUND_EVAL && G.round_eval) G.do({ cmd: "cash_out" })
}

const Ids = v.pipe(v.array(v.pipe(v.number(), v.integer())), v.maxLength(5))
const Id = v.pipe(v.number(), v.integer())

export const Action = v.variant("type", [
  v.object({ type: v.literal("select_blind") }),
  v.object({ type: v.literal("skip_blind") }),
  v.object({ type: v.literal("reroll_boss") }),
  v.object({ type: v.literal("play"), cards: v.pipe(Ids, v.minLength(1)) }),
  v.object({ type: v.literal("discard"), cards: v.pipe(Ids, v.minLength(1)) }),
  v.object({ type: v.literal("buy"), id: Id, use: v.optional(v.boolean()) }),
  v.object({ type: v.literal("sell"), id: Id }),
  v.object({ type: v.literal("use"), id: Id, targets: v.optional(Ids) }),
  v.object({ type: v.literal("pick"), id: Id, targets: v.optional(Ids) }),
  v.object({ type: v.literal("skip_pack") }),
  v.object({ type: v.literal("reroll") }),
  v.object({ type: v.literal("end_shop") }),
  v.object({ type: v.literal("move"), id: Id, to: v.pipe(v.number(), v.integer(), v.minValue(0)) }),
])
export type Action = v.InferOutput<typeof Action>

/** Actions after which the state the model saw is stale, so the rest of a batch is dropped. */
const REVEALING = new Set<Action["type"]>(["select_blind", "skip_blind", "reroll_boss", "play", "discard", "use", "pick", "skip_pack", "reroll"])

type AreaName = "hand" | "jokers" | "consumeables" | "shop_jokers" | "shop_vouchers" | "shop_booster" | "pack_cards"

const area = (G: Game, name: AreaName): CardArea | undefined => G[name]

const find = (G: Game, id: number, names: AreaName[]) => {
  for (const name of names) {
    const a = area(G, name)
    const index = a?.cards.findIndex((c) => c.sort_id === id) ?? -1
    if (a && index >= 0) return { name, index, card: a.cards[index]! }
  }
  throw new IllegalAction(`no card #${id} in ${names.join("/")}`)
}

const handIndexes = (G: Game, ids: number[]) => ids.map((id) => find(G, id, ["hand"]).index).sort((a, b) => a - b)

const apply = (G: Game, a: Action) => {
  switch (a.type) {
    case "select_blind":
    case "skip_blind":
    case "reroll_boss":
    case "reroll":
    case "end_shop":
    case "skip_pack":
      return G.do({ cmd: a.type })
    case "play":
    case "discard":
      return G.do({ cmd: a.type, cards: handIndexes(G, a.cards) })
    case "buy": {
      const hit = find(G, a.id, ["shop_jokers", "shop_vouchers", "shop_booster"])
      return G.do({ cmd: "buy", area: hit.name, index: hit.index, use: a.use ?? false })
    }
    case "sell": {
      const hit = find(G, a.id, ["jokers", "consumeables"])
      return G.do({ cmd: "sell", area: hit.name, index: hit.index })
    }
    case "use":
      return G.do({ cmd: "use", index: find(G, a.id, ["consumeables"]).index, targets: handIndexes(G, a.targets ?? []) })
    case "pick":
      return G.do({ cmd: "pick", index: find(G, a.id, ["pack_cards"]).index, targets: handIndexes(G, a.targets ?? []) })
    case "move": {
      const hit = find(G, a.id, ["jokers", "hand", "consumeables"])
      return G.do({ cmd: "move", area: hit.name, from: hit.index, to: a.to })
    }
  }
}

export type StepResult = { action: Action; ok: true } | { action: Action; ok: false; error: string }

/** Runs actions in order. Stops at the first illegal one, and after any action that reveals new state. */
export const runActions = (G: Game, actions: Action[]) => {
  const results: StepResult[] = []
  for (const action of actions) {
    try {
      apply(G, action)
      settle(G)
      results.push({ action, ok: true })
    } catch (e) {
      if (!(e instanceof IllegalAction)) throw e
      results.push({ action, ok: false, error: e.message })
      break
    }
    if (REVEALING.has(action.type) || phaseOf(G) === "won" || phaseOf(G) === "lost") break
  }
  return { results, dropped: actions.length - results.length }
}

export type Play = { cards: number[]; hand: string; score: number; min: number; max: number; beats_blind: boolean }

const TRIALS = 4

/**
 * Exact score of playing `ids` now. Runs on clones whose RNG is re-seeded, so the deterministic
 * part is exact and luck (Lucky cards, Bloodstone, ...) is sampled instead of leaking the real
 * future rolls. Score spread across trials shows up as min/max.
 */
export const scorePlay = (G: Game, ids: number[], trials = TRIALS): Play => {
  const idx = handIndexes(G, ids)
  const cards = idx.map((i) => G.hand!.cards[i]!)
  const [hand] = get_poker_hand_info(G, cards)
  const scores: number[] = []
  for (let t = 0; t < trials; t++) {
    const C = G.clone()
    C.rng = new PseudoRandom(`${G.seed}#calc${t}`)
    const before = Number(C.GAME.chips)
    C.act_play(idx)
    scores.push(Number(C.GAME.chips) - before)
  }
  const score = scores.reduce((s, x) => s + x, 0) / scores.length
  const need = Number(G.GAME.blind.chips) - Number(G.GAME.chips)
  return { cards: ids, hand, score, min: Math.min(...scores), max: Math.max(...scores), beats_blind: score >= need }
}

const combos = (n: number, k: number): number[][] => {
  if (k === 0) return [[]]
  const out: number[][] = []
  for (let i = 0; i <= n - k; i++) for (const rest of combos(n - i - 1, k - 1)) out.push([i, ...rest.map((r) => r + i + 1)])
  return out
}

/** Every 1-5 card play from the hand, ranked by a single sampled trial, top `n` re-scored with full trials. */
export const bestPlays = (G: Game, n = 5): Play[] => {
  const hand: Card[] = G.hand!.cards
  const candidates: Play[] = []
  for (let k = 1; k <= Math.min(5, hand.length); k++)
    for (const c of combos(hand.length, k)) candidates.push(scorePlay(G, c.map((i) => hand[i]!.sort_id), 1))
  candidates.sort((a, b) => b.score - a.score || a.cards.length - b.cards.length)
  return candidates.slice(0, n).map((p) => scorePlay(G, p.cards))
}
