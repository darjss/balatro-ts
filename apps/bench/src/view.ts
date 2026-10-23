import type { Card, Game } from "@balatro-ts/engine"
import { phaseOf } from "./game.ts"

const RANK: Record<string, string> = { Ace: "A", King: "K", Queen: "Q", Jack: "J", "10": "10" }
const SUIT: Record<string, string> = { Spades: "♠", Hearts: "♥", Clubs: "♣", Diamonds: "♦" }

const num = (x: unknown) => {
  const n = Number(x)
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "")
}

const tags = (c: Card) => {
  const out: string[] = []
  if (c.ability.set === "Enhanced") out.push(c.config.center.name)
  if (c.edition) out.push(c.edition.type)
  if (c.seal) out.push(`${c.seal} Seal`)
  if (c.ability.eternal) out.push("eternal")
  if (c.ability.perishable) out.push(`perishable ${c.ability.perish_tally}`)
  if (c.ability.rental) out.push("rental")
  if (c.debuff) out.push("DEBUFFED")
  return out.length > 0 ? ` [${out.join(", ")}]` : ""
}

const playing = (c: Card) =>
  c.facing === "back" ? `#${c.sort_id} ??` : `#${c.sort_id} ${RANK[c.base.value] ?? c.base.value}${SUIT[c.base.suit] ?? c.base.suit}${tags(c)}`

const jokerState = (c: Card) => {
  const a = c.ability
  const parts: string[] = []
  if (a.mult) parts.push(`mult ${num(a.mult)}`)
  if (a.x_mult && a.x_mult !== 1) parts.push(`x${num(a.x_mult)}`)
  if (typeof a.extra === "number") parts.push(`value ${num(a.extra)}`)
  else if (a.extra && typeof a.extra === "object")
    for (const [k, val] of Object.entries(a.extra)) if (typeof val === "number" || typeof val === "string") parts.push(`${k} ${typeof val === "number" ? num(val) : val}`)
  return parts.length > 0 ? ` (now: ${parts.join(", ")})` : ""
}

const item = (G: Game, c: Card, price?: "cost" | "sell") => {
  const center = c.config.center
  const set = c.ability.set
  const money = price === "cost" ? ` $${c.cost}` : price === "sell" ? ` sells $${c.sell_cost}` : ""
  if (set === "Default" || set === "Enhanced") return `${playing(c)}${money}`
  if (set === "Booster") {
    const cfg = center.config ?? {}
    return `#${c.sort_id} ${center.name}${money}: choose ${cfg.choose ?? 1} of ${cfg.extra ?? "?"} ${center.kind ?? ""} cards`
  }
  const desc = G.data.description(center.key) ?? ""
  const kind = set === "Joker" ? ["", "Common", "Uncommon", "Rare", "Legendary"][center.rarity] : set
  return `#${c.sort_id} ${center.name} (${kind})${money}${tags(c)}: ${desc}${set === "Joker" ? jokerState(c) : ""}`
}

const blindLine = (G: Game, key: string | undefined) => {
  if (!key) return "?"
  const b = G.P_BLINDS[key]
  const desc = G.data.description(key)
  return desc ? `${b?.name ?? key}: ${desc}` : (b?.name ?? key)
}

const deckSummary = (G: Game) => {
  const cards = G.deck?.cards ?? []
  const bySuit = new Map<string, number>()
  const byRank = new Map<string, number>()
  for (const c of cards) {
    if (c.ability.effect === "Stone Card") continue
    bySuit.set(c.base.suit, (bySuit.get(c.base.suit) ?? 0) + 1)
    const r = RANK[c.base.value] ?? c.base.value
    byRank.set(r, (byRank.get(r) ?? 0) + 1)
  }
  const order = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"]
  const suits = [...bySuit].map(([s, n]) => `${SUIT[s] ?? s}${n}`).join(" ")
  const ranks = order.filter((r) => byRank.has(r)).map((r) => `${r}:${byRank.get(r)}`).join(" ")
  return `${cards.length} cards left to draw. Suits ${suits}. Ranks ${ranks}`
}

export const render = (G: Game) => {
  const GAME = G.GAME
  const cr = GAME.current_round
  const rr = GAME.round_resets
  const phase = phaseOf(G)
  const lines: string[] = []
  lines.push(`PHASE: ${phase}`)
  lines.push(`Ante ${rr.ante}/${GAME.win_ante ?? 8}, round ${GAME.round}. Money $${num(GAME.dollars)}. Hands per round ${rr.hands}, discards per round ${rr.discards}, hand size ${G.hand?.config.card_limit ?? "?"}.`)

  const onDeck = GAME.blind_on_deck as string | undefined
  const choices = rr.blind_choices ?? {}
  const blindTags = rr.blind_tags ?? {}
  if (phase === "hand") {
    lines.push(`BLIND: ${blindLine(G, GAME.blind.config?.blind?.key ?? choices[onDeck ?? "Small"])}${GAME.blind.disabled ? " (disabled)" : ""}`)
    lines.push(`Score ${num(GAME.chips)} / ${num(GAME.blind.chips)} needed. Hands left ${cr.hands_left}, discards left ${cr.discards_left}.`)
  } else {
    const order = ["Small", "Big", "Boss"].filter((b) => rr.blind_states?.[b] !== "Defeated" && rr.blind_states?.[b] !== "Skipped")
    lines.push(`UPCOMING BLINDS (base chips ${num(G.get_blind_amount(rr.ante))}):`)
    for (const b of order) {
      const mult = G.P_BLINDS[choices[b]]?.mult ?? 1
      const tag = b !== "Boss" && blindTags[b] ? ` | skip reward: ${G.P_TAGS[blindTags[b]]?.name}: ${G.data.description(blindTags[b]) ?? ""}` : ""
      lines.push(`- ${b}${b === onDeck ? " (next)" : ""}: ${num(G.get_blind_amount(rr.ante) * mult * (GAME.starting_params?.ante_scaling ?? 1))} chips. ${blindLine(G, choices[b])}${tag}`)
    }
  }

  if (G.hand && G.hand.cards.length > 0) lines.push(`HAND (${G.hand.cards.length}): ${G.hand.cards.map(playing).join("  ")}`)
  lines.push(`DECK: ${deckSummary(G)}`)

  const jokers = G.jokers?.cards ?? []
  lines.push(`JOKERS (${jokers.length}/${G.jokers?.config.card_limit}), left to right:`)
  for (const c of jokers) lines.push(`- ${item(G, c, "sell")}`)
  const cons = G.consumeables?.cards ?? []
  lines.push(`CONSUMABLES (${cons.length}/${G.consumeables?.config.card_limit}):`)
  for (const c of cons) lines.push(`- ${item(G, c, "sell")}`)

  if (phase === "shop") {
    lines.push(`SHOP (reroll $${cr.reroll_cost}):`)
    for (const c of G.shop_jokers?.cards ?? []) lines.push(`- ${item(G, c, "cost")}`)
    for (const c of G.shop_vouchers?.cards ?? []) lines.push(`- voucher ${item(G, c, "cost")}`)
    for (const c of G.shop_booster?.cards ?? []) lines.push(`- pack ${item(G, c, "cost")}`)
  }
  if (phase === "pack") {
    lines.push(`OPEN PACK: pick ${GAME.pack_choices} more, or skip_pack:`)
    for (const c of G.pack_cards?.cards ?? []) lines.push(`- ${item(G, c)}`)
  }

  const used = (GAME.tags ?? []).map((t: { key: string }) => G.P_TAGS[t.key]?.name ?? t.key)
  if (used.length > 0) lines.push(`TAGS: ${used.join(", ")}`)
  const vouchers = Object.keys(GAME.used_vouchers ?? {}).filter((k) => GAME.used_vouchers[k])
  if (vouchers.length > 0) lines.push(`VOUCHERS OWNED: ${vouchers.map((k) => G.P_CENTERS[k]?.name ?? k).join(", ")}`)

  lines.push("HAND LEVELS (chips x mult, times played):")
  for (const name of G.handlist) {
    const h = GAME.hands[name]
    if (!h?.visible) continue
    lines.push(`- ${name} L${h.level}: ${num(h.chips)} x ${num(h.mult)}${h.played ? `, played ${h.played}` : ""}`)
  }
  return lines.join("\n")
}
