// Booster packs: Card:open(), the pack states and end_consumeable.
// Ported from ArnoStar/BalatroEngine (balatro/packs.py).

import type { Card } from "./card.ts";
import { CardArea } from "./cardarea.ts";
import type { Game } from "./game.ts";
import { lua_tostring } from "./rng.ts";

export const open_booster = (card: Card) => {
  const G = card.G;
  const GAME = G.GAME;
  const S = G.STATES;
  if (card.ability.set !== "Booster") return;
  G.STATE_COMPLETE = false;
  card.opening = true;
  const name: string = card.ability.name;
  if (name.includes("Arcana")) G.STATE = S.TAROT_PACK;
  else if (name.includes("Celestial")) G.STATE = S.PLANET_PACK;
  else if (name.includes("Spectral")) G.STATE = S.SPECTRAL_PACK;
  else if (name.includes("Standard")) G.STATE = S.STANDARD_PACK;
  else if (name.includes("Buffoon")) G.STATE = S.BUFFOON_PACK;
  GAME.pack_size = card.ability.extra;
  GAME.pack_choices = card.config.center.config.choose || 1;
  if (card.cost > 0) G.ease_dollars(-card.cost);
  // create_UIBox_*_pack() makes G.pack_cards before the cards are generated
  G.pack_cards = new CardArea(G, "pack_cards", {
    card_limit: GAME.pack_size,
    type: "consumeable",
    highlight_limit: 1,
  });
  G.booster_pack = true;

  G.add_event(() => {
    // Card:explode() queues blocking-but-unblockable events that hold back
    // every blockable event for ~1.95s, while the (unblockable) pack
    // generation fires at 1.3s.  So the pack is generated before anything
    // the open_booster jokers queue (e.g. Hallucination's tarot), and the
    // booster card itself is removed (Card:remove at 1.95s) right after.
    G.generate_pack_cards(card);
    G.defer_removal(card);
    for (const j of [...G.jokers!.cards]) j.calculate_joker({ open_booster: true, card });
    if (GAME.modifiers.inflation) {
      GAME.inflation += 1;
      G.add_event(() => G.refresh_all_costs());
    }
  });
};

export const PacksMixin = {
  generate_pack_cards(this: Game, booster: Card): void {
    const G = this;
    const GAME = G.GAME;
    // generation runs >=1.7s after the pack was opened: every timed effect
    // still pending from before (e.g. a tarot used in the previous pack of
    // a Double+Charm tag chain finishing its 0.7s dissolve) has fired.
    G.run_deferred_one_frame();
    const ante = lua_tostring(GAME.round_resets.ante);
    const name: string = booster.ability.name;
    const cards: Card[] = [];
    for (let i = 0; i < booster.ability.extra; i++) {
      let card: Card | undefined;
      if (name.includes("Arcana")) {
        if (GAME.used_vouchers.v_omen_globe && G.rng.random("omen_globe") > 0.8)
          card = G.create_card(
            "Spectral",
            G.pack_cards,
            undefined,
            undefined,
            true,
            true,
            undefined,
            "ar2",
          );
        else
          card = G.create_card(
            "Tarot",
            G.pack_cards,
            undefined,
            undefined,
            true,
            true,
            undefined,
            "ar1",
          );
      } else if (name.includes("Celestial")) {
        if (GAME.used_vouchers.v_telescope && i === 0) {
          let planet: string | undefined;
          let hand: string | undefined;
          let tally = 0;
          for (const v of G.handlist) {
            if (GAME.hands[v].visible && GAME.hands[v].played > tally) {
              hand = v;
              tally = GAME.hands[v].played;
            }
          }
          if (hand)
            for (const v of G.P_CENTER_POOLS.Planet!)
              if (v.config.hand_type === hand) planet = v.key;
          card = G.create_card(
            "Planet",
            G.pack_cards,
            undefined,
            undefined,
            true,
            true,
            planet,
            "pl1",
          );
        } else {
          card = G.create_card(
            "Planet",
            G.pack_cards,
            undefined,
            undefined,
            true,
            true,
            undefined,
            "pl1",
          );
        }
      } else if (name.includes("Spectral")) {
        card = G.create_card(
          "Spectral",
          G.pack_cards,
          undefined,
          undefined,
          true,
          true,
          undefined,
          "spe",
        );
      } else if (name.includes("Standard")) {
        const typ = G.rng.random(G.rng.pseudoseed("stdset" + ante)) > 0.6 ? "Enhanced" : "Base";
        card = G.create_card(
          typ,
          G.pack_cards,
          undefined,
          undefined,
          undefined,
          true,
          undefined,
          "sta",
        );
        const edition = G.poll_edition("standard_edition" + ante, 2, true);
        card.set_edition(edition);
        const seal_poll = G.rng.random(G.rng.pseudoseed("stdseal" + ante));
        if (seal_poll > 1 - 0.02 * 10) {
          const seal_type = G.rng.random(G.rng.pseudoseed("stdsealtype" + ante));
          if (seal_type > 0.75) card.set_seal("Red");
          else if (seal_type > 0.5) card.set_seal("Blue");
          else if (seal_type > 0.25) card.set_seal("Gold");
          else card.set_seal("Purple");
        }
      } else if (name.includes("Buffoon")) {
        card = G.create_card(
          "Joker",
          G.pack_cards,
          undefined,
          undefined,
          true,
          true,
          undefined,
          "buf",
        );
      }
      cards.push(card!);
    }

    G.add_event(() => {
      if (G.pack_cards !== undefined && !G.pack_cards.removed)
        for (const c of cards) G.pack_cards.emplace(c);
    });
  },

  update_pack(this: Game): void {
    const G = this;
    const S = G.STATES;
    if (G.STATE_COMPLETE) return;
    G.STATE_COMPLETE = true;
    if (G.STATE === S.TAROT_PACK || G.STATE === S.SPECTRAL_PACK)
      G.add_event(() => {
        G.add_event(() => G.draw_from_deck_to_hand());
      });
  },

  end_consumeable(this: Game, _e?: unknown, _delayfac = 1): void {
    const G = this;
    const GAME = G.GAME;
    if (G.booster_pack)
      G.add_event(() => {
        if (G.pack_cards !== undefined) G.pack_cards.remove();
        G.booster_pack = undefined;
      });

    G.add_event(() => {
      G.draw_from_hand_to_deck();

      G.add_event(() => {
        G.STATE = GAME.PACK_INTERRUPT;
        delete GAME.PACK_INTERRUPT;
      });
      for (const t of [...GAME.tags]) if (t.apply_to_run({ type: "new_blind_choice" })) break;
    });
  },

  // ------------------------------------------------------------- actions
  skip_booster(this: Game): void {
    const G = this;
    if (!G.in_pack()) throw new Error("no booster pack is open");
    for (const j of [...G.jokers!.cards]) j.calculate_joker({ skipping_booster: true });
    G.end_consumeable(undefined);
    G.advance();
  },

  in_pack(this: Game): boolean {
    const S = this.STATES;
    return (
      this.STATE === S.TAROT_PACK ||
      this.STATE === S.PLANET_PACK ||
      this.STATE === S.SPECTRAL_PACK ||
      this.STATE === S.STANDARD_PACK ||
      this.STATE === S.BUFFOON_PACK
    );
  },

  can_select_pack_card(this: Game, card: Card): boolean {
    const G = this;
    if (card.ability.consumeable) return card.can_use_consumeable();
    return (
      card.ability.set !== "Joker" ||
      Boolean(card.edition && card.edition.negative) ||
      G.jokers!.cards.length < G.jokers!.config.card_limit
    );
  },
};
