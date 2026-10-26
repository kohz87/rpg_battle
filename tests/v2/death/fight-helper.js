import assert from 'node:assert/strict';
import { ok } from './helpers.js';

export async function wipe(w) {
    for (const actor of [w.pc, w.friend]) ok(w.command('test.pool', { actor, pool: 'hp', cur: 1 }));
    await w.say('<Changes>\n! encounter 3 Ogre — closing in | tier: deadly | stakes: normal\n</Changes>');
    const offers = w.q('combat.offers');
    if (!offers && w.host.registry.restore().state === 'pending') return { ok: false, code: 'RESTORE_PENDING', message: 'The selected native checkpoint must settle first.' };
    const offer = offers[0];
    ok(w.command('combat.start', { offer: offer.id }, 'ui'));
    for (let i = 0; i < 200; i++) {
        const v = w.q('combat.session');
        if (v.status !== 'active') break;
        ok(w.command('combat.act', { session: v.id, board: v.board, action: { type: 'defend' } }, 'ui'));
    }
    const v = w.q('combat.session');
    assert.equal(v.status, 'lost');
    return ok(w.command('combat.end', { session: v.id }, 'ui'));
}
