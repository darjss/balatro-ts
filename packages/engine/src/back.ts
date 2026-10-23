// Port of back.lua (deck effects).
// Ported from ArnoStar/BalatroEngine (balatro/back.py).

import type { Game } from "./game.ts";
import { copy_table, type T } from "./lua.ts";
import { Tag } from "./tag.ts";
import { apply_to_run } from "./vouchers.ts";

export class Back {
  G: Game;
  name: string;
  effect: { center: T; config: T };
  key: string;

  constructor(G: Game, center: T | undefined) {
    this.G = G;
    const c: T = center ?? G.P_CENTERS["b_red"]!;
    this.name = c.name || "Red Deck";
    this.effect = { center: c, config: copy_table(c.config) };
    this.key = c.key;
  }

  trigger_effect(args: T | undefined): [number, number] | undefined {
    const G = this.G;
    if (!args) return undefined;
    if (
      this.name === "Anaglyph Deck" &&
      args.context === "eval" &&
      G.GAME.last_blind &&
      G.GAME.last_blind.boss
    )
      G.add_event(() => G.add_tag(new Tag(G, "tag_double")));
    if (this.name === "Plasma Deck" && args.context === "blind_amount") return undefined;
    if (this.name === "Plasma Deck" && args.context === "final_scoring_step") {
      const tot = args.chips + args.mult;
      args.chips = Math.floor(tot / 2);
      args.mult = Math.floor(tot / 2);
      return [args.chips, args.mult];
    }
    return undefined;
  }

  apply_to_run() {
    const G = this.G;
    const cfg = this.effect.config;
    const sp = G.GAME.starting_params;
    if (cfg.voucher) {
      G.GAME.used_vouchers[cfg.voucher] = true;
      G.GAME.starting_voucher_count = (G.GAME.starting_voucher_count || 0) + 1;
      apply_to_run(G, undefined, G.P_CENTERS[cfg.voucher]);
    }
    if (cfg.hands) sp.hands = sp.hands + cfg.hands;
    if (cfg.consumables != null && cfg.consumables.length > 0) {
      G.add_event(() => {
        for (const v of cfg.consumables) {
          const card = G.create_card(
            "Tarot",
            G.consumeables,
            undefined,
            undefined,
            undefined,
            undefined,
            v,
            "deck",
          );
          card.add_to_deck();
          G.consumeables!.emplace(card);
        }
      });
    }
    if (cfg.dollars) sp.dollars = sp.dollars + cfg.dollars;
    if (cfg.remove_faces) sp.no_faces = true;
    if (cfg.spectral_rate) G.GAME.spectral_rate = cfg.spectral_rate;
    if (cfg.discards) sp.discards = sp.discards + cfg.discards;
    if (cfg.reroll_discount) sp.reroll_cost = sp.reroll_cost - cfg.reroll_discount;
    if (cfg.edition) {
      G.add_event(() => {
        let i = 0;
        while (i < cfg.edition_count) {
          const card = G._random_card_from(G.playing_cards, "edition_deck");
          if (!card.edition) {
            i += 1;
            card.set_edition({ [cfg.edition]: true }, undefined, true);
          }
        }
      });
    }
    if (cfg.vouchers != null && cfg.vouchers.length > 0) {
      for (const v of cfg.vouchers) {
        G.GAME.used_vouchers[v] = true;
        G.GAME.starting_voucher_count = (G.GAME.starting_voucher_count || 0) + 1;
        apply_to_run(G, undefined, G.P_CENTERS[v]);
      }
    }
    if (this.name === "Checkered Deck") {
      G.add_event(() => {
        for (const v of G.playing_cards) {
          if (v.base.suit === "Clubs") v.change_suit("Spades");
          if (v.base.suit === "Diamonds") v.change_suit("Hearts");
        }
      });
    }
    if (cfg.randomize_rank_suit) sp.erratic_suits_and_ranks = true;
    if (cfg.joker_slot) sp.joker_slots = sp.joker_slots + cfg.joker_slot;
    if (cfg.hand_size) sp.hand_size = sp.hand_size + cfg.hand_size;
    if (cfg.ante_scaling) sp.ante_scaling = cfg.ante_scaling;
    if (cfg.consumable_slot) sp.consumable_slots = sp.consumable_slots + cfg.consumable_slot;
    if (cfg.no_interest) G.GAME.modifiers.no_interest = true;
    if (cfg.extra_hand_bonus) G.GAME.modifiers.money_per_hand = cfg.extra_hand_bonus;
    if (cfg.extra_discard_bonus) G.GAME.modifiers.money_per_discard = cfg.extra_discard_bonus;
  }
}
