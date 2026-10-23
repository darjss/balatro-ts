// Port of blind.lua (logic only).
// Ported from ArnoStar/BalatroEngine (balatro/blind.py).

import type { Card } from "./card.ts";
import type { CardArea } from "./cardarea.ts";
import { type Game, STATES } from "./game.ts";
import type { T } from "./lua.ts";
import type { PokerHands } from "./poker.ts";

// G.GAME.blind is always a table in Lua, so `if G.GAME.blind` is always true
// once it is set.
export class Blind {
  G: Game;
  config: T = {};
  chips = 0;
  name = "";
  dollars = 0;
  debuff: T = {};
  mult = 0;
  disabled = false;
  discards_sub: number | undefined = undefined;
  hands_sub: number | undefined = undefined;
  boss: boolean | undefined = undefined;
  triggered: boolean | undefined = undefined;
  prepped: boolean | undefined = undefined;
  hands: Record<string, boolean> | undefined = undefined;
  only_hand: string | false | undefined = undefined;

  constructor(G: Game) {
    this.G = G;
  }

  toString() {
    return `<Blind '${this.name}' chips=${this.chips}>`;
  }

  get_type() {
    if (this.name === "Small Blind") return "Small";
    if (this.name === "Big Blind") return "Big";
    if (this.name) return "Boss";
    return undefined;
  }

  set_blind(blind: T | null | undefined, reset?: boolean, _silent?: boolean) {
    const G = this.G;
    const GAME = G.GAME;
    if (!reset) {
      this.config.blind = blind != null ? blind : {};
      this.name = blind != null && blind.name ? blind.name : "";
      this.dollars = blind != null && blind.dollars ? blind.dollars : 0;
      const type = this.get_type();
      if (GAME.modifiers.no_blind_reward && type != null && GAME.modifiers.no_blind_reward[type])
        this.dollars = 0;
      this.debuff = blind != null && blind.debuff != null ? blind.debuff : {};
      this.mult = blind != null && blind.mult ? blind.mult : 0;
      this.disabled = false;
      this.discards_sub = undefined;
      this.hands_sub = undefined;
      this.boss = blind != null ? Boolean(blind.boss) : undefined;
      this.triggered = undefined;
      this.prepped = true;
      GAME.last_blind = GAME.last_blind || {};
      // assigning nil to a Lua table field removes it
      if (this.boss != null) GAME.last_blind.boss = this.boss;
      else delete GAME.last_blind.boss;
      GAME.last_blind.name = this.name;
      this.chips =
        G.get_blind_amount(GAME.round_resets.ante) * this.mult * GAME.starting_params.ante_scaling;
      if (blind == null) this.chips = 0;
    }
    const name = this.name;
    if (name === "The Eye" && !reset) {
      this.hands = {};
      for (const h of G.data.handlist) this.hands[h] = false;
    }
    if (name === "The Mouth" && !reset) this.only_hand = false;
    if (name === "The Fish" && !reset) this.prepped = undefined;
    if (name === "The Water" && !reset) {
      this.discards_sub = GAME.current_round.discards_left;
      G.ease_discard(-this.discards_sub!);
    }
    if (name === "The Needle" && !reset) {
      this.hands_sub = GAME.round_resets.hands - 1;
      G.ease_hands_played(-this.hands_sub!);
    }
    if (name === "The Manacle" && !reset) G.hand!.change_size(-1);
    const jokers = G.jokers!;
    if (name === "Amber Acorn" && !reset && jokers.cards.length > 0) {
      jokers.unhighlight_all();
      for (const v of jokers.cards) v.flip();
      if (jokers.cards.length > 1) {
        G.add_event(() => {
          for (let i = 0; i < 3; i++) G.add_event(() => G.jokers!.shuffle("aajk"));
        });
      }
    }
    for (const v of G.playing_cards) this.debuff_card(v);
    for (const v of jokers.cards) if (!reset) this.debuff_card(v, true);
  }

  defeat(_silent?: boolean) {
    const G = this.G;
    for (const v of G.jokers!.cards) if (v.facing === "back") v.flip();
    if (this.name === "The Manacle" && !this.disabled) G.hand!.change_size(1);
    // the blind is reset ~1.2s later in a non-blockable event
    G.defer(() => this.set_blind(undefined, undefined, true));
  }

  disable() {
    const G = this.G;
    const GAME = G.GAME;
    this.disabled = true;
    for (const v of G.jokers!.cards) if (v.facing === "back") v.flip();
    const name = this.name;
    if (name === "The Water") G.ease_discard(this.discards_sub!);
    if (
      name === "The Wheel" ||
      name === "The House" ||
      name === "The Mark" ||
      name === "The Fish"
    ) {
      for (const c of G.hand!.cards) if (c.facing === "back") c.flip();
      for (const v of G.playing_cards) delete v.ability.wheel_flipped;
    }
    if (name === "The Needle") G.ease_hands_played(this.hands_sub!);
    if (name === "The Wall") this.chips = this.chips / 2;
    if (name === "Cerulean Bell")
      for (const v of G.playing_cards) delete v.ability.forced_selection;
    if (name === "The Manacle") {
      G.hand!.change_size(1);
      G.draw_from_deck_to_hand(1);
    }
    if (name === "Violet Vessel") this.chips = this.chips / 3;

    G.add_event(() => {
      if (this.boss && GAME.chips - GAME.blind.chips >= 0) {
        G.STATE = STATES.NEW_ROUND;
        G.STATE_COMPLETE = false;
      }
    });
    for (const v of G.playing_cards) this.debuff_card(v);
    for (const v of G.jokers!.cards) this.debuff_card(v);
  }

  press_play() {
    const G = this.G;
    if (this.disabled) return undefined;
    const name = this.name;
    if (name === "The Hook") {
      G.add_event(() => {
        let any_selected: boolean | undefined;
        const cards = [...G.hand!.cards];
        for (let i = 0; i < 2; i++) {
          if (i < G.hand!.cards.length) {
            // pseudorandom_element sorts by sort_id but returns the original index
            const order = cards
              .map((_, j) => j)
              .sort((a, b) => cards[a]!.sort_id - cards[b]!.sort_id);
            const pick = order[G.rng.element_index(order.length, G.rng.pseudoseed("hook"))]!;
            G.hand!.add_to_highlighted(cards[pick]!, true);
            cards.splice(pick, 1);
            any_selected = true;
          }
        }
        if (any_selected) G.discard_cards_from_highlighted(undefined, true);
      });
      this.triggered = true;
      return true;
    }
    if (name === "Crimson Heart") {
      if (G.jokers!.cards.length > 0) {
        this.triggered = true;
        this.prepped = true;
      }
    }
    if (name === "The Fish") this.prepped = true;
    if (name === "The Tooth") {
      G.add_event(() => {
        for (let i = 0; i < G.play!.cards.length; i++) G.ease_dollars(-1);
      });
      this.triggered = true;
      return true;
    }
    return undefined;
  }

  modify_hand(
    cards: Card[],
    poker_hands: PokerHands,
    text: string,
    mult: number,
    hand_chips: number,
  ): [number, number, boolean] {
    if (this.disabled) return [mult, hand_chips, false];
    if (this.name === "The Flint") {
      this.triggered = true;
      return [
        Math.max(Math.floor(mult * 0.5 + 0.5), 1),
        Math.max(Math.floor(hand_chips * 0.5 + 0.5), 0),
        true,
      ];
    }
    return [mult, hand_chips, false];
  }

  debuff_hand(cards: Card[], hand: PokerHands, handname: string, check?: boolean) {
    const G = this.G;
    if (this.disabled) return undefined;
    if (this.debuff != null) {
      this.triggered = false;
      const d = this.debuff;
      if (d.hand && hand[d.hand]!.length > 0) {
        this.triggered = true;
        return true;
      }
      if (d.h_size_ge && cards.length < d.h_size_ge) {
        this.triggered = true;
        return true;
      }
      if (d.h_size_le && cards.length > d.h_size_le) {
        this.triggered = true;
        return true;
      }
      if (this.name === "The Eye") {
        if (this.hands![handname]) {
          this.triggered = true;
          return true;
        }
        if (!check) this.hands![handname] = true;
      }
      if (this.name === "The Mouth") {
        if (this.only_hand && this.only_hand !== handname) {
          this.triggered = true;
          return true;
        }
        if (!check) this.only_hand = handname;
      }
    }
    if (this.name === "The Arm") {
      this.triggered = false;
      if (G.GAME.hands[handname].level > 1) {
        this.triggered = true;
        if (!check) G.level_up_hand(undefined, handname, undefined, -1);
      }
    }
    if (this.name === "The Ox") {
      this.triggered = false;
      if (handname === G.GAME.current_round.most_played_poker_hand) {
        this.triggered = true;
        if (!check) G.ease_dollars(-G.GAME.dollars, true);
      }
    }
    return undefined;
  }

  drawn_to_hand() {
    const G = this.G;
    if (!this.disabled) {
      if (this.name === "Cerulean Bell") {
        const any_forced = G.hand!.cards.some((v: Card) => v.ability.forced_selection);
        if (!any_forced) {
          G.hand!.unhighlight_all();
          const forced = G._random_card_from(G.hand!.cards, "cerulean_bell");
          forced.ability.forced_selection = true;
          G.hand!.add_to_highlighted(forced);
        }
      }
      if (this.name === "Crimson Heart" && this.prepped && G.jokers!.cards.length > 0) {
        const jokers: Card[] = [];
        for (const c of G.jokers!.cards) {
          if (!c.debuff || G.jokers!.cards.length < 2) jokers.push(c);
          c.set_debuff(false);
        }
        if (jokers.length > 0) {
          const card = G._random_card_from(jokers, "crimson_heart");
          card.set_debuff(true);
        } else {
          // pseudorandom_element on an empty table still advances the stream
          G.rng.pseudoseed("crimson_heart");
        }
      }
    }
    this.prepped = undefined;
  }

  stay_flipped(area: CardArea, card: Card) {
    const G = this.G;
    if (!this.disabled) {
      if (area === G.hand) {
        if (
          this.name === "The Wheel" &&
          G.rng.random(G.rng.pseudoseed("wheel")) < G.GAME.probabilities.normal / 7
        )
          return true;
        if (
          this.name === "The House" &&
          G.GAME.current_round.hands_played === 0 &&
          G.GAME.current_round.discards_used === 0
        )
          return true;
        if (this.name === "The Mark" && card.is_face(true)) return true;
        if (this.name === "The Fish" && this.prepped) return true;
      }
    }
    return undefined;
  }

  debuff_card(card: Card, _from_blind?: boolean) {
    const G = this.G;
    const d = this.debuff;
    if (d != null && !this.disabled && card.area !== G.jokers) {
      if (d.suit && card.is_suit(d.suit, true)) {
        card.set_debuff(true);
        return;
      }
      if (d.is_face === "face" && card.is_face(true)) {
        card.set_debuff(true);
        return;
      }
      if (this.name === "The Pillar" && card.ability.played_this_ante) {
        card.set_debuff(true);
        return;
      }
      if (d.value && d.value === card.base.value) {
        card.set_debuff(true);
        return;
      }
      if (d.nominal && d.nominal === card.base.nominal) {
        card.set_debuff(true);
        return;
      }
    }
    if (this.name === "Crimson Heart" && !this.disabled && card.area === G.jokers) return;
    if (this.name === "Verdant Leaf" && !this.disabled && card.area !== G.jokers) {
      card.set_debuff(true);
      return;
    }
    card.set_debuff(false);
  }
}
