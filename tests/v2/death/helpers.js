import assert from 'node:assert/strict';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { rulesModule, mergeInto, SD } from '../progress/helpers/world.js';
import { fightPin, ref } from '../progress/helpers/fixture.js';
import { createDeathPart } from '../../../src/v2/death/index.js';
import { resolveBatch } from '../../../src/v2/fight/batch.js';
import { recordLethal, intervene } from '../../../src/v2/death/commands.js';

export const ok = out => { assert.equal(out.ok, true, `${out.code}: ${out.message}`); return out; };
export { ref };

/** Real RB party/combat/rules + real SB timeline; SD's already-used clock fixture. Native fixture is added by return tests. */
export async function world(t, { pin = true, native = null, faults = null, st = {}, image = null } = {}) {
    let host = null;
    const death = createDeathPart({ host: () => host?.timeline.host ?? null });
    let module = mergeInto(createModule(), rulesModule({ given: fightPin() }));
    const old = module;
    module = {
        ...old,
        domains: { ...old.domains, ...death.domains },
        commands: { ...old.commands, ...death.commands,
            'test.lethal': recordLethal, 'test.intervene': intervene,
            'test.proof'(ctx, { kind, payload, parents = [] }) { return { summary: 'Code evidence.', narrate: false, data: ctx.proof({ kind, payload, parents }) }; },
            'test.linkNpc'(ctx, { actor, npc }) { ctx.draft('party').actors[actor].npcId = npc; return { summary: 'Linked.', narrate: false }; },
            'test.reward'(ctx) {
                if (!ctx.claim('c12:reward')) ctx.fail('CLAIMED', 'The reward was already paid.');
                ctx.call('wallet.receive', { owner: 'party', amount: 30 });
                ctx.call('party.grantXp', { actor: ctx.read('party').pc, amount: 25, claim: 'c12:reward' });
                return { summary: 'One reward.', narrate: false };
            },
        },
        queries: { ...old.queries, ...death.queries },
        replayQueries: [...new Set([...old.replayQueries, ...death.replayQueries])],
        batchResults: { resolve: resolveBatch },
        capture: { kinds: { ...old.capture.kinds, ...death.kinds }, apply: (ctx, line) => death.kinds[line.kind] ? death.kinds[line.kind].apply(ctx, line) : old.capture.apply(ctx, line) },
        hooks: { ...old.hooks,
            canGenerate(view, info) { const out = old.hooks.canGenerate?.(view, info); return out?.ok === false ? out : death.hooks.canGenerate(view, info); },
            replayGuard: (view, info) => death.hooks.replayGuard(view, info) ?? old.hooks.replayGuard(view, info),
            afterCapture: (view, info) => ({ commands: [...(old.hooks.afterCapture?.(view, info)?.commands ?? []), ...death.hooks.afterCapture(view, info).commands] }),
        },
    };
    host = await createHost({ modules: [SD, module, ...(native ? [native.module] : [])], timelineFaults: faults, st: { ...st, ...(image ? { chat: image.chat } : {}) } });
    if (image) { host.ctx.chatMetadata = structuredClone(image.metadata); await host.turn.onChatChanged(); }
    t.after(() => host.close());
    t.mock.method(console, 'warn', () => {});
    if (!image) {
        await host.sdk.command('party.create', { name: 'Astra', preset: 'fighter' });
        await host.send('Dawn.', 'Haven.');
    }
    const command = (type, payload = {}, cause = 'system') => host.bus.command(type, payload, { cause });
    const q = (name, args = {}) => host.sdk.query(name, args);
    const pc = q('party.pc').id;
    if (pin && !image) {
        ok(command('test.pin'));
        ok(command('test.start', { actor: pc, class: ref('c0') }));
    }
    // A test-only RB adapter, rather than a forged cross-owner caller.
    const friend = image ? q('party.actors').find(m => m.kind === 'companion')?.id : ok(command('party.addCompanion', { name: 'Lyra', level: 1, ...(pin ? { class: ref('c0') } : {}) })).receipt.data.actor;
    const proof = (kind, payload, parents = []) => ok(command('test.proof', { kind, payload, parents })).receipt.data.id;
    const lethal = (actor, cause = 'narrative') => {
        const evidence = proof('story', { actor, cause, lethal: true });
        return ok(command('test.lethal', { actor, cause, evidence: [evidence] })).receipt.data;
    };
    return { host, command, q, pc, friend, proof, lethal, head: () => host.head(), say: text => host.send('Go on.', text),
        slice: name => host.head().domains[name], problems: () => host.store.problems() };
}
