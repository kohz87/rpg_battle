// Hooks that more than one part defines are merged by module.js's mergeHook, not by the last part winning:
// afterCapture concatenates every part's commands in part order, canGenerate needs every part to allow it,
// replayGuard is dispatched by kind (the first part that answers). Parts here are registered through createModule({ parts }).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../../src/v2/module.js';

const make = parts => createModule({ settings: () => ({}), query: () => [], parts });

test('afterCapture: the commands of every part, in part order, whatever a part returns or awaits', async () => {
    const a = { hooks: { afterCapture: () => ({ commands: [{ type: 'a.one', payload: {} }, { type: 'a.two', payload: {} }] }) } };
    const none = { hooks: { afterCapture: () => undefined } };
    const b = { hooks: { afterCapture: async () => ({ commands: [{ type: 'b.one', payload: { n: 1 } }] }) } };
    const empty = { hooks: { afterCapture: () => ({ commands: [] }) } };
    const out = await make([['pa', a], ['pn', none], ['pb', b], ['pe', empty]]).hooks.afterCapture({ state: { domains: {} } }, { index: 0, type: 'normal' });
    assert.deepEqual(out.commands.map(c => c.type), ['a.one', 'a.two', 'b.one']);
    assert.deepEqual((await make([['pb', b], ['pa', a]]).hooks.afterCapture({}, {})).commands.map(c => c.type), ['b.one', 'a.one', 'a.two'], 'part order, not name order');
});

test('afterCapture: the arguments reach every part, and a throwing part is a failure of the hook, not a silent drop', async () => {
    const seen = [];
    const spy = id => ({ hooks: { afterCapture: (view, info) => { seen.push([id, view.mark, info.type]); return { commands: [] }; } } });
    await make([['x', spy('x')], ['y', spy('y')]]).hooks.afterCapture({ mark: 'v' }, { index: 3, type: 'swipe' });
    assert.deepEqual(seen, [['x', 'v', 'swipe'], ['y', 'v', 'swipe']]);
    const bad = { hooks: { afterCapture: () => { throw new Error('boom'); } } };
    await assert.rejects(make([['x', spy('x')], ['bad', bad]]).hooks.afterCapture({}, {}), /boom/);
});

test('no part with afterCapture: the module has no such hook (a chat that registers none adds no step)', () => {
    assert.equal(Object.hasOwn(make([['x', { hooks: {} }]]).hooks, 'afterCapture'), false);
});

test('canGenerate: every part must allow; the first no is the answer', async () => {
    const yes = { hooks: { canGenerate: () => ({ ok: true }) } };
    const no = { hooks: { canGenerate: () => ({ ok: false, reason: 'first no', action: false }) } };
    const other = { hooks: { canGenerate: () => ({ ok: false, reason: 'second no' }) } };
    const silent = { hooks: { canGenerate: () => undefined } };
    const view = { state: { domains: { creation: { skipped: true } } } }; // the party and return parts allow it
    assert.deepEqual(await make([['a', yes], ['b', silent]]).hooks.canGenerate(view, {}), { ok: true });
    assert.deepEqual(await make([['a', yes], ['b', no], ['c', other]]).hooks.canGenerate(view, {}), { ok: false, reason: 'first no', action: false });
    assert.deepEqual(await make([['a', other], ['b', no]]).hooks.canGenerate(view, {}), { ok: false, reason: 'second no' });
    assert.equal((await make([['a', yes], ['b', { hooks: { canGenerate: () => false } }]]).hooks.canGenerate(view, {})), false);
    // A later part's yes never hides an earlier part's no.
    assert.equal((await make([['a', no], ['b', yes]]).hooks.canGenerate(view, {})).ok, false);
});

test('replayGuard: dispatched by kind, the first part that answers; undefined when none does', () => {
    const guard = (kind, answer) => ({ hooks: { replayGuard: (view, info) => (info.guard.predicate.kind === kind ? answer : undefined) } });
    const hook = make([['p', guard('rules.settle', { ok: true })], ['q', guard('death.resolve', { ok: false, reason: 'off' })]]).hooks.replayGuard;
    const info = kind => ({ guard: { predicate: { kind } } });
    assert.deepEqual(hook({}, info('rules.settle')), { ok: true });
    assert.deepEqual(hook({}, info('death.resolve')), { ok: false, reason: 'off' });
    assert.equal(hook({}, info('something.else')), undefined, 'the host fails closed on no answer');
});
