// Port of tag.lua.
// Ported from ArnoStar/BalatroEngine (balatro/tag.py).

import { Card } from "./card.ts";
import type { Game } from "./game.ts";
import { copy_table, type T } from "./lua.ts";

export type TagAbility = {
  orbital_hand: string;
  blind_type?: string;
};

const EDITION_TAGS = new Map([
  ["Foil Tag", "foil"],
  ["Holographic Tag", "holo"],
  ["Polychrome Tag", "polychrome"],
  ["Negative Tag", "negative"],
]);

export class Tag {
  G: Game;
  key: string;
  config: T;
  name: string;
  tally: number;
  triggered = false;
  ID: number;
  ability: TagAbility;

  constructor(G: Game, key: string, for_collection = false, blind_type?: string) {
    this.G = G;
    this.key = key;
    const proto = G.P_TAGS[key]!;
    this.config = copy_table(proto.config);
    this.name = proto.name;
    this.tally = G.GAME.tag_tally || 0;
    G.tagid += 1;
    this.ID = G.tagid;
    this.ability = { orbital_hand: "[Poker Hand]" };
    if (blind_type != null) this.ability.blind_type = blind_type;
    G.GAME.tag_tally = G.GAME.tag_tally ? G.GAME.tag_tally + 1 : 1;
    if (!for_collection) this.set_ability();
  }

  toString() {
    return `<Tag ${this.key}>`;
  }

  set_ability() {
    const G = this.G;
    if (this.name === "Orbital Tag") {
      if (G.orbital_hand) {
        this.ability.orbital_hand = G.orbital_hand;
      } else if (this.ability.blind_type) {
        const oc = G.GAME.orbital_choices;
        const ante = G.GAME.round_resets.ante;
        if (oc && oc[ante] && oc[ante][this.ability.blind_type])
          this.ability.orbital_hand = oc[ante][this.ability.blind_type];
      }
    }
  }

  remove() {
    const G = this.G;
    const i = G.GAME.tags.indexOf(this);
    if (i >= 0) G.GAME.tags.splice(i, 1);
  }

  /** Tag:yep(): the tag's effect runs in an event, then the tag is removed. */
  _yep(func?: () => void) {
    const G = this.G;
    if (func != null) G.add_event(func);
    G.add_event(() => this.remove());
  }

  _nope() {
    this.G.add_event(() => this.remove());
  }

  apply_to_run(context: T) {
    const G = this.G;
    if (this.triggered || this.config.type !== context.type) return undefined;
    const t = context.type;
    const name = this.name;
    if (t === "eval") {
      if (name === "Investment Tag" && G.GAME.last_blind && G.GAME.last_blind.boss) {
        this._yep();
        this.triggered = true;
        const ret: T = { dollars: this.config.dollars, condition: "Defeat the Boss", tag: this };
        return ret;
      }
    } else if (t === "immediate") {
      if (name === "Top-up Tag") {
        this._yep(() => {
          for (let i = 0; i < this.config.spawn_jokers; i++) {
            if (G.jokers != null && G.jokers.cards.length < G.jokers.config.card_limit) {
              const card = G.create_card(
                "Joker",
                G.jokers,
                undefined,
                0,
                undefined,
                undefined,
                undefined,
                "top",
              );
              card.add_to_deck();
              G.jokers.emplace(card);
            }
          }
        });
        this.triggered = true;
        return true;
      }
      if (name === "Skip Tag") {
        this._yep();
        G.ease_dollars((G.GAME.skips || 0) * this.config.skip_bonus);
        this.triggered = true;
        return true;
      }
      if (name === "Garbage Tag") {
        this._yep();
        G.ease_dollars((G.GAME.unused_discards || 0) * this.config.dollars_per_discard);
        this.triggered = true;
        return true;
      }
      if (name === "Handy Tag") {
        this._yep();
        G.ease_dollars((G.GAME.hands_played || 0) * this.config.dollars_per_hand);
        this.triggered = true;
        return true;
      }
      if (name === "Economy Tag") {
        this._yep();
        G.add_event(() =>
          G.ease_dollars(Math.min(this.config.max, Math.max(0, G.GAME.dollars)), true),
        );
        this.triggered = true;
        return true;
      }
      if (name === "Orbital Tag") {
        G.level_up_hand(this, this.ability.orbital_hand, undefined, this.config.levels);
        this._yep();
        this.triggered = true;
        return true;
      }
    } else if (t === "new_blind_choice") {
      let pack: string | undefined;
      if (name === "Charm Tag") pack = "p_arcana_mega_1"; // _1/_2 picked with global math.random: art only
      else if (name === "Meteor Tag") pack = "p_celestial_mega_1";
      else if (name === "Ethereal Tag") pack = "p_spectral_normal_1";
      else if (name === "Standard Tag") pack = "p_standard_mega_1";
      else if (name === "Buffoon Tag") pack = "p_buffoon_mega_1";
      if (pack != null) {
        const key = pack;
        this._yep(() => {
          const card = new Card(G, undefined, G.P_CENTERS[key]!, { bypass_discovery_center: true });
          card.cost = 0;
          card.from_tag = true;
          G.use_card(card);
        });
        this.triggered = true;
        return true;
      }
      if (name === "Boss Tag") {
        this._yep(() => {
          G.from_boss_tag = true;
          G.reroll_boss();
        });
        this.triggered = true;
        return true;
      }
    } else if (t === "voucher_add") {
      if (name === "Voucher Tag") {
        this._yep(() => {
          G.ARGS.voucher_tag = G.ARGS.voucher_tag || {};
          const voucher_key = G.get_next_voucher_key(true);
          G.ARGS.voucher_tag[voucher_key] = true;
          G.shop_vouchers!.config.card_limit += 1;
          const card = new Card(G, undefined, G.P_CENTERS[voucher_key]!, {
            bypass_discovery_center: true,
          });
          G.shop_vouchers!.emplace(card);
          delete G.ARGS.voucher_tag;
        });
        this.triggered = true;
      }
    } else if (t === "tag_add") {
      if (name === "Double Tag" && context.tag.key !== "tag_double") {
        this._yep(() => {
          if (context.tag.ability && context.tag.ability.orbital_hand)
            G.orbital_hand = context.tag.ability.orbital_hand;
          G.add_tag(new Tag(G, context.tag.key));
          G.orbital_hand = undefined;
        });
        this.triggered = true;
      }
    } else if (t === "round_start_bonus") {
      if (name === "Juggle Tag") {
        this._yep();
        G.hand!.change_size(this.config.h_size);
        G.GAME.round_resets.temp_handsize =
          (G.GAME.round_resets.temp_handsize || 0) + this.config.h_size;
        this.triggered = true;
        return true;
      }
    } else if (t === "store_joker_create") {
      let card: Card | undefined;
      if (name === "Rare Tag") {
        const rares = new Set<string>();
        for (const v of G.jokers!.cards)
          if (v.config.center.rarity === 3) rares.add(v.config.center.key);
        if (G.P_JOKER_RARITY_POOLS[2]!.length > rares.size) {
          const created = G.create_card(
            "Joker",
            context.area,
            undefined,
            1,
            undefined,
            undefined,
            undefined,
            "rta",
          );
          card = created;
          this._yep(() => {
            created.ability.couponed = true;
            created.set_cost();
          });
        } else {
          this._nope();
        }
        this.triggered = true;
      } else if (name === "Uncommon Tag") {
        const created = G.create_card(
          "Joker",
          context.area,
          undefined,
          0.9,
          undefined,
          undefined,
          undefined,
          "uta",
        );
        card = created;
        this._yep(() => {
          created.ability.couponed = true;
          created.set_cost();
        });
      }
      this.triggered = true;
      return card;
    } else if (t === "shop_start") {
      if (name === "D6 Tag" && !G.GAME.shop_d6ed) {
        G.GAME.shop_d6ed = true;
        this._yep(() => {
          G.GAME.round_resets.temp_reroll_cost = 0;
          G.calculate_reroll_cost(true);
        });
        this.triggered = true;
        return true;
      }
    } else if (t === "store_joker_modify") {
      let applied: boolean | undefined;
      const card: Card = context.card;
      if (!card.edition && !card.temp_edition && card.ability.set === "Joker") {
        const ed = EDITION_TAGS.get(name);
        if (ed != null) {
          card.temp_edition = true;
          this._yep(() => {
            card.temp_edition = undefined;
            card.set_edition({ [ed]: true }, true);
            card.ability.couponed = true;
            card.set_cost();
          });
          applied = true;
        }
        this.triggered = true;
      }
      return applied;
    } else if (t === "shop_final_pass") {
      if (name === "Coupon Tag" && G.shop != null && !G.GAME.shop_free) {
        G.GAME.shop_free = true;
        this._yep(() => {
          if (G.shop_jokers != null && G.shop_booster != null) {
            for (const v of G.shop_jokers.cards) {
              v.ability.couponed = true;
              v.set_cost();
            }
            for (const v of G.shop_booster.cards) {
              v.ability.couponed = true;
              v.set_cost();
            }
          }
        });
        this.triggered = true;
        return true;
      }
    }
    return undefined;
  }
}
