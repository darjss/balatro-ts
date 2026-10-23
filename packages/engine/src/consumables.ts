// Card:use_consumeable() and Card:can_use_consumeable() from card.lua.
// Ported from ArnoStar/BalatroEngine (balatro/consumables.py).

import type { Card } from "./card.ts";
import { STATES, type Game } from "./game.ts";
import type { T } from "./lua.ts";
import { sorted_by_sort_id } from "./rng.ts";

export const RANK_UP = new Map<number, string>([
  [2, "3"],
  [3, "4"],
  [4, "5"],
  [5, "6"],
  [6, "7"],
  [7, "8"],
  [8, "9"],
  [9, "T"],
  [10, "J"],
  [11, "Q"],
  [12, "K"],
  [13, "A"],
  [14, "2"],
]);
export const ID_TO_CHAR = new Map<number, string>([
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

export function set_consumeable_usage(G: Game, card: Card) {
  if (card.config.center_key && card.ability.consumeable) {
    const key: string = card.config.center_key;
    const cu = G.GAME.consumeable_usage;
    if (cu[key]) {
      cu[key].count += 1;
    } else {
      cu[key] = { count: 1, order: card.config.center.order, set: card.ability.set };
    }
    const tot: T = G.GAME.consumeable_usage_total ?? {
      tarot: 0,
      planet: 0,
      spectral: 0,
      tarot_planet: 0,
      all: 0,
    };
    G.GAME.consumeable_usage_total = tot;
    const s = card.config.center.set;
    if (s === "Tarot") {
      tot.tarot += 1;
      tot.tarot_planet += 1;
    } else if (s === "Planet") {
      tot.planet += 1;
      tot.tarot_planet += 1;
    } else if (s === "Spectral") {
      tot.spectral += 1;
    }
    tot.all += 1;
    if (s === "Tarot" || s === "Planet") {
      G.add_event(() => {
        G.add_event(() => {
          G.GAME.last_tarot_planet = key;
        });
      });
    }
  }
}

export function use_consumeable(self: Card, area: unknown, copier?: Card) {
  const G = self.G;
  const GAME = G.GAME;
  if (!copier) set_consumeable_usage(G, self);
  if (self.debuff) return;
  const used_tarot = copier ?? self;
  const ab = self.ability;
  const cons = ab.consumeable;
  const name = ab.name;
  const hand = G.hand!;
  const hl = hand.highlighted;

  if (cons.mod_conv || cons.suit_conv) {
    if (name === "Death") {
      let rightmost = hl[0];
      for (const c of hl) if (hand.index(c) > hand.index(rightmost)) rightmost = c;
      for (let i = 0; i < hl.length; i++) {
        G.add_event(() => {
          if (G.hand!.highlighted[i] !== rightmost) G.copy_card(rightmost, G.hand!.highlighted[i]);
        });
      }
    } else if (name === "Strength") {
      for (let i = 0; i < hl.length; i++) {
        G.add_event(() => {
          const card = G.hand!.highlighted[i];
          const suit_prefix = card.base.suit[0] + "_";
          card.set_base(G.P_CARDS[suit_prefix + RANK_UP.get(card.base.id)]);
        });
      }
    } else if (cons.suit_conv) {
      for (let i = 0; i < hl.length; i++) {
        G.add_event(() => G.hand!.highlighted[i].change_suit(cons.suit_conv));
      }
    } else {
      for (let i = 0; i < hl.length; i++) {
        G.add_event(() => G.hand!.highlighted[i].set_ability(G.P_CENTERS[cons.mod_conv]));
      }
    }
    // Python queues the bound method G.hand.unhighlight_all
    G.add_event(() => hand.unhighlight_all());
  }

  if (name === "Black Hole") {
    for (const k of G.hands_order()) G.level_up_hand(self, k, true);
  }

  if (name === "Talisman" || name === "Deja Vu" || name === "Trance" || name === "Medium") {
    const conv_card = hl[0];
    G.add_event(() => conv_card.set_seal(ab.extra, undefined, true));
    G.add_event(() => hand.unhighlight_all());
  }

  if (name === "Aura") {
    G.add_event(() => {
      const edition = G.poll_edition("aura", undefined, true, true);
      G.hand!.highlighted[0].set_edition(edition, true);
    });
  }

  if (name === "Cryptid") {
    G.add_event(() => {
      const new_cards: Card[] = [];
      for (let i = 0; i < ab.extra; i++) {
        G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
        const c = G.copy_card(G.hand!.highlighted[0], undefined, undefined, G.playing_card);
        c.add_to_deck();
        G.deck!.config.card_limit += 1;
        G.playing_cards.push(c);
        G.hand!.emplace(c);
        new_cards.push(c);
      }
      G.playing_card_joker_effects(new_cards);
    });
  }

  if (name === "Sigil" || name === "Ouija") {
    if (name === "Sigil") {
      const suit = G.rng.element(["S", "H", "D", "C"], G.rng.pseudoseed("sigil"));
      for (let i = 0; i < hand.cards.length; i++) {
        G.add_event(() => {
          const card = G.hand!.cards[i];
          card.set_base(G.P_CARDS[suit + "_" + ID_TO_CHAR.get(card.base.id)]);
        });
      }
    }
    if (name === "Ouija") {
      const rank = G.rng.element(
        ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"],
        G.rng.pseudoseed("ouija"),
      );
      for (let i = 0; i < hand.cards.length; i++) {
        G.add_event(() => {
          const card = G.hand!.cards[i];
          card.set_base(G.P_CARDS[card.base.suit[0] + "_" + rank]);
        });
      }
      hand.change_size(-1);
    }
  }

  if (cons.hand_type) G.level_up_hand(used_tarot, cons.hand_type);

  if (cons.remove_card) {
    const destroyed_cards: Card[] = [];
    if (name === "The Hanged Man") {
      for (let i = hl.length - 1; i >= 0; i--) destroyed_cards.push(hl[i]);

      G.add_event(() => {
        for (let i = G.hand!.highlighted.length - 1; i >= 0; i--) {
          const card = G.hand!.highlighted[i];
          if (card.ability.name === "Glass Card") card.shatter();
          else card.start_dissolve();
        }
      });
    } else if (name === "Familiar" || name === "Grim" || name === "Incantation") {
      destroyed_cards.push(G._random_card_from(hand.cards, "random_destroy"));

      G.add_event(() => {
        for (const card of destroyed_cards.toReversed()) {
          if (card.ability.name === "Glass Card") card.shatter();
          else card.start_dissolve();
        }
      });

      G.add_event(() => {
        const cards: boolean[] = [];
        for (let i = 0; i < ab.extra; i++) {
          cards.push(true);
          let suit: string | undefined;
          let rank: string | undefined;
          if (name === "Familiar") {
            rank = G.rng.element(["J", "Q", "K"], G.rng.pseudoseed("familiar_create"));
            suit = G.rng.element(["S", "H", "D", "C"], G.rng.pseudoseed("familiar_create"));
          } else if (name === "Grim") {
            rank = "A";
            suit = G.rng.element(["S", "H", "D", "C"], G.rng.pseudoseed("grim_create"));
          } else if (name === "Incantation") {
            rank = G.rng.element(
              ["2", "3", "4", "5", "6", "7", "8", "9", "T"],
              G.rng.pseudoseed("incantation_create"),
            );
            suit = G.rng.element(["S", "H", "D", "C"], G.rng.pseudoseed("incantation_create"));
          }
          suit = suit ?? "S";
          rank = rank ?? "A";
          const cen_pool = G.P_CENTER_POOLS["Enhanced"].filter((v) => v.key !== "m_stone");
          const center = G.rng.element(cen_pool, G.rng.pseudoseed("spe_card"));
          G.create_playing_card({ front: G.P_CARDS[suit + "_" + rank], center }, G.hand);
        }
        G.playing_card_joker_effects(cards);
      });
    } else if (name === "Immolate") {
      const temp_hand = sorted_by_sort_id(hand.cards);
      G.rng.shuffle(temp_hand, G.rng.pseudoseed("immolate"));
      for (let i = 0; i < Math.min(ab.extra.destroy, temp_hand.length); i++) {
        destroyed_cards.push(temp_hand[i]);
      }

      G.add_event(() => {
        for (const card of destroyed_cards.toReversed()) {
          if (card.ability.name === "Glass Card") card.shatter();
          else card.start_dissolve();
        }
      });
      G.ease_dollars(ab.extra.dollars);
    }
    for (const j of G.jokers!.cards.slice()) {
      j.calculate_joker({ remove_playing_cards: true, removed: destroyed_cards });
    }
  }

  if (name === "The Fool") {
    G.add_event(() => {
      if (G.consumeables!.config.card_limit > G.consumeables!.cards.length) {
        const card = G.create_card(
          "Tarot_Planet",
          G.consumeables,
          undefined,
          undefined,
          undefined,
          undefined,
          GAME.last_tarot_planet,
          "fool",
        );
        card.add_to_deck();
        G.consumeables!.emplace(card);
      }
    });
  }
  if (name === "The Hermit") {
    G.add_event(() => G.ease_dollars(Math.max(0, Math.min(GAME.dollars, ab.extra)), true));
  }
  if (name === "Temperance") {
    G.add_event(() => G.ease_dollars(ab.money, true));
  }
  if (name === "The Emperor" || name === "The High Priestess") {
    const n = Math.min(
      cons.tarots || cons.planets,
      G.consumeables!.config.card_limit - G.consumeables!.cards.length,
    );
    for (let i = 0; i < n; i++) {
      G.add_event(() => {
        if (G.consumeables!.config.card_limit > G.consumeables!.cards.length) {
          const card = G.create_card(
            name === "The Emperor" ? "Tarot" : "Planet",
            G.consumeables,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            name === "The Emperor" ? "emp" : "pri",
          );
          card.add_to_deck();
          G.consumeables!.emplace(card);
        }
      });
    }
  }
  if (name === "Judgement" || name === "The Soul") {
    G.add_event(() => {
      const card = G.create_card(
        "Joker",
        G.jokers,
        name === "The Soul",
        undefined,
        undefined,
        undefined,
        undefined,
        name === "Judgement" ? "jud" : "sou",
      );
      card.add_to_deck();
      G.jokers!.emplace(card);
    });
  }
  if (name === "Ankh") {
    const deletable = G.jokers!.cards.filter((v) => !v.ability.eternal);
    const chosen = G._random_card_from(G.jokers!.cards, "ankh_choice");

    G.add_event(() => {
      for (const v of deletable) if (v !== chosen) v.start_dissolve();
    });

    G.add_event(() => {
      const card = G.copy_card(
        chosen,
        undefined,
        undefined,
        undefined,
        Boolean(chosen.edition && chosen.edition.negative),
      );
      card.add_to_deck();
      if (card.edition && card.edition.negative) card.set_edition(undefined, true);
      G.jokers!.emplace(card);
    });
  }
  if (name === "Wraith") {
    G.add_event(() => {
      const card = G.create_card(
        "Joker",
        G.jokers,
        undefined,
        0.99,
        undefined,
        undefined,
        undefined,
        "wra",
      );
      card.add_to_deck();
      G.jokers!.emplace(card);
      if (GAME.dollars !== 0) G.ease_dollars(-GAME.dollars, true);
    });
  }
  if (name === "The Wheel of Fortune" || name === "Ectoplasm" || name === "Hex") {
    const temp_pool =
      name === "The Wheel of Fortune"
        ? [...self.eligible_strength_jokers]
        : [...self.eligible_editionless_jokers];
    if (
      name === "Ectoplasm" ||
      name === "Hex" ||
      G.rng.random("wheel_of_fortune") < GAME.probabilities.normal / ab.extra
    ) {
      const seed_key =
        name === "The Wheel of Fortune"
          ? "wheel_of_fortune"
          : name === "Ectoplasm"
            ? "ectoplasm"
            : "hex";

      G.add_event(() => {
        const eligible = G._random_card_from(temp_pool, seed_key);
        let edition: T | undefined;
        if (name === "Ectoplasm") edition = { negative: true };
        else if (name === "Hex") edition = { polychrome: true };
        else edition = G.poll_edition("wheel_of_fortune", undefined, true, true);
        eligible.set_edition(edition, true);
        if (name === "Hex") {
          for (const v of G.jokers!.cards.slice()) {
            if (v !== eligible && !v.ability.eternal) v.start_dissolve();
          }
        }
        if (name === "Ectoplasm") {
          GAME.ecto_minus = GAME.ecto_minus || 1;
          G.hand!.change_size(-GAME.ecto_minus);
          GAME.ecto_minus += 1;
        }
      });
    }
  }
}

export function can_use_consumeable(self: Card, any_state = false, skip_check = false) {
  const G = self.G;
  const S = STATES;
  if (
    !skip_check &&
    ((G.play != null && G.play.cards.length > 0) || (G.GAME.STOP_USE && G.GAME.STOP_USE > 0))
  ) {
    return false;
  }
  if (
    (G.STATE !== S.HAND_PLAYED && G.STATE !== S.DRAW_TO_HAND && G.STATE !== S.PLAY_TAROT) ||
    any_state
  ) {
    const name = self.ability.name;
    const cons = self.ability.consumeable;
    if (name === "The Hermit" || name === "Temperance" || name === "Black Hole" || cons.hand_type) {
      return true;
    }
    if (name === "The Wheel of Fortune") {
      if (self.eligible_strength_jokers.length > 0) return true;
    }
    if (name === "Ankh") {
      for (const v of G.jokers!.cards) {
        if (v.ability.set === "Joker" && G.jokers!.config.card_limit > 1) return true;
      }
    }
    if (name === "Aura") {
      if (G.hand != null && G.hand.highlighted.length === 1 && !G.hand.highlighted[0].edition) {
        return true;
      }
    }
    if (name === "Ectoplasm" || name === "Hex") {
      if (self.eligible_editionless_jokers.length > 0) return true;
    }
    if (name === "The Emperor" || name === "The High Priestess") {
      if (
        G.consumeables!.cards.length < G.consumeables!.config.card_limit ||
        self.area === G.consumeables
      ) {
        return true;
      }
    }
    if (name === "The Fool") {
      if (
        (G.consumeables!.cards.length < G.consumeables!.config.card_limit ||
          self.area === G.consumeables) &&
        G.GAME.last_tarot_planet &&
        G.GAME.last_tarot_planet !== "c_fool"
      ) {
        return true;
      }
    }
    if (name === "Judgement" || name === "The Soul" || name === "Wraith") {
      return G.jokers!.cards.length < G.jokers!.config.card_limit || self.area === G.jokers;
    }
    if (
      G.STATE === S.SELECTING_HAND ||
      G.STATE === S.TAROT_PACK ||
      G.STATE === S.SPECTRAL_PACK ||
      G.STATE === S.PLANET_PACK
    ) {
      if (cons.max_highlighted) {
        const mod_num = cons.mod_num != null ? cons.mod_num : Math.min(5, cons.max_highlighted);
        if (
          mod_num >= G.hand!.highlighted.length &&
          G.hand!.highlighted.length >= (cons.min_highlighted || 1)
        ) {
          return true;
        }
      }
      if (
        (name === "Familiar" ||
          name === "Grim" ||
          name === "Incantation" ||
          name === "Immolate" ||
          name === "Sigil" ||
          name === "Ouija") &&
        G.hand!.cards.length > 1
      ) {
        return true;
      }
    }
  }
  return false;
}
