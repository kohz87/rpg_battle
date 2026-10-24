// Retained wording is a public quest behavior, independent of the mechanics move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestPart } from '../../../src/v2/quests/index.js';

const expected = [
    'Quest rewards: when a quest is turned in, code checks it, pays the reward and tells you under [Happened]; never add coins for a quest reward yourself.',
    'Turning in: close a quest when {{user}} turns it in (- quest Name — turned in); code checks the goal and the place, then pays, or tells you why it stays open.',
    'Every quest needs a concrete goal (| goal: what counts as done). When the goal of a quest code cannot count is met in the story, write ~ quest Name | met: yes (met: no if it is undone). Keep one short line of where it stands: ~ quest Name | progress: …',
    'Quest pacing: offer a new quest rarely, when the story calls for it, and leave quiet stretches with no new jobs. A passer-by is only a passer-by, not a quest-giver. Trouble does not come looking for {{user}} unless they provoke it.',
].join('\n');

test('quest part retains verbatim static guidance and 250-token budget', () => {
    const { context } = createQuestPart();
    assert.equal(context?.static(), expected);
    assert.equal(context.static(), context.static());
    assert.equal(context.budget, 250);
});

test('quest tail retains ready turn-in and story-judged goal wording through RB queries only', () => {
    const rows = [
        { id: 'th_00000001', key: 'Mill job', giver: 'Miller', taken: true, ready: true, goal: 'Bring herbs',
            details: { hasGoal: true }, progress: { countable: true, met: true, finish: { ok: true } } },
        { id: 'th_00000002', key: 'Find peace', giver: '', taken: true, ready: false, goal: 'Hear the whole story',
            details: { hasGoal: true }, progress: { countable: false, met: false, finish: { ok: false } } },
    ];
    const view = { query(name) {
        assert.ok(['rules.quests', 'quest.board'].includes(name), name);
        return name === 'rules.quests' ? [] : { active: rows };
    } };
    const out = createQuestPart().context?.tail(view);
    assert.deepEqual(out, { lines: [
        'Quest goal the story judges: Find peace — Hear the whole story.',
        'Ready to turn in: Mill job (to Miller, here).',
    ], optional: [] });
    rows[0].progress.finish.ok = false;
    assert.equal(createQuestPart().context.tail(view).lines.at(-1), 'Ready to turn in: Mill job (to Miller, at a settlement or where Miller is).');
});
