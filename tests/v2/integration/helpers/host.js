// RPG Battle on the real Story Block v2 host (the vendored runtime and testkit in
// tests/vendor/story-block/, SPEC §10): Story Block's core module (scene, inventory) and RPG
// Battle's merged module (src/v2/module.js), on the testkit's fake SillyTavern.
//
// The host draws its receipt seeds and ids from crypto. `seeded()` swaps in a counter-based
// source for the test, so a fight plays the same way every run; nothing else is faked.

import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { MODULE_ID, createModule } from '../../../../src/v2/module.js';
import { EQUIP_PARTS } from '../../items/helpers/equip-parts.js';
import { createModule as createDirector } from '../../../../../Story_director/src/v2/module.js';
import { part as checks } from '../../../../../Story_director/src/v2/checks/index.js';
import { withDirector } from './peer.js';

// splitmix32 over a counter: plenty for test dice, the same every run.
function source(seed) {
    let x = seed | 0;
    const next = () => {
        x = (x + 0x9E3779B9) | 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B);
        z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35);
        return (z ^ (z >>> 16)) >>> 0;
    };
    return {
        getRandomValues(array) {
            for (let i = 0; i < array.length; i += 1) {
                const value = next();
                array[i] = array instanceof Uint8Array ? value & 0xFF : value;
            }
            return array;
        },
    };
}

/** Runs `fn` with globalThis.crypto replaced by a seeded source; restores it after. */
export async function seeded(seed, fn) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const real = globalThis.crypto;
    const fake = source(seed);
    fake.randomUUID = () => real.randomUUID();
    Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
    try {
        return await fn();
    } finally {
        Object.defineProperty(globalThis, 'crypto', saved);
    }
}

/**
 * A host with Story Block's core module and RPG Battle. `options` go to the testkit's createHost
 * (st, settings). As live, `globalThis.StoryBlock.sdk` is the host's sdk while it is open (the
 * items part's item.define hook asks it for the currency); `close()` takes it away again.
 */
// A tiny module that sends one of RPG Battle's internal commands (party.grantXp, party.addCompanion…)
// as another part would: through its own ctx.call, so the callee sees a calling module. Story Block's
// sdk runs every command as the reader's click (cause 'ui'), which those commands refuse.
const CALLER = {
    id: 'rb-test-caller',
    name: 'RPG Battle test caller',
    version: '0.0.0',
    commands: { 'rbtest.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) },
};

export async function rpgHost(options = {}) {
    const { tweak = null, equip = false, ...hostOptions } = options;
    let sdk = null;
    // `equip`: the planner and a stand-in rules.sheet beside the plain module (a chat that pins no rules has neither; tests/v2/items/helpers/equip-parts.js).
    const module = createModule({ settings: () => sdk?.settings(MODULE_ID) ?? {}, ...(equip ? { parts: [...EQUIP_PARTS] } : {}) });
    // `tweak(module)`: a test's change to the module before it registers (a query wrapped to misbehave).
    if (typeof tweak === 'function') tweak(module);
    const host = await createHost({ ...hostOptions, modules: withDirector([...((options.modules ?? []).some(peer => peer.id === 'story-director') ? [] : [createDirector({ parts: [['checks', checks]] })]), module, CALLER, ...(options.modules ?? [])]) });
    sdk = host.sdk;
    const saved = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    const close = host.close;
    host.module = module;
    host.close = () => {
        close();
        if (saved === undefined) delete globalThis.StoryBlock;
        else globalThis.StoryBlock = saved;
    };
    host.q = (name, args) => sdk.query(name, args);
    host.cmd = async (type, payload = {}, opts) => {
        const out = await sdk.command(type, payload, opts);
        // Legacy fixtures opt into SD checks explicitly; production creation links only a pinned PC.
        if (out.ok && type === 'party.create' && host.registry.query('checks.policy')) {
            const policy = sdk.query('checks.policy', {});
            if (policy.defaultActor === null) {
                const made = await sdk.command('checks.actor', { write: 'wr_fixture1', name: payload.name, expectedHash: policy.hash });
                if (!made.ok) throw new Error(made.message);
                const result = made.receipt.data.v2.result;
                const linked = await sdk.command('checks.link', { write: 'wr_fixture2', actor: result.actor, rbActor: out.receipt.data.actor, expectedHash: result.hash });
                if (!linked.ok) throw new Error(linked.message);
            }
        }
        return out;
    };
    /** One of RPG Battle's internal commands, sent as another module sends it (CALLER). */
    host.internal = (type, payload = {}) => sdk.command('rbtest.call', { type, payload });
    /** A reply with a <Changes> block of `lines`. */
    host.reply = (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
    /** The static prompt texts set so far (non-empty), in order. */
    host.statics = () => host.st.promptLog.filter(entry => entry.key === 'story_suite_static' && entry.value).map(entry => entry.value);
    host.tails = () => host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value);
    return host;
}

/** Plays `auto` turns until the fight is over; returns the session's status. */
export async function playOut(host, { most = 200 } = {}) {
    for (let n = 0; n < most; n += 1) {
        const session = host.q('combat.session');
        if (!session || session.status !== 'active') return session?.status ?? null;
        const result = await host.cmd('combat.act', { action: { type: 'auto' } });
        if (!result.ok) throw new Error(`combat.act was refused: ${result.code} ${result.message}`);
    }
    throw new Error('The fight did not end.');
}
