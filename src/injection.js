// RPG Battle: what goes into the next reply's prompt, laid out for prompt caching (pure).
//
// (0.5.41) Providers reuse the longest identical prompt prefix between requests. So the story
// instruction, the same every reply, goes early (Story Suite's static slot, right after the main
// prompt) and never carries anything that changes; everything that does (a fight's hand-off, the
// narrating line, the trade and item notes, the foes met, lasting conditions, the purse) goes in
// one note at the very end of the prompt (the suite's tail slot, depth 0), rebuilt every reply.

import { NARRATING_INSTRUCTION, STORY_INSTRUCTION } from './story.js';

export const STATIC_PROMPT_KEY = 'story_suite_static_rpg_battle';
export const TAIL_PROMPT_KEY = 'story_suite_tail_3_rpg_battle';
// Keys used before 0.5.41: cleared on load and on every reply, so no stale copy lingers.
export const OLD_PROMPT_KEYS = Object.freeze(['rpg_battle', 'rpg_battle_rules', 'rpg_battle_trade', 'rpg_battle_item']);

export const UNDER_WAY_LINE = 'A fight is under way in RPG Battle: write no <Wounds> and no <Encounter> until its result is told.';

const text = value => String(value ?? '').trim();

/**
 * The next reply's injections: { staticText, tail: [{ label, text }], tailText }.
 * `story`: whether the story instruction goes at all (RPG Battle on, a living character);
 * `underWay`: a fight is being fought; `handoff`, `trade`, `item`: the notes for this reply;
 * `foes`, `lasting`, `purse`: the lines that change with the story ('' when none).
 * The static text depends on nothing but `story`, so it is byte-identical reply after reply.
 */
export function promptLayout({ story = false, underWay = false, handoff = '', trade = '', item = '', foes = '', lasting = '', purse = '' } = {}) {
    const tail = [];
    const add = (label, value) => {
        const body = text(value);
        if (body) tail.push({ label, text: body });
    };
    add('Fight hand-off', handoff);
    if (text(handoff)) add('Narrating', NARRATING_INSTRUCTION);
    else if (story && underWay) add('Fight under way', UNDER_WAY_LINE);
    add('Trade note', trade);
    add('Item note', item);
    if (story && !underWay) {
        add('Foes met', foes);
        add('Lasting conditions', lasting);
        add('Purse', purse);
    }
    return { staticText: story ? STORY_INSTRUCTION : '', tail, tailText: tail.map(part => part.text).join('\n\n') };
}
