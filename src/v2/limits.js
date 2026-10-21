// The limits code holds the numbers of a thing to when they come from words or a file rather than
// from the rules (B1-5, B-b3-15): the story's notes (the item.define hook) and a character file's
// items. Pure.

import { capItem } from '../items.js';

const whole = value => Math.max(0, Math.round(Number(value) || 0));

// The most the story's own words may make a thing do (B1-5: code sets the numbers, a note's
// "heals 999999 HP" does not): the largest built-in potion's heal (a Grand Elixir, 250) and mana
// (a large tonic, 40); a thrown flask's harm no more than that heal.
export const STORY_EFFECT_MAX = Object.freeze({ heal: 250, mp: 40, damage: 250 });

/** A story's rarity word: never legendary (only a pack's own item or a fight's loot is legendary). */
export const storyRarity = rarity => (rarity === 'legendary' ? 'epic' : rarity);

/** An effect the story's words gave, held to STORY_EFFECT_MAX. */
export function capEffect(effect) {
    const out = { ...effect, heal: Math.min(STORY_EFFECT_MAX.heal, whole(effect?.heal)), mp: Math.min(STORY_EFFECT_MAX.mp, whole(effect?.mp)) };
    if (effect?.damage) out.damage = { ...effect.damage, amount: Math.min(STORY_EFFECT_MAX.damage, whole(effect.damage.amount)) };
    return out;
}

/** Stats the story's words gave a piece, capped to its rarity's budget at `level` (v1 capItem). */
export function capStats(stats, { slot, rarity, level = 1, rules }) {
    if (!stats || !Object.keys(stats).length) return stats;
    return capItem({ slot, rarity, stats }, Math.max(1, whole(level) || 1), rules).stats;
}
