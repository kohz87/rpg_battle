import { world, ok } from './helpers.js';
import { nativeFixture, NPC } from './native.js';
import { createDeathCoordinator } from '../../../src/v2/death/coordinator.js';

export const coordinator = w => createDeathCoordinator({ timeline: w.host.sdk.timeline, host: w.host.timeline.host, state: w.head, command: w.command, query: w.q });
export async function savedWorld(t, options = {}) {
    const native = options.native ?? nativeFixture();
    const w = await world(t, { ...options, native });
    ok(w.command('test.linkNpc', { actor: w.friend, npc: NPC }));
    await w.say('<Changes>\n~ time 14400\n~ here pack.fixture/haven\n</Changes>');
    const target = ok(await w.host.timeline.host.make({ kind: 'day-start', day: 10 })).snapshot;
    return { ...w, native: native.native, nativeModule: native, target, coordinator: coordinator(w) };
}

