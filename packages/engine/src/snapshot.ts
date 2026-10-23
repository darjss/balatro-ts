// A comparable dump of the game state (same format as tools/lua/oracle.lua).
// Ported from ArnoStar/BalatroEngine (balatro/snapshot.py). Python's None is
// written as null so the JSON matches.

import type { Card } from "./card.ts";
import type { CardArea } from "./cardarea.ts";
import type { Game } from "./game.ts";
import { format_g, isPlainTable, type T } from "./lua.ts";
import type { Tag } from "./tag.ts";

export const JOKER_ABILITY_KEYS = [
  "mult",
  "x_mult",
  "extra_value",
  "caino_xmult",
  "yorick_discards",
  "invis_rounds",
  "to_do_poker_hand",
  "loyalty_remaining",
  "perish_tally",
];

export const fmt = (x: unknown) => (typeof x === "number" ? format_g(x, 17) : (x ?? null));

export const card_desc = (c: Card) => {
  const d: T = { key: c.config.center.key, sort_id: c.sort_id };
  const ab = c.ability;
  if (ab.set === "Default" || ab.set === "Enhanced") {
    d.card = c.config.card_key ?? null;
    if (ab.perma_bonus && ab.perma_bonus !== 0) d.perma_bonus = ab.perma_bonus;
  }
  if (c.edition) d.edition = c.edition.type ?? null;
  if (c.seal) d.seal = c.seal;
  if (c.debuff) d.debuff = true;
  if (c.facing === "back") d.facing = "back";
  if (ab.eternal) d.eternal = true;
  if (ab.perishable) d.perishable = ab.perish_tally ?? null;
  if (ab.rental) d.rental = true;
  if (ab.forced_selection) d.forced = true;
  if (c.highlighted) d.highlighted = true;
  d.cost = c.cost;
  d.sell_cost = c.sell_cost;
  if (ab.set === "Joker") {
    const a: T = {};
    for (const k of JOKER_ABILITY_KEYS) if (ab[k] != null) a[k] = fmt(ab[k]);
    if (isPlainTable(ab.extra)) {
      for (const [k, v] of Object.entries(ab.extra))
        if (!isPlainTable(v) && !Array.isArray(v)) a["extra." + k] = fmt(v);
    } else if (ab.extra != null) {
      a.extra = fmt(ab.extra);
    }
    d.ability = a;
  }
  return d;
};

export const area_desc = (area: CardArea | undefined) => {
  if (area === undefined || area.removed) return null;
  return area.cards.map(card_desc);
};

const truthy_keys = (t: T) =>
  Object.entries(t)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

export const snapshot = (G: Game) => {
  const GAME = G.GAME;
  const cr = GAME.current_round;
  const hands: T = {};
  for (const [k, v] of Object.entries<T>(GAME.hands))
    hands[k] = {
      level: v.level ?? null,
      played: v.played ?? null,
      chips: v.chips ?? null,
      mult: v.mult ?? null,
      visible: v.visible ?? null,
    };
  const s = {
    state: G.STATE,
    state_complete: G.STATE_COMPLETE,
    ante: GAME.round_resets.ante ?? null,
    round: GAME.round ?? null,
    dollars: GAME.dollars ?? null,
    chips: fmt(GAME.chips),
    hands_left: cr.hands_left ?? null,
    discards_left: cr.discards_left ?? null,
    hand_size: G.hand !== undefined ? G.hand.config.card_limit : null,
    joker_slots: G.jokers !== undefined ? G.jokers.config.card_limit : null,
    consumable_slots: G.consumeables !== undefined ? G.consumeables.config.card_limit : null,
    reroll_cost: cr.reroll_cost ?? null,
    blind: GAME.blind
      ? {
          name: GAME.blind.name ?? null,
          chips: fmt(GAME.blind.chips),
          disabled: GAME.blind.disabled ?? null,
        }
      : null,
    blind_on_deck: GAME.blind_on_deck ?? null,
    boss: GAME.round_resets.blind_choices.Boss ?? null,
    voucher: cr.voucher ?? null,
    blind_tags: { ...GAME.round_resets.blind_tags },
    blind_states: { ...GAME.round_resets.blind_states },
    tags: (GAME.tags as Tag[]).map((t) => t.key),
    deck: area_desc(G.deck),
    hand: area_desc(G.hand),
    discard: area_desc(G.discard),
    play: area_desc(G.play),
    jokers: area_desc(G.jokers),
    consumeables: area_desc(G.consumeables),
    shop_jokers: G.shop ? area_desc(G.shop_jokers) : null,
    shop_vouchers: G.shop ? area_desc(G.shop_vouchers) : null,
    shop_booster: G.shop ? area_desc(G.shop_booster) : null,
    pack_cards:
      G.pack_cards !== undefined && !G.pack_cards.removed ? area_desc(G.pack_cards) : null,
    pack_choices: GAME.pack_choices ?? null,
    hands,
    used_jokers: truthy_keys(GAME.used_jokers),
    used_vouchers: truthy_keys(GAME.used_vouchers),
    pool_flags: truthy_keys(GAME.pool_flags),
    current_round: {
      idol: cr.idol_card ? `${cr.idol_card.suit}:${cr.idol_card.rank}` : null,
      mail: cr.mail_card ? (cr.mail_card.rank ?? null) : null,
      ancient: cr.ancient_card ? (cr.ancient_card.suit ?? null) : null,
      castle: cr.castle_card ? (cr.castle_card.suit ?? null) : null,
      most_played: cr.most_played_poker_hand ?? null,
      dollars: cr.dollars ?? null,
    },
    rng: Object.fromEntries([...G.rng.state].map(([k, v]) => [k, fmt(v)])),
    hands_order: [...G.hands_order()],
  };
  return s;
};
