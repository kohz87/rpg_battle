// Break-round helpers (B4, combat): a host with Story Block's core and RPG Battle (and, when the
// sibling checkout is there, Story Director), a started character, and a from-scratch replay.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playOut, rpgHost, seeded } from '../integration/helpers/host.js';

export { playOut, rpgHost, seeded };

export const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');

/** A host with Ren (fighter) and a first reply in a settlement. */
export async function started(options = {}, { name = 'Ren', preset = 'fighter' } = {}) {
    const host = await rpgHost(options);
    const made = await host.cmd('party.create', { name, preset });
    if (!made.ok) throw new Error(`party.create: ${made.message}`);
    await host.send('We walk into the village.', host.reply('Bluewatch Village, at dusk.', ['~ place Bluewatch Village | kind: settlement']));
    return host;
}

/** The head state a fresh host builds from this host's chat (invariant 1: replay == live). */
export async function replayed(host, options = {}) {
    const chat = structuredClone(host.st.ctx.chat);
    const fresh = await rpgHost({ ...options, st: { ...(options.st ?? {}), chat } });
    try {
        return structuredClone(fresh.head());
    } finally {
        fresh.close();
    }
}

/** A reply with an encounter line, then its offer started. → { offer, start } */
export async function offerAndStart(host, line, text = 'Foes!') {
    await host.send('Onward.', host.reply(text, [line]));
    const offer = host.q('combat.offers').at(-1);
    const start = offer ? await host.cmd('combat.start', { offer: offer.id }) : null;
    return { offer, start };
}

const SD = fileURLToPath(new URL('../../../../Story_director/src/v2/module.js', import.meta.url));
/** Story Director's module from the sibling checkout, or null when it is not there. */
export async function storyDirector() {
    if (!existsSync(SD)) return null;
    const mod = await import(SD);
    return mod.createModule();
}
