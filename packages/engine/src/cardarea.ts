// Port of cardarea.lua (logic only; card order == on-screen left-to-right order).
// Ported from ArnoStar/BalatroEngine (balatro/cardarea.py).

import type { Card } from "./card.ts";
import { type Game, STATES } from "./game.ts";

/** What callers pass to `CardArea(G, name, config)`. */
export type CardAreaInit = {
  card_limit?: number;
  type?: string;
  highlight_limit?: number;
  sort?: string;
};

export type CardAreaConfig = CardAreaInit & {
  highlighted_limit: number;
  card_limit: number;
  temp_limit: number;
  card_count: number;
  type: string;
  sort: string;
  real_card_limit?: number;
  last_poll_size?: number;
};

export class CardArea {
  G: Game;
  name: string;
  cards: Card[] = [];
  highlighted: Card[] = [];
  config: CardAreaConfig;
  removed = false;

  constructor(G: Game, name: string, config: CardAreaInit) {
    this.G = G;
    this.name = name;
    const card_limit = config.card_limit ?? 52;
    this.config = {
      ...config,
      highlighted_limit: config.highlight_limit ?? 5,
      card_limit,
      temp_limit: card_limit,
      card_count: 0,
      type: config.type ?? "deck",
      sort: config.sort ?? "desc",
    };
  }

  toString() {
    return `<CardArea ${this.name} [${this.cards.map(String).join(", ")}]>`;
  }

  // ----------------------------------------------------------------- core
  emplace(card: Card, location?: string, stay_flipped?: boolean) {
    const G = this.G;
    if (location === "front" || this.config.type === "deck") this.cards.unshift(card);
    else this.cards.push(card);
    if (
      card.facing === "back" &&
      this.config.type !== "discard" &&
      this.config.type !== "deck" &&
      !stay_flipped
    )
      card.flip();
    if (this === G.hand && stay_flipped) card.ability.wheel_flipped = true;
    if (this.cards.length > this.config.card_limit) {
      if (this === G.deck) this.config.card_limit = this.cards.length;
    }
    card.area = this;
    if ((this.config.type === "deck" || this.config.type === "discard") && card.facing === "front")
      card.flip(); // align_cards() keeps deck/discard cards face down
    if (this === G.jokers) {
      let joker_tally = 0;
      for (const c of this.cards) if (c.ability.set === "Joker") joker_tally += 1;
      if (joker_tally > G.GAME.max_jokers) G.GAME.max_jokers = joker_tally;
    }
    // hand, joker, consumeable, title_2: align_cards keeps these ordered by
    // x position == list order
  }

  remove_card(card?: Card, discarded_only = false) {
    if (this.removed) return undefined;
    let cards = this.cards;
    if (discarded_only) cards = this.cards.filter((v) => v.ability && v.ability.discarded);
    if (card == null) {
      if (cards.length === 0) return undefined;
      if (this.config.type === "discard" || this.config.type === "deck") card = cards.at(-1)!;
      else card = cards[0]!;
    }
    for (let i = this.cards.length - 1; i >= 0; i--) {
      if (this.cards[i] === card) {
        card.area = undefined;
        this.cards.splice(i, 1);
        this.remove_from_highlighted(card, true);
        break;
      }
    }
    return card;
  }

  change_size(delta: number) {
    const G = this.G;
    if (delta === 0) return;
    G.add_event(() => {
      const real =
        this.config.real_card_limit != null ? this.config.real_card_limit : this.config.card_limit;
      this.config.real_card_limit = real + delta;
      this.config.card_limit = Math.max(0, this.config.real_card_limit);
      if (
        delta > 0 &&
        this.config.real_card_limit > 1 &&
        this === G.hand &&
        this.cards.length > 0 &&
        (G.STATE === STATES.DRAW_TO_HAND || G.STATE === STATES.SELECTING_HAND)
      ) {
        for (let i = 0; i < Math.abs(delta); i++) {
          G.draw_card(G.deck, G.hand!);
          G.add_event(() => this.sort());
        }
      }
    });
  }

  // ------------------------------------------------------------ highlight
  can_highlight(_card: Card) {
    return (
      this.config.type === "hand" ||
      this.config.type === "joker" ||
      this.config.type === "consumeable" ||
      (this.config.type === "shop" && this.config.highlighted_limit > 0)
    );
  }

  add_to_highlighted(card: Card, _silent = false) {
    if (this.config.type === "shop") {
      if (this.highlighted.length > 0) this.remove_from_highlighted(this.highlighted[0]);
      this.highlighted.push(card);
      card.highlighted = true;
    } else if (this.config.type === "joker" || this.config.type === "consumeable") {
      if (this.highlighted.length >= this.config.highlighted_limit)
        this.remove_from_highlighted(this.highlighted[0]);
      this.highlighted.push(card);
      card.highlighted = true;
    } else if (this.highlighted.length >= this.config.highlighted_limit) {
      card.highlighted = false;
    } else {
      this.highlighted.push(card);
      card.highlighted = true;
    }
  }

  remove_from_highlighted(card: Card | undefined, force = false) {
    const G = this.G;
    if (!force && card != null && card.ability.forced_selection && this === G.hand) return;
    for (let i = this.highlighted.length - 1; i >= 0; i--) {
      if (this.highlighted[i] === card) {
        this.highlighted.splice(i, 1);
        break;
      }
    }
    if (card != null) card.highlighted = false;
  }

  unhighlight_all() {
    const G = this.G;
    for (let i = this.highlighted.length - 1; i >= 0; i--) {
      const c = this.highlighted[i]!;
      if (c.ability.forced_selection && this === G.hand) continue;
      c.highlighted = false;
      this.highlighted.splice(i, 1);
    }
  }

  // ---------------------------------------------------------- order / rng
  index(card: Card) {
    return this.cards.indexOf(card);
  }

  shuffle(seed?: string) {
    const G = this.G;
    this.cards.sort((a, b) => a.sort_id - b.sort_id);
    G.rng.shuffle(this.cards, G.rng.pseudoseed(seed || "shuffle"));
  }

  sort(method?: string) {
    this.config.sort = method || this.config.sort;
    const m = this.config.sort;
    // Lua's table.sort with a strict comparator; keys are all distinct
    // (get_nominal includes the per-card unique_val), so a stable sort
    // gives the same result.
    if (m === "desc") this.cards.sort((a, b) => b.get_nominal() - a.get_nominal());
    else if (m === "asc") this.cards.sort((a, b) => a.get_nominal() - b.get_nominal());
    else if (m === "suit desc")
      this.cards.sort((a, b) => b.get_nominal("suit") - a.get_nominal("suit"));
    else if (m === "suit asc")
      this.cards.sort((a, b) => a.get_nominal("suit") - b.get_nominal("suit"));
    else if (m === "order") {
      const order = (c: Card): number =>
        c.config.card && c.config.card.order != null ? c.config.card.order : c.config.center.order;
      this.cards.sort((a, b) => order(a) - order(b));
    }
  }

  draw_card_from(area: CardArea, stay_flipped?: boolean, discarded_only = false) {
    const G = this.G;
    if (this.cards.length < this.config.card_limit || this === G.deck || this === G.hand) {
      const card = area.remove_card(undefined, discarded_only);
      if (card != null) {
        let stay = G.GAME.blind ? G.GAME.blind.stay_flipped(this, card) : undefined;
        if (this === G.hand && G.GAME.modifiers.flipped_cards) {
          if (G.rng.random("flipped_card") < 1 / G.GAME.modifiers.flipped_cards) stay = true;
        }
        this.emplace(card, undefined, stay);
        return true;
      }
    }
    return false;
  }

  /** CardArea:remove() -> every card in it is removed (Card:remove). */
  remove() {
    for (const c of this.cards.slice()) c.remove();
    this.cards = [];
    this.removed = true;
  }
}
