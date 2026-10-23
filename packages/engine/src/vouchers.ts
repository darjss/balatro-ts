// Card:redeem() and Card:apply_to_run() from card.lua.
// Ported from ArnoStar/BalatroEngine (balatro/vouchers.py).

import type { Card } from "./card.ts";
import type { Game } from "./game.ts";
import type { T } from "./lua.ts";

export const redeem = (card: Card) => {
  const G = card.G;
  if (card.ability.set !== "Voucher") return;
  if (card.shop_voucher) delete G.GAME.current_round.voucher;
  G.GAME.used_vouchers[card.config.center_key!] = true;
  G.ease_dollars(-card.cost);
  delete G.GAME.current_round.voucher;
  apply_to_run(G, card, undefined);
  for (const j of G.jokers!.cards.slice()) j.calculate_joker({ buying_card: true, card });
  if (G.GAME.modifiers.inflation) {
    G.GAME.inflation += 1;
    G.add_event(() => G.refresh_all_costs());
  }
};

export const apply_to_run = (G: Game, card: Card | undefined, center: T | undefined) => {
  const name = center != null ? center.name : card != null ? card.ability.name : undefined;
  // extra is a number for every voucher handled below
  const extra: number =
    center != null && center.config.extra != null
      ? center.config.extra
      : card != null
        ? card.ability.extra
        : undefined;
  const GAME = G.GAME;

  if (name === "Overstock" || name === "Overstock Plus") G.add_event(() => G.change_shop_size(1));
  if (name === "Tarot Merchant" || name === "Tarot Tycoon")
    G.add_event(() => {
      GAME.tarot_rate = 4 * extra;
    });
  if (name === "Planet Merchant" || name === "Planet Tycoon")
    G.add_event(() => {
      GAME.planet_rate = 4 * extra;
    });
  if (name === "Hone" || name === "Glow Up")
    G.add_event(() => {
      GAME.edition_rate = extra;
    });
  if (name === "Magic Trick" || name === "Illusion")
    G.add_event(() => {
      GAME.playing_card_rate = extra;
    });
  if (name === "Crystal Ball")
    G.add_event(() => {
      G.consumeables!.config.card_limit += 1;
    });
  if (name === "Clearance Sale" || name === "Liquidation")
    G.add_event(() => {
      GAME.discount_percent = extra;
      G.refresh_all_costs();
    });
  if (name === "Reroll Surplus" || name === "Reroll Glut") {
    const amount = card != null ? card.ability.extra : extra;
    G.add_event(() => {
      GAME.round_resets.reroll_cost = GAME.round_resets.reroll_cost - amount;
      GAME.current_round.reroll_cost = Math.max(0, GAME.current_round.reroll_cost - amount);
    });
  }
  if (name === "Seed Money" || name === "Money Tree")
    G.add_event(() => {
      GAME.interest_cap = extra;
    });
  if (name === "Grabber" || name === "Nacho Tong") {
    GAME.round_resets.hands += extra;
    G.ease_hands_played(extra);
  }
  if (name === "Paint Brush" || name === "Palette") G.hand!.change_size(1);
  if (name === "Wasteful" || name === "Recyclomancy") {
    GAME.round_resets.discards += extra;
    G.ease_discard(extra);
  }
  if (name === "Antimatter")
    G.add_event(() => {
      if (G.jokers != null) G.jokers.config.card_limit += 1;
    });
  if (name === "Hieroglyph" || name === "Petroglyph") {
    G.ease_ante(-extra);
    const rr_ = GAME.round_resets;
    rr_.blind_ante = rr_.blind_ante != null ? rr_.blind_ante : rr_.ante;
    rr_.blind_ante = rr_.blind_ante - extra;
    if (name === "Hieroglyph") {
      rr_.hands -= extra;
      G.ease_hands_played(-extra);
    }
    if (name === "Petroglyph") {
      rr_.discards -= extra;
      G.ease_discard(-extra);
    }
  }
};
