// evaluate_poker_hand & friends (misc_functions.lua) and get_poker_hand_info.
// Ported from ArnoStar/BalatroEngine (balatro/poker.py).

import type { Card } from "./card.ts";
import type { Game } from "./game.ts";

export const HANDS_ORDER = [
  "Flush Five",
  "Flush House",
  "Five of a Kind",
  "Straight Flush",
  "Four of a Kind",
  "Full House",
  "Flush",
  "Straight",
  "Three of a Kind",
  "Two Pair",
  "Pair",
  "High Card",
];

/** Hand name -> groups of cards making that hand (plus `top`, the best one found). */
export type PokerHands = Record<string, Card[][]>;

export const get_flush = (G: Game, hand: Card[]): Card[][] => {
  const four_fingers = G.find_joker("Four Fingers").length > 0;
  const need = 5 - (four_fingers ? 1 : 0);
  if (hand.length > 5 || hand.length < need) return [];
  for (const suit of ["Spades", "Hearts", "Clubs", "Diamonds"]) {
    const t = hand.filter((c) => c.is_suit(suit, undefined, true));
    if (t.length >= need) return [t];
  }
  return [];
};

export const get_straight = (G: Game, hand: Card[]): Card[][] => {
  const four_fingers = G.find_joker("Four Fingers").length > 0;
  const need = 5 - (four_fingers ? 1 : 0);
  if (hand.length > 5 || hand.length < need) return [];
  let t: Card[] = [];
  const ids = new Map<number, Card[]>();
  for (const c of hand) {
    const cid = c.get_id();
    if (1 < cid && cid < 15) {
      const list = ids.get(cid);
      if (list) list.push(c);
      else ids.set(cid, [c]);
    }
  }
  let straight_length = 0;
  let straight = false;
  const can_skip = G.find_joker("Shortcut").length > 0;
  let skipped_rank = false;
  for (let j = 1; j < 15; j++) {
    const key = j === 1 ? 14 : j;
    const group = ids.get(key);
    if (group) {
      straight_length += 1;
      skipped_rank = false;
      t.push(...group);
    } else if (can_skip && !skipped_rank && j !== 14) {
      skipped_rank = true;
    } else {
      straight_length = 0;
      skipped_rank = false;
      if (!straight) t = [];
      if (straight) break;
    }
    if (straight_length >= need) straight = true;
  }
  if (!straight) return [];
  return [t];
};

export const get_X_same = (num: number, hand: Card[]): Card[][] => {
  const vals = new Map<number, Card[]>();
  const ids = hand.map((c) => c.get_id()); // note: Stone cards get unique negative ids
  for (let i = hand.length - 1; i >= 0; i--) {
    const curr = [hand[i]!];
    for (let j = 0; j < hand.length; j++) if (ids[i] === ids[j] && i !== j) curr.push(hand[j]!);
    if (curr.length === num) vals.set(ids[i]!, curr);
  }
  const ret: Card[][] = [];
  for (let i = 14; i > 0; i--) {
    const v = vals.get(i);
    if (v && v.length > 0) ret.push(v);
  }
  return ret;
};

export const get_highest = (hand: Card[]): Card[][] => {
  let highest: Card | undefined;
  for (const c of hand) if (highest == null || c.get_nominal() > highest.get_nominal()) highest = c;
  return highest != null ? [[highest]] : [];
};

export const evaluate_poker_hand = (G: Game, hand: Card[]) => {
  const results: PokerHands = {};
  for (const h of HANDS_ORDER) results[h] = [];
  const p5 = get_X_same(5, hand);
  const p4 = get_X_same(4, hand);
  const p3 = get_X_same(3, hand);
  const p2 = get_X_same(2, hand);
  const flush = get_flush(G, hand);
  const straight = get_straight(G, hand);
  const highest = get_highest(hand);
  // every group assigned below is non-empty, so `top or x` == `top ?? x`
  let top: Card[][] | undefined;

  if (p5.length > 0 && flush.length > 0) {
    results["Flush Five"] = p5;
    top ??= results["Flush Five"];
  }
  if (p3.length > 0 && p2.length > 0 && flush.length > 0) {
    results["Flush House"]!.push([...p3[0]!, ...p2[0]!]);
    top ??= results["Flush House"];
  }
  if (p5.length > 0) {
    results["Five of a Kind"] = p5;
    top ??= results["Five of a Kind"];
  }
  if (flush.length > 0 && straight.length > 0) {
    const ret = [...flush[0]!];
    for (const v of straight[0]!) if (!flush[0]!.includes(v)) ret.push(v);
    results["Straight Flush"] = [ret];
    top ??= results["Straight Flush"];
  }
  if (p4.length > 0) {
    results["Four of a Kind"] = p4;
    top ??= results["Four of a Kind"];
  }
  if (p3.length > 0 && p2.length > 0) {
    results["Full House"]!.push([...p3[0]!, ...p2[0]!]);
    top ??= results["Full House"];
  }
  if (flush.length > 0) {
    results["Flush"] = flush;
    top ??= results["Flush"];
  }
  if (straight.length > 0) {
    results["Straight"] = straight;
    top ??= results["Straight"];
  }
  if (p3.length > 0) {
    results["Three of a Kind"] = p3;
    top ??= results["Three of a Kind"];
  }
  if (p2.length === 2 || (p3.length === 1 && p2.length === 1)) {
    const a = p2[0]!;
    const b = p2.length > 1 ? p2[1]! : p3[0]!;
    results["Two Pair"]!.push([...a, ...b]);
    top ??= results["Two Pair"];
  }
  if (p2.length > 0) {
    results["Pair"] = p2;
    top ??= results["Pair"];
  }
  if (highest.length > 0) {
    results["High Card"] = highest;
    top ??= results["High Card"];
  }

  // these keep at most 4/3/2 groups of the larger set (Lua builds sparse lists)
  if (results["Five of a Kind"]!.length > 0)
    results["Four of a Kind"] = results["Five of a Kind"]!.slice(0, 4);
  if (results["Four of a Kind"]!.length > 0)
    results["Three of a Kind"] = results["Four of a Kind"]!.slice(0, 3);
  if (results["Three of a Kind"]!.length > 0)
    results["Pair"] = results["Three of a Kind"]!.slice(0, 2);
  if (top !== undefined) results.top = top;
  return results;
};

export const get_poker_hand_info = (G: Game, cards: Card[]) => {
  const poker_hands = evaluate_poker_hand(G, cards);
  let scoring_hand: Card[] = [];
  let text = "NULL";
  for (const h of HANDS_ORDER) {
    if (poker_hands[h]!.length > 0) {
      text = h;
      scoring_hand = [...poker_hands[h]![0]!];
      break;
    }
  }
  let disp_text = text;
  if (text === "Straight Flush") {
    let mn = 10;
    for (const c of scoring_hand) {
      const cid = c.get_id();
      if (cid < mn) mn = cid;
    }
    if (mn >= 10) disp_text = "Royal Flush";
  }
  return [text, disp_text, poker_hands, scoring_hand, disp_text] as const;
};
