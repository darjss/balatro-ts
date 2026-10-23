// Card:calculate_joker() from card.lua, ported branch for branch.
// Ported from ArnoStar/BalatroEngine (balatro/jokers.py).
//
// The order of the checks matters (some generic checks, e.g. `x_mult > 1`,
// come before the name-specific ones) and so does the short-circuit order of
// conditions that consume RNG (e.g. `is_face() and pseudorandom('business')`),
// so this file follows the original structure exactly.

import { Card } from "./card.ts";
import { lua_mod, nonempty, type T } from "./lua.ts";
import { get_poker_hand_info } from "./poker.ts";
import { lua_tostring } from "./rng.ts";
import { Tag } from "./tag.ts";

/** The 'eaten / melted / extinct' animation: removal ~0.3s later (non-blockable). */
export function _remove_eaten(self: Card) {
  const G = self.G;
  G.add_event(() => {
    G.defer(() => {
      if (G.jokers != null) G.jokers.remove_card(self);
      self.remove();
    });
  });
}

// mirrors the Lua
export function calculate_joker(self: Card, context: T): T | true | undefined {
  const G = self.G;
  const GAME = G.GAME;
  if (self.debuff) return undefined;
  const ab = self.ability;
  const name = ab.name;

  if (ab.set === "Planet" && !self.debuff) {
    if (context.joker_main) {
      if (
        GAME.used_vouchers["v_observatory"] &&
        ab.consumeable.hand_type === context.scoring_name
      ) {
        return { Xmult_mod: G.P_CENTERS["v_observatory"].config.extra };
      }
    }
  }

  if (ab.set !== "Joker" || self.debuff) return undefined;

  if (name === "Blueprint") {
    let other: Card | undefined;
    const cards = G.jokers!.cards;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] === self) other = i + 1 < cards.length ? cards[i + 1] : undefined;
    }
    if (other !== undefined && other !== self) {
      context.blueprint = context.blueprint ? context.blueprint + 1 : 1;
      context.blueprint_card = context.blueprint_card || self;
      if (context.blueprint > G.jokers!.cards.length + 1) return undefined;
      const ret = other.calculate_joker(context);
      // a copied joker never returns a bare `true` (only Sixth Sense does, and not under blueprint)
      if (ret && ret !== true) {
        ret.card = context.blueprint_card || self;
        return ret;
      }
    }
  }
  if (name === "Brainstorm") {
    const other = G.jokers!.cards.length > 0 ? G.jokers!.cards[0] : undefined;
    if (other !== undefined && other !== self) {
      context.blueprint = context.blueprint ? context.blueprint + 1 : 1;
      context.blueprint_card = context.blueprint_card || self;
      if (context.blueprint > G.jokers!.cards.length + 1) return undefined;
      const ret = other.calculate_joker(context);
      if (ret && ret !== true) {
        ret.card = context.blueprint_card || self;
        return ret;
      }
    }
  }

  const cons = G.consumeables!;

  const cons_space = () => cons.cards.length + GAME.consumeable_buffer < cons.config.card_limit;

  const make_consumable = (typ: string, append: string) => {
    G.add_event(() => {
      const card = G.create_card(
        typ,
        G.consumeables,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        append,
      );
      card.add_to_deck();
      G.consumeables!.emplace(card);
      GAME.consumeable_buffer = 0;
    });
  };

  // ----------------------------------------------------------------- contexts
  if (context.open_booster) {
    if (name === "Hallucination" && cons_space()) {
      if (
        G.rng.random("halu" + lua_tostring(GAME.round_resets.ante)) <
        GAME.probabilities.normal / ab.extra
      ) {
        GAME.consumeable_buffer += 1;
        make_consumable("Tarot", "hal");
      }
    }
  } else if (context.buying_card) {
    // nothing
  } else if (context.selling_self) {
    if (name === "Luchador") {
      if (GAME.blind && !GAME.blind.disabled && GAME.blind.get_type() === "Boss") {
        GAME.blind.disable();
      }
    }
    if (name === "Diet Cola") {
      G.add_event(() => G.add_tag(new Tag(G, "tag_double")));
    }
    if (name === "Invisible Joker" && ab.invis_rounds >= ab.extra && !context.blueprint) {
      const jokers = G.jokers!.cards.filter((c) => c !== self);
      if (jokers.length > 0) {
        if (G.jokers!.cards.length <= G.jokers!.config.card_limit) {
          const chosen = G._random_card_from(jokers, "invisible");
          const card = G.copy_card(
            chosen,
            undefined,
            undefined,
            undefined,
            Boolean(chosen.edition && chosen.edition.negative),
          );
          if (card.ability.invis_rounds != null) card.ability.invis_rounds = 0;
          card.add_to_deck();
          G.jokers!.emplace(card);
        }
      }
    }
  } else if (context.selling_card) {
    if (name === "Campfire" && !context.blueprint) ab.x_mult = ab.x_mult + ab.extra;
    return undefined;
  } else if (context.reroll_shop) {
    if (name === "Flash Card" && !context.blueprint) ab.mult = ab.mult + ab.extra;
  } else if (context.ending_shop) {
    if (name === "Perkeo") {
      if (G.consumeables!.cards.length > 0) {
        G.add_event(() => {
          const card = G.copy_card(G._random_card_from(G.consumeables!.cards, "perkeo"), undefined);
          card.set_edition({ negative: true }, true);
          card.add_to_deck();
          G.consumeables!.emplace(card);
        });
      }
      return undefined;
    }
    return undefined;
  } else if (context.skip_blind) {
    return undefined;
  } else if (context.skipping_booster) {
    if (name === "Red Card" && !context.blueprint) ab.mult = ab.mult + ab.extra;
    return undefined;
  } else if (context.playing_card_added && !self.getting_sliced) {
    if (
      name === "Hologram" &&
      !context.blueprint &&
      context.cards != null &&
      context.cards.length > 0
    ) {
      ab.x_mult = ab.x_mult + context.cards.length * ab.extra;
    }
  } else if (context.first_hand_drawn) {
    if (name === "Certificate") {
      G.add_event(() => {
        const card = G.create_playing_card(
          { front: G.random_p_card("cert_fr"), center: G.P_CENTERS["c_base"] },
          G.hand,
        );
        const seal_type = G.rng.random(G.rng.pseudoseed("certsl"));
        if (seal_type > 0.75) card.set_seal("Red", true);
        else if (seal_type > 0.5) card.set_seal("Blue", true);
        else if (seal_type > 0.25) card.set_seal("Gold", true);
        else card.set_seal("Purple", true);
        GAME.blind.debuff_card(card);
        G.hand!.sort();
      });
      G.playing_card_joker_effects([true]);
    }
  } else if (context.setting_blind && !self.getting_sliced) {
    const src: Card = context.blueprint_card || self;
    if (name === "Chicot" && !context.blueprint && context.blind.boss && !self.getting_sliced) {
      G.add_event(() => {
        // Python queues the bound method GAME.blind.disable
        const blind = GAME.blind;
        G.add_event(() => blind.disable());
      });
    }
    if (name === "Madness" && !context.blueprint && !context.blind.boss) {
      ab.x_mult = ab.x_mult + ab.extra;
      const destructable = G.jokers!.cards.filter(
        (c) => c !== self && !c.ability.eternal && !c.getting_sliced,
      );
      const to_destroy =
        destructable.length > 0 ? G._random_card_from(destructable, "madness") : undefined;
      if (to_destroy !== undefined && !src.getting_sliced) {
        to_destroy.getting_sliced = true;
        G.add_event(() => to_destroy.start_dissolve());
      }
    }
    if (name === "Burglar" && !src.getting_sliced) {
      G.add_event(() => {
        G.ease_discard(-GAME.current_round.discards_left, undefined, true);
        G.ease_hands_played(ab.extra);
      });
    }
    if (
      name === "Riff-raff" &&
      !src.getting_sliced &&
      G.jokers!.cards.length + GAME.joker_buffer < G.jokers!.config.card_limit
    ) {
      const to_create = Math.min(
        2,
        G.jokers!.config.card_limit - (G.jokers!.cards.length + GAME.joker_buffer),
      );
      GAME.joker_buffer = GAME.joker_buffer + to_create;

      G.add_event(() => {
        for (let i = 0; i < to_create; i++) {
          const card = G.create_card(
            "Joker",
            G.jokers,
            undefined,
            0,
            undefined,
            undefined,
            undefined,
            "rif",
          );
          card.add_to_deck();
          G.jokers!.emplace(card);
          GAME.joker_buffer = 0;
        }
      });
    }
    if (name === "Cartomancer" && !src.getting_sliced && cons_space()) {
      GAME.consumeable_buffer += 1;

      G.add_event(() => {
        make_consumable("Tarot", "car");
      });
    }
    if (name === "Ceremonial Dagger" && !context.blueprint) {
      let my_pos: number | undefined;
      for (let i = 0; i < G.jokers!.cards.length; i++) {
        if (G.jokers!.cards[i] === self) {
          my_pos = i;
          break;
        }
      }
      if (
        my_pos !== undefined &&
        my_pos + 1 < G.jokers!.cards.length &&
        !self.getting_sliced &&
        !G.jokers!.cards[my_pos + 1].ability.eternal &&
        !G.jokers!.cards[my_pos + 1].getting_sliced
      ) {
        const sliced = G.jokers!.cards[my_pos + 1];
        sliced.getting_sliced = true;
        GAME.joker_buffer = GAME.joker_buffer - 1;

        G.add_event(() => {
          GAME.joker_buffer = 0;
          ab.mult = ab.mult + sliced.sell_cost * 2;
          sliced.start_dissolve();
        });
      }
    }
    if (name === "Marble Joker" && !src.getting_sliced) {
      G.add_event(() => {
        const front = G.random_p_card("marb_fr");
        G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
        const card = new Card(G, front, G.P_CENTERS["m_stone"], {
          playing_card: G.playing_card,
        });
        G.play!.emplace(card);
        G.playing_cards.push(card);
      });

      G.add_event(() => {
        G.deck!.config.card_limit += 1;
      });
      G.draw_card(G.play, G.deck!);
      G.playing_card_joker_effects([true]);
    }
    return undefined;
  } else if (context.destroying_card && !context.blueprint) {
    if (
      name === "Sixth Sense" &&
      context.full_hand.length === 1 &&
      context.full_hand[0].get_id() === 6 &&
      GAME.current_round.hands_played === 0
    ) {
      if (cons_space()) {
        GAME.consumeable_buffer += 1;
        make_consumable("Spectral", "sixth");
      }
      return true;
    }
    return undefined;
  } else if (context.cards_destroyed) {
    // never produced by the game
  } else if (context.remove_playing_cards) {
    if (name === "Caino" && !context.blueprint) {
      let face_cards = 0;
      for (const v of context.removed as Card[]) if (v.is_face()) face_cards += 1;
      if (face_cards > 0) ab.caino_xmult = ab.caino_xmult + face_cards * ab.extra;
      return undefined;
    }
    if (name === "Glass Joker" && !context.blueprint) {
      let glass_cards = 0;
      for (const v of context.removed as Card[]) if (v.shattered) glass_cards += 1;
      if (glass_cards > 0) {
        G.add_event(() => {
          G.add_event(() => {
            ab.x_mult = ab.x_mult + ab.extra * glass_cards;
          });
        });
      }
      return undefined;
    }
  } else if (context.using_consumeable) {
    if (
      name === "Glass Joker" &&
      !context.blueprint &&
      context.consumeable.ability.name === "The Hanged Man"
    ) {
      let shattered = 0;
      for (const v of G.hand!.highlighted) if (v.ability.name === "Glass Card") shattered += 1;
      if (shattered > 0) ab.x_mult = ab.x_mult + ab.extra * shattered;
      return undefined;
    }
    if (
      name === "Fortune Teller" &&
      !context.blueprint &&
      context.consumeable.ability.set === "Tarot"
    ) {
      // nothing
    }
    if (
      name === "Constellation" &&
      !context.blueprint &&
      context.consumeable.ability.set === "Planet"
    ) {
      ab.x_mult = ab.x_mult + ab.extra;
      return undefined;
    }
    return undefined;
  } else if (context.debuffed_hand) {
    if (name === "Matador") {
      if (GAME.blind.triggered) {
        G.ease_dollars(ab.extra);
        GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra;
        G.add_event(() => {
          GAME.dollar_buffer = 0;
        });
        return { dollars: ab.extra };
      }
    }
  } else if (context.pre_discard) {
    if (name === "Burnt Joker" && GAME.current_round.discards_used <= 0 && !context.hook) {
      const [text] = get_poker_hand_info(G, G.hand!.highlighted);
      G.level_up_hand(context.blueprint_card || self, text, undefined, 1);
    }
  } else if (context.discard) {
    if (name === "Ramen" && !context.blueprint) {
      if (ab.x_mult - ab.extra <= 1) {
        _remove_eaten(self);
        return { message: "Eaten!" };
      }
      ab.x_mult = ab.x_mult - ab.extra;
      return { message: "-x" };
    }
    if (name === "Yorick" && !context.blueprint) {
      if (ab.yorick_discards <= 1) {
        ab.yorick_discards = ab.extra.discards;
        ab.x_mult = ab.x_mult + ab.extra.xmult;
        return { message: "x" };
      }
      ab.yorick_discards = ab.yorick_discards - 1;
      return undefined;
    }
    if (
      name === "Trading Card" &&
      !context.blueprint &&
      GAME.current_round.discards_used <= 0 &&
      context.full_hand.length === 1
    ) {
      G.ease_dollars(ab.extra);
      return { remove: true, card: self };
    }
    if (
      name === "Castle" &&
      !context.other_card.debuff &&
      context.other_card.is_suit(GAME.current_round.castle_card.suit) &&
      !context.blueprint
    ) {
      ab.extra.chips = ab.extra.chips + ab.extra.chip_mod;
      return { message: "Upgrade!", card: self };
    }
    if (
      name === "Mail-In Rebate" &&
      !context.other_card.debuff &&
      context.other_card.get_id() === GAME.current_round.mail_card.id
    ) {
      G.ease_dollars(ab.extra);
      return { card: self };
    }
    if (
      name === "Hit the Road" &&
      !context.other_card.debuff &&
      context.other_card.get_id() === 11 &&
      !context.blueprint
    ) {
      ab.x_mult = ab.x_mult + ab.extra;
      return { card: self };
    }
    if (
      name === "Green Joker" &&
      !context.blueprint &&
      context.other_card === context.full_hand.at(-1)
    ) {
      const prev = ab.mult;
      ab.mult = Math.max(0, ab.mult - ab.extra.discard_sub);
      if (ab.mult !== prev) return { card: self };
    }
    if (name === "Faceless Joker" && context.other_card === context.full_hand.at(-1)) {
      let faces = 0;
      for (const v of context.full_hand as Card[]) if (v.is_face()) faces += 1;
      if (faces >= ab.extra.faces) {
        G.add_event(() => G.ease_dollars(ab.extra.dollars));
        return undefined;
      }
    }
    return undefined;
  } else if (context.end_of_round) {
    if (context.individual) {
      // nothing
    } else if (context.repetition) {
      if (context.cardarea === G.hand) {
        if (
          name === "Mime" &&
          (nonempty(context.card_effects[0]) || context.card_effects.length > 1)
        ) {
          return { repetitions: ab.extra, card: self };
        }
      }
    } else if (!context.blueprint) {
      if (name === "Campfire" && GAME.blind.boss && ab.x_mult > 1) {
        ab.x_mult = 1;
        return { message: "Reset" };
      }
      if (name === "Rocket" && GAME.blind.boss) {
        ab.extra.dollars = ab.extra.dollars + ab.extra.increase;
        return { message: "Upgrade!" };
      }
      if (name === "Turtle Bean" && !context.blueprint) {
        if (ab.extra.h_size - ab.extra.h_mod <= 0) {
          _remove_eaten(self);
          return { message: "Eaten!" };
        }
        ab.extra.h_size = ab.extra.h_size - ab.extra.h_mod;
        G.hand!.change_size(-ab.extra.h_mod);
        return { message: "-h" };
      }
      if (name === "Invisible Joker" && !context.blueprint) {
        ab.invis_rounds = ab.invis_rounds + 1;
        return { message: "invis" };
      }
      if (name === "Popcorn" && !context.blueprint) {
        if (ab.mult - ab.extra <= 0) {
          _remove_eaten(self);
          return { message: "Eaten!" };
        }
        ab.mult = ab.mult - ab.extra;
        return { message: "-mult" };
      }
      if (name === "To Do List" && !context.blueprint) {
        const hands = G.hands_order().filter(
          (k) => GAME.hands[k].visible && k !== ab.to_do_poker_hand,
        );
        ab.to_do_poker_hand = G.rng.element(hands, G.rng.pseudoseed("to_do"));
        return { message: "Reset" };
      }
      if (name === "Egg") {
        ab.extra_value = ab.extra_value + ab.extra;
        self.set_cost();
        return { message: "Value Up!" };
      }
      if (name === "Gift Card") {
        for (const v of G.jokers!.cards) {
          v.ability.extra_value = (v.ability.extra_value || 0) + ab.extra;
          v.set_cost();
        }
        for (const v of G.consumeables!.cards) {
          v.ability.extra_value = (v.ability.extra_value || 0) + ab.extra;
          v.set_cost();
        }
        return { message: "Value Up!" };
      }
      if (name === "Hit the Road" && ab.x_mult > 1) {
        ab.x_mult = 1;
        return { message: "Reset" };
      }
      if (name === "Gros Michel" || name === "Cavendish") {
        if (
          G.rng.random(name === "Cavendish" ? "cavendish" : "gros_michel") <
          GAME.probabilities.normal / ab.extra.odds
        ) {
          _remove_eaten(self);
          if (name === "Gros Michel") GAME.pool_flags.gros_michel_extinct = true;
          return { message: "Extinct!" };
        }
        return { message: "Safe!" };
      }
      if (name === "Mr. Bones" && context.game_over && GAME.chips / GAME.blind.chips >= 0.25) {
        G.add_event(() => self.start_dissolve());
        return { message: "Saved", saved: true };
      }
    }
  } else if (context.individual) {
    const oc: Card = context.other_card;
    if (context.cardarea === G.play) {
      if (name === "Hiker") {
        oc.ability.perma_bonus = oc.ability.perma_bonus || 0;
        oc.ability.perma_bonus = oc.ability.perma_bonus + ab.extra;
        return { extra: { message: "Upgrade!" }, card: self };
      }
      if (name === "Lucky Cat" && oc.lucky_trigger && !context.blueprint) {
        ab.x_mult = ab.x_mult + ab.extra;
        return { extra: { focus: self, message: "Upgrade!" }, card: self };
      }
      if (name === "Wee Joker" && oc.get_id() === 2 && !context.blueprint) {
        ab.extra.chips = ab.extra.chips + ab.extra.chip_mod;
        return { extra: { focus: self, message: "Upgrade!" }, card: self };
      }
      if (name === "Photograph") {
        let first_face: Card | undefined;
        for (const c of context.scoring_hand as Card[]) {
          if (c.is_face()) {
            first_face = c;
            break;
          }
        }
        if (oc === first_face) return { x_mult: ab.extra, card: self };
      }
      if (name === "8 Ball" && cons_space()) {
        if (oc.get_id() === 8 && G.rng.random("8ball") < GAME.probabilities.normal / ab.extra) {
          GAME.consumeable_buffer += 1;

          const func = () => {
            make_consumable("Tarot", "8ba");
          };
          return { extra: { focus: self, message: "+1 Tarot", func }, card: self };
        }
      }
      if (
        name === "The Idol" &&
        oc.get_id() === GAME.current_round.idol_card.id &&
        oc.is_suit(GAME.current_round.idol_card.suit)
      ) {
        return { x_mult: ab.extra, card: self };
      }
      if (name === "Scary Face" && oc.is_face()) return { chips: ab.extra, card: self };
      if (name === "Smiley Face" && oc.is_face()) return { mult: ab.extra, card: self };
      if (name === "Golden Ticket" && oc.ability.name === "Gold Card") {
        GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra;
        G.add_event(() => {
          GAME.dollar_buffer = 0;
        });
        return { dollars: ab.extra, card: self };
      }
      if (name === "Scholar" && oc.get_id() === 14) {
        return { chips: ab.extra.chips, mult: ab.extra.mult, card: self };
      }
      if (name === "Walkie Talkie" && (oc.get_id() === 10 || oc.get_id() === 4)) {
        return { chips: ab.extra.chips, mult: ab.extra.mult, card: self };
      }
      if (
        name === "Business Card" &&
        oc.is_face() &&
        G.rng.random("business") < GAME.probabilities.normal / ab.extra
      ) {
        GAME.dollar_buffer = (GAME.dollar_buffer || 0) + 2;
        G.add_event(() => {
          GAME.dollar_buffer = 0;
        });
        return { dollars: 2, card: self };
      }
      if (name === "Fibonacci" && [2, 3, 5, 8, 14].includes(oc.get_id())) {
        return { mult: ab.extra, card: self };
      }
      if (name === "Even Steven") {
        const cid = oc.get_id();
        if (cid >= 0 && cid <= 10 && cid % 2 === 0) return { mult: ab.extra, card: self };
      }
      if (name === "Odd Todd") {
        const cid = oc.get_id();
        if ((cid >= 0 && cid <= 10 && cid % 2 === 1) || cid === 14) {
          return { chips: ab.extra, card: self };
        }
      }
      if (ab.effect === "Suit Mult" && oc.is_suit(ab.extra.suit)) {
        return { mult: ab.extra.s_mult, card: self };
      }
      if (name === "Rough Gem" && oc.is_suit("Diamonds")) {
        GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra;
        G.add_event(() => {
          GAME.dollar_buffer = 0;
        });
        return { dollars: ab.extra, card: self };
      }
      if (name === "Onyx Agate" && oc.is_suit("Clubs")) return { mult: ab.extra, card: self };
      if (name === "Arrowhead" && oc.is_suit("Spades")) return { chips: ab.extra, card: self };
      if (
        name === "Bloodstone" &&
        oc.is_suit("Hearts") &&
        G.rng.random("bloodstone") < GAME.probabilities.normal / ab.extra.odds
      ) {
        return { x_mult: ab.extra.Xmult, card: self };
      }
      if (name === "Ancient Joker" && oc.is_suit(GAME.current_round.ancient_card.suit)) {
        return { x_mult: ab.extra, card: self };
      }
      if (name === "Triboulet" && (oc.get_id() === 12 || oc.get_id() === 13)) {
        return { x_mult: ab.extra, card: self };
      }
    }
    if (context.cardarea === G.hand) {
      if (name === "Shoot the Moon" && oc.get_id() === 12) {
        if (oc.debuff) return { message: "Debuffed", card: self };
        return { h_mult: 13, card: self };
      }
      if (name === "Baron" && oc.get_id() === 13) {
        if (oc.debuff) return { message: "Debuffed", card: self };
        return { x_mult: ab.extra, card: self };
      }
      if (
        name === "Reserved Parking" &&
        oc.is_face() &&
        G.rng.random("parking") < GAME.probabilities.normal / ab.extra.odds
      ) {
        if (oc.debuff) return { message: "Debuffed", card: self };
        GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra.dollars;
        G.add_event(() => {
          GAME.dollar_buffer = 0;
        });
        return { dollars: ab.extra.dollars, card: self };
      }
      if (name === "Raised Fist") {
        let temp_mult = 15;
        let temp_id = 15;
        let raised: Card | undefined;
        for (const c of G.hand!.cards) {
          if (temp_id >= c.base.id && c.ability.effect !== "Stone Card") {
            temp_mult = c.base.nominal;
            temp_id = c.base.id;
            raised = c;
          }
        }
        if (raised === oc) {
          if (oc.debuff) return { message: "Debuffed", card: self };
          return { h_mult: 2 * temp_mult, card: self };
        }
      }
    }
  } else if (context.repetition) {
    const oc: Card = context.other_card;
    if (context.cardarea === G.play) {
      if (name === "Sock and Buskin" && oc.is_face()) {
        return { repetitions: ab.extra, card: self };
      }
      if (
        name === "Hanging Chad" &&
        context.scoring_hand &&
        context.scoring_hand.length > 0 &&
        oc === context.scoring_hand[0]
      ) {
        return { repetitions: ab.extra, card: self };
      }
      if (name === "Dusk" && GAME.current_round.hands_left === 0) {
        return { repetitions: ab.extra, card: self };
      }
      if (name === "Seltzer") return { repetitions: 1, card: self };
      if (name === "Hack" && [2, 3, 4, 5].includes(oc.get_id())) {
        return { repetitions: ab.extra, card: self };
      }
    }
    if (context.cardarea === G.hand) {
      if (
        name === "Mime" &&
        (nonempty(context.card_effects[0]) || context.card_effects.length > 1)
      ) {
        return { repetitions: ab.extra, card: self };
      }
    }
  } else if (context.other_joker) {
    if (
      name === "Baseball Card" &&
      context.other_joker.config.center.rarity === 2 &&
      self !== context.other_joker
    ) {
      return { Xmult_mod: ab.extra };
    }
  } else {
    if (context.cardarea === G.jokers) {
      if (context.before) return _before(self, context);
      else if (context.after) return _after(self, context);
      else return _joker_main(self, context);
    }
  }
  return undefined;
}

export function _before(self: Card, context: T) {
  const G = self.G;
  const GAME = G.GAME;
  const ab = self.ability;
  const name = ab.name;
  const ph = context.poker_hands;
  if (
    name === "Spare Trousers" &&
    (ph["Two Pair"].length > 0 || ph["Full House"].length > 0) &&
    !context.blueprint
  ) {
    ab.mult = ab.mult + ab.extra;
    return { card: self, message: "Upgrade!" };
  }
  if (name === "Space Joker" && G.rng.random("space") < GAME.probabilities.normal / ab.extra) {
    return { card: self, level_up: true, message: "Level Up!" };
  }
  if (name === "Square Joker" && context.full_hand.length === 4 && !context.blueprint) {
    ab.extra.chips = ab.extra.chips + ab.extra.chip_mod;
    return { card: self, message: "Upgrade!" };
  }
  if (name === "Runner" && ph["Straight"].length > 0 && !context.blueprint) {
    ab.extra.chips = ab.extra.chips + ab.extra.chip_mod;
    return { card: self, message: "Upgrade!" };
  }
  if (name === "Midas Mask" && !context.blueprint) {
    const faces: Card[] = [];
    for (const v of context.scoring_hand as Card[]) {
      if (v.is_face()) {
        faces.push(v);
        v.set_ability(G.P_CENTERS["m_gold"], undefined, true);
      }
    }
    if (faces.length > 0) return { card: self, message: "Gold" };
  }
  if (name === "Vampire" && !context.blueprint) {
    const enhanced: Card[] = [];
    for (const v of context.scoring_hand as Card[]) {
      if (v.config.center !== G.P_CENTERS["c_base"] && !v.debuff && !v.vampired) {
        enhanced.push(v);
        v.vampired = true;
        v.set_ability(G.P_CENTERS["c_base"], undefined, true);

        G.add_event(() => {
          v.vampired = undefined;
        });
      }
    }
    if (enhanced.length > 0) {
      ab.x_mult = ab.x_mult + ab.extra * enhanced.length;
      return { card: self, message: "x" };
    }
  }
  if (name === "To Do List" && context.scoring_name === ab.to_do_poker_hand) {
    G.ease_dollars(ab.extra.dollars);
    GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra.dollars;
    G.add_event(() => {
      GAME.dollar_buffer = 0;
    });
    return { dollars: ab.extra.dollars };
  }
  if (name === "DNA" && GAME.current_round.hands_played === 0) {
    if (context.full_hand.length === 1) {
      G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
      const card = G.copy_card(context.full_hand[0], undefined, undefined, G.playing_card);
      card.add_to_deck();
      G.deck!.config.card_limit += 1;
      G.playing_cards.push(card);
      G.hand!.emplace(card);
      // evaluate_play's card_eval_status_text() runs
      // playing_card_joker_effects(playing_cards_created) synchronously
      return { card: self, message: "Copied!", playing_cards_created: [true] };
    }
  }
  if (name === "Ride the Bus" && !context.blueprint) {
    const faces = (context.scoring_hand as Card[]).some((c) => c.is_face());
    if (faces) {
      const last = ab.mult;
      ab.mult = 0;
      if (last > 0) return { card: self, message: "Reset" };
    } else {
      ab.mult = ab.mult + ab.extra;
    }
  }
  if (name === "Obelisk" && !context.blueprint) {
    let reset = true;
    const play_more_than = GAME.hands[context.scoring_name].played || 0;
    for (const k of G.hands_order()) {
      const v = GAME.hands[k];
      if (k !== context.scoring_name && v.played >= play_more_than && v.visible) reset = false;
    }
    if (reset) {
      if (ab.x_mult > 1) {
        ab.x_mult = 1;
        return { card: self, message: "Reset" };
      }
    } else {
      ab.x_mult = ab.x_mult + ab.extra;
    }
  }
  if (name === "Green Joker" && !context.blueprint) {
    ab.mult = ab.mult + ab.extra.hand_add;
    return { card: self, message: "+mult" };
  }
  return undefined;
}

export function _after(self: Card, context: T) {
  const ab = self.ability;
  const name = ab.name;
  if (name === "Ice Cream" && !context.blueprint) {
    if (ab.extra.chips - ab.extra.chip_mod <= 0) {
      _remove_eaten(self);
      return { message: "Melted!" };
    }
    ab.extra.chips = ab.extra.chips - ab.extra.chip_mod;
    return { message: "-chips" };
  }
  if (name === "Seltzer" && !context.blueprint) {
    if (ab.extra - 1 <= 0) {
      _remove_eaten(self);
      return { message: "Drank!" };
    }
    ab.extra = ab.extra - 1;
    return { message: String(ab.extra) };
  }
  return undefined;
}

export function _joker_main(self: Card, context: T) {
  const G = self.G;
  const GAME = G.GAME;
  const ab = self.ability;
  const name = ab.name;
  const ph = context.poker_hands;
  const cons = G.consumeables!;

  if (name === "Loyalty Card") {
    ab.loyalty_remaining = lua_mod(
      ab.extra.every - 1 - (GAME.hands_played - ab.hands_played_at_create),
      ab.extra.every + 1,
    );
    if (context.blueprint) {
      if (ab.loyalty_remaining === ab.extra.every) return { Xmult_mod: ab.extra.Xmult };
    } else {
      if (ab.loyalty_remaining === 0) {
        // nothing
      } else if (ab.loyalty_remaining === ab.extra.every) {
        return { Xmult_mod: ab.extra.Xmult };
      }
    }
  }
  if (name !== "Seeing Double" && ab.x_mult > 1 && (ab.type === "" || ph[ab.type].length > 0)) {
    return { Xmult_mod: ab.x_mult };
  }
  if (ab.t_mult > 0 && ph[ab.type].length > 0) return { mult_mod: ab.t_mult };
  if (ab.t_chips > 0 && ph[ab.type].length > 0) return { chip_mod: ab.t_chips };
  if (name === "Half Joker" && context.full_hand.length <= ab.extra.size) {
    return { mult_mod: ab.extra.mult };
  }
  if (name === "Abstract Joker") {
    let x = 0;
    for (const c of G.jokers!.cards) if (c.ability.set === "Joker") x += 1;
    return { mult_mod: x * ab.extra };
  }
  if (name === "Acrobat" && GAME.current_round.hands_left === 0) return { Xmult_mod: ab.extra };
  if (name === "Mystic Summit" && GAME.current_round.discards_left === ab.extra.d_remaining) {
    return { mult_mod: ab.extra.mult };
  }
  if (name === "Misprint") {
    const temp_mult = G.rng.randint("misprint", ab.extra.min, ab.extra.max);
    return { mult_mod: temp_mult };
  }
  if (name === "Banner" && GAME.current_round.discards_left > 0) {
    return { chip_mod: GAME.current_round.discards_left * ab.extra };
  }
  if (name === "Stuntman") return { chip_mod: ab.extra.chip_mod };
  if (name === "Matador") {
    if (GAME.blind.triggered) {
      G.ease_dollars(ab.extra);
      GAME.dollar_buffer = (GAME.dollar_buffer || 0) + ab.extra;
      G.add_event(() => {
        GAME.dollar_buffer = 0;
      });
      return { dollars: ab.extra };
    }
  }
  if (name === "Supernova") return { mult_mod: GAME.hands[context.scoring_name].played };
  if (name === "Ceremonial Dagger" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Vagabond" && cons.cards.length + GAME.consumeable_buffer < cons.config.card_limit) {
    if (GAME.dollars <= ab.extra) {
      GAME.consumeable_buffer += 1;

      G.add_event(() => {
        const card = G.create_card(
          "Tarot",
          G.consumeables,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "vag",
        );
        card.add_to_deck();
        G.consumeables!.emplace(card);
        GAME.consumeable_buffer = 0;
      });
      return { message: "+1 Tarot", card: self };
    }
  }
  if (
    name === "Superposition" &&
    cons.cards.length + GAME.consumeable_buffer < cons.config.card_limit
  ) {
    let aces = 0;
    for (const c of context.scoring_hand as Card[]) if (c.get_id() === 14) aces += 1;
    if (aces >= 1 && ph["Straight"].length > 0) {
      GAME.consumeable_buffer += 1;

      G.add_event(() => {
        const card = G.create_card(
          "Tarot",
          G.consumeables,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "sup",
        );
        card.add_to_deck();
        G.consumeables!.emplace(card);
        GAME.consumeable_buffer = 0;
      });
      return { message: "+1 Tarot", card: self };
    }
  }
  if (name === "Seance" && cons.cards.length + GAME.consumeable_buffer < cons.config.card_limit) {
    if (ph[ab.extra.poker_hand].length > 0) {
      GAME.consumeable_buffer += 1;

      G.add_event(() => {
        const card = G.create_card(
          "Spectral",
          G.consumeables,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          "sea",
        );
        card.add_to_deck();
        G.consumeables!.emplace(card);
        GAME.consumeable_buffer = 0;
      });
      return { message: "+1 Spectral", card: self };
    }
  }
  if (name === "Flower Pot") {
    const suits = { Hearts: 0, Diamonds: 0, Spades: 0, Clubs: 0 };
    for (const c of context.scoring_hand as Card[]) {
      if (c.ability.name !== "Wild Card") {
        if (c.is_suit("Hearts", true) && suits.Hearts === 0) suits.Hearts += 1;
        else if (c.is_suit("Diamonds", true) && suits.Diamonds === 0) suits.Diamonds += 1;
        else if (c.is_suit("Spades", true) && suits.Spades === 0) suits.Spades += 1;
        else if (c.is_suit("Clubs", true) && suits.Clubs === 0) suits.Clubs += 1;
      }
    }
    for (const c of context.scoring_hand as Card[]) {
      if (c.ability.name === "Wild Card") {
        if (c.is_suit("Hearts") && suits.Hearts === 0) suits.Hearts += 1;
        else if (c.is_suit("Diamonds") && suits.Diamonds === 0) suits.Diamonds += 1;
        else if (c.is_suit("Spades") && suits.Spades === 0) suits.Spades += 1;
        else if (c.is_suit("Clubs") && suits.Clubs === 0) suits.Clubs += 1;
      }
    }
    if (suits.Hearts > 0 && suits.Diamonds > 0 && suits.Spades > 0 && suits.Clubs > 0) {
      return { Xmult_mod: ab.extra };
    }
  }
  if (name === "Seeing Double") {
    const suits = { Hearts: 0, Diamonds: 0, Spades: 0, Clubs: 0 };
    for (const c of context.scoring_hand as Card[]) {
      if (c.ability.name !== "Wild Card") {
        if (c.is_suit("Hearts")) suits.Hearts += 1;
        if (c.is_suit("Diamonds")) suits.Diamonds += 1;
        if (c.is_suit("Spades")) suits.Spades += 1;
        if (c.is_suit("Clubs")) suits.Clubs += 1;
      }
    }
    for (const c of context.scoring_hand as Card[]) {
      if (c.ability.name === "Wild Card") {
        if (c.is_suit("Clubs") && suits.Clubs === 0) suits.Clubs += 1;
        else if (c.is_suit("Diamonds") && suits.Diamonds === 0) suits.Diamonds += 1;
        else if (c.is_suit("Spades") && suits.Spades === 0) suits.Spades += 1;
        else if (c.is_suit("Hearts") && suits.Hearts === 0) suits.Hearts += 1;
      }
    }
    if ((suits.Hearts > 0 || suits.Diamonds > 0 || suits.Spades > 0) && suits.Clubs > 0) {
      return { Xmult_mod: ab.extra };
    }
  }
  if (name === "Wee Joker") return { chip_mod: ab.extra.chips };
  if (name === "Castle" && ab.extra.chips > 0) return { chip_mod: ab.extra.chips };
  if (name === "Blue Joker" && G.deck!.cards.length > 0) {
    return { chip_mod: ab.extra * G.deck!.cards.length };
  }
  if (name === "Erosion" && GAME.starting_deck_size - G.playing_cards.length > 0) {
    return { mult_mod: ab.extra * (GAME.starting_deck_size - G.playing_cards.length) };
  }
  if (name === "Square Joker") return { chip_mod: ab.extra.chips };
  if (name === "Runner") return { chip_mod: ab.extra.chips };
  if (name === "Ice Cream") return { chip_mod: ab.extra.chips };
  if (name === "Stone Joker" && ab.stone_tally > 0) {
    return { chip_mod: ab.extra * ab.stone_tally };
  }
  if (name === "Steel Joker" && ab.steel_tally > 0) {
    return { Xmult_mod: 1 + ab.extra * ab.steel_tally };
  }
  if (name === "Bull" && GAME.dollars + (GAME.dollar_buffer || 0) > 0) {
    return { chip_mod: ab.extra * Math.max(0, GAME.dollars + (GAME.dollar_buffer || 0)) };
  }
  if (name === "Driver's License") {
    if ((ab.driver_tally || 0) >= 16) return { Xmult_mod: ab.extra };
  }
  if (name === "Blackboard") {
    let black = 0;
    let all_cards = 0;
    for (const c of G.hand!.cards) {
      all_cards += 1;
      if (c.is_suit("Clubs", undefined, true) || c.is_suit("Spades", undefined, true)) black += 1;
    }
    if (black === all_cards) return { Xmult_mod: ab.extra };
  }
  if (name === "Joker Stencil") {
    if (G.jokers!.config.card_limit - G.jokers!.cards.length > 0) return { Xmult_mod: ab.x_mult };
  }
  if (name === "Swashbuckler" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Joker") return { mult_mod: ab.mult };
  if (name === "Spare Trousers" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Ride the Bus" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Flash Card" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Popcorn" && ab.mult > 0) return { mult_mod: ab.mult };
  if (name === "Green Joker" && ab.mult > 0) return { mult_mod: ab.mult };
  if (
    name === "Fortune Teller" &&
    GAME.consumeable_usage_total &&
    GAME.consumeable_usage_total.tarot > 0
  ) {
    return { mult_mod: GAME.consumeable_usage_total.tarot };
  }
  if (name === "Gros Michel") return { mult_mod: ab.extra.mult };
  if (name === "Cavendish") return { Xmult_mod: ab.extra.Xmult };
  if (name === "Red Card" && ab.mult > 0) return { mult_mod: ab.mult };
  if (
    name === "Card Sharp" &&
    GAME.hands[context.scoring_name] &&
    GAME.hands[context.scoring_name].played_this_round > 1
  ) {
    return { Xmult_mod: ab.extra.Xmult };
  }
  if (
    name === "Bootstraps" &&
    Math.floor((GAME.dollars + (GAME.dollar_buffer || 0)) / ab.extra.dollars) >= 1
  ) {
    return {
      mult_mod:
        ab.extra.mult * Math.floor((GAME.dollars + (GAME.dollar_buffer || 0)) / ab.extra.dollars),
    };
  }
  if (name === "Caino" && ab.caino_xmult > 1) return { Xmult_mod: ab.caino_xmult };
  return undefined;
}
