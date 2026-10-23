// Card / tag / voucher / boss generation (common_events.lua + create_card_for_shop).
// Ported from ArnoStar/BalatroEngine (balatro/pools.py).

import { Card } from "./card.ts";
import type { CardArea } from "./cardarea.ts";
import type { Game } from "./game.ts";
import { copy_table, lua_mod, type T } from "./lua.ts";
import { lua_tostring, sorted_by_sort_id } from "./rng.ts";

export const UNAVAILABLE = "UNAVAILABLE";

export const PoolsMixin = {
  // ------------------------------------------------------------------ pools
  get_current_pool(
    this: Game,
    _type: string,
    _rarity?: number,
    _legendary?: unknown,
    _append?: string,
  ): [string[], string] {
    const G = this;
    const GAME = G.GAME;
    const ante = GAME.round_resets.ante;
    let starting_pool: T[];
    let pool_key: string;
    if (_type === "Joker") {
      let rarity =
        _rarity != null ? _rarity : G.rng.random("rarity" + lua_tostring(ante) + (_append || ""));
      rarity = _legendary ? 4 : rarity > 0.95 ? 3 : rarity > 0.7 ? 2 : 1;
      starting_pool = G.P_JOKER_RARITY_POOLS[rarity - 1]!;
      pool_key = "Joker" + String(rarity) + (!_legendary ? _append || "" : "");
    } else {
      starting_pool = G.P_CENTER_POOLS[_type]!;
      pool_key = _type + (_append || "");
    }

    let pool: string[] = [];
    let pool_size = 0;
    let showman: boolean | undefined;
    for (const v of starting_pool) {
      let add: boolean | undefined;
      if (_type === "Enhanced") {
        add = true;
      } else if (_type === "Demo") {
        add = true;
      } else if (_type === "Tag") {
        if ((!v.requires || G.is_discovered(v.requires)) && (!v.min_ante || v.min_ante <= ante))
          add = true;
      } else {
        if (showman === undefined) showman = G.find_joker("Showman").length > 0;
        if (!(GAME.used_jokers[v.key] && !showman) && (G.is_unlocked(v) || v.rarity === 4)) {
          if (v.set === "Voucher") {
            if (!GAME.used_vouchers[v.key]) {
              let include = true;
              if (v.requires)
                for (const vv of v.requires as string[])
                  if (!GAME.used_vouchers[vv]) include = false;
              if (G.shop_vouchers !== undefined)
                for (const vv of G.shop_vouchers.cards)
                  if (vv.config.center.key === v.key) include = false;
              if (include) add = true;
            }
          } else if (v.set === "Planet") {
            if (!v.config.softlock || GAME.hands[v.config.hand_type].played > 0) add = true;
          } else if (v.enhancement_gate) {
            add = undefined;
            for (const vv of G.playing_cards)
              if (vv.config.center.key === v.enhancement_gate) add = true;
          } else {
            add = true;
          }
          if (v.name === "Black Hole" || v.name === "The Soul") add = false;
        }
      }
      if (v.no_pool_flag && GAME.pool_flags[v.no_pool_flag]) add = undefined;
      if (v.yes_pool_flag && !GAME.pool_flags[v.yes_pool_flag]) add = undefined;
      if (add && !GAME.banned_keys[v.key]) {
        pool.push(v.key);
        pool_size += 1;
      } else {
        pool.push(UNAVAILABLE);
      }
    }

    if (pool_size === 0) {
      if (_type === "Tarot" || _type === "Tarot_Planet") pool = ["c_strength"];
      else if (_type === "Planet") pool = ["c_pluto"];
      else if (_type === "Spectral") pool = ["c_incantation"];
      else if (_type === "Voucher") pool = ["v_blank"];
      else if (_type === "Tag") pool = ["tag_handy"];
      else pool = ["j_joker"];
    }
    return [pool, pool_key + (!_legendary ? lua_tostring(ante) : "")];
  },

  /** pseudorandom_element + the '_resample' loop used everywhere. */
  pick_from_pool(this: Game, pool: string[], pool_key: string) {
    const rng = this.rng;
    let center = pool[rng.element_index(pool.length, rng.pseudoseed(pool_key))]!;
    let it = 1;
    while (center === UNAVAILABLE) {
      it += 1;
      center =
        pool[rng.element_index(pool.length, rng.pseudoseed(pool_key + "_resample" + String(it)))]!;
    }
    return center;
  },

  get_next_voucher_key(this: Game, _from_tag = false) {
    let [pool, pool_key] = this.get_current_pool("Voucher");
    if (_from_tag) pool_key = "Voucher_fromtag";
    return this.pick_from_pool(pool, pool_key);
  },

  get_next_tag_key(this: Game, append?: string) {
    if (this.FORCE_TAG) return this.FORCE_TAG;
    const [pool, pool_key] = this.get_current_pool("Tag", undefined, undefined, append);
    return this.pick_from_pool(pool, pool_key);
  },

  poll_edition(
    this: Game,
    _key?: string,
    _mod = 1,
    _no_neg?: unknown,
    _guaranteed?: unknown,
  ): T | undefined {
    const G = this;
    const poll = G.rng.random(_key || "edition_generic");
    if (_guaranteed) {
      if (poll > 1 - 0.003 * 25 && !_no_neg) return { negative: true };
      else if (poll > 1 - 0.006 * 25) return { polychrome: true };
      else if (poll > 1 - 0.02 * 25) return { holo: true };
      else if (poll > 1 - 0.04 * 25) return { foil: true };
    } else {
      const rate = G.GAME.edition_rate;
      if (poll > 1 - 0.003 * _mod && !_no_neg) return { negative: true };
      else if (poll > 1 - 0.006 * rate * _mod) return { polychrome: true };
      else if (poll > 1 - 0.02 * rate * _mod) return { holo: true };
      else if (poll > 1 - 0.04 * rate * _mod) return { foil: true };
    }
    return undefined;
  },

  /** pseudorandom_element(G.P_CARDS, pseudoseed(key)) -> P_CARDS entry. */
  random_p_card(this: Game, seed_key: string): T {
    const keys = this.data.P_CARDS_SORTED_KEYS;
    return this.P_CARDS[keys[this.rng.element_index(keys.length, this.rng.pseudoseed(seed_key))]!]!;
  },

  // ------------------------------------------------------------- create_card
  create_card(
    this: Game,
    _type: string,
    area: CardArea | undefined,
    legendary?: unknown,
    _rarity?: number,
    _skip_materialize?: unknown,
    soulable?: unknown,
    forced_key?: string,
    key_append?: string,
  ): Card {
    const G = this;
    const GAME = G.GAME;
    area = area ?? G.jokers;
    const ante = lua_tostring(GAME.round_resets.ante);
    if (!forced_key && soulable && !GAME.banned_keys.c_soul) {
      const showman = G.find_joker("Showman").length > 0;
      if (
        (_type === "Tarot" || _type === "Spectral" || _type === "Tarot_Planet") &&
        !(GAME.used_jokers.c_soul && !showman)
      )
        if (G.rng.random("soul_" + _type + ante) > 0.997) forced_key = "c_soul";
      if (
        (_type === "Planet" || _type === "Spectral") &&
        !(GAME.used_jokers.c_black_hole && !showman)
      )
        if (G.rng.random("soul_" + _type + ante) > 0.997) forced_key = "c_black_hole";
    }
    if (_type === "Base") forced_key = "c_base";

    let center: T;
    if (forced_key && !GAME.banned_keys[forced_key]) {
      center = G.P_CENTERS[forced_key]!;
      _type = center.set !== "Default" ? center.set : _type;
    } else {
      const [pool, pool_key] = G.get_current_pool(_type, _rarity, legendary, key_append);
      center = G.P_CENTERS[G.pick_from_pool(pool, pool_key)]!;
    }

    let front: T | undefined;
    if (_type === "Base" || _type === "Enhanced")
      front = G.random_p_card("front" + (key_append || "") + ante);

    const card = new Card(G, front, center, {
      bypass_discovery_center: [
        G.shop_jokers,
        G.pack_cards,
        G.shop_vouchers,
        G.jokers,
        G.consumeables,
      ].includes(area),
      discover: area === G.jokers || area === G.consumeables,
    });

    if (_type === "Joker") {
      if (GAME.modifiers.all_eternal) card.set_eternal(true);
      if (area === G.shop_jokers || area === G.pack_cards) {
        const ep_poll = G.rng.random((area === G.pack_cards ? "packetper" : "etperpoll") + ante);
        if (GAME.modifiers.enable_eternals_in_shop && ep_poll > 0.7) card.set_eternal(true);
        else if (GAME.modifiers.enable_perishables_in_shop && 0.4 < ep_poll && ep_poll <= 0.7)
          card.set_perishable(true);
        if (
          GAME.modifiers.enable_rentals_in_shop &&
          G.rng.random((area === G.pack_cards ? "packssjr" : "ssjr") + ante) > 0.7
        )
          card.set_rental(true);
      }
      const edition = G.poll_edition("edi" + (key_append || "") + ante);
      card.set_edition(edition);
    }
    return card;
  },

  create_playing_card(
    this: Game,
    card_init: T | undefined,
    area: CardArea | undefined,
    _skip_materialize?: unknown,
    _silent?: unknown,
    _colours?: unknown,
  ): Card {
    const G = this;
    card_init = card_init ?? {};
    if (card_init.front == null) card_init.front = G.random_p_card("front");
    if (card_init.center == null) card_init.center = G.P_CENTERS.c_base;
    G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
    const card = new Card(G, card_init.front, card_init.center, { playing_card: G.playing_card });
    G.playing_cards.push(card);
    card.playing_card = G.playing_card;
    if (area !== undefined) area.emplace(card);
    return card;
  },

  copy_card(
    this: Game,
    other: Card,
    new_card?: Card,
    _card_scale?: unknown,
    playing_card?: number,
    strip_edition?: unknown,
  ): Card {
    const G = this;
    if (new_card === undefined)
      new_card = new Card(
        G,
        undefined,
        G.P_CENTERS.c_base!,
        playing_card != null ? { playing_card } : {},
      );
    new_card.set_ability(other.config.center);
    new_card.ability.type = other.ability.type;
    new_card.set_base(other.config.card);
    for (const [k, v] of Object.entries(other.ability)) new_card.ability[k] = copy_table(v);
    if (!strip_edition) new_card.set_edition(other.edition ?? {}, undefined, true);
    new_card.set_seal(other.seal, true);
    if (other.params && Object.keys(other.params).length > 0) {
      new_card.params = other.params;
      if (playing_card != null) new_card.params.playing_card = playing_card;
      else delete new_card.params.playing_card;
    }
    new_card.debuff = other.debuff;
    new_card.pinned = other.pinned;
    return new_card;
  },

  // ----------------------------------------------------------------- packs
  get_pack(this: Game, _key?: string, _type?: string): T {
    const G = this;
    const GAME = G.GAME;
    if (!GAME.first_shop_buffoon && !GAME.banned_keys.p_buffoon_normal_1) {
      GAME.first_shop_buffoon = true;
      // math.random(1, 2) on the *global* LuaJIT state only picks the
      // artwork; both packs are identical
      return G.P_CENTERS.p_buffoon_normal_1!;
    }
    let cume = 0.0;
    const boosters = G.P_CENTER_POOLS.Booster!;
    for (const v of boosters)
      if ((!_type || _type === v.kind) && !GAME.banned_keys[v.key])
        cume += v.weight != null ? v.weight : 1;
    const poll =
      G.rng.random(
        G.rng.pseudoseed((_key || "pack_generic") + lua_tostring(GAME.round_resets.ante)),
      ) * cume;
    let it = 0.0;
    let center: T | undefined;
    for (const v of boosters) {
      if (!GAME.banned_keys[v.key]) {
        const w = v.weight != null ? v.weight : 1;
        if (!_type || _type === v.kind) it += w;
        if (it >= poll && it - w <= poll) {
          center = v;
          break;
        }
      }
    }
    return center!;
  },

  // ------------------------------------------------------------------ boss
  get_new_boss(this: Game): string {
    const G = this;
    const GAME = G.GAME;
    const ante = GAME.round_resets.ante;
    const presc = GAME.perscribed_bosses;
    if (presc && presc[ante]) {
      const ret = presc[ante];
      delete presc[ante];
      GAME.bosses_used[ret] = GAME.bosses_used[ret] + 1;
      return ret;
    }
    if (G.FORCE_BOSS) return G.FORCE_BOSS;
    const eligible = new Map<string, true | number>();
    const win_ante = GAME.win_ante;
    for (const [k, v] of Object.entries(G.P_BLINDS)) {
      const b = v.boss;
      if (!b) continue;
      if (
        !b.showdown &&
        b.min <= Math.max(1, ante) &&
        (lua_mod(Math.max(1, ante), win_ante) !== 0 || ante < 2)
      )
        eligible.set(k, true);
      else if (b.showdown && lua_mod(ante, win_ante) === 0 && ante >= 2) eligible.set(k, true);
    }
    for (const k of Object.keys(GAME.banned_keys)) eligible.delete(k);
    let min_use = 100;
    for (const [k, v] of Object.entries<number>(GAME.bosses_used)) {
      if (eligible.has(k)) {
        eligible.set(k, v);
        if (v <= min_use) min_use = v;
      }
    }
    for (const [k, v] of [...eligible]) if (v !== true && v > min_use) eligible.delete(k);
    const keys = [...eligible.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const boss = keys[G.rng.element_index(keys.length, G.rng.pseudoseed("boss"))]!;
    GAME.bosses_used[boss] = GAME.bosses_used[boss] + 1;
    return boss;
  },

  // -------------------------------------------------- per-round random cards
  _random_card_from(this: Game, cards: Card[], seed_key: string): Card {
    const ordered = sorted_by_sort_id(cards);
    return ordered[this.rng.element_index(ordered.length, this.rng.pseudoseed(seed_key))]!;
  },

  reset_idol_card(this: Game) {
    const G = this;
    const cr = G.GAME.current_round;
    cr.idol_card.rank = "Ace";
    cr.idol_card.suit = "Spades";
    const valid = G.playing_cards.filter((v) => v.ability.effect !== "Stone Card");
    if (valid.length > 0) {
      const c = G._random_card_from(valid, "idol" + lua_tostring(G.GAME.round_resets.ante));
      cr.idol_card.rank = c.base.value;
      cr.idol_card.suit = c.base.suit;
      cr.idol_card.id = c.base.id;
    }
  },

  reset_mail_rank(this: Game) {
    const G = this;
    const cr = G.GAME.current_round;
    cr.mail_card.rank = "Ace";
    const valid = G.playing_cards.filter((v) => v.ability.effect !== "Stone Card");
    if (valid.length > 0) {
      const c = G._random_card_from(valid, "mail" + lua_tostring(G.GAME.round_resets.ante));
      cr.mail_card.rank = c.base.value;
      cr.mail_card.id = c.base.id;
    }
  },

  reset_ancient_card(this: Game) {
    const G = this;
    const cr = G.GAME.current_round;
    const suits = ["Spades", "Hearts", "Clubs", "Diamonds"].filter(
      (s) => s !== cr.ancient_card.suit,
    );
    cr.ancient_card.suit = G.rng.element(
      suits,
      G.rng.pseudoseed("anc" + lua_tostring(G.GAME.round_resets.ante)),
    );
  },

  reset_castle_card(this: Game) {
    const G = this;
    const cr = G.GAME.current_round;
    cr.castle_card.suit = "Spades";
    const valid = G.playing_cards.filter((v) => v.ability.effect !== "Stone Card");
    if (valid.length > 0) {
      const c = G._random_card_from(valid, "cas" + lua_tostring(G.GAME.round_resets.ante));
      cr.castle_card.suit = c.base.suit;
    }
  },

  reset_blinds(this: Game) {
    const G = this;
    const rr = G.GAME.round_resets;
    if (rr.blind_states == null)
      rr.blind_states = { Small: "Select", Big: "Upcoming", Boss: "Upcoming" };
    if (rr.blind_states.Boss === "Defeated") {
      rr.blind_states.Small = "Upcoming";
      rr.blind_states.Big = "Upcoming";
      rr.blind_states.Boss = "Upcoming";
      G.GAME.blind_on_deck = "Small";
      rr.blind_choices.Boss = G.get_new_boss();
      rr.boss_rerolled = false;
    }
  },

  // ------------------------------------------------------------- shop cards
  create_card_for_shop(this: Game, area: CardArea): Card {
    const G = this;
    const GAME = G.GAME;
    for (const tag of [...GAME.tags]) {
      const forced = tag.apply_to_run({ type: "store_joker_create", area });
      // store_joker_create returns the created Card or nil
      if (forced instanceof Card) {
        for (const t2 of [...GAME.tags])
          if (t2.apply_to_run({ type: "store_joker_modify", card: forced })) break;
        return forced;
      }
    }
    GAME.spectral_rate = GAME.spectral_rate || 0;
    const total_rate =
      GAME.joker_rate +
      GAME.tarot_rate +
      GAME.planet_rate +
      GAME.playing_card_rate +
      GAME.spectral_rate;
    const polled_rate =
      G.rng.random(G.rng.pseudoseed("cdt" + lua_tostring(GAME.round_resets.ante))) * total_rate;
    let check_rate = 0;
    const illusion = GAME.used_vouchers.v_illusion;
    let base_type = "Base";
    if (illusion && G.rng.random(G.rng.pseudoseed("illusion")) > 0.6) base_type = "Enhanced";
    for (const [typ, val] of [
      ["Joker", GAME.joker_rate],
      ["Tarot", GAME.tarot_rate],
      ["Planet", GAME.planet_rate],
      [base_type, GAME.playing_card_rate],
      ["Spectral", GAME.spectral_rate],
    ] as [string, number][]) {
      if (check_rate < polled_rate && polled_rate <= check_rate + val) {
        const card = G.create_card(
          typ,
          area,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "sho",
        );
        G.add_event(() => {
          for (const t of [...GAME.tags])
            if (t.apply_to_run({ type: "store_joker_modify", card })) break;
        });
        if (
          (typ === "Base" || typ === "Enhanced") &&
          illusion &&
          G.rng.random(G.rng.pseudoseed("illusion")) > 0.8
        ) {
          const edition_poll = G.rng.random(G.rng.pseudoseed("illusion"));
          let edition: T;
          if (edition_poll > 1 - 0.15) edition = { polychrome: true };
          else if (edition_poll > 0.5) edition = { holo: true };
          else edition = { foil: true };
          card.set_edition(edition);
        }
        return card;
      }
      check_rate += val;
    }
    throw new Error("create_card_for_shop: no card type selected");
  },
};
