// Port of card.lua (everything except calculate_joker, which lives in jokers.ts).
// Ported from ArnoStar/BalatroEngine (balatro/card.py).

import type { CardArea } from "./cardarea.ts";
import { can_use_consumeable, use_consumeable } from "./consumables.ts";
import type { Game } from "./game.ts";
import { calculate_joker } from "./jokers.ts";
import { copy_table, type T } from "./lua.ts";
import { open_booster } from "./packs.ts";
import { apply_to_run, redeem } from "./vouchers.ts";

// [nominal, face_nominal, id]
export const RANK_NOMINALS = new Map<string, readonly [number, number, number]>([
  ["2", [2, 0.0, 2]],
  ["3", [3, 0.0, 3]],
  ["4", [4, 0.0, 4]],
  ["5", [5, 0.0, 5]],
  ["6", [6, 0.0, 6]],
  ["7", [7, 0.0, 7]],
  ["8", [8, 0.0, 8]],
  ["9", [9, 0.0, 9]],
  ["10", [10, 0.0, 10]],
  ["Jack", [10, 0.1, 11]],
  ["Queen", [10, 0.2, 12]],
  ["King", [10, 0.3, 13]],
  ["Ace", [11, 0.4, 14]],
]);
// [suit_nominal, suit_nominal_original]
export const SUIT_NOMINALS = new Map<string, readonly [number, number]>([
  ["Diamonds", [0.01, 0.001]],
  ["Clubs", [0.02, 0.002]],
  ["Hearts", [0.03, 0.003]],
  ["Spades", [0.04, 0.004]],
]);
export const ID_TO_RANK_CHAR = new Map<number, string>([
  [2, "2"],
  [3, "3"],
  [4, "4"],
  [5, "5"],
  [6, "6"],
  [7, "7"],
  [8, "8"],
  [9, "9"],
  [10, "T"],
  [11, "J"],
  [12, "Q"],
  [13, "K"],
  [14, "A"],
]);
export const VALUE_TO_RANK_CHAR = new Map<string, string>([
  ["Ace", "A"],
  ["King", "K"],
  ["Queen", "Q"],
  ["Jack", "J"],
  ["10", "T"],
]);
export const SUIT_PREFIX = new Map<string, string>([
  ["Diamonds", "D_"],
  ["Spades", "S_"],
  ["Clubs", "C_"],
  ["Hearts", "H_"],
]);

export type CardParams = {
  playing_card?: number;
  viewed_back?: boolean;
  bypass_discovery_center?: boolean;
  discover?: boolean;
};

export type CardConfig = {
  card: T;
  center: T;
  card_key?: string;
  center_key?: string;
};

/** `self.base`. name/suit/value/id are only set for playing cards. */
export type CardBase = {
  name: string;
  suit: string;
  value: string;
  nominal: number;
  suit_nominal: number;
  face_nominal: number;
  times_played: number;
  id: number;
  original_value?: string;
  suit_nominal_original?: number;
};

export type Edition = {
  type: "holo" | "foil" | "polychrome" | "negative";
  holo?: true;
  foil?: true;
  polychrome?: true;
  negative?: true;
  mult?: number;
  chips?: number;
  x_mult?: number;
};

/** A card object: playing card, joker, consumable, voucher or booster. */
export class Card {
  G: Game;
  params: CardParams;
  config: CardConfig;
  playing_card: number | undefined;
  sort_id: number;
  ID: number;
  back: "viewed_back" | "selected_back";
  bypass_discovery_center: boolean | undefined;
  base_cost = 0;
  extra_cost = 0;
  cost = 0;
  sell_cost = 0;
  unique_val: number;
  edition: Edition | undefined = undefined;
  seal: string | undefined = undefined;
  // set by set_ability()
  ability!: T;
  base!: CardBase;
  area: CardArea | undefined = undefined;
  facing: "front" | "back" = "front";
  highlighted = false;
  debuff = false;
  added_to_deck: boolean | undefined = undefined;
  removed = false;
  // transient flags used by the game logic
  getting_sliced: boolean | undefined = undefined;
  shattered: boolean | undefined = undefined;
  destroyed: boolean | undefined = undefined;
  lucky_trigger: boolean | undefined = undefined;
  vampired: boolean | undefined = undefined;
  opening: boolean | undefined = undefined;
  from_tag: boolean | undefined = undefined;
  shop_voucher: boolean | undefined = undefined;
  temp_edition: boolean | undefined = undefined;
  pinned: boolean | undefined = undefined;
  eligible_strength_jokers: Card[] = [];
  eligible_editionless_jokers: Card[] = [];

  constructor(G: Game, card: T | undefined, center: T, params?: CardParams) {
    this.G = G;
    this.params = params ?? {};
    this.config = { card: card ?? {}, center };
    this.playing_card = this.params.playing_card;
    G.sort_id += 1;
    this.sort_id = G.sort_id;
    this.ID = this.sort_id;
    this.back = this.params.viewed_back ? "viewed_back" : "selected_back";
    this.bypass_discovery_center = this.params.bypass_discovery_center;
    this.unique_val = 1 - this.ID / 1603301;
    this.set_ability(center, true);
    this.set_base(card, true);
    this.set_cost();
    G.all_cards.push(this);
  }

  // ------------------------------------------------------------------ repr
  toString() {
    return `<Card ${this.short()}#${this.sort_id}>`;
  }

  short() {
    let s: string;
    if (this.ability.set === "Default" || this.ability.set === "Enhanced") s = card_label(this);
    else s = this.config.center.key || "?";
    if (this.edition) s += `[${this.edition.type}]`;
    return s;
  }

  get key(): string {
    return this.config.center.key;
  }

  // ------------------------------------------------------------- set_base
  set_base(card: T | undefined, initial = false) {
    const G = this.G;
    card = card ?? {};
    this.config.card = card;
    this.config.card_key = G.P_CARD_KEY.get(card);
    let suit_base_nominal_original: number | undefined;
    if (this.base && this.base.suit_nominal_original != null)
      suit_base_nominal_original = this.base.suit_nominal_original;
    const times_played = 0;
    this.base = {
      name: card.name,
      suit: card.suit,
      value: card.value,
      nominal: 0,
      suit_nominal: 0,
      face_nominal: 0,
      times_played,
      // id (like name/suit/value) stays nil for non-playing cards, as in the Lua table
    } as CardBase;
    const rank = RANK_NOMINALS.get(card.value);
    if (rank) {
      const [nominal, face, rid] = rank;
      this.base.nominal = nominal;
      this.base.face_nominal = face;
      this.base.id = rid;
    }
    if (initial) this.base.original_value = this.base.value;
    const suit = SUIT_NOMINALS.get(card.suit);
    if (suit) {
      const [sn, sno] = suit;
      this.base.suit_nominal = sn;
      this.base.suit_nominal_original = suit_base_nominal_original ?? sno;
    }
    if (!initial) G.GAME.blind.debuff_card(this);
  }

  // ---------------------------------------------------------- set_ability
  set_ability(center: T, initial = false, _delay_sprites = false) {
    const G = this.G;
    this.config.center = center;
    this.config.center_key = center.key;
    // (the Lua subtracts the old enhancement bonus from the *old* ability
    // table right before replacing it - a no-op)
    const old: T | undefined = this.ability;
    const cfg: T = center.config ?? {};
    const ability: T = {
      name: center.name,
      effect: center.effect,
      set: center.set,
      mult: cfg.mult || 0,
      h_mult: cfg.h_mult || 0,
      h_x_mult: cfg.h_x_mult || 0,
      h_dollars: cfg.h_dollars || 0,
      p_dollars: cfg.p_dollars || 0,
      t_mult: cfg.t_mult || 0,
      t_chips: cfg.t_chips || 0,
      x_mult: cfg.Xmult != null ? cfg.Xmult : 1,
      h_size: cfg.h_size || 0,
      d_size: cfg.d_size || 0,
      extra: cfg.extra != null ? copy_table(cfg.extra) : undefined,
      extra_value: 0,
      type: cfg.type || "",
      order: center.order,
      forced_selection: old != null ? old.forced_selection : undefined,
      perma_bonus: old != null && old.perma_bonus != null ? old.perma_bonus : 0,
    };
    // nil fields are absent from a Lua table
    for (const k of Object.keys(ability)) if (ability[k] == null) delete ability[k];
    this.ability = ability;
    // the Lua reads self.ability.bonus from the *new* table (always nil),
    // so any previous enhancement bonus is dropped
    this.ability.bonus = cfg.bonus || 0;
    if (center.consumeable) this.ability.consumeable = copy_table(cfg);
    const name = this.ability.name;
    if (name === "Invisible Joker") this.ability.invis_rounds = 0;
    if (name === "To Do List") {
      const poker_hands = G.hands_order().filter((k: string) => G.GAME.hands[k].visible);
      const old_hand = this.ability.to_do_poker_hand;
      delete this.ability.to_do_poker_hand;
      const area_is_title = this.area != null && this.area.config.type === "title";
      while (this.ability.to_do_poker_hand == null) {
        const choice = G.rng.element(
          poker_hands,
          G.rng.pseudoseed(area_is_title ? "false_to_do" : "to_do"),
        );
        this.ability.to_do_poker_hand = choice;
        if (choice === old_hand) delete this.ability.to_do_poker_hand;
      }
    }
    if (name === "Caino") this.ability.caino_xmult = 1;
    if (name === "Yorick") this.ability.yorick_discards = this.ability.extra.discards;
    if (name === "Loyalty Card") {
      this.ability.burnt_hand = 0;
      this.ability.loyalty_remaining = this.ability.extra.every;
    }
    this.base_cost = center.cost != null ? center.cost : 1;
    this.ability.hands_played_at_create = G.GAME ? G.GAME.hands_played : 0;
    if (!G.OVERLAY_MENU)
      for (const k of G.data.by_name.get(name) ?? []) G.GAME.used_jokers[k] = true;
    if (!initial) G.GAME.blind.debuff_card(this);
  }

  // ------------------------------------------------------------- set_cost
  set_cost() {
    const G = this.G;
    this.extra_cost = 0 + G.GAME.inflation;
    if (this.edition) {
      const e = this.edition;
      this.extra_cost +=
        (e.holo ? 3 : 0) + (e.foil ? 2 : 0) + (e.polychrome ? 5 : 0) + (e.negative ? 5 : 0);
    }
    this.cost = Math.max(
      1,
      Math.floor(
        ((this.base_cost + this.extra_cost + 0.5) * (100 - G.GAME.discount_percent)) / 100,
      ),
    );
    if (this.ability.set === "Booster" && G.GAME.modifiers.booster_ante_scaling)
      this.cost = this.cost + G.GAME.round_resets.ante - 1;
    if (
      (this.ability.set === "Planet" ||
        (this.ability.set === "Booster" && this.ability.name.includes("Celestial"))) &&
      G.find_joker("Astronomer").length > 0
    )
      this.cost = 0;
    if (this.ability.rental) this.cost = 1;
    this.sell_cost = Math.max(1, Math.floor(this.cost / 2)) + (this.ability.extra_value || 0);
    if (
      this.area != null &&
      this.ability.couponed &&
      (this.area === G.shop_jokers || this.area === G.shop_booster)
    )
      this.cost = 0;
  }

  // ---------------------------------------------------------- set_edition
  set_edition(edition: T | false | null | undefined, _immediate = false, _silent = false) {
    const G = this.G;
    this.edition = undefined;
    if (edition == null || edition === false) return; // Lua returns before set_cost() here
    const P = G.P_CENTERS;
    if (edition.holo) {
      this.edition = { mult: P["e_holo"]!.config.extra, holo: true, type: "holo" };
    } else if (edition.foil) {
      this.edition = { chips: P["e_foil"]!.config.extra, foil: true, type: "foil" };
    } else if (edition.polychrome) {
      this.edition = {
        x_mult: P["e_polychrome"]!.config.extra,
        polychrome: true,
        type: "polychrome",
      };
    } else if (edition.negative) {
      // self.edition was reset to nil above, so this always fires for an
      // existing card (matches the Lua, which also checks `not self.edition`)
      if (this.added_to_deck) {
        if (this.ability.consumeable) G.consumeables!.config.card_limit += 1;
        else G.jokers!.config.card_limit += 1;
      }
      this.edition = { negative: true, type: "negative" };
    }
    this.set_cost();
  }

  // ------------------------------------------------------------- set_seal
  set_seal(seal: string | null | undefined, _silent = false, _immediate = false) {
    this.seal = seal ? seal : undefined;
    this.set_cost();
  }

  get_seal(bypass_debuff = false) {
    if (this.debuff && !bypass_debuff) return undefined;
    return this.seal;
  }

  set_eternal(eternal?: boolean) {
    delete this.ability.eternal;
    if (this.config.center.eternal_compat && !this.ability.perishable)
      if (eternal) this.ability.eternal = eternal;
  }

  set_perishable(_perishable?: boolean) {
    delete this.ability.perishable;
    if (this.config.center.perishable_compat && !this.ability.eternal) {
      this.ability.perishable = true;
      this.ability.perish_tally = this.G.GAME.perishable_rounds;
    }
  }

  set_rental(rental?: boolean) {
    if (rental) this.ability.rental = rental;
    else delete this.ability.rental;
    this.set_cost();
  }

  set_debuff(should_debuff?: boolean | null) {
    const G = this.G;
    const debuff = Boolean(should_debuff);
    if (this.ability.perishable && this.ability.perish_tally <= 0) {
      if (!this.debuff) {
        this.debuff = true;
        if (this.area === G.jokers) this.remove_from_deck(true);
      }
      return;
    }
    if (debuff !== this.debuff) {
      if (this.area === G.jokers) {
        if (debuff) this.remove_from_deck(true);
        else this.add_to_deck(true);
      }
      this.debuff = debuff;
    }
  }

  change_suit(new_suit: string) {
    const G = this.G;
    const new_val = VALUE_TO_RANK_CHAR.get(this.base.value) ?? this.base.value;
    this.set_base(G.P_CARDS[SUIT_PREFIX.get(new_suit)! + new_val]);
    G.GAME.blind.debuff_card(this);
  }

  // ---------------------------------------------------------- deck in/out
  add_to_deck(from_debuff = false) {
    const G = this.G;
    if (this.added_to_deck) return;
    this.added_to_deck = true;
    if (this.ability.set === "Enhanced" || this.ability.set === "Default") return;
    const ab = this.ability;
    const name = ab.name;
    if (ab.h_size !== 0) G.hand!.change_size(ab.h_size);
    if (ab.d_size > 0) {
      G.GAME.round_resets.discards += ab.d_size;
      G.ease_discard(ab.d_size);
    }
    if (name === "Credit Card") G.GAME.bankrupt_at = G.GAME.bankrupt_at - ab.extra;
    if (name === "Chicot" && G.GAME.blind && G.GAME.blind.boss && !G.GAME.blind.disabled)
      G.GAME.blind.disable();
    if (name === "Chaos the Clown") {
      G.GAME.current_round.free_rerolls += 1;
      G.calculate_reroll_cost(true);
    }
    if (name === "Turtle Bean") G.hand!.change_size(ab.extra.h_size);
    if (name === "Oops! All 6s")
      for (const k of Object.keys(G.GAME.probabilities))
        G.GAME.probabilities[k] = G.GAME.probabilities[k] * 2;
    if (name === "To the Moon") G.GAME.interest_amount += ab.extra;
    if (name === "Astronomer") G.add_event(() => G.refresh_all_costs());
    if (name === "Troubadour") {
      G.hand!.change_size(ab.extra.h_size);
      G.GAME.round_resets.hands += ab.extra.h_plays;
    }
    if (name === "Stuntman") G.hand!.change_size(-ab.extra.h_size);
    if (this.edition && this.edition.negative) {
      if (from_debuff) delete ab.queue_negative_removal;
      else if (ab.consumeable) G.consumeables!.config.card_limit += 1;
      else G.jokers!.config.card_limit += 1;
    }
    if (G.GAME.blind) G.add_event(() => G.GAME.blind.set_blind(undefined, true, undefined));
  }

  remove_from_deck(from_debuff = false) {
    const G = this.G;
    if (!this.added_to_deck) return;
    this.added_to_deck = false;
    const ab = this.ability;
    const name = ab.name;
    if (ab.h_size !== 0) G.hand!.change_size(-ab.h_size);
    if (ab.d_size > 0) {
      G.GAME.round_resets.discards -= ab.d_size;
      G.ease_discard(-ab.d_size);
    }
    if (name === "Credit Card") G.GAME.bankrupt_at = G.GAME.bankrupt_at + ab.extra;
    if (name === "Chaos the Clown") {
      G.GAME.current_round.free_rerolls -= 1;
      G.calculate_reroll_cost(true);
    }
    if (name === "Turtle Bean") G.hand!.change_size(-ab.extra.h_size);
    if (name === "Oops! All 6s")
      for (const k of Object.keys(G.GAME.probabilities))
        G.GAME.probabilities[k] = G.GAME.probabilities[k] / 2;
    if (name === "To the Moon") G.GAME.interest_amount -= ab.extra;
    if (name === "Astronomer") G.add_event(() => G.refresh_all_costs());
    if (name === "Troubadour") {
      G.hand!.change_size(-ab.extra.h_size);
      G.GAME.round_resets.hands -= ab.extra.h_plays;
    }
    if (name === "Stuntman") G.hand!.change_size(ab.extra.h_size);
    if (this.edition && this.edition.negative && G.jokers != null) {
      if (from_debuff) ab.queue_negative_removal = true;
      else if (ab.consumeable) G.consumeables!.config.card_limit -= 1;
      else G.jokers.config.card_limit -= 1;
    }
    if (G.GAME.blind) G.add_event(() => G.GAME.blind.set_blind(undefined, true, undefined));
  }

  // --------------------------------------------------------------- getters
  get_nominal(mod?: string) {
    let mult = 1;
    if (mod === "suit") mult = 1000;
    if (this.ability.effect === "Stone Card") mult = -1000;
    const b = this.base;
    return (
      b.nominal +
      b.suit_nominal * mult +
      (b.suit_nominal_original || 0) * 0.0001 * mult +
      b.face_nominal +
      0.000001 * this.unique_val
    );
  }

  get_id() {
    if (this.ability.effect === "Stone Card" && !this.vampired) {
      // the game returns -math.random(100, 1000000) from the *global*
      // LuaJIT state; only uniqueness matters, so use a unique negative id
      this.G.stone_id_counter -= 1;
      return this.G.stone_id_counter;
    }
    return this.base.id;
  }

  is_face(from_boss = false) {
    if (this.debuff && !from_boss) return undefined;
    const rid = this.get_id();
    if (rid === 11 || rid === 12 || rid === 13 || this.G.find_joker("Pareidolia").length > 0)
      return true;
    return undefined;
  }

  get_original_rank() {
    return this.base.original_value;
  }

  get_chip_bonus(): number {
    if (this.debuff) return 0;
    if (this.ability.effect === "Stone Card")
      return this.ability.bonus + (this.ability.perma_bonus || 0);
    return this.base.nominal + this.ability.bonus + (this.ability.perma_bonus || 0);
  }

  get_chip_mult(): number {
    const G = this.G;
    if (this.debuff) return 0;
    if (this.ability.set === "Joker") return 0;
    if (this.ability.effect === "Lucky Card") {
      if (G.rng.random("lucky_mult") < G.GAME.probabilities.normal / 5) {
        this.lucky_trigger = true;
        return this.ability.mult;
      }
      return 0;
    }
    return this.ability.mult;
  }

  get_chip_x_mult(_context?: T): number {
    if (this.debuff) return 0;
    if (this.ability.set === "Joker") return 0;
    if (this.ability.x_mult <= 1) return 0;
    return this.ability.x_mult;
  }

  get_chip_h_mult(): number {
    if (this.debuff) return 0;
    return this.ability.h_mult;
  }

  get_chip_h_x_mult(): number {
    if (this.debuff) return 0;
    return this.ability.h_x_mult;
  }

  get_edition(_context?: T) {
    if (this.debuff) return undefined;
    if (this.edition) {
      const ret: T = { card: this };
      if (this.edition.x_mult) ret.x_mult_mod = this.edition.x_mult;
      if (this.edition.mult) ret.mult_mod = this.edition.mult;
      if (this.edition.chips) ret.chip_mod = this.edition.chips;
      return ret;
    }
    return undefined;
  }

  get_end_of_round_effect(_context?: T) {
    const G = this.G;
    if (this.debuff) return {};
    const ret: T = {};
    if (this.ability.h_dollars > 0) {
      ret.h_dollars = this.ability.h_dollars;
      ret.card = this;
    }
    const consumeables = G.consumeables!;
    if (
      this.seal === "Blue" &&
      consumeables.cards.length + G.GAME.consumeable_buffer < consumeables.config.card_limit
    ) {
      G.GAME.consumeable_buffer += 1;
      G.add_event(() => {
        if (G.GAME.last_hand_played) {
          // the Lua starts from planet = 0; the Python passes 0 as forced_key,
          // which create_card treats as falsy, the same as nil
          let planet: string | undefined;
          for (const v of G.P_CENTER_POOLS["Planet"]!)
            if (v.config.hand_type === G.GAME.last_hand_played) planet = v.key;
          const card = G.create_card(
            "Planet",
            G.consumeables,
            undefined,
            undefined,
            undefined,
            undefined,
            planet,
            "blusl",
          );
          card.add_to_deck();
          G.consumeables!.emplace(card);
          G.GAME.consumeable_buffer = 0;
        }
      });
      ret.effect = true;
    }
    return ret;
  }

  get_p_dollars(): number {
    const G = this.G;
    if (this.debuff) return 0;
    let ret = 0;
    if (this.seal === "Gold") ret += 3;
    if (this.ability.p_dollars > 0) {
      if (this.ability.effect === "Lucky Card") {
        if (G.rng.random("lucky_money") < G.GAME.probabilities.normal / 15) {
          this.lucky_trigger = true;
          ret += this.ability.p_dollars;
        }
      } else {
        ret += this.ability.p_dollars;
      }
    }
    if (ret > 0) {
      G.GAME.dollar_buffer = (G.GAME.dollar_buffer || 0) + ret;
      G.add_event(() => {
        G.GAME.dollar_buffer = 0;
      });
    }
    return ret;
  }

  is_suit(suit: string, bypass_debuff = false, flush_calc = false) {
    const G = this.G;
    const red = (s: string) => s === "Hearts" || s === "Diamonds";
    if (flush_calc) {
      if (this.ability.effect === "Stone Card") return false;
      if (this.ability.name === "Wild Card" && !this.debuff) return true;
      if (G.find_joker("Smeared Joker").length > 0 && red(this.base.suit) === red(suit))
        return true;
      return this.base.suit === suit;
    }
    if (this.debuff && !bypass_debuff) return undefined;
    if (this.ability.effect === "Stone Card") return false;
    if (this.ability.name === "Wild Card") return true;
    if (G.find_joker("Smeared Joker").length > 0 && red(this.base.suit) === red(suit)) return true;
    return this.base.suit === suit;
  }

  // ------------------------------------------------------------ seals etc
  calculate_seal(context: T): T | undefined {
    const G = this.G;
    if (this.debuff) return undefined;
    if (context.repetition) {
      if (this.seal === "Red") return { message: "Again!", repetitions: 1, card: this };
    }
    if (context.discard) {
      const consumeables = G.consumeables!;
      if (
        this.seal === "Purple" &&
        consumeables.cards.length + G.GAME.consumeable_buffer < consumeables.config.card_limit
      ) {
        G.GAME.consumeable_buffer += 1;
        G.add_event(() => {
          const card = G.create_card(
            "Tarot",
            G.consumeables,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            "8ba",
          );
          card.add_to_deck();
          G.consumeables!.emplace(card);
          G.GAME.consumeable_buffer = 0;
        });
      }
    }
    return undefined;
  }

  calculate_rental() {
    const G = this.G;
    if (this.ability.rental) G.ease_dollars(-G.GAME.rental_rate);
  }

  calculate_perishable() {
    if (this.ability.perishable && this.ability.perish_tally > 0) {
      if (this.ability.perish_tally === 1) {
        this.ability.perish_tally = 0;
        this.set_debuff();
      } else {
        this.ability.perish_tally = this.ability.perish_tally - 1;
      }
    }
  }

  calculate_dollar_bonus(): number | undefined {
    const G = this.G;
    if (this.debuff) return undefined;
    if (this.ability.set === "Joker") {
      const name = this.ability.name;
      if (name === "Golden Joker") return this.ability.extra;
      if (name === "Cloud 9" && this.ability.nine_tally && this.ability.nine_tally > 0)
        return this.ability.extra * this.ability.nine_tally;
      if (name === "Rocket") return this.ability.extra.dollars;
      if (name === "Satellite") {
        let planets_used = 0;
        for (const v of Object.values<T>(G.GAME.consumeable_usage))
          if (v.set === "Planet") planets_used += 1;
        if (planets_used === 0) return undefined;
        return this.ability.extra * planets_used;
      }
      if (
        name === "Delayed Gratification" &&
        G.GAME.current_round.discards_used === 0 &&
        G.GAME.current_round.discards_left > 0
      )
        return G.GAME.current_round.discards_left * this.ability.extra;
    }
    return undefined;
  }

  calculate_joker(context: T) {
    return calculate_joker(this, context);
  }

  // ----------------------------------------------------------- per frame
  /** Card:update logic that matters for the game (runs every frame in Lua). */
  update() {
    const G = this.G;
    const ab = this.ability;
    if (ab.consumeable && ab.consumeable.max_highlighted)
      ab.consumeable.mod_num = Math.min(5, ab.consumeable.max_highlighted);
    if (ab.perma_debuff) this.debuff = true;
    const name = ab.name;
    const jokers = G.jokers!;
    if (name === "Temperance") {
      let money = 0;
      for (const c of jokers.cards) if (c.ability.set === "Joker") money += c.sell_cost;
      ab.money = Math.min(money, ab.extra);
    } else if (name === "Throwback") {
      ab.x_mult = 1 + G.GAME.skips * ab.extra;
    } else if (name === "Driver's License") {
      ab.driver_tally = G.playing_cards.filter(
        (v: Card) => v.config.center !== G.P_CENTERS["c_base"],
      ).length;
    } else if (name === "Steel Joker") {
      ab.steel_tally = G.playing_cards.filter(
        (v: Card) => v.config.center === G.P_CENTERS["m_steel"],
      ).length;
    } else if (name === "Cloud 9") {
      ab.nine_tally = G.playing_cards.filter((v: Card) => v.get_id() === 9).length;
    } else if (name === "Stone Joker") {
      ab.stone_tally = G.playing_cards.filter(
        (v: Card) => v.config.center === G.P_CENTERS["m_stone"],
      ).length;
    } else if (name === "Joker Stencil") {
      let x = jokers.config.card_limit - jokers.cards.length;
      for (const c of jokers.cards) if (c.ability.name === "Joker Stencil") x += 1;
      ab.x_mult = x;
    } else if (name === "The Wheel of Fortune") {
      this.eligible_strength_jokers = jokers.cards.filter(
        (v: Card) => v.ability.set === "Joker" && !v.edition,
      );
    } else if (name === "Ectoplasm" || name === "Hex") {
      this.eligible_editionless_jokers = jokers.cards.filter(
        (v: Card) => v.ability.set === "Joker" && !v.edition,
      );
    } else if (name === "Blueprint" || name === "Brainstorm") {
      let other: Card | undefined;
      if (name === "Brainstorm") {
        other = jokers.cards[0];
      } else {
        const cards = jokers.cards;
        for (let i = 0; i < cards.length; i++) if (cards[i] === this) other = cards[i + 1];
      }
      if (other != null && other !== this && other.config.center.blueprint_compat)
        ab.blueprint_compat = "compatible";
      else ab.blueprint_compat = "incompatible";
    } else if (name === "Swashbuckler") {
      let sell_cost = 0;
      for (const c of jokers.cards) if (c !== this && c.area === G.jokers) sell_cost += c.sell_cost;
      ab.mult = sell_cost;
    }
  }

  flip() {
    if (this.facing === "front") {
      this.facing = "back";
    } else if (this.facing === "back") {
      delete this.ability.wheel_flipped;
      this.facing = "front";
    }
  }

  // --------------------------------------------------------------- removal
  /** Card:remove() */
  remove() {
    const G = this.G;
    if (this.removed) return;
    this.removed = true;
    if (this.area != null) this.area.remove_card(this);
    this.remove_from_deck();
    if (this.ability.queue_negative_removal) {
      if (this.ability.consumeable) G.consumeables!.config.card_limit -= 1;
      else G.jokers!.config.card_limit -= 1;
    }
    if (!G.OVERLAY_MENU) {
      const name = this.ability.name;
      const keys = G.data.by_name.get(name) ?? [];
      if (keys.length > 0 && G.find_joker(name, true).length === 0)
        for (const k of keys) delete G.GAME.used_jokers[k];
    }
    if (G.playing_cards != null) {
      const i = G.playing_cards.indexOf(this);
      if (i >= 0) G.playing_cards.splice(i, 1);
      for (let j = 0; j < G.playing_cards.length; j++) G.playing_cards[j]!.playing_card = j + 1;
    }
    const k = G.all_cards.indexOf(this);
    if (k >= 0) G.all_cards.splice(k, 1);
  }

  start_dissolve(..._args: unknown[]) {
    // visual dissolve; the actual removal happens ~0.7s later in
    // non-blockable events -> modelled as end-of-action deferred removal
    this.G.defer_removal(this);
  }

  shatter() {
    this.shattered = true;
    this.G.defer_removal(this);
  }

  // ----------------------------------------------------------- consumables
  use_consumeable(area: CardArea | undefined, copier?: Card) {
    use_consumeable(this, area, copier);
  }

  can_use_consumeable(any_state = false, skip_check = false): boolean {
    return can_use_consumeable(this, any_state, skip_check);
  }

  check_use() {
    const G = this.G;
    if (this.ability.name === "Ankh") {
      if (G.jokers!.cards.length >= G.jokers!.config.card_limit) return true;
    }
    return undefined;
  }

  sell_card() {
    const G = this.G;
    this.calculate_joker({ selling_self: true });
    G.add_event(() => {
      G.ease_dollars(this.sell_cost);
      this.start_dissolve();
      if (this.ability.set === "Joker" && G.GAME.blind && G.GAME.blind.name === "Verdant Leaf")
        G.add_event(() => G.GAME.blind.disable());
    });
  }

  can_sell_card(_context?: T) {
    const G = this.G;
    if ((G.play != null && G.play.cards.length > 0) || (G.GAME.STOP_USE && G.GAME.STOP_USE > 0))
      return false;
    if (this.area != null && this.area.config.type === "joker" && !this.ability.eternal)
      return true;
    return false;
  }

  open() {
    open_booster(this);
  }

  redeem() {
    redeem(this);
  }

  apply_to_run(center?: T) {
    apply_to_run(this.G, this, center);
  }
}

/** Short text for a playing card: e.g. 'AS' (+enhancement/seal). */
export const card_label = (card: Card) => {
  const b = card.base;
  const rank = VALUE_TO_RANK_CHAR.get(b.value) ?? (b.value || "?");
  let s = `${rank}${(b.suit || "?")[0]}`;
  if (card.ability.set === "Enhanced")
    s += "+" + (card.ability.name || "").replace(" Card", "").toLowerCase();
  if (card.seal) s += "*" + card.seal.toLowerCase();
  return s;
};
