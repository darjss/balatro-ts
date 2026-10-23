// High-level player actions with the same legality checks as the game's UI.
// Ported from ArnoStar/BalatroEngine (balatro/actions.py).

import type { CardArea } from "./cardarea.ts";
import { STATES, type Game } from "./game.ts";
import { Tag } from "./tag.ts";
import { apply_to_run } from "./vouchers.ts";

export class IllegalAction extends Error {
  override name = "IllegalAction";
}

export type AreaName =
  | "shop_jokers"
  | "shop_vouchers"
  | "shop_booster"
  | "pack_cards"
  | "play"
  | "jokers"
  | "consumeables"
  | "hand"
  | "deck"
  | "discard";

/** Oracle-style command dicts (see tools/lua/oracle.lua). */
export type Command =
  | { cmd: "select_blind" }
  | { cmd: "skip_blind" }
  | { cmd: "reroll_boss" }
  | { cmd: "play"; cards: number[] }
  | { cmd: "discard"; cards: number[] }
  | { cmd: "cash_out" }
  | { cmd: "reroll" }
  | { cmd: "buy"; area: AreaName; index: number; use?: boolean }
  | { cmd: "end_shop" }
  | { cmd: "use"; index: number; targets?: number[] | null }
  | { cmd: "sell"; area: AreaName; index: number }
  | { cmd: "pick"; index: number; targets?: number[] | null }
  | { cmd: "skip_pack" }
  | { cmd: "move"; area: AreaName; from: number; to: number }
  | { cmd: "sort"; mode?: "rank" | "suit" }
  | { cmd: "state" }
  | { cmd: "cheat"; dollars?: number; ante?: number; boss?: string }
  | { cmd: "add_joker"; key: string; edition?: string }
  | { cmd: "add_tag"; key: string }
  | { cmd: "add_voucher"; key: string };

export const ActionsMixin = {
  // ----------------------------------------------------------- helpers
  _area(this: Game, name: string): CardArea {
    let area: CardArea | undefined;
    switch (name) {
      case "shop_jokers":
        area = this.shop_jokers;
        break;
      case "shop_vouchers":
        area = this.shop_vouchers;
        break;
      case "shop_booster":
        area = this.shop_booster;
        break;
      case "pack_cards":
        area = this.pack_cards;
        break;
      case "play":
        area = this.play;
        break;
      case "jokers":
        area = this.jokers;
        break;
      case "consumeables":
        area = this.consumeables;
        break;
      case "hand":
        area = this.hand;
        break;
      case "deck":
        area = this.deck;
        break;
      case "discard":
        area = this.discard;
        break;
    }
    if (area == null) throw new IllegalAction(`no area '${name}'`);
    return area;
  },

  _highlight(this: Game, area: CardArea, idxs?: readonly number[] | null) {
    area.unhighlight_all();
    for (const i of idxs ?? []) {
      if (!(0 <= i && i < area.cards.length))
        throw new IllegalAction(`no card at ${area.name}[${i}]`);
      area.add_to_highlighted(area.cards[i]!, true);
    }
  },

  _require(this: Game, cond: boolean, msg: string) {
    if (!cond) throw new IllegalAction(msg);
  },

  // ----------------------------------------------------------- blinds
  act_select_blind(this: Game) {
    this._require(
      this.STATE === STATES.BLIND_SELECT && this.blind_select != null,
      "not at blind select",
    );
    this.select_blind();
  },

  act_skip_blind(this: Game) {
    this._require(
      this.STATE === STATES.BLIND_SELECT && this.blind_select != null,
      "not at blind select",
    );
    this._require(
      this.GAME.blind_on_deck === "Small" || this.GAME.blind_on_deck === "Big",
      "the boss blind can't be skipped",
    );
    this.skip_blind();
  },

  act_reroll_boss(this: Game) {
    this._require(
      this.STATE === STATES.BLIND_SELECT && this.blind_select != null,
      "not at blind select",
    );
    this._require(this.can_reroll_boss(), "can't reroll the boss");
    this.reroll_boss();
  },

  // ------------------------------------------------------------- hand
  act_play(this: Game, idxs: number[]) {
    this._require(this.STATE === STATES.SELECTING_HAND, "not selecting a hand");
    this._highlight(this.hand!, idxs);
    const n = this.hand!.highlighted.length;
    this._require(0 < n && n <= 5, "select 1-5 cards to play");
    this.play_cards_from_highlighted();
    this.advance();
  },

  act_discard(this: Game, idxs: number[]) {
    this._require(this.STATE === STATES.SELECTING_HAND, "not selecting a hand");
    this._require(this.GAME.current_round.discards_left > 0, "no discards left");
    this._highlight(this.hand!, idxs);
    this._require(this.hand!.highlighted.length > 0, "select cards to discard");
    this.discard_cards_from_highlighted();
    this.advance();
  },

  act_cash_out(this: Game) {
    this._require(
      this.STATE === STATES.ROUND_EVAL && this.round_eval != null,
      "not at round evaluation",
    );
    this.cash_out();
  },

  // ------------------------------------------------------------- shop
  act_reroll(this: Game) {
    this._require(this.STATE === STATES.SHOP && this.shop != null, "not in the shop");
    const cr = this.GAME.current_round;
    this._require(
      !(this.GAME.dollars - this.GAME.bankrupt_at - cr.reroll_cost < 0 && cr.reroll_cost !== 0),
      "can't afford the reroll",
    );
    this.reroll_shop();
  },

  act_buy(this: Game, area: string, index: number, use = false) {
    this._require(this.STATE === STATES.SHOP && this.shop != null, "not in the shop");
    const a = this._area(area);
    this._require(0 <= index && index < a.cards.length, `nothing at ${area}[${index}]`);
    const card = a.cards[index]!;
    this._require(this.can_afford(card), "can't afford it");
    if (area === "shop_jokers") {
      if (use) {
        this._require(
          Boolean(card.ability.consumeable) && card.can_use_consumeable(),
          "can't use it now",
        );
      } else {
        this._require(this.check_for_buy_space(this, card), "no room");
      }
      this.buy_from_shop(card, use);
    } else if (area === "shop_vouchers" || area === "shop_booster") {
      this.use_card(card);
      this.advance();
    } else {
      throw new IllegalAction(`can't buy from ${area}`);
    }
  },

  act_end_shop(this: Game) {
    this._require(this.STATE === STATES.SHOP && this.shop != null, "not in the shop");
    this.toggle_shop();
  },

  // -------------------------------------------------- jokers / consumables
  act_use(this: Game, index: number, targets?: number[] | null) {
    this._require(0 <= index && index < this.consumeables!.cards.length, "no such consumable");
    const card = this.consumeables!.cards[index]!;
    if (targets != null) this._highlight(this.hand!, targets);
    this._require(card.can_use_consumeable(), "can't use this card now");
    this.use_card(card);
    this.advance();
  },

  act_sell(this: Game, area: string, index: number) {
    const a = this._area(area);
    this._require(
      (area === "jokers" || area === "consumeables") && 0 <= index && index < a.cards.length,
      "nothing to sell there",
    );
    const card = a.cards[index]!;
    this._require(card.can_sell_card(), "can't sell this card");
    this.sell_card(card);
  },

  /** The 'Rank'/'Suit' sort buttons (the choice sticks for later draws). */
  act_sort(this: Game, mode = "rank") {
    this.hand!.sort(mode === "suit" ? "suit desc" : "desc");
    this.advance();
  },

  act_move(this: Game, area: string, frm: number, to: number) {
    const a = this._area(area);
    this._require(0 <= frm && frm < a.cards.length && 0 <= to && to < a.cards.length, "bad move");
    const [c] = a.cards.splice(frm, 1);
    a.cards.splice(to, 0, c!);
    this.update_cards();
  },

  // ------------------------------------------------------------- packs
  act_pick(this: Game, index: number, targets?: number[] | null) {
    this._require(this.in_pack() && this.pack_cards != null, "no pack open");
    this._require(0 <= index && index < this.pack_cards!.cards.length, "no such pack card");
    const card = this.pack_cards!.cards[index]!;
    if (targets != null) this._highlight(this.hand!, targets);
    this._require(this.can_select_pack_card(card), "can't take this card");
    this.use_card(card);
    this.advance();
  },

  act_skip_pack(this: Game) {
    this._require(
      this.in_pack() && this.pack_cards != null && this.pack_cards!.cards.length > 0,
      "no pack open",
    );
    const S = STATES;
    this._require(
      this.STATE === S.PLANET_PACK ||
        this.STATE === S.STANDARD_PACK ||
        this.STATE === S.BUFFOON_PACK ||
        this.hand!.cards.length > 0 ||
        this.hand!.config.card_limit <= 0,
      "can't skip yet",
    );
    this.skip_booster();
  },

  // ----------------------------------------------------------- dispatch
  /** Apply an oracle-style command dict (see tools/lua/oracle.lua). */
  do(this: Game, cmd: Command) {
    const c: string = cmd.cmd;
    switch (cmd.cmd) {
      case "select_blind":
        this.act_select_blind();
        break;
      case "skip_blind":
        this.act_skip_blind();
        break;
      case "reroll_boss":
        this.act_reroll_boss();
        break;
      case "play":
        this.act_play(cmd.cards);
        break;
      case "discard":
        this.act_discard(cmd.cards);
        break;
      case "cash_out":
        this.act_cash_out();
        break;
      case "reroll":
        this.act_reroll();
        break;
      case "buy":
        this.act_buy(cmd.area, cmd.index, Boolean(cmd.use));
        break;
      case "end_shop":
        this.act_end_shop();
        break;
      case "use":
        this.act_use(cmd.index, cmd.targets);
        break;
      case "sell":
        this.act_sell(cmd.area, cmd.index);
        break;
      case "pick":
        this.act_pick(cmd.index, cmd.targets);
        break;
      case "skip_pack":
        this.act_skip_pack();
        break;
      case "move":
        this.act_move(cmd.area, cmd.from, cmd.to);
        break;
      case "sort":
        this.act_sort(cmd.mode ?? "rank");
        break;
      case "state":
        break;
      case "cheat": // test helpers, no RNG involved
        if (cmd.dollars != null) this.GAME.dollars = cmd.dollars;
        if (cmd.ante != null) {
          this.GAME.round_resets.ante = cmd.ante;
          this.GAME.round_resets.blind_ante = cmd.ante;
        }
        if (cmd.boss != null) this.GAME.round_resets.blind_choices.Boss = cmd.boss;
        this.advance();
        break;
      case "add_joker":
        this.add_joker(cmd.key, cmd.edition);
        this.advance();
        break;
      case "add_tag":
        this.add_tag(new Tag(this, cmd.key));
        this.advance();
        break;
      case "add_voucher":
        this.GAME.used_vouchers[cmd.key] = true;
        apply_to_run(this, undefined, this.P_CENTERS[cmd.key]);
        this.advance();
        break;
      default:
        throw new IllegalAction(`unknown command '${c}'`);
    }
  },
};
