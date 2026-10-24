// fix-encounter (user's live test): the reply wrote its encounter line in the story, on its own line
// just before the <Changes> block, and no fight could start. Story Block now reads such a line with
// the block (its capture.js strayLines, vendored here) and hides it the same way. The whole path from
// the user's reply: the offer, Start, the board. RPG Battle alone (always), and in the whole suite with
// the Ersveil pack (helpers/suite.js; needs the four checkouts side by side, skipped otherwise).
// The static instruction now says where the line goes ("in <Changes>").
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { STATIC_TEXT } from '../../../src/v2/combat/index.js';
import { sessionOf } from '../../../src/v2/combat/stored.js';

let suite = null;
try { suite = await import('../break/helpers/suite.js'); } catch (error) { suite = { error }; }
const skipSuite = suite?.error ? `the four Story Suite checkouts are not side by side: ${suite.error.message}` : false;

const HIDDEN = /<!--\s*STORY_SUITE_V2[\s\S]*?-->/g;
const shown = mes => String(mes).replace(HIDDEN, '');
const ENCOUNTER = '! encounter 8 Weir Rat — cellar pack | tier: weak | stakes: normal';
// The user's reply, as the model wrote it (the story cut short).
const REPLY = [
    'Minke pressed the iron key into your palm. "Cellar\'s under the Watch Granary. Mind the stairs."',
    '',
    'The cellar was full of rats.',
    '',
    'None of them ran.',
    '',
    'Dozens of them sat upright on the burst sacks, their greasy grey flanks twitching in unison. A cluster of eight huddled atop a burst hemp bale directly beneath the center tie-beam, their round black eyes fixed entirely on the bottom of the steps, whiskers quivering as their blunt snouts lifted toward the open air.',
    '',
    ENCOUNTER,
    '',
    '<Changes>',
    '+ quest Watch Granary Rats — clear the cellar | giver: Minke | goal: bring 40 rat tails to gate wardens | reward: 5 copper per dozen | due: Goldwane 13 | difficulty: easy',
    '~ place Watch Granary | kind: settlement | region: River Confederacy | with: Astra',
    '- present Minke',
    '</Changes>',
].join('\n');

// The offer, Re-read reading the same, Start, and the board with the eight rats on it.
async function offerToBoard(host) {
    await host.send('I take the key and go down to the cellar.', REPLY);
    const last = host.ctx.chat.length - 1;
    const mes = host.ctx.chat[last].mes;
    assert.doesNotMatch(shown(mes), /encounter/, 'the line is not shown');
    const offers = host.q('combat.offers');
    assert.equal(offers.length, 1, JSON.stringify(host.turn.problems()));
    // (With Story Director the rats are tied to the quest that wants their tails, RB #110: the fields kept.)
    assert.deepEqual(offers[0].foes.map(({ name, count, tier }) => ({ name, count, tier })), [{ name: 'Weir Rat', count: 8, tier: 'weak' }]);
    assert.equal(offers[0].stakes, 'normal');
    assert.equal(offers[0].place, 'Watch Granary', 'the place line before it in the reply is read first');
    assert.equal(offers[0].text, 'Weir Rat ×8 (weak)');
    assert.deepEqual(host.turn.problems().filter(item => item.code === 'STRAY' || /encounter/.test(item.message)), []);

    const live = structuredClone(host.head());
    const again = await host.turn.reread(last);
    assert.equal(again.ok, true, again.message);
    assert.deepEqual(host.head(), live, 'Re-read reads what the reply read');
    assert.equal(host.ctx.chat[last].mes, mes);

    const started = await host.cmd('combat.start', { offer: offers[0].id });
    assert.equal(started.ok, true, started.message);
    const session = host.q('combat.session');
    assert.equal(session?.status, 'active');
    const board = host.q('combat.board');
    assert.ok(board, 'the board draws');
    // Every rat written is fought: the first engagement on the board, the rest in later waves (the field
    // cap, and a wave of their own for stunners past the tier's few: combat/setup.js planWaves,
    // spreadStunners). Counted from the fight's setup, not from how often the board's JSON names a rat
    // (its log names them too, as many times as the opening's dice make it: 7 to 9, the earlier flake).
    const setup = sessionOf(host.head().domains.combat).setup;
    const fielded = [setup.enemies, ...(setup.waves ?? []).map(wave => wave.enemies)];
    assert.equal(fielded.flat().length, 8, `eight Weir Rats in the fight (${fielded.map(list => list.length).join(' + ')})`);
    assert.ok(fielded.flat().every(enemy => /^Weir Rat\b/.test(enemy.name)), fielded.flat().map(enemy => enemy.name).join(', '));
    const onBoard = board.combatants.filter(c => c.side === 'enemy');
    assert.equal(onBoard.length, setup.enemies.length, 'the board shows the first engagement\'s rats');
    assert.ok(onBoard.every(c => /^Weir Rat\b/.test(c.name)));
    assert.deepEqual(host.q('combat.offers'), [], 'the offer is taken');
}

test('the user\'s reply: the encounter line in the story is offered, the fight starts, the board draws (RPG Battle alone)', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await rpgHost();
    t.after(() => host.close());
    assert.equal((await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' })).ok, true);
    await host.send('We look around.', host.reply('Bluewatch.', ['~ place Bluewatch Village | kind: settlement']));
    await offerToBoard(host);
});

test('the user\'s reply in the whole suite with the Ersveil pack: offered, started, on the board', { skip: skipSuite }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await suite.started();
    t.after(() => host.close());
    await offerToBoard(host);
    assert.deepEqual(host.q('quest.board', {}).active.map(quest => quest.key), ['Watch Granary Rats'], 'the block\'s quest is read as before');
});

test('the fight instruction says the encounter line goes in <Changes>', () => {
    assert.match(STATIC_TEXT, /write its encounter line in <Changes> \(tier:/);
});
