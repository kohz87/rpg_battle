// Shared bits for the b3-economy break tests in RPG Battle: the integration host (vendored Story
// Block runtime + this module), a character, a market and a fight played out.
import { playOut, rpgHost, seeded } from '../../integration/helpers/host.js';

export { seeded };
export const coin = (host, owner = 'party') => host.head().domains.inventory.wallets?.[owner]?.coin ?? 0;
export const show = r => `${r.code ?? ''} ${r.message ?? r.receipt?.summary ?? ''}`;

/** A host with Wessel made and a first reply in Bluewatch Village (a market). */
export async function market(options = {}) {
    const host = await rpgHost(options);
    const made = await host.cmd('party.create', { name: 'Wessel', preset: 'fighter' });
    if (!made.ok) throw new Error(made.message);
    await host.send('We walk into the village.', host.reply('Bluewatch Village.', ['~ place Bluewatch Village | kind: settlement', '+ coin 5000']));
    return host;
}

/** An encounter line, the fight played out (auto), not yet ended. → the session id. */
export async function foughtOut(host, foes = '1 Cellar Rat', tier = 'trivial') {
    await host.send('We go down.', host.reply('Something moves.', [`! encounter ${foes} — in the dark | tier: ${tier}`]));
    const offer = host.q('combat.offers').at(-1);
    const begun = await host.cmd('combat.start', { offer: offer.id });
    if (!begun.ok) throw new Error(begun.message);
    const id = host.head().domains.combat.session.id;
    await playOut(host);
    return id;
}
