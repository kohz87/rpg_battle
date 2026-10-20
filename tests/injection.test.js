// The next reply's prompt laid out for prompt caching (src/injection.js, 0.5.41).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NARRATING_INSTRUCTION, STORY_INSTRUCTION } from '../src/story.js';
import { OLD_PROMPT_KEYS, STATIC_PROMPT_KEY, TAIL_PROMPT_KEY, UNDER_WAY_LINE, promptLayout } from '../src/injection.js';

test('the story instruction is the same, byte for byte, whatever changes from reply to reply', () => {
    const first = promptLayout({ story: true, foes: 'Foes this story has met (the same creature keeps its name): Wolf.', purse: 'Purse: 6 silver in all; …' });
    const second = promptLayout({ story: true, handoff: 'Battle resolved by RPG Battle: …', trade: '[Trade] Since the last reply, Ren sold …', item: '[Item] Ren uses …', foes: 'Foes this story has met (the same creature keeps its name): Wolf, Rat.', lasting: 'Lasting conditions: Ren poisoned. …', purse: 'Purse: 9 silver in all; …' });
    const fighting = promptLayout({ story: true, underWay: true });
    assert.equal(first.staticText, STORY_INSTRUCTION);
    assert.equal(second.staticText, first.staticText);
    assert.equal(fighting.staticText, first.staticText);
    // Nothing that changes is in it.
    for (const changing of ['Foes this story has met', 'Purse:', 'Lasting conditions', 'Battle resolved', '[Trade]', '[Item]']) assert.ok(!first.staticText.includes(changing), changing);
    assert.equal(promptLayout({ story: false }).staticText, '');
});

test('everything that changes goes in one note at the end, in a fixed order', () => {
    const layout = promptLayout({ story: true, handoff: 'H', trade: 'T', item: 'I', foes: 'F', lasting: 'L', purse: 'P' });
    assert.deepEqual(layout.tail.map(part => part.label), ['Fight hand-off', 'Narrating', 'Trade note', 'Item note', 'Foes met', 'Lasting conditions', 'Purse']);
    assert.equal(layout.tailText, ['H', NARRATING_INSTRUCTION, 'T', 'I', 'F', 'L', 'P'].join('\n\n'));
    // A fight being fought: the story is told to keep out of it, and nothing else of the story's.
    assert.deepEqual(promptLayout({ story: true, underWay: true, foes: 'F', purse: 'P' }).tail.map(part => part.text), [UNDER_WAY_LINE]);
    // Nothing to tell: an empty note (the slot is emptied, so nothing spent lingers).
    assert.equal(promptLayout({ story: true }).tailText, '');
    // A trade with RPG Battle off for the story (no character yet) still goes.
    assert.equal(promptLayout({ story: false, trade: 'T', purse: 'P' }).tailText, 'T');
});

test('the slots are Story Suite\'s, and the old keys are known so they can be cleared', () => {
    assert.equal(STATIC_PROMPT_KEY, 'story_suite_static_rpg_battle');
    assert.equal(TAIL_PROMPT_KEY, 'story_suite_tail_3_rpg_battle');
    assert.deepEqual([...OLD_PROMPT_KEYS], ['rpg_battle', 'rpg_battle_rules', 'rpg_battle_trade', 'rpg_battle_item']);
});
