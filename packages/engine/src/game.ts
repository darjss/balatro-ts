// The Game object (`G` in the Lua source): run state, card areas, helpers.
//
// Gameplay functions are split over mixins (pools, flow, shop, packs) but all
// operate on this object, mirroring how the Lua code uses the global `G`.
// Ported from ArnoStar/BalatroEngine (balatro/game.py).

import { ActionsMixin } from "./actions.ts";
import { Back } from "./back.ts";
import { Blind } from "./blind.ts";
import { Card } from "./card.ts";
import { CardArea } from "./cardarea.ts";
import { load, type GameData } from "./data.ts";
import { FlowMixin } from "./flow.ts";
import { copy_table, floor, type T } from "./lua.ts";
import { PacksMixin } from "./packs.ts";
import { PoolsMixin } from "./pools.ts";
import { PseudoRandom, normalize_seed } from "./rng.ts";
import { ShopMixin } from "./shop.ts";
import { snapshot } from "./snapshot.ts";
import type { Tag } from "./tag.ts";
import { apply_to_run } from "./vouchers.ts";

export const STATES = {
  SELECTING_HAND: 1,
  HAND_PLAYED: 2,
  DRAW_TO_HAND: 3,
  GAME_OVER: 4,
  SHOP: 5,
  PLAY_TAROT: 6,
  BLIND_SELECT: 7,
  ROUND_EVAL: 8,
  TAROT_PACK: 9,
  PLANET_PACK: 10,
  MENU: 11,
  TUTORIAL: 12,
  SPLASH: 13,
  SANDBOX: 14,
  SPECTRAL_PACK: 15,
  DEMO_CTA: 16,
  STANDARD_PACK: 17,
  BUFFOON_PACK: 18,
  NEW_ROUND: 19,
} as const;

export type State = (typeof STATES)[keyof typeof STATES];

export const STATE_NAMES = new Map(
  Object.entries(STATES).map(([k, v]) => [v, k as keyof typeof STATES] as const),
);

export const DECK_NAMES: Record<string, string> = {
  red: "b_red",
  blue: "b_blue",
  yellow: "b_yellow",
  green: "b_green",
  black: "b_black",
  magic: "b_magic",
  nebula: "b_nebula",
  ghost: "b_ghost",
  abandoned: "b_abandoned",
  checkered: "b_checkered",
  zodiac: "b_zodiac",
  painted: "b_painted",
  anaglyph: "b_anaglyph",
  plasma: "b_plasma",
  erratic: "b_erratic",
  challenge: "b_challenge",
};
export const STAKE_NAMES: Record<string, number> = {
  white: 1,
  red: 2,
  green: 3,
  black: 4,
  blue: 5,
  purple: 6,
  orange: 7,
  gold: 8,
};

/**
 * Which centers are unlocked/discovered (affects pools).
 *
 * Seed finders assume everything is unlocked; `Profile.fresh()` is a brand
 * new save. Discoveries made during a *seeded* run don't count in the game,
 * so the profile is static for the whole run.
 */
export class Profile {
  all: boolean;
  unlocked: Set<string>;
  discovered: Set<string>;

  constructor(unlocked?: Set<string>, discovered?: Set<string>, all_ = true) {
    this.all = all_;
    this.unlocked = unlocked ?? new Set();
    this.discovered = discovered ?? new Set();
  }

  static everything() {
    return new Profile(undefined, undefined, true);
  }

  static fresh() {
    const d = load();
    const unlocked = new Set(
      Object.entries(d.P_CENTERS)
        .filter(([, v]) => v.unlocked !== false)
        .map(([k]) => k),
    );
    const discovered = new Set(
      Object.entries(d.P_CENTERS)
        .filter(([, v]) => v.discovered)
        .map(([k]) => k),
    );
    for (const [k, v] of Object.entries(d.P_TAGS)) if (v.discovered) discovered.add(k);
    return new Profile(unlocked, discovered, false);
  }
}

export type GameOptions = {
  deck?: string;
  stake?: number | string;
  challenge?: string;
  profile?: Profile;
  hands_order?: Iterable<string>;
  normalize?: boolean;
};

type Methods<M> = { [K in keyof M]: M[K] };

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export interface Game
  extends
    Methods<typeof PoolsMixin>,
    Methods<typeof FlowMixin>,
    Methods<typeof ShopMixin>,
    Methods<typeof PacksMixin>,
    Methods<typeof ActionsMixin> {}

// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export class Game {
  readonly STATES = STATES;

  data: GameData;
  P_CENTERS: Record<string, T>;
  P_CARDS: Record<string, T>;
  P_BLINDS: Record<string, T>;
  P_TAGS: Record<string, T>;
  P_SEALS: Record<string, T>;
  P_CENTER_POOLS: Record<string, T[]>;
  P_JOKER_RARITY_POOLS: T[][];
  P_CARD_KEY: Map<T, string>;
  handlist: string[];
  profile: Profile;
  _hands_order: string[];

  seed: string;
  deck_key: string;
  stake: number;
  challenge_id: string | undefined;

  // runtime bookkeeping (globals in the Lua)
  sort_id = 0;
  tagid = 0;
  playing_card = 0;
  stone_id_counter = -100;
  all_cards: Card[] = [];
  events: (() => unknown)[] = [];
  deferred: (() => unknown)[] = [];
  OVERLAY_MENU: T | undefined = undefined;
  FORCE_TAG: string | undefined = undefined;
  FORCE_BOSS: string | undefined = undefined;
  orbital_hand: string | undefined = undefined;
  from_boss_tag: boolean | undefined = undefined;
  ARGS: T = {};
  STATE: State = STATES.BLIND_SELECT;
  STATE_COMPLETE = false;
  TAROT_INTERRUPT: State | undefined = undefined;
  shop: boolean | undefined = undefined;
  blind_select: T | undefined = undefined;
  booster_pack: boolean | undefined = undefined;
  round_eval: boolean | undefined = undefined;
  shop_jokers: CardArea | undefined = undefined;
  shop_vouchers: CardArea | undefined = undefined;
  shop_booster: CardArea | undefined = undefined;
  pack_cards: CardArea | undefined = undefined;
  play: CardArea | undefined = undefined;
  jokers: CardArea | undefined = undefined;
  consumeables: CardArea | undefined = undefined;
  hand: CardArea | undefined = undefined;
  deck: CardArea | undefined = undefined;
  discard: CardArea | undefined = undefined;
  playing_cards: Card[] = [];
  GAME: T;
  rng: PseudoRandom;
  log: unknown[] = [];

  // set later by flow (attributes the Python adds outside __init__)
  last_score: T | undefined = undefined;
  last_scoring: T | undefined = undefined;
  round_eval_rows: [string, number][] | undefined = undefined;

  constructor(
    seed: string,
    {
      deck = "b_red",
      stake = 1,
      challenge,
      profile,
      hands_order,
      normalize = true,
    }: GameOptions = {},
  ) {
    this.data = load();
    const d = this.data;
    this.P_CENTERS = d.P_CENTERS;
    this.P_CARDS = d.P_CARDS;
    this.P_BLINDS = d.P_BLINDS;
    this.P_TAGS = d.P_TAGS;
    this.P_SEALS = d.P_SEALS;
    this.P_CENTER_POOLS = d.P_CENTER_POOLS;
    this.P_JOKER_RARITY_POOLS = d.P_JOKER_RARITY_POOLS;
    this.P_CARD_KEY = new Map(Object.entries(d.P_CARDS).map(([k, v]) => [v, k]));
    this.handlist = d.handlist;
    this.profile = profile ?? Profile.everything();
    this._hands_order = hands_order !== undefined ? [...hands_order] : [...DEFAULT_HANDS_ORDER];

    this.seed = normalize ? normalize_seed(seed) : seed;
    this.deck_key = DECK_NAMES[deck.toLowerCase()] ?? deck;
    this.stake = typeof stake === "string" ? (STAKE_NAMES[stake.toLowerCase()] ?? 1) : stake;
    this.challenge_id = challenge;

    this.GAME = this.init_game_object();
    this.rng = new PseudoRandom(this.seed);
  }

  snapshot() {
    return snapshot(this);
  }

  /**
   * An independent copy of the whole run (for what-if exploration).
   *
   * Static prototype tables are shared, everything else is copied, so the
   * clone continues with exactly the same RNG streams and state.
   */
  clone(): Game {
    const memo = new Map<unknown, unknown>([
      [this.data, this.data],
      [this.profile, this.profile],
    ]);
    const share = (v: object) => memo.set(v, v);
    for (const table of [
      this.P_CENTERS,
      this.P_CARDS,
      this.P_BLINDS,
      this.P_TAGS,
      this.P_SEALS,
      this.data.P_STAKES,
    ]) {
      share(table);
      for (const v of Object.values(table)) share(v);
    }
    for (const pool of Object.values(this.P_CENTER_POOLS)) share(pool);
    share(this.P_CENTER_POOLS);
    for (const pool of this.P_JOKER_RARITY_POOLS) share(pool);
    share(this.P_JOKER_RARITY_POOLS);
    share(this.P_CARD_KEY);
    share(this.handlist);
    return deepcopy(this, memo);
  }

  // ------------------------------------------------------------- profile
  is_unlocked(center: T) {
    if (this.profile.all) return true;
    if (center.unlocked !== false) return true;
    return this.profile.unlocked.has(center.key);
  }

  is_discovered(key: string) {
    if (this.profile.all) return true;
    return this.profile.discovered.has(key);
  }

  /** Iteration order of `pairs(G.GAME.hands)` (see DEFAULT_HANDS_ORDER). */
  hands_order() {
    return this._hands_order;
  }

  // -------------------------------------------------------------- events
  add_event(fn: () => unknown, front = false) {
    if (front) this.events.unshift(fn);
    else this.events.push(fn);
  }

  run_events() {
    const ev = this.events;
    while (ev.length > 0) ev.shift()!();
  }

  /** Non-blockable delayed events: run once the action has settled. */
  defer(fn: () => unknown) {
    this.deferred.push(fn);
  }

  defer_removal(card: Card) {
    this.defer(() => card.remove());
  }

  /** Fire every pending timed (non-blockable) effect; events they queue join the normal queue. */
  run_deferred_one_frame() {
    while (this.deferred.length > 0) {
      const fns = this.deferred;
      this.deferred = [];
      for (const fn of fns) fn();
    }
  }

  run_deferred() {
    while (this.deferred.length > 0) {
      this.run_deferred_one_frame();
      this.run_events();
    }
  }

  // ------------------------------------------------------------- helpers
  find_joker(name: string, non_debuff = false) {
    const out: Card[] = [];
    if (this.jokers === undefined) return out;
    for (const v of this.jokers.cards)
      if (v.ability.name === name && (non_debuff || !v.debuff)) out.push(v);
    for (const v of this.consumeables!.cards)
      if (v.ability.name === name && (non_debuff || !v.debuff)) out.push(v);
    return out;
  }

  get_blind_amount(ante: number) {
    const k = 0.75;
    const scaling = this.GAME.modifiers.scaling;
    let amounts: number[];
    if (!scaling || scaling === 1) amounts = [300, 800, 2000, 5000, 11000, 20000, 35000, 50000];
    else if (scaling === 2) amounts = [300, 900, 2600, 8000, 20000, 36000, 60000, 100000];
    else amounts = [300, 1000, 3200, 9000, 25000, 60000, 110000, 200000];
    if (ante < 1) return 100;
    if (ante <= 8) return amounts[ante - 1]!;
    const a = amounts[7]!;
    const b = 1.6;
    const c = ante - 8;
    const dd = 1 + 0.2 * (ante - 8);
    const amount = floor(a * (b + (k * c) ** dd) ** c);
    if (amount === Infinity) return amount;
    // Python's math.floor returns an int, so the rounding below is exact
    // integer arithmetic; the result becomes a float (nearest double) on use
    const A = BigInt(amount);
    return Number(A - (A % 10n ** BigInt(Math.floor(Math.log10(amount) - 1))));
  }

  refresh_all_costs() {
    for (const c of [...this.all_cards]) c.set_cost();
  }

  /** Per-frame CardArea:update + Card:update logic (Game:update -> MOVEABLES). */
  update_cards() {
    const G = this;
    const hand = G.hand;
    if (hand !== undefined) {
      const per = G.GAME.modifiers.minus_hand_size_per_X_dollar;
      if (per) {
        const last = hand.config.last_poll_size || 0;
        const now = Math.floor(G.GAME.dollars / per);
        if (now !== last) {
          hand.change_size(last - now);
          hand.config.last_poll_size = now;
        }
      }
      for (const c of [...hand.cards])
        if (c.ability.forced_selection && hand.highlighted.length === 0) hand.add_to_highlighted(c);
    }
    if (G.deck !== undefined && G.deck.config.card_limit > G.playing_cards.length)
      G.deck.config.card_limit = G.playing_cards.length;
    for (const c of [...this.all_cards]) if (!c.removed) c.update();
  }

  ease_dollars(mod: number, instant = false) {
    const _mod = () => {
      this.GAME.dollars = this.GAME.dollars + (mod || 0);
    };
    if (instant) _mod();
    else this.add_event(_mod);
  }

  ease_discard(mod: number, instant = false, _silent = false) {
    const _mod = () => {
      const cr = this.GAME.current_round;
      if (Math.abs(Math.max(cr.discards_left, mod)) === 0) return;
      const m = Math.max(-cr.discards_left, mod || 0);
      cr.discards_left = cr.discards_left + m;
    };
    if (instant) _mod();
    else this.add_event(_mod);
  }

  ease_hands_played(mod: number, instant = false) {
    const _mod = () => {
      this.GAME.current_round.hands_left = this.GAME.current_round.hands_left + (mod || 0);
    };
    if (instant) _mod();
    else this.add_event(_mod);
  }

  ease_ante(mod: number) {
    this.add_event(() => {
      this.GAME.round_resets.ante = this.GAME.round_resets.ante + (mod || 0);
    });
  }

  ease_round(mod: number) {
    this.add_event(() => {
      this.GAME.round = this.GAME.round + (mod || 0);
    });
  }

  ease_chips(mod: number) {
    this.add_event(() => {
      this.GAME.chips = mod || 0;
    });
  }

  level_up_hand(_card: unknown, hand: string, _instant?: unknown, amount = 1) {
    const h = this.GAME.hands[hand];
    h.level = Math.max(0, h.level + amount);
    h.mult = Math.max(h.s_mult + h.l_mult * (h.level - 1), 1);
    h.chips = Math.max(h.s_chips + h.l_chips * (h.level - 1), 0);
  }

  calculate_reroll_cost(skip_increment = false) {
    const cr = this.GAME.current_round;
    if (cr.free_rerolls < 0) cr.free_rerolls = 0;
    if (cr.free_rerolls > 0) {
      cr.reroll_cost = 0;
      return;
    }
    cr.reroll_cost_increase = cr.reroll_cost_increase || 0;
    if (!skip_increment) cr.reroll_cost_increase += 1;
    const rr = this.GAME.round_resets;
    cr.reroll_cost =
      (rr.temp_reroll_cost != null ? rr.temp_reroll_cost : rr.reroll_cost) +
      cr.reroll_cost_increase;
  }

  add_tag(tag: Tag) {
    for (const t of [...this.GAME.tags]) t.apply_to_run({ type: "tag_add", tag });
    this.GAME.tags.push(tag);
  }

  change_shop_size(mod: number) {
    const G = this;
    if (!G.GAME.shop) return;
    G.GAME.shop.joker_max = G.GAME.shop.joker_max + mod;
    if (G.shop_jokers !== undefined && !G.shop_jokers.removed) {
      if (mod < 0)
        for (let i = G.shop_jokers.cards.length - 1; i > G.GAME.shop.joker_max - 1; i--)
          if (i < G.shop_jokers.cards.length) G.shop_jokers.cards[i]!.remove();
      G.shop_jokers.config.card_limit = G.GAME.shop.joker_max;
      if (mod > 0)
        for (let n = G.GAME.shop.joker_max - G.shop_jokers.cards.length; n > 0; n--)
          G.shop_jokers.emplace(G.create_card_for_shop(G.shop_jokers));
    }
  }

  playing_card_joker_effects(cards: Card[]) {
    for (const j of [...this.jokers!.cards]) j.calculate_joker({ playing_card_added: true, cards });
  }

  /** draw_card() from common_events.lua: the move happens in an event. */
  draw_card(
    from_: CardArea | undefined,
    to: CardArea,
    card?: Card,
    sort = false,
    stay_flipped?: boolean,
    discarded_only = false,
  ) {
    const G = this;
    G.add_event(() => {
      let c = card;
      if (c !== undefined) {
        if (from_ !== undefined) c = from_.remove_card(c)!;
        let stay = G.GAME && G.GAME.blind ? G.GAME.blind.stay_flipped(to, c) : undefined;
        if (G.GAME.modifiers.flipped_cards && to === G.hand)
          if (G.rng.random("flipped_card") < 1 / G.GAME.modifiers.flipped_cards) stay = true;
        to.emplace(c, undefined, stay);
      } else {
        to.draw_card_from(from_!, stay_flipped, discarded_only);
      }
      if (sort) to.sort();
    });
  }

  // ------------------------------------------------------- game object
  init_game_object(): T {
    const d = this.data;
    const bosses_used: T = {};
    for (const [k, v] of Object.entries(d.P_BLINDS)) if (v.boss) bosses_used[k] = 0;
    const cards_played: T = {};
    for (const r of ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"])
      cards_played[r] = { suits: {}, total: 0 };
    // the Python T() constructor keeps None values (last_tarot_planet, blind,
    // blind_on_deck, temp_reroll_cost, temp_handsize); here they are simply absent
    const g: T = {
      won: false,
      round_scores: {
        new_collection: { amt: 0 },
        cards_played: { amt: 0 },
        cards_discarded: { amt: 0 },
        times_rerolled: { amt: 0 },
        cards_purchased: { amt: 0 },
        hand: { amt: 0 },
      },
      joker_usage: {},
      consumeable_usage: {},
      hand_usage: {},
      win_ante: 8,
      stake: 1,
      modifiers: {},
      starting_params: copy_table(d.starting_params),
      banned_keys: {},
      round: 0,
      probabilities: { normal: 1 },
      bosses_used,
      pseudorandom: {},
      starting_deck_size: 52,
      ecto_minus: 1,
      pack_size: 2,
      skips: 0,
      STOP_USE: 0,
      edition_rate: 1,
      joker_rate: 20,
      tarot_rate: 4,
      planet_rate: 4,
      spectral_rate: 0,
      playing_card_rate: 0,
      consumeable_buffer: 0,
      joker_buffer: 0,
      discount_percent: 0,
      interest_cap: 25,
      interest_amount: 1,
      inflation: 0,
      hands_played: 0,
      unused_discards: 0,
      perishable_rounds: 5,
      rental_rate: 3,
      chips: 0,
      dollars: 0,
      max_jokers: 0,
      bankrupt_at: 0,
      current_boss_streak: 0,
      base_reroll_cost: 5,
      sort: "desc",
      previous_round: { dollars: 4 },
      tags: [],
      tag_tally: 0,
      pool_flags: {},
      used_jokers: {},
      used_vouchers: {},
      current_round: {
        current_hand: { chips: 0, mult: 0, chip_total: 0, handname: "" },
        used_packs: {},
        cards_flipped: 0,
        idol_card: { suit: "Spades", rank: "Ace" },
        mail_card: { rank: "Ace" },
        ancient_card: { suit: "Spades" },
        castle_card: { suit: "Spades" },
        hands_left: 0,
        hands_played: 0,
        discards_left: 0,
        discards_used: 0,
        dollars: 0,
        reroll_cost: 5,
        reroll_cost_increase: 0,
        jokers_purchased: 0,
        free_rerolls: 0,
        round_dollars: 0,
        most_played_poker_hand: "High Card",
      },
      round_resets: {
        hands: 1,
        discards: 1,
        reroll_cost: 1,
        ante: 1,
        blind_ante: 1,
        blind_states: { Small: "Select", Big: "Upcoming", Boss: "Upcoming" },
        blind_choices: { Small: "bl_small", Big: "bl_big" },
        boss_rerolled: false,
      },
      round_bonus: { next_hands: 0, discards: 0 },
      shop: { joker_max: 2 },
      cards_played,
      hands: copy_table(d.hands_proto),
    };
    return g;
  }

  // -------------------------------------------------------------- start
  start_run() {
    const G = this;
    const GAME = G.GAME;
    const challenge = G.challenge_id ? G.data.challenge(G.challenge_id) : undefined;
    let back_center: T | undefined;
    if (challenge !== undefined && challenge.deck && challenge.deck.type)
      back_center = G.data.center_by_name(challenge.deck.type);
    else back_center = G.P_CENTERS[G.deck_key];
    GAME.stake = G.stake;
    GAME.STOP_USE = 0;
    GAME.selected_back = new Back(G, back_center);
    GAME.selected_back_key = back_center;
    if (GAME.stake >= 2) {
      GAME.modifiers.no_blind_reward ??= {};
      GAME.modifiers.no_blind_reward.Small = true;
    }
    if (GAME.stake >= 3) GAME.modifiers.scaling = 2;
    if (GAME.stake >= 4) GAME.modifiers.enable_eternals_in_shop = true;
    if (GAME.stake >= 5) GAME.starting_params.discards = GAME.starting_params.discards - 1;
    if (GAME.stake >= 6) GAME.modifiers.scaling = 3;
    if (GAME.stake >= 7) GAME.modifiers.enable_perishables_in_shop = true;
    if (GAME.stake >= 8) GAME.modifiers.enable_rentals_in_shop = true;

    // card areas exist before any event runs
    let sp = GAME.starting_params;
    const consumeables = new CardArea(G, "consumeables", {
      card_limit: sp.consumable_slots,
      type: "joker",
      highlight_limit: 1,
    });
    const jokers = new CardArea(G, "jokers", {
      card_limit: sp.joker_slots,
      type: "joker",
      highlight_limit: 1,
    });
    G.consumeables = consumeables;
    G.jokers = jokers;
    G.discard = new CardArea(G, "discard", { card_limit: 500, type: "discard" });
    const deck = new CardArea(G, "deck", { card_limit: 52, type: "deck" });
    G.deck = deck;
    const hand = new CardArea(G, "hand", { card_limit: sp.hand_size, type: "hand" });
    G.hand = hand;
    G.play = new CardArea(G, "play", { card_limit: 5, type: "play" });
    GAME.blind = new Blind(G);

    GAME.selected_back.apply_to_run();

    if (challenge !== undefined) {
      this._apply_challenge(challenge);
      sp = GAME.starting_params;
    }

    // CardAreas above were created with the *pre*-deck starting params in
    // the Lua as well?  No: start_run builds areas after apply_to_run.
    consumeables.config.card_limit = sp.consumable_slots;
    consumeables.config.temp_limit = sp.consumable_slots;
    jokers.config.card_limit = sp.joker_slots;
    jokers.config.temp_limit = sp.joker_slots;
    hand.config.card_limit = sp.hand_size;
    hand.config.temp_limit = sp.hand_size;

    const rr = GAME.round_resets;
    rr.hands = sp.hands;
    rr.discards = sp.discards;
    rr.reroll_cost = sp.reroll_cost;
    GAME.dollars = sp.dollars;
    GAME.base_reroll_cost = sp.reroll_cost;
    rr.reroll_cost = GAME.base_reroll_cost;
    GAME.current_round.reroll_cost = GAME.base_reroll_cost;

    GAME.seeded = true;
    GAME.pseudorandom = G.rng.state;
    rr.blind_tags ??= {};
    rr.blind_choices.Boss = G.get_new_boss();
    GAME.current_round.voucher = G.get_next_voucher_key();
    rr.blind_tags.Small = G.get_next_tag_key();
    rr.blind_tags.Big = G.get_next_tag_key();

    // starting deck
    let card_protos: T[] = [];
    const de: T | undefined =
      challenge !== undefined && challenge.deck ? challenge.deck : undefined;
    if (de !== undefined && de.cards) {
      card_protos = de.cards.map((v: T) => ({ ...v }));
    } else {
      // pairs() order over P_CARDS is irrelevant: every pass is either
      // unconditional (52 erratic draws) or the result gets sorted below
      for (let k of G.data.P_CARDS_SORTED_KEYS) {
        if (sp.erratic_suits_and_ranks)
          k = G.data.P_CARDS_SORTED_KEYS[G.rng.element_index(52, G.rng.pseudoseed("erratic"))]!;
        const r = k[2]!;
        const s = k[0]!;
        let keep = true;
        let e: string | undefined;
        let dd: string | undefined;
        let g: string | undefined;
        if (de !== undefined) {
          if (de.yes_ranks && !de.yes_ranks[r]) keep = false;
          if (de.no_ranks && de.no_ranks[r]) keep = false;
          if (de.yes_suits && !de.yes_suits[s]) keep = false;
          if (de.no_suits && de.no_suits[s]) keep = false;
          [e, dd, g] = [de.enhancement, de.edition, de.gold_seal];
        }
        if (sp.no_faces && ["K", "Q", "J"].includes(r)) keep = false;
        if (keep) {
          const p: T = { s, r };
          if (e != null) p.e = e;
          if (dd != null) p.d = dd;
          if (g != null) p.g = g;
          card_protos.push(p);
        }
      }
    }
    if (sp.extra_cards) for (const v of sp.extra_cards) card_protos.push({ ...v });
    const proto_key = (p: T): string =>
      (p.s || "") + (p.r || "") + (p.e || "") + (p.d || "") + (p.g || "");
    card_protos.sort((a, b) => {
      const ka = proto_key(a);
      const kb = proto_key(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const p of card_protos) G.card_from_control(p);
    GAME.starting_deck_size = G.playing_cards.length;

    GAME.current_round.discards_left = rr.discards;
    GAME.current_round.hands_left = rr.hands;
    deck.shuffle();
    G.reset_idol_card();
    G.reset_mail_rank();
    delete GAME.current_round.ancient_card.suit;
    G.reset_ancient_card();
    G.reset_castle_card();

    GAME.blind.set_blind(undefined, undefined, true);
    G.reset_blinds();
    G.STATE = STATES.BLIND_SELECT;
    G.STATE_COMPLETE = false;
    G.advance();
    return this;
  }

  card_from_control(control: T) {
    const G = this;
    G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
    const card = new Card(
      G,
      G.P_CARDS[control.s + "_" + control.r],
      G.P_CENTERS[control.e || "c_base"]!,
      { playing_card: G.playing_card },
    );
    if (control.d) card.set_edition({ [control.d]: true }, true, true);
    if (control.g) card.set_seal(control.g, true, true);
    G.deck!.emplace(card);
    G.playing_cards.push(card);
    return card;
  }

  _apply_challenge(ch: T) {
    const G = this;
    const GAME = G.GAME;
    GAME.challenge = ch.id;
    GAME.challenge_tab = ch;
    if (ch.jokers)
      for (const v of ch.jokers as T[])
        G.add_event(() => {
          const j = G.add_joker(v.id, v.edition);
          if (v.eternal) j.set_eternal(true);
          if (v.pinned) j.pinned = true;
        });
    if (ch.consumeables)
      for (const v of ch.consumeables as T[]) G.add_event(() => G.add_joker(v.id, undefined));
    if (ch.vouchers)
      for (const v of ch.vouchers as T[]) {
        GAME.used_vouchers[v.id] = true;
        G.add_event(() => {
          GAME.starting_voucher_count = (GAME.starting_voucher_count || 0) + 1;
          apply_to_run(G, undefined, G.P_CENTERS[v.id]);
        });
      }
    const rules = ch.rules;
    if (rules) {
      for (const v of (rules.modifiers ?? []) as T[]) GAME.starting_params[v.id] = v.value;
      for (const v of (rules.custom ?? []) as T[]) {
        if (v.id === "no_reward") {
          GAME.modifiers.no_blind_reward ??= {};
          GAME.modifiers.no_blind_reward.Small = true;
          GAME.modifiers.no_blind_reward.Big = true;
          GAME.modifiers.no_blind_reward.Boss = true;
        } else if (v.id === "no_reward_specific") {
          GAME.modifiers.no_blind_reward ??= {};
          GAME.modifiers.no_blind_reward[v.value] = true;
        } else if (v.value != null) {
          GAME.modifiers[v.id] = v.value;
        } else if (v.id === "no_shop_jokers") {
          GAME.joker_rate = 0;
        } else {
          GAME.modifiers[v.id] = true;
        }
      }
    }
    const res = ch.restrictions;
    if (res) {
      for (const v of (res.banned_cards ?? []) as T[]) {
        GAME.banned_keys[v.id] = true;
        for (const vv of (v.ids ?? []) as string[]) GAME.banned_keys[vv] = true;
      }
      for (const v of (res.banned_tags ?? []) as T[]) GAME.banned_keys[v.id] = true;
      for (const v of (res.banned_other ?? []) as T[]) GAME.banned_keys[v.id] = true;
    }
  }

  add_joker(key: string, edition?: string, _silent?: unknown, eternal?: unknown) {
    const G = this;
    const center = G.P_CENTERS[key]!;
    const area = center.consumeable ? G.consumeables : G.jokers;
    const card = new Card(G, undefined, center, {
      discover: true,
      bypass_discovery_center: true,
    });
    if (area !== undefined) card.add_to_deck();
    if (edition) card.set_edition({ [edition]: true });
    if (eternal) card.set_eternal(true);
    if (area !== undefined && card.ability.set === "Joker") area.emplace(card);
    else if (G.consumeables !== undefined) G.consumeables.emplace(card);
    return card;
  }
}

Object.assign(Game.prototype, PoolsMixin, FlowMixin, ShopMixin, PacksMixin, ActionsMixin);

/**
 * `copy.deepcopy` with a pre-filled memo: class instances keep their
 * prototype, arrays, Maps, Sets and plain objects are copied, cycles resolve
 * through the memo, functions are shared by reference.
 */
const deepcopy = <V>(v: V, memo: Map<unknown, unknown>): V => {
  if (typeof v !== "object" || v === null) return v;
  if (memo.has(v)) return memo.get(v) as V;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    memo.set(v, out);
    for (const x of v) out.push(deepcopy(x, memo));
    return out as V;
  }
  if (v instanceof Map) {
    const out = new Map();
    memo.set(v, out);
    for (const [k, x] of v) out.set(deepcopy(k, memo), deepcopy(x, memo));
    return out as V;
  }
  if (v instanceof Set) {
    const out = new Set();
    memo.set(v, out);
    for (const x of v) out.add(deepcopy(x, memo));
    return out as V;
  }
  const out: Record<PropertyKey, unknown> = Object.create(Object.getPrototypeOf(v));
  memo.set(v, out);
  const src = v as Record<PropertyKey, unknown>;
  for (const k of Reflect.ownKeys(src)) out[k] = deepcopy(src[k], memo);
  return out as V;
};

/**
 * `pairs(G.GAME.hands)` iteration order. It decides To Do List targets, the
 * Orbital Tag hand and The Ox's tie-break (and nothing else). In LuaJIT 2.1
 * (LOVE 11.4+/Balatro) the order depends on string hashes that are keyed with
 * a random per-process seed ("Redesign and harden string interning", 2020), so
 * it changes from one game launch to the next: the seed fixes *which position*
 * is chosen, the session fixes which hand sits at that position. The default
 * is simply the constructor's source order; pass `hands_order` to match a
 * particular session (the oracle reports the order it used).
 */
export const DEFAULT_HANDS_ORDER = [
  "Flush Five",
  "Flush House",
  "Five of a Kind",
  "Straight Flush",
  "Four of a Kind",
  "Full House",
  "Flush",
  "Straight",
  "Three of a Kind",
  "Two Pair",
  "Pair",
  "High Card",
];
