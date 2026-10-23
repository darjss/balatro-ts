import { ActionsMixin } from "./actions.ts";
import { FlowMixin } from "./flow.ts";
import { Game } from "./game.ts";
import { PacksMixin } from "./packs.ts";
import { PoolsMixin } from "./pools.ts";
import { ShopMixin } from "./shop.ts";

// The mixin modules import game.ts and game.ts would import them back. Assigning here, after every
// module has loaded, keeps the result independent of which module the cycle is entered from.
Object.assign(Game.prototype, PoolsMixin, FlowMixin, ShopMixin, PacksMixin, ActionsMixin);

export { IllegalAction } from "./actions.ts";
export { Card } from "./card.ts";
export { CardArea } from "./cardarea.ts";
export { load } from "./data.ts";
export { DECK_NAMES, Game, Profile, STAKE_NAMES, STATES, STATE_NAMES } from "./game.ts";
export { get_poker_hand_info } from "./poker.ts";
export { PseudoRandom } from "./rng.ts";
export { snapshot } from "./snapshot.ts";
