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

test('a preset with its Main Prompt off still gets the static instruction, once (0.5.42)', async () => {
    const { withStaticPart } = await import('../src/injection.js');
    const { STORY_INSTRUCTION } = await import('../src/story.js');
    // Main Prompt off: SillyTavern dropped the in-prompt slot; it goes after the leading system messages.
    const off = [{ role: 'system', content: 'Character card' }, { role: 'system', content: 'World info' }, { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello.' }];
    const kept = withStaticPart(off, STORY_INSTRUCTION);
    assert.deepEqual(kept.map(message => message.role), ['system', 'system', 'system', 'user', 'assistant']);
    assert.equal(kept[2].content, STORY_INSTRUCTION);
    assert.equal(kept.filter(message => message.content.includes(STORY_INSTRUCTION)).length, 1);
    // Main Prompt on: already merged into a system message, nothing is added.
    const on = [{ role: 'system', content: `Main prompt\n${STORY_INSTRUCTION}` }, { role: 'user', content: 'Hi' }];
    assert.equal(withStaticPart(on, STORY_INSTRUCTION), on);
    // Run again on its own result: no duplicate. Nothing to keep: untouched.
    assert.equal(withStaticPart(kept, STORY_INSTRUCTION), kept);
    assert.equal(withStaticPart(off, ''), off);
    // A chat that starts with the reader's message: first of all.
    assert.equal(withStaticPart([{ role: 'user', content: 'Hi' }], STORY_INSTRUCTION)[0].role, 'system');
    // Another extension's call while the story has replies (a scan: system + user, no replies): untouched.
    const scan = [{ role: 'system', content: 'You are a dossier scanner.' }, { role: 'user', content: 'Transcript …' }];
    assert.equal(withStaticPart(scan, STORY_INSTRUCTION, { story: true }), scan);
    assert.equal(withStaticPart(off, STORY_INSTRUCTION, { story: true })[2].content, STORY_INSTRUCTION);
});
