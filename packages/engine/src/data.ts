// Static game data extracted from the original source. Ported from
// ArnoStar/BalatroEngine (balatro/data.py).

import raw from "./data/game_data.json" with { type: "json" };
import descriptions from "./data/descriptions.json" with { type: "json" };
import { copy_table, type T } from "./lua.ts";

export type Raw = typeof raw;

export class GameData {
  readonly version: string;
  readonly P_CENTERS: Record<string, T>;
  readonly P_CARDS: Record<string, T>;
  readonly P_BLINDS: Record<string, T>;
  readonly P_TAGS: Record<string, T>;
  readonly P_SEALS: Record<string, T>;
  readonly P_STAKES: Record<string, T>;
  readonly P_CENTER_POOLS: Record<string, T[]>;
  readonly P_JOKER_RARITY_POOLS: T[][];
  readonly handlist: string[];
  readonly hands_proto: Record<string, T>;
  readonly starting_params: T;
  readonly challenges: T[];
  readonly poker_hand_names: Record<string, string>;
  /** P_CARDS keys sorted the way pseudorandom_element sorts string keys. */
  readonly P_CARDS_SORTED_KEYS: string[];
  readonly by_name = new Map<string, string[]>();

  constructor(data: Raw) {
    const d: T = copy_table(data);
    this.version = d.version;
    this.P_CENTERS = d.centers;
    this.P_CARDS = d.cards;
    this.P_BLINDS = d.blinds;
    this.P_TAGS = d.tags;
    this.P_SEALS = d.seals;
    this.P_STAKES = d.stakes;
    for (const table of [this.P_CENTERS, this.P_BLINDS, this.P_TAGS, this.P_SEALS, this.P_STAKES])
      for (const [k, v] of Object.entries(table)) v.key = k;
    // pools hold the prototype objects themselves, in the game's sort order
    const pools: Record<string, T[]> = {};
    for (const [name, keys] of Object.entries<string[]>(d.center_pools)) {
      const src =
        name === "Tag"
          ? this.P_TAGS
          : name === "Seal"
            ? this.P_SEALS
            : name === "Stake"
              ? this.P_STAKES
              : this.P_CENTERS;
      pools[name] = keys.map((k) => src[k]!);
    }
    this.P_CENTER_POOLS = pools;
    this.P_JOKER_RARITY_POOLS = (d.joker_rarity_pools as string[][]).map((keys) =>
      keys.map((k) => this.P_CENTERS[k]!),
    );
    this.handlist = d.handlist;
    this.hands_proto = d.hands;
    this.starting_params = d.starting_params;
    this.challenges = d.challenges;
    this.poker_hand_names = d.poker_hand_names;
    this.P_CARDS_SORTED_KEYS = Object.keys(this.P_CARDS)
      .filter((k) => k !== "empty")
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [k, v] of Object.entries(this.P_CENTERS)) {
      if (v.name == null) continue;
      const list = this.by_name.get(v.name);
      if (list) list.push(k);
      else this.by_name.set(v.name, [k]);
    }
  }

  center_by_name(name: string) {
    return Object.values(this.P_CENTERS).find((v) => v.name === name);
  }

  challenge(cid: string) {
    const c = this.challenges.find((c) => c.id === cid);
    if (!c) throw new Error(`unknown challenge ${cid}`);
    return c;
  }

  display_name(key: string): string {
    for (const d of [this.P_CENTERS, this.P_TAGS, this.P_BLINDS]) {
      const v = d[key];
      if (v) return v.display_name ?? v.name ?? key;
    }
    return key;
  }

  /** Effect text for jokers, consumables, vouchers, tags and boss blinds (from balatro-rs, MIT). */
  description(key: string): string | undefined {
    return (descriptions as Record<string, string>)[key];
  }
}

let cached: GameData | undefined;

export const load = () => (cached ??= new GameData(raw));
