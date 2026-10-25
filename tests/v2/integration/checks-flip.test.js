// The complete Stage 5 path: real SB + SD + RB, including the replay boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../../../../Story_block/testkit/index.js';
import { createModule as director } from '../../../../Story_director/src/v2/module.js';
import { createModule as battle } from '../../../../rpg_battle/src/v2/module.js';
import { pinFor, smallRulesPack } from '../../../../rpg_battle/tests/v2/progress/helpers/fixture.js';

const reply = lines => `The attempt.\n<Changes>\n${lines.join('\n')}\n</Changes>`;
const check = (skill = 'Stealth', dc = 20) => `? check ${skill} — an attempt | dc: ${dc} | result: impossible`;
const credits = host => Object.values(host.head().domains.progress.credits).reduce((sum, row) => sum + row.award, 0);
async function setup(t, { assist = false } = {}) {
    let sdk;
    const sd = director({ host: { settings: id => sdk?.settings(id) ?? {}, substitute: text => text } });
    const rb = battle({ rules: (() => { const pack = smallRulesPack(); pack.content.rules[0].skills[0].name = 'Stealth'; return pinFor('checks-flip', pack); })(), settings: () => sdk?.settings('rpg-battle') ?? {}, preflight: {
        hostApi: 2, classification: 'empty', restore: 'idle', peers: [{ module: 'story-director', enabled: true, version: '2.0.0-beta.2' }],
    } });
    const host = await createHost({ modules: [sd, rb], callModel: async () => '? check Stealth — the risky attempt | dc: hard',
        settings: { modules: { 'story-block': { assistClassifier: assist } } } });
    sdk = host.sdk;
    t.after(() => host.close());
    const made = await sdk.command('party.create', { name: 'Mara', preset: 'fighter', class: 'pack.fixture/c0' });
    assert.equal(made.ok, true, made.message);
    if (!assist) await host.send('Dawn.', reply(['~ time June 3, 1200, 08:00 am']));
    return host;
}

async function replay(host) {
    const state = structuredClone(host.head());
    await host.st.loadChat(JSON.parse(JSON.stringify(host.ctx.chat)));
    assert.deepEqual(host.head(), state, 'reload');
    host.store.rebuild();
    assert.deepEqual(host.head(), state, 'rebuild');
    assert.deepEqual(host.store.problems(), []);
    assert.deepEqual(host.turn.problems(), []);
}

test('real modules: a skill check has one die, one practice attempt, receipts only; reread, swipe and delete retract it', async t => {
    const host = await setup(t);
    assert.equal(host.registry.captureOwner('check'), 'story-director');
    await host.send('I try.', reply([check()]));
    const index = host.ctx.chat.length - 1;
    let log = Object.values(host.head().domains.checks.log);
    assert.equal(log.length, 1);
    assert.equal(log[0].source, 'rb');
    assert.equal(log[0].total, log[0].die + log[0].mod);
    assert.equal(credits(host), 1);
    assert.equal(Object.keys(host.head().domains.progress.attempts).length, 1);
    const receipt = host.ctx.chat[index].extra.storySuite.receipts.find(row => row.type === 'capture.check');
    assert.equal(receipt.data.v2.result.die, log[0].die);
    assert.equal(receipt.data.v2.result.outcome, log[0].outcome);
    assert.equal(receipt.narrate, true);
    assert.equal(receipt.problem, undefined);
    assert.ok(!host.registry.screens().find(screen => screen.id === 'rpg-battle/status-card').template.includes('state.checks'));
    await replay(host);
    // Re-read the edited reply as a stat-only attempt: no skill practice remains.
    host.ctx.chat[index].mes = reply([check('STR')]);
    assert.equal((await host.sdk.reread(index)).ok, true);
    assert.equal(credits(host), 0);
    assert.equal(Object.keys(host.head().domains.progress.attempts).length, 0);
    await replay(host);
    await host.swipe(reply([check('s01', 40)]));
    assert.equal(credits(host), 1, 'a failed attempt practices too');
    await replay(host);
    await host.st.deleteMessage(index);
    assert.equal(credits(host), 0);
    assert.equal(Object.keys(host.head().domains.checks.log).length, 0);
    await replay(host);
});

test('real modules: skill practice shares the two-per-skill, six-per-reply and thirty-per-day caps', async t => {
    const host = await setup(t);
    for (let n = 0; n < 6; n += 1) {
        await host.send(`Practice ${n}.`, reply(['Stealth', 's01', 's02'].flatMap(skill => [1, 20, 40].map(dc => check(skill, dc)))));
        assert.equal(credits(host), Math.min(30, (n + 1) * 6));
        await replay(host);
    }
});

test('real modules: Assist capture pre-roll calls SD once, and the generation sees the outcome', async t => {
    const host = await setup(t, { assist: true });
    const { request } = await host.send('I attempt the risky task.', 'The story follows the roll.');
    const log = Object.values(host.head().domains.checks.log);
    assert.equal(log.length, 1);
    const receipts = host.ctx.chat.flatMap(message => message.extra?.storySuite?.receipts ?? []);
    const precheck = receipts.find(row => row.type === 'assist.precheck');
    assert.ok(precheck);
    assert.equal(precheck.data.check, log[0].id);
    assert.equal(precheck.data.outcome, log[0].outcome);
    assert.equal(precheck.data.rolled, true);
    assert.match(request.chat.filter(message => message.role === 'system').map(message => message.content).join('\n'), /Mara tries Stealth: d20/);
    assert.equal(Object.keys(host.head().domains.progress.attempts).length, 1);
    await replay(host);
});
