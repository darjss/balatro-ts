// Round flow: blind selection, drawing, playing, scoring, end of round.
// Port of functions/state_events.lua, the matching parts of
// functions/button_callbacks.lua and the Game:update_* state functions.
// Ported from ArnoStar/BalatroEngine (balatro/flow.py).

// `const G = this` keeps the Lua's global `G.x` names line by line.
/* oxlint-disable typescript/no-this-alias */

import type { Card } from "./card.ts";
import { STATES, type Game } from "./game.ts";
import { floor, nonempty, type T } from "./lua.ts";
import { get_poker_hand_info } from "./poker.ts";
import { lua_tostring } from "./rng.ts";
import { Tag } from "./tag.ts";

/** eval_card() from common_events.lua. */
export const eval_card = (G: Game, card: Card, context: T): T => {
  const ret: T = {};
  if (context.repetition_only) {
    const seals = card.calculate_seal(context);
    if (seals) ret.seals = seals;
    return ret;
  }
  if (context.cardarea === G.play) {
    const chips = card.get_chip_bonus();
    if (chips > 0) ret.chips = chips;
    const mult = card.get_chip_mult();
    if (mult > 0) ret.mult = mult;
    const x_mult = card.get_chip_x_mult(context);
    if (x_mult > 0) ret.x_mult = x_mult;
    const p_dollars = card.get_p_dollars();
    if (p_dollars > 0) ret.p_dollars = p_dollars;
    const jokers = card.calculate_joker(context);
    if (jokers) ret.jokers = jokers;
    const edition = card.get_edition(context);
    if (edition) ret.edition = edition;
  }
  if (context.cardarea === G.hand) {
    const h_mult = card.get_chip_h_mult();
    if (h_mult > 0) ret.h_mult = h_mult;
    const h_x_mult = card.get_chip_h_x_mult();
    if (h_x_mult > 0) ret.x_mult = h_x_mult;
    const jokers = card.calculate_joker(context);
    if (jokers) ret.jokers = jokers;
  }
  if (context.cardarea === G.jokers || context.card === G.consumeables) {
    let jokers;
    if (context.edition) jokers = card.get_edition(context);
    else if (context.other_joker) jokers = context.other_joker.calculate_joker(context);
    else jokers = card.calculate_joker(context);
    if (jokers) ret.jokers = jokers;
  }
  return ret;
};

export const mod_chips = (G: Game, chips: number) => {
  if (G.GAME.modifiers.chips_dollar_cap) chips = Math.min(chips, Math.max(G.GAME.dollars, 0));
  return chips;
};

export const mod_mult = (mult: number) => mult;

export const FlowMixin = {
  // ================================================================ driver
  /**
   * Run the game loop until it waits for input.
   *
   * Mirrors Game:update(): every frame the event manager handles at most
   * ONE blocking event (EventManager:update sets `blocked` after the
   * first blocking event it handles, completed or not), then the state
   * machine runs (Game:update_*), then every card runs Card:update.
   */
  advance(this: Game, max_iter = 1000000) {
    const G = this;
    const ev = G.events;
    for (let i = 0; i < max_iter; i++) {
      if (ev.length > 0) ev.shift()!();
      const before_state = G.STATE;
      const before_complete = G.STATE_COMPLETE;
      G.update_state();
      G.update_cards();
      if (ev.length > 0 || G.STATE !== before_state || G.STATE_COMPLETE !== before_complete)
        continue;
      if (G.deferred.length > 0) {
        G.run_deferred_one_frame();
        continue;
      }
      return;
    }
    throw new Error("advance(): no fixed point (infinite loop?)");
  },

  update_state(this: Game) {
    const G = this;
    const S = STATES;
    const st = G.STATE;
    if (st === S.SELECTING_HAND) {
      if (G.hand!.cards.length === 0 && G.deck!.cards.length > 0) {
        G.STATE = S.DRAW_TO_HAND;
        G.STATE_COMPLETE = false;
      } else {
        G.update_selecting_hand();
      }
    } else if (st === S.HAND_PLAYED) {
      G.update_hand_played();
    } else if (st === S.DRAW_TO_HAND) {
      G.update_draw_to_hand();
    } else if (st === S.NEW_ROUND) {
      G.update_new_round();
    } else if (st === S.BLIND_SELECT) {
      G.update_blind_select();
    } else if (st === S.ROUND_EVAL) {
      G.update_round_eval();
    } else if (st === S.SHOP) {
      G.update_shop();
    } else if (
      st === S.TAROT_PACK ||
      st === S.SPECTRAL_PACK ||
      st === S.STANDARD_PACK ||
      st === S.BUFFOON_PACK ||
      st === S.PLANET_PACK
    ) {
      G.update_pack();
    } else if (st === S.GAME_OVER) {
      if (!G.STATE_COMPLETE) {
        // update_game_over pauses the game: every pending event was
        // created unpaused and is skipped from now on.  Timed
        // non-blockable effects (eaten jokers, shattered/dissolved
        // cards) were created during the scoring animations, seconds
        // before the end of round, so they already happened - together
        // with the events they queued.
        G.STATE_COMPLETE = true;
        G.events.length = 0;
        G.run_deferred(); // fires them and the events they queue
        G.events.length = 0;
      }
    }
  },

  // ----------------------------------------------------- state functions
  update_selecting_hand(this: Game) {
    const G = this;
    if (G.hand!.cards.length === 0 && G.deck!.cards.length === 0 && G.play!.cards.length === 0)
      G.end_round();
    if (G.shop != null) G.remove_shop();
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;
      if (G.hand!.cards.length === 0 && G.deck!.cards.length === 0) G.end_round();
    }
  },

  update_hand_played(this: Game) {
    const G = this;
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;

      const ev = () => {
        // this event sits behind ~2s of scoring animations; every timed
        // effect queued while scoring (shattered glass, Sixth Sense,
        // eaten jokers) has fired by now, before end_round's RNG
        // (Idol/Mail/Castle picks over G.playing_cards)
        G.run_deferred_one_frame();
        if (G.GAME.chips - G.GAME.blind.chips >= 0 || G.GAME.current_round.hands_left < 1)
          G.STATE = STATES.NEW_ROUND;
        else G.STATE = STATES.DRAW_TO_HAND;
        G.STATE_COMPLETE = false;
      };
      G.add_event(ev);
    }
  },

  update_draw_to_hand(this: Game) {
    const G = this;
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;
      for (const tag of G.GAME.tags.slice()) tag.apply_to_run({ type: "round_start_bonus" });

      const ev = () => {
        if (G.draw_from_deck_to_hand()) return;
        const cr = G.GAME.current_round;
        if (cr.hands_played === 0 && cr.discards_used === 0 && G.GAME.facing_blind) {
          for (const j of G.jokers!.cards.slice()) j.calculate_joker({ first_hand_drawn: true });
        }

        const ev2 = () => {
          G.STATE = STATES.SELECTING_HAND;
          G.STATE_COMPLETE = false;
          G.GAME.blind.drawn_to_hand();
        };
        G.add_event(ev2);
      };
      G.add_event(ev);
    }
  },

  update_new_round(this: Game) {
    const G = this;
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;
      G.end_round();
    }
  },

  update_blind_select(this: Game) {
    const G = this;
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;

      const ev = () => {
        const ev2 = () => {
          G.create_blind_select();
          for (const tag of G.GAME.tags.slice()) tag.apply_to_run({ type: "immediate" });
          for (const tag of G.GAME.tags.slice()) {
            if (tag.apply_to_run({ type: "new_blind_choice" })) break;
          }
        };
        G.add_event(ev2);
      };
      G.add_event(ev);
    }
  },

  update_round_eval(this: Game) {
    const G = this;
    if (!G.STATE_COMPLETE) {
      G.STATE_COMPLETE = true;

      const ev = () => {
        delete G.GAME.facing_blind;
        G.round_eval = true;
        G.add_event(() => G.evaluate_round());
      };
      G.add_event(ev);
    }
  },

  // ======================================================== blind select
  /** create_UIBox_blind_select(): decides blind_on_deck, orbital choices, tags. */
  create_blind_select(this: Game) {
    const G = this;
    const GAME = G.GAME;
    const rr = GAME.round_resets;
    const bs = rr.blind_states;
    const passed = ["Defeated", "Skipped", "Hide"];
    GAME.blind_on_deck = !passed.includes(bs.Small)
      ? "Small"
      : !passed.includes(bs.Big)
        ? "Big"
        : "Boss";
    G.blind_select = { tags: {} };
    for (const typ of ["Small", "Big", "Boss"]) {
      if (bs[typ] === "Hide") continue;
      G.create_blind_choice(typ);
      if ((typ === "Small" || typ === "Big") && rr.blind_tags && rr.blind_tags[typ])
        G.blind_select.tags[typ] = new Tag(G, rr.blind_tags[typ], undefined, typ);
    }
  },

  create_blind_choice(this: Game, typ: string, run_info = false) {
    const G = this;
    const GAME = G.GAME;
    if (!GAME.blind_on_deck) GAME.blind_on_deck = "Small";
    if (!run_info) GAME.round_resets.blind_states[GAME.blind_on_deck] = "Select";
    const ante = GAME.round_resets.ante;
    GAME.orbital_choices = GAME.orbital_choices ?? {};
    if (GAME.orbital_choices[ante] == null) GAME.orbital_choices[ante] = {};
    if (!GAME.orbital_choices[ante][typ]) {
      const poker_hands = G.hands_order().filter((k: string) => GAME.hands[k].visible);
      GAME.orbital_choices[ante][typ] = G.rng.element(poker_hands, G.rng.pseudoseed("orbital"));
    }
    GAME.round_resets.blind_ante = GAME.round_resets.blind_ante || GAME.round_resets.ante;
  },

  select_blind(this: Game) {
    const G = this;
    if (!(G.STATE === STATES.BLIND_SELECT && G.blind_select != null))
      throw new Error("not selecting a blind");
    const GAME = G.GAME;
    GAME.facing_blind = true;
    const blind = G.P_BLINDS[GAME.round_resets.blind_choices[GAME.blind_on_deck]];

    const ev = () => {
      G.ease_round(1);
      GAME.round_resets.blind = blind;
      GAME.round_resets.blind_states[GAME.blind_on_deck] = "Current";
      G.blind_select = undefined;
    };
    G.add_event(ev);
    G.add_event(() => G.new_round());
    G.advance();
  },

  skip_blind(this: Game) {
    const G = this;
    if (!(G.STATE === STATES.BLIND_SELECT && G.blind_select != null))
      throw new Error("not selecting a blind");
    const GAME = G.GAME;
    const tag = G.blind_select.tags[GAME.blind_on_deck];
    if (tag == null) throw new Error("this blind can't be skipped");
    GAME.skips = (GAME.skips || 0) + 1;
    G.add_tag(tag);
    const skipped = GAME.blind_on_deck || "Small";
    const skip_to = GAME.blind_on_deck === "Small" ? "Big" : "Boss";
    GAME.round_resets.blind_states[skipped] = "Skipped";
    GAME.round_resets.blind_states[skip_to] = "Select";
    GAME.blind_on_deck = skip_to;

    const ev = () => {
      for (const j of G.jokers!.cards.slice()) j.calculate_joker({ skip_blind: true });
      for (const t of GAME.tags.slice()) t.apply_to_run({ type: "immediate" });
      for (const t of GAME.tags.slice()) {
        if (t.apply_to_run({ type: "new_blind_choice" })) break;
      }
    };
    G.add_event(ev);
    G.advance();
  },

  reroll_boss(this: Game, _from_ui = true) {
    const G = this;
    const GAME = G.GAME;
    GAME.round_resets.boss_rerolled = true;
    if (!G.from_boss_tag) G.ease_dollars(-10);
    G.from_boss_tag = undefined;

    const ev = () => {
      GAME.round_resets.blind_choices.Boss = G.get_new_boss();
      G.create_blind_choice("Boss");
      for (const t of GAME.tags.slice()) {
        if (t.apply_to_run({ type: "new_blind_choice" })) break;
      }
    };
    G.add_event(ev);
    if (_from_ui) G.advance();
  },

  can_reroll_boss(this: Game) {
    const GAME = this.GAME;
    return (
      GAME.dollars - GAME.bankrupt_at - 10 >= 0 &&
      Boolean(
        GAME.used_vouchers.v_retcon ||
        (GAME.used_vouchers.v_directors_cut && !GAME.round_resets.boss_rerolled),
      )
    );
  },

  // ============================================================ new round
  new_round(this: Game) {
    const G = this;
    const GAME = G.GAME;

    const ev = () => {
      const cr = GAME.current_round;
      const rr = GAME.round_resets;
      cr.discards_left = Math.max(0, rr.discards + GAME.round_bonus.discards);
      cr.hands_left = Math.max(1, rr.hands + GAME.round_bonus.next_hands);
      cr.hands_played = 0;
      cr.discards_used = 0;
      cr.reroll_cost_increase = 0;
      cr.used_packs = {};
      for (const h of Object.values<T>(GAME.hands)) h.played_this_round = 0;
      for (const v of G.playing_cards) delete v.ability.wheel_flipped;
      cr.free_rerolls = G.find_joker("Chaos the Clown").length;
      G.calculate_reroll_cost(true);
      GAME.round_bonus.next_hands = 0;
      GAME.round_bonus.discards = 0;
      let blhash: string;
      if (rr.blind === G.P_BLINDS.bl_small) {
        rr.blind_states.Small = "Current";
        GAME.current_boss_streak = 0;
        blhash = "S";
      } else if (rr.blind === G.P_BLINDS.bl_big) {
        rr.blind_states.Big = "Current";
        GAME.current_boss_streak = 0;
        blhash = "B";
      } else {
        rr.blind_states.Boss = "Current";
        blhash = "L";
      }
      GAME.subhash = lua_tostring(rr.ante) + blhash;
      GAME.blind.set_blind(rr.blind);
      for (const j of G.jokers!.cards.slice())
        j.calculate_joker({ setting_blind: true, blind: rr.blind });

      const ev2 = () => {
        G.STATE = STATES.DRAW_TO_HAND;
        G.deck!.shuffle("nr" + lua_tostring(rr.ante));
        G.STATE_COMPLETE = false;
      };
      G.add_event(ev2);
    };
    G.add_event(ev);
  },

  // ========================================================= draw/discard
  draw_from_deck_to_hand(this: Game, e?: number) {
    const G = this;
    const S = STATES;
    if (
      G.STATE !== S.TAROT_PACK &&
      G.STATE !== S.SPECTRAL_PACK &&
      G.hand!.config.card_limit <= 0 &&
      G.hand!.cards.length === 0
    ) {
      G.STATE = S.GAME_OVER;
      G.STATE_COMPLETE = false;
      return true;
    }
    let hand_space =
      e ?? Math.min(G.deck!.cards.length, G.hand!.config.card_limit - G.hand!.cards.length);
    const bl = G.GAME.blind;
    const cr = G.GAME.current_round;
    if (bl.name === "The Serpent" && !bl.disabled && (cr.hands_played > 0 || cr.discards_used > 0))
      hand_space = Math.min(G.deck!.cards.length, 3);
    for (let i = 0; i < hand_space; i++) G.draw_card(G.deck, G.hand!, undefined, true);
    return undefined;
  },

  discard_cards_from_highlighted(this: Game, _e?: unknown, hook = false) {
    const G = this;
    const GAME = G.GAME;
    for (const v of G.playing_cards) delete v.ability.forced_selection;
    const highlighted_count = Math.min(
      G.hand!.highlighted.length,
      G.discard!.config.card_limit - G.play!.cards.length,
    );
    if (highlighted_count > 0) {
      G.hand!.highlighted.sort((a: Card, b: Card) => G.hand!.index(a) - G.hand!.index(b));
      const hl = G.hand!.highlighted;
      for (const j of G.jokers!.cards.slice())
        j.calculate_joker({ pre_discard: true, full_hand: hl, hook });
      const cards: Card[] = [];
      const destroyed_cards: Card[] = [];
      for (let i = 0; i < highlighted_count; i++) {
        const c = hl[i]!;
        c.calculate_seal({ discard: true });
        let removed = false;
        for (const j of G.jokers!.cards.slice()) {
          const ev = j.calculate_joker({ discard: true, other_card: c, full_hand: hl });
          // calculate_joker only returns `true` for destroying_card, so a table check is `if ev:`
          if (typeof ev === "object") {
            if (ev.remove) removed = true;
          }
        }
        cards.push(c);
        if (removed) {
          destroyed_cards.push(c);
          if (c.ability.name === "Glass Card") c.shatter();
          else c.start_dissolve();
        } else {
          c.ability.discarded = true;
          G.draw_card(G.hand, G.discard!, c);
        }
      }
      if (destroyed_cards.length > 0) {
        for (const j of G.jokers!.cards.slice())
          eval_card(G, j, {
            cardarea: G.jokers,
            remove_playing_cards: true,
            removed: destroyed_cards,
          });
      }
      GAME.round_scores.cards_discarded.amt += cards.length;
      if (!hook) {
        if (GAME.modifiers.discard_cost) G.ease_dollars(-GAME.modifiers.discard_cost);
        G.ease_discard(-1);
        GAME.current_round.discards_used += 1;
        G.STATE = STATES.DRAW_TO_HAND;

        const ev2 = () => {
          G.STATE_COMPLETE = false;
        };
        G.add_event(ev2);
      }
    }
  },

  play_cards_from_highlighted(this: Game, _e?: unknown) {
    const G = this;
    const GAME = G.GAME;
    if (G.play!.cards.length > 0) return;
    GAME.blind.triggered = false;
    for (const v of G.playing_cards) delete v.ability.forced_selection;
    G.hand!.highlighted.sort((a: Card, b: Card) => G.hand!.index(a) - G.hand!.index(b));

    const ev0 = () => {
      G.STATE = STATES.HAND_PLAYED;
      G.STATE_COMPLETE = true;
    };
    G.add_event(ev0);
    G.ease_hands_played(-1);
    for (const c of G.hand!.highlighted.slice()) {
      c.base.times_played += 1;
      c.ability.played_this_ante = true;
      GAME.round_scores.cards_played.amt += 1;
      G.draw_card(G.hand, G.play!, c);
    }
    GAME.blind.press_play();

    const ev1 = () => {
      G.add_event(() => G.evaluate_play());

      const ev2 = () => {
        G.draw_from_play_to_discard();
        GAME.hands_played += 1;
        GAME.current_round.hands_played += 1;
      };
      G.add_event(ev2);

      const ev3 = () => {
        G.STATE_COMPLETE = false;
      };
      G.add_event(ev3);
    };
    G.add_event(ev1);
  },

  draw_from_play_to_discard(this: Game) {
    const G = this;
    for (const v of G.play!.cards.slice()) {
      if (!v.shattered && !v.destroyed) G.draw_card(G.play, G.discard!, v);
    }
  },

  draw_from_play_to_hand(this: Game, cards: Card[]) {
    const G = this;
    for (const c of cards) {
      if (!c.shattered && !c.destroyed) G.draw_card(G.play, G.hand!, c, true);
    }
  },

  draw_from_discard_to_deck(this: Game) {
    const G = this;

    const ev = () => {
      const n = G.discard!.cards.length;
      for (let i = 0; i < n; i++) G.draw_card(G.discard, G.deck!);
    };
    G.add_event(ev);
  },

  draw_from_hand_to_deck(this: Game) {
    const G = this;
    const n = G.hand!.cards.length;
    for (let i = 0; i < n; i++) G.draw_card(G.hand, G.deck!);
  },

  draw_from_hand_to_discard(this: Game) {
    const G = this;
    const n = G.hand!.cards.length;
    for (let i = 0; i < n; i++) G.draw_card(G.hand, G.discard!);
  },

  // ============================================================== scoring
  evaluate_play(this: Game) {
    const G = this;
    const GAME = G.GAME;
    const [text, disp_text, poker_hands, scoring_hand] = get_poker_hand_info(G, G.play!.cards);
    const hand = GAME.hands[text];
    hand.played += 1;
    hand.played_this_round += 1;
    GAME.last_hand_played = text;
    GAME.hand_usage[text] = (GAME.hand_usage[text] || 0) + 1;
    hand.visible = true;

    const splash = G.find_joker("Splash").length > 0;
    const pures: Card[] = [];
    for (let i = 0; i < G.play!.cards.length; i++) {
      const c = G.play!.cards[i]!;
      if (splash) {
        if (i < scoring_hand.length) scoring_hand[i] = c;
        else scoring_hand.push(c);
      } else if (c.ability.effect === "Stone Card") {
        if (!scoring_hand.includes(c)) pures.push(c);
      }
    }
    scoring_hand.push(...pures);
    scoring_hand.sort((a: Card, b: Card) => G.play!.index(a) - G.play!.index(b));
    G.last_scoring = { text, disp_text, scoring: scoring_hand.slice() };

    const ctx_base = {
      full_hand: G.play!.cards,
      scoring_hand,
      scoring_name: text,
      poker_hands,
    };
    let mult = 0.0;
    let hand_chips = 0.0;
    if (!GAME.blind.debuff_hand(G.play!.cards, poker_hands, text)) {
      mult = mod_mult(hand.mult);
      hand_chips = mod_chips(G, hand.chips);
      if (GAME.first_used_hand_level && GAME.first_used_hand_level > 0) {
        G.level_up_hand(undefined, text, undefined, GAME.first_used_hand_level);
        delete GAME.first_used_hand_level;
      }
      for (const j of G.jokers!.cards.slice()) {
        const effects = eval_card(G, j, { cardarea: G.jokers, before: true, ...ctx_base });
        if (effects.jokers) {
          // via card_eval_status_text
          if (effects.jokers.playing_cards_created)
            G.playing_card_joker_effects(effects.jokers.playing_cards_created);
          if (effects.jokers.level_up) G.level_up_hand(j, text);
        }
      }
      mult = mod_mult(hand.mult);
      hand_chips = mod_chips(G, hand.chips);
      [mult, hand_chips] = GAME.blind.modify_hand(
        G.play!.cards,
        poker_hands,
        text,
        mult,
        hand_chips,
      );
      [mult, hand_chips] = [mod_mult(mult), mod_chips(G, hand_chips)];

      // --- played cards
      for (const c of scoring_hand) {
        if (c.ability.effect !== "Stone Card") {
          const cp = GAME.cards_played[c.base.value];
          cp.total += 1;
          cp.suits[c.base.suit] = true;
        }
        if (c.debuff) {
          GAME.blind.triggered = true;
          continue;
        }
        const reps: (number | T)[] = [1];
        const ev = eval_card(G, c, {
          repetition_only: true,
          cardarea: G.play,
          repetition: true,
          ...ctx_base,
        });
        if (nonempty(ev)) {
          for (let r = 0; r < ev.seals.repetitions; r++) reps.push(ev);
        }
        for (const j of G.jokers!.cards.slice()) {
          const ev = eval_card(G, j, {
            cardarea: G.play,
            other_card: c,
            repetition: true,
            ...ctx_base,
          });
          if (nonempty(ev) && ev.jokers) {
            for (let r = 0; r < ev.jokers.repetitions; r++) reps.push(ev);
          }
        }
        for (let _r = 0; _r < reps.length; _r++) {
          const effects: T[] = [
            eval_card(G, c, {
              cardarea: G.play,
              full_hand: G.play!.cards,
              scoring_hand,
              poker_hand: text,
            }),
          ];
          for (const j of G.jokers!.cards.slice()) {
            const ev = j.calculate_joker({
              cardarea: G.play,
              other_card: c,
              individual: true,
              ...ctx_base,
            });
            if (typeof ev === "object") effects.push(ev);
          }
          c.lucky_trigger = undefined;
          for (const eff of effects) {
            if (eff.chips) hand_chips = mod_chips(G, hand_chips + eff.chips);
            if (eff.mult) mult = mod_mult(mult + eff.mult);
            if (eff.p_dollars) G.ease_dollars(eff.p_dollars);
            if (eff.dollars) G.ease_dollars(eff.dollars);
            if (eff.extra) {
              const ex = eff.extra;
              if (ex.mult_mod) mult = mod_mult(mult + ex.mult_mod);
              if (ex.chip_mod) hand_chips = mod_chips(G, hand_chips + ex.chip_mod);
              if (ex.swap) {
                const old_mult = mult;
                mult = mod_mult(hand_chips);
                hand_chips = mod_chips(G, old_mult);
              }
              if (ex.func) ex.func();
            }
            if (eff.x_mult) mult = mod_mult(mult * eff.x_mult);
            if (eff.edition) {
              const ed = eff.edition;
              hand_chips = mod_chips(G, hand_chips + (ed.chip_mod || 0));
              mult = mult + (ed.mult_mod || 0);
              mult = mod_mult(mult * (ed.x_mult_mod || 1));
            }
          }
        }
      }

      // --- cards held in hand
      for (const hc of G.hand!.cards.slice()) {
        const reps: (number | T)[] = [1];
        let k = 0;
        while (k < reps.length) {
          const effects: T[] = [eval_card(G, hc, { cardarea: G.hand, ...ctx_base })];
          for (const j of G.jokers!.cards.slice()) {
            const ev = j.calculate_joker({
              cardarea: G.hand,
              other_card: hc,
              individual: true,
              ...ctx_base,
            });
            if (typeof ev === "object") effects.push(ev);
          }
          if (reps[k] === 1) {
            const ev = eval_card(G, hc, {
              repetition_only: true,
              cardarea: G.hand,
              repetition: true,
              card_effects: effects,
              ...ctx_base,
            });
            if (nonempty(ev) && (nonempty(effects[0]) || effects.length > 1)) {
              for (let r = 0; r < ev.seals.repetitions; r++) reps.push(ev);
            }
            for (const j of G.jokers!.cards.slice()) {
              const ev = eval_card(G, j, {
                cardarea: G.hand,
                other_card: hc,
                repetition: true,
                card_effects: effects,
                ...ctx_base,
              });
              if (nonempty(ev)) {
                for (let r = 0; r < ev.jokers.repetitions; r++) reps.push(ev);
              }
            }
          }
          for (const eff of effects) {
            if (eff.dollars) G.ease_dollars(eff.dollars);
            if (eff.h_mult) mult = mod_mult(mult + eff.h_mult);
            if (eff.x_mult) mult = mod_mult(mult * eff.x_mult);
          }
          k += 1;
        }
      }

      // --- jokers (and consumables: Observatory planets)
      const nj = G.jokers!.cards.length;
      const n = nj + G.consumeables!.cards.length;
      for (let i = 0; i < n; i++) {
        const _card =
          i < G.jokers!.cards.length
            ? G.jokers!.cards[i]!
            : G.consumeables!.cards[i - G.jokers!.cards.length]!;
        const edition_effects = eval_card(G, _card, {
          cardarea: G.jokers,
          edition: true,
          ...ctx_base,
        });
        if (edition_effects.jokers) {
          edition_effects.jokers.edition = true;
          if (edition_effects.jokers.chip_mod)
            hand_chips = mod_chips(G, hand_chips + edition_effects.jokers.chip_mod);
          if (edition_effects.jokers.mult_mod)
            mult = mod_mult(mult + edition_effects.jokers.mult_mod);
        }
        const effects = eval_card(G, _card, { cardarea: G.jokers, joker_main: true, ...ctx_base });
        if (effects.jokers) {
          const ej = effects.jokers;
          if (ej.mult_mod) mult = mod_mult(mult + ej.mult_mod);
          if (ej.chip_mod) hand_chips = mod_chips(G, hand_chips + ej.chip_mod);
          if (ej.Xmult_mod) mult = mod_mult(mult * ej.Xmult_mod);
        }
        for (const v of G.jokers!.cards.slice()) {
          const effect = v.calculate_joker({ other_joker: _card, ...ctx_base });
          if (typeof effect === "object") {
            if (effect.mult_mod) mult = mod_mult(mult + effect.mult_mod);
            if (effect.chip_mod) hand_chips = mod_chips(G, hand_chips + effect.chip_mod);
            if (effect.Xmult_mod) mult = mod_mult(mult * effect.Xmult_mod);
          }
        }
        if (edition_effects.jokers) {
          if (edition_effects.jokers.x_mult_mod)
            mult = mod_mult(mult * edition_effects.jokers.x_mult_mod);
        }
      }

      const res = GAME.selected_back.trigger_effect({
        context: "final_scoring_step",
        chips: hand_chips,
        mult,
      });
      if (res) {
        const [nu_chip, nu_mult] = res;
        mult = mod_mult(nu_mult ?? mult);
        hand_chips = mod_chips(G, nu_chip ?? hand_chips);
      }

      const cards_destroyed: Card[] = [];
      for (const c of scoring_hand) {
        let destroyed;
        for (const j of G.jokers!.cards.slice()) {
          destroyed = j.calculate_joker({ destroying_card: c, full_hand: G.play!.cards });
          if (destroyed) break;
        }
        if (
          c.ability.name === "Glass Card" &&
          !c.debuff &&
          G.rng.random("glass") < GAME.probabilities.normal / c.ability.extra
        )
          destroyed = true;
        if (destroyed) {
          if (c.ability.name === "Glass Card") c.shattered = true;
          else c.destroyed = true;
          cards_destroyed.push(c);
        }
      }
      for (const j of G.jokers!.cards.slice())
        eval_card(G, j, {
          cardarea: G.jokers,
          remove_playing_cards: true,
          removed: cards_destroyed,
        });
      for (const c of cards_destroyed) {
        const kill = () => {
          if (c.ability.name === "Glass Card") c.shatter();
          else c.start_dissolve();
        };
        G.add_event(kill);
      }
    } else {
      mult = mod_mult(0);
      hand_chips = mod_chips(G, 0);
      for (const j of G.jokers!.cards.slice())
        eval_card(G, j, { cardarea: G.jokers, debuffed_hand: true, ...ctx_base });
    }

    const score = floor(hand_chips * mult);
    G.last_score = { chips: hand_chips, mult, score, hand: text };
    const chips_before = GAME.chips;

    const add_chips = () => {
      GAME.chips = chips_before + score;
    };
    G.add_event(add_chips);
    // Python max(): the first argument wins unless the second is larger, so NaN never wins
    const hand_score = hand_chips * mult;
    GAME.round_scores.hand.amt =
      hand_score > GAME.round_scores.hand.amt ? hand_score : GAME.round_scores.hand.amt;

    for (const j of G.jokers!.cards.slice())
      eval_card(G, j, { cardarea: G.jokers, after: true, ...ctx_base });

    const ev_debuff = () => {
      if (GAME.modifiers.debuff_played_cards) {
        for (const c of scoring_hand) c.ability.perma_debuff = true;
      }
    };
    G.add_event(ev_debuff);
  },

  // ============================================================ end round
  end_round(this: Game) {
    const G = this;
    const GAME = G.GAME;

    const ev = () => {
      G.run_deferred_one_frame(); // see update_hand_played
      let game_over = true;
      if (GAME.chips - GAME.blind.chips >= 0) game_over = false;
      for (const j of G.jokers!.cards.slice()) {
        const ret = j.calculate_joker({ end_of_round: true, game_over });
        if (typeof ret === "object" && ret.saved) game_over = false;
        j.calculate_rental();
        j.calculate_perishable();
      }
      if (GAME.round_resets.ante === GAME.win_ante && GAME.blind.get_type() === "Boss")
        GAME.won = true;
      if (game_over) {
        G.STATE = STATES.GAME_OVER;
        G.STATE_COMPLETE = false;
        return;
      }
      GAME.unused_discards = (GAME.unused_discards || 0) + GAME.current_round.discards_left;
      if (GAME.blind.get_type() === "Boss") {
        let handname = "High Card";
        let played = -1;
        for (const k of G.hands_order()) {
          const v = GAME.hands[k];
          // the Lua compares against an `_order` that is never
          // updated, so ties go to the *last* hand in pairs() order
          if (v.played > played || (v.played === played && 100 > v.order)) {
            played = v.played;
            handname = k;
          }
        }
        GAME.current_round.most_played_poker_hand = handname;
      }
      // end of round effects of cards held in hand
      for (const hc of G.hand!.cards.slice()) {
        const reps: (number | T)[] = [1];
        let k = 0;
        while (k < reps.length) {
          const effects: T[] = [hc.get_end_of_round_effect()];
          for (const j of G.jokers!.cards.slice()) {
            const ev_ = j.calculate_joker({
              cardarea: G.hand,
              other_card: hc,
              individual: true,
              end_of_round: true,
            });
            if (typeof ev_ === "object") effects.push(ev_);
          }
          if (reps[k] === 1) {
            const ev_ = eval_card(G, hc, {
              end_of_round: true,
              cardarea: G.hand,
              repetition: true,
              repetition_only: true,
            });
            if (nonempty(ev_) && (nonempty(effects[0]) || effects.length > 1)) {
              for (let r = 0; r < ev_.seals.repetitions; r++) reps.push(ev_);
            }
            for (const j of G.jokers!.cards.slice()) {
              const ev_ = eval_card(G, j, {
                cardarea: G.hand,
                other_card: hc,
                repetition: true,
                end_of_round: true,
                card_effects: effects,
              });
              if (nonempty(ev_)) {
                for (let r = 0; r < ev_.jokers.repetitions; r++) reps.push(ev_);
              }
            }
          }
          for (const eff of effects) {
            if (eff.h_dollars) G.ease_dollars(eff.h_dollars);
          }
          k += 1;
        }
      }
      G.draw_from_hand_to_discard();
      if (GAME.blind.get_type() === "Boss") {
        delete GAME.voucher_restock;
        if (
          GAME.modifiers.set_eternal_ante &&
          GAME.round_resets.ante === GAME.modifiers.set_eternal_ante
        ) {
          for (const j of G.jokers!.cards) j.set_eternal(true);
        }
        if (
          GAME.modifiers.set_joker_slots_ante &&
          GAME.round_resets.ante === GAME.modifiers.set_joker_slots_ante
        )
          G.jokers!.config.card_limit = 0;
        G.ease_ante(1);
      }
      G.draw_from_discard_to_deck();

      const ev2 = () => {
        G.STATE = STATES.ROUND_EVAL;
        G.STATE_COMPLETE = false;
        const rr = GAME.round_resets;
        if (rr.blind === G.P_BLINDS.bl_small) {
          rr.blind_states.Small = "Defeated";
        } else if (rr.blind === G.P_BLINDS.bl_big) {
          rr.blind_states.Big = "Defeated";
        } else {
          GAME.current_round.voucher = G.get_next_voucher_key();
          rr.blind_states.Boss = "Defeated";
          for (const v of G.playing_cards) delete v.ability.played_this_ante;
        }
        if (rr.temp_handsize) {
          G.hand!.change_size(-rr.temp_handsize);
          delete rr.temp_handsize;
        }
        if (rr.temp_reroll_cost != null) {
          delete rr.temp_reroll_cost;
          G.calculate_reroll_cost(true);
        }
        G.reset_idol_card();
        G.reset_mail_rank();
        G.reset_ancient_card();
        G.reset_castle_card();
        for (const v of G.playing_cards) {
          delete v.ability.discarded;
          delete v.ability.forced_selection;
        }
      };
      G.add_event(ev2);
    };
    G.add_event(ev);
  },

  evaluate_round(this: Game) {
    const G = this;
    const GAME = G.GAME;
    let dollars = 0;
    const rows: [string, number][] = [];
    if (GAME.chips - GAME.blind.chips >= 0) {
      rows.push(["blind", GAME.blind.dollars]);
      dollars += GAME.blind.dollars;
    }
    const blind = GAME.blind;
    G.add_event(() => blind.defeat());
    GAME.selected_back.trigger_effect({ context: "eval" });
    const cr = GAME.current_round;
    if (cr.hands_left > 0 && !GAME.modifiers.no_extra_hand_money) {
      const v = cr.hands_left * (GAME.modifiers.money_per_hand || 1);
      rows.push(["hands", v]);
      dollars += v;
    }
    if (cr.discards_left > 0 && GAME.modifiers.money_per_discard) {
      const v = cr.discards_left * GAME.modifiers.money_per_discard;
      rows.push(["discards", v]);
      dollars += v;
    }
    for (const j of G.jokers!.cards.slice()) {
      const ret = j.calculate_dollar_bonus();
      if (ret) {
        rows.push([`joker:${j.key}`, ret]);
        dollars += ret;
      }
    }
    for (const t of GAME.tags.slice()) {
      const ret = t.apply_to_run({ type: "eval" });
      if (ret) {
        rows.push([`tag:${t.key}`, ret.dollars]);
        dollars += ret.dollars;
      }
    }
    if (GAME.dollars >= 5 && !GAME.modifiers.no_interest) {
      const v =
        GAME.interest_amount * Math.min(Math.floor(GAME.dollars / 5), GAME.interest_cap / 5);
      rows.push(["interest", v]);
      dollars += v;
    }
    G.round_eval_rows = rows;

    const set_total = () => {
      GAME.current_round.dollars = dollars;
    };
    G.add_event(set_total);
  },

  cash_out(this: Game) {
    const G = this;
    const GAME = G.GAME;
    if (!(G.STATE === STATES.ROUND_EVAL && G.round_eval != null))
      throw new Error("not at round evaluation");
    G.deck!.shuffle("cashout" + lua_tostring(GAME.round_resets.ante));

    const ev = () => {
      G.round_eval = undefined;
      const cr = GAME.current_round;
      cr.jokers_purchased = 0;
      cr.discards_left = Math.max(0, GAME.round_resets.discards + GAME.round_bonus.discards);
      cr.hands_left = Math.max(1, GAME.round_resets.hands + GAME.round_bonus.next_hands);
      G.STATE = STATES.SHOP;
      delete GAME.shop_free;
      delete GAME.shop_d6ed;
      G.STATE_COMPLETE = false;
    };
    G.add_event(ev);
    G.ease_dollars(GAME.current_round.dollars);

    const ev2 = () => {
      GAME.previous_round.dollars = GAME.dollars;
    };
    G.add_event(ev2);
    G.ease_chips(0);
    if (GAME.round_resets.blind_states.Boss === "Defeated") {
      GAME.round_resets.blind_ante = GAME.round_resets.ante;
      GAME.round_resets.blind_tags.Small = G.get_next_tag_key();
      GAME.round_resets.blind_tags.Big = G.get_next_tag_key();
    }
    G.reset_blinds();
    G.advance();
  },
};
