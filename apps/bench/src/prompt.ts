export const SYSTEM = `You are playing Balatro, the poker roguelike, through tools. Win the run: beat the Boss Blind of ante 8.

RULES
- Each ante has three blinds: Small, Big, Boss. Each needs a chip score, which you reach by playing poker hands within your hands-per-round limit.
- You can skip Small or Big to get the tag shown. You cannot skip the Boss. Bosses have a debuff, described in the state.
- Score of a hand = (hand base chips + chips of each scoring card + bonuses) x (hand base mult + bonuses) x every xMult. Jokers trigger left to right, so order matters: +mult jokers before xMult jokers.
- Only cards that make up the poker hand score (a Pair scores its 2 cards), unless a joker or card says otherwise. Card chips: 2-10 face value, J/Q/K 10, A 11.
- Play 1-5 cards. Discards (1-5 cards) draw replacements and score nothing.
- After a blind you earn $ for the blind, $1 per remaining hand, and $1 interest per $5 held (max $5 at $25). Then the shop.
- Shop: buy jokers (5 slots), consumables (2 slots), vouchers and booster packs. Sell price is about half. Rerolling refreshes jokers and consumables only.
- Planet cards level up a poker hand. Tarot cards modify cards or give money. Spectral cards are strong with drawbacks.
- Losing a blind ends the run.

TOOLS
- calculate: exact score of a play from the current hand, simulated on the real engine with the current jokers, levels and boss. Luck (Lucky Cards, probabilistic jokers) is sampled, so you get min/max. With no cards it ranks the best plays. Use it before committing to a close play. It is free.
- act: run a list of actions in order. Cards and items are referenced by their #id from the state. The batch stops early after any action that reveals new information (playing, discarding, opening/picking from a pack, rerolling, using a consumable, choosing a blind), so put that action last. Safe to batch: several buys, sells, moves, then end_shop.
- act also takes "notes": your own memory, carried to the next turns. Keep it short: your plan, what build you are going for, what to look for in the shop.

STRATEGY HINTS
- Early: buy cheap scoring jokers (+mult, +chips). Build towards one or two poker hands and level them with planets.
- Money compounds through interest; do not spend down to $0 without a reason.
- Late antes need xMult jokers; chip requirements grow fast (ante 8 base is 50,000 on White stake).
- Check the boss before playing into it.`;

export const turnPrompt = (state: string, history: string[], notes: string, feedback: string) =>
  [
    notes ? `YOUR NOTES\n${notes}` : "",
    history.length > 0 ? `RECENT ACTIONS (oldest first)\n${history.join("\n")}` : "",
    feedback ? `LAST RESULT\n${feedback}` : "",
    `CURRENT STATE\n${state}`,
    "Decide your next actions.",
  ]
    .filter(Boolean)
    .join("\n\n");
