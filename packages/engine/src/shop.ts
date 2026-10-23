// Shop and card-use actions (button_callbacks.lua + Game:update_shop).
// Ported from ArnoStar/BalatroEngine (balatro/shop.py).

import { Card } from "./card.ts";
import { CardArea } from "./cardarea.ts";
import type { Game, State } from "./game.ts";

export const ShopMixin = {
  // -------------------------------------------------------------- update
  update_shop(this: Game): void {
    const G = this;
    if (G.STATE_COMPLETE) return;
    const shop_exists = G.shop !== undefined;
    if (G.shop === undefined) {
      G.shop = true;
      G.shop_jokers = new CardArea(G, "shop_jokers", {
        card_limit: G.GAME.shop.joker_max,
        type: "shop",
        highlight_limit: 1,
      });
      G.shop_vouchers = new CardArea(G, "shop_vouchers", {
        card_limit: 1,
        type: "shop",
        highlight_limit: 1,
      });
      G.shop_booster = new CardArea(G, "shop_booster", {
        card_limit: 2,
        type: "shop",
        highlight_limit: 1,
      });
    }

    G.add_event(() => {
      G.add_event(() => {
        const GAME = G.GAME;
        for (const t of [...GAME.tags]) t.apply_to_run({ type: "shop_start" });
        if (!shop_exists) {
          const shop_jokers = G.shop_jokers!;
          for (let n = GAME.shop.joker_max - shop_jokers.cards.length; n > 0; n--)
            shop_jokers.emplace(G.create_card_for_shop(shop_jokers));
          if (GAME.current_round.voucher && G.P_CENTERS[GAME.current_round.voucher] != null) {
            const card = new Card(G, undefined, G.P_CENTERS[GAME.current_round.voucher]!, {
              bypass_discovery_center: true,
            });
            card.shop_voucher = true;
            G.shop_vouchers!.emplace(card);
          }
          GAME.current_round.used_packs ??= {};
          for (const i of [1, 2]) {
            if (!GAME.current_round.used_packs[i])
              GAME.current_round.used_packs[i] = G.get_pack("shop_pack").key;
            if (GAME.current_round.used_packs[i] !== "USED") {
              const card = new Card(G, undefined, G.P_CENTERS[GAME.current_round.used_packs[i]]!, {
                bypass_discovery_center: true,
              });
              card.ability.booster_pos = i;
              G.shop_booster!.emplace(card);
            }
          }
          for (const t of [...GAME.tags]) t.apply_to_run({ type: "voucher_add" });
          for (const t of [...GAME.tags]) t.apply_to_run({ type: "shop_final_pass" });
        }
      });
    });
    G.STATE_COMPLETE = true;
  },

  /** G.shop:remove(): unbought shop cards are removed (frees used_jokers). */
  remove_shop(this: Game): void {
    const G = this;
    if (G.shop === undefined) return;
    for (const area of [G.shop_jokers, G.shop_vouchers, G.shop_booster])
      if (area !== undefined) area.remove();
    G.shop = undefined;
  },

  // ------------------------------------------------------------- actions
  reroll_shop(this: Game): void {
    const G = this;
    const GAME = G.GAME;
    if (G.STATE !== G.STATES.SHOP) throw new Error("not in the shop");
    const cr = GAME.current_round;
    if (GAME.dollars - GAME.bankrupt_at - cr.reroll_cost < 0 && cr.reroll_cost !== 0)
      throw new Error("can't afford reroll");
    if (cr.reroll_cost > 0) G.ease_dollars(-cr.reroll_cost);

    G.add_event(() => {
      const final_free = cr.free_rerolls > 0;
      cr.free_rerolls = Math.max(cr.free_rerolls - 1, 0);
      GAME.round_scores.times_rerolled.amt += 1;
      G.calculate_reroll_cost(final_free);
      const shop_jokers = G.shop_jokers!;
      for (let i = shop_jokers.cards.length - 1; i >= 0; i--) {
        const c = shop_jokers.remove_card(shop_jokers.cards[i])!;
        c.remove();
      }
      for (let n = GAME.shop.joker_max - shop_jokers.cards.length; n > 0; n--)
        shop_jokers.emplace(G.create_card_for_shop(shop_jokers));
    });

    G.add_event(() => {
      G.add_event(() => {
        for (const j of [...G.jokers!.cards]) j.calculate_joker({ reroll_shop: true });
      });
    });
    G.advance();
  },

  check_for_buy_space(G: Game, card: Card): boolean {
    const s = card.ability.set;
    if (
      s !== "Voucher" &&
      s !== "Enhanced" &&
      s !== "Default" &&
      !(
        s === "Joker" &&
        G.jokers!.cards.length <
          G.jokers!.config.card_limit + (card.edition && card.edition.negative ? 1 : 0)
      ) &&
      !(
        card.ability.consumeable &&
        G.consumeables!.cards.length <
          G.consumeables!.config.card_limit + (card.edition && card.edition.negative ? 1 : 0)
      )
    )
      return false;
    return true;
  },

  can_afford(this: Game, card: Card): boolean {
    return !(card.cost > this.GAME.dollars - this.GAME.bankrupt_at && card.cost > 0);
  },

  buy_from_shop(this: Game, card: Card, buy_and_use = false): void {
    const G = this;
    const GAME = G.GAME;
    if (G.STATE !== G.STATES.SHOP) throw new Error("not in the shop");
    if (!G.can_afford(card)) throw new Error("can't afford this card");
    if (buy_and_use) {
      if (!card.can_use_consumeable()) throw new Error("this card can't be used right now");
    } else if (!ShopMixin.check_for_buy_space(G, card)) {
      throw new Error("no space for this card");
    }

    G.add_event(() => {
      card.area!.remove_card(card);
      card.add_to_deck();
      if (card.ability.set === "Default" || card.ability.set === "Enhanced") {
        G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
        G.deck!.emplace(card);
        card.playing_card = G.playing_card;
        G.playing_card_joker_effects([card]);
        G.playing_cards.push(card);
      } else if (!buy_and_use) {
        if (card.ability.consumeable) G.consumeables!.emplace(card);
        else G.jokers!.emplace(card);
        G.add_event(() => card.calculate_joker({ buying_card: true, card }));
      }
      GAME.round_scores.cards_purchased.amt += 1;
      if (card.ability.set === "Joker") GAME.current_round.jokers_purchased += 1;
      for (const j of [...G.jokers!.cards]) j.calculate_joker({ buying_card: true, card });
      if (GAME.modifiers.inflation) {
        GAME.inflation += 1;
        G.add_event(() => G.refresh_all_costs());
      }
      if (card.cost !== 0) G.ease_dollars(-card.cost);
      if (buy_and_use) G.use_card(card, true);
    });
    G.advance();
  },

  /** 'Next Round' button. */
  toggle_shop(this: Game): void {
    const G = this;
    if (!(G.STATE === G.STATES.SHOP && G.shop !== undefined)) throw new Error("not in the shop");
    for (const j of [...G.jokers!.cards]) j.calculate_joker({ ending_shop: true });

    G.add_event(() => {
      G.remove_shop();
      G.STATE_COMPLETE = false;
      G.STATE = G.STATES.BLIND_SELECT;
    });
    G.advance();
  },

  sell_card(this: Game, card: Card): void {
    const G = this;
    if (!card.can_sell_card()) throw new Error("this card can't be sold");
    card.sell_card();
    for (const j of [...G.jokers!.cards])
      if (j !== card) j.calculate_joker({ selling_card: true, card });
    G.advance();
  },

  // ------------------------------------------------------------ use_card
  /** G.FUNCS.use_card: consumables, boosters, vouchers and pack picks. */
  use_card(this: Game, card: Card, _mute?: unknown, _nosave?: unknown): void {
    const G = this;
    const S = G.STATES;
    const GAME = G.GAME;
    const area = card.area;
    const prev_state = G.STATE;
    const packs: State[] = [
      S.TAROT_PACK,
      S.PLANET_PACK,
      S.SPECTRAL_PACK,
      S.STANDARD_PACK,
      S.BUFFOON_PACK,
    ];
    let dont_dissolve: boolean | undefined;
    let delay_fac = 1;
    if (card.check_use()) return;
    G.TAROT_INTERRUPT = G.STATE;
    if (card.ability.set === "Booster") GAME.PACK_INTERRUPT = G.STATE;
    if (!packs.includes(G.STATE)) G.STATE = S.PLAY_TAROT;
    if (card.area !== undefined) card.area.remove_card(card);
    const s = card.ability.set;
    if (card.ability.consumeable) {
      if (!([S.TAROT_PACK, S.PLANET_PACK, S.SPECTRAL_PACK] as State[]).includes(G.STATE))
        G.draw_card(G.hand, G.play!, card);
      card.use_consumeable(area);
      for (const j of [...G.jokers!.cards])
        j.calculate_joker({ using_consumeable: true, consumeable: card });
    } else if (s === "Enhanced" || s === "Default") {
      G.playing_card = G.playing_card ? G.playing_card + 1 : 1;
      G.deck!.emplace(card);
      card.playing_card = G.playing_card;
      G.playing_card_joker_effects([card]);
      card.add_to_deck();
      G.playing_cards.push(card);
      dont_dissolve = true;
      delay_fac = 0.2;
    } else if (s === "Joker") {
      card.add_to_deck();
      G.jokers!.emplace(card);
      dont_dissolve = true;
      delay_fac = 0.2;
    } else if (s === "Booster") {
      if (card.ability.booster_pos)
        GAME.current_round.used_packs[card.ability.booster_pos] = "USED";
      G.draw_card(G.hand, G.play!, card);
      if (!card.from_tag) GAME.round_scores.cards_purchased.amt += 1;
      card.open();
    } else if (s === "Voucher") {
      G.draw_card(G.hand, G.play!, card);
      GAME.round_scores.cards_purchased.amt += 1;
      card.redeem();
    }
    if (s === "Booster") {
      G.TAROT_INTERRUPT = undefined;
      return;
    }

    G.add_event(() => {
      if (!dont_dissolve) card.start_dissolve();

      G.add_event(() => {
        G.STATE = prev_state;
        G.TAROT_INTERRUPT = undefined;
        if (packs.includes(prev_state) && G.booster_pack) {
          if (area === G.consumeables) {
            // pass
          } else if (GAME.pack_choices && GAME.pack_choices > 1) {
            GAME.pack_choices = GAME.pack_choices - 1;
          } else {
            G.end_consumeable(undefined, delay_fac);
          }
        }
      });
    });
  },
};
