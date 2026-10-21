// RPG Battle v2, items part: using a thing in the story (MODULES §F96: the story leads, code
// referees).
//
// The story writes `! use Minor Healing Draught | on: Mira | qty: 2` when someone drinks, eats or
// applies something. Code finds it among the party's things (the one using it first, then the
// shared bag, then anyone else in the party), applies its effect from the item's definition by the
// same rule as the item.use command (v1 useItemOutside: the amounts, the clamps to max HP/MP, the
// conditions cured), one dose per line unless `qty:` says more, and the receipt goes to the next
// reply. A dose that would do nothing is not spent: the doses stop there.
//
// When code refuses (full HP, nothing to cure, not a consumable, not in the bag, a fight going on),
// nothing is used and the receipt tells the story so ("Mira is at full HP; the Minor Healing
// Draught stays in the bag."), with `data.refused` set. During a fight, the fight's own Item action
// is the way to use something (the fight takes it out when it is used); a story `use` line then
// leaves the thing in the bag, since the fight keeps everyone's HP until it ends.
//
// The `- item Name` path (Story Block's `item` kind) is Story Block's: when its line or the reply
// says the thing was used (USED_WORDS), Story Block routes it here with `item.use { name, on, qty,
// story: true }` (see the coordinator's patch), and the same rules apply.

import { useItemOutside } from '../../recovery.js';
import { helpsOutside, inventoryOf, partyOwns, sheetOf, stackIds } from './shared.js';

/** Words that say a thing was used up (a `- item` line's labels or the reply's text around it). */
export const USED_WORDS = /\b(?:used|uses|drank|drinks|drunk|ate|eats|eaten|applied|applies|quaffed|swallowed|consumed)\b/i;
/** Words that say it went another way: lost, sold, given away (never routed to a use). */
export const GONE_WORDS = /\b(?:lost|loses|sold|sells|gave|given|gives|dropped|stolen|traded|handed|broke|broken|spilled|spilt)\b/i;
export const MAX_DOSES = 10;

const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether a `- item` line means the thing was used: a label `used: yes`, or a used-word in its
 * labels, its text or the reply, and no lost/sold/given word in its own text or labels.
 */
export function usedByLine(line, replyText = '') {
    const labels = Object.entries(line?.labels ?? {}).map(([name, value]) => `${name} ${value}`).join(' ');
    const own = `${line?.text ?? ''} ${labels}`;
    if (GONE_WORDS.test(own)) return false;
    if (/^(?:yes|true|1)$/i.test(String(line?.labels?.used ?? '').trim())) return true;
    return USED_WORDS.test(own) || USED_WORDS.test(String(replyText ?? ''));
}

/** The defs a written name may mean: the inventory's alias for it, else every def of that name. */
function defsNamed(inventory, name) {
    const wanted = key(name);
    const ids = new Set();
    const alias = inventory.aliases?.[wanted];
    if (alias) ids.add(alias);
    for (const [id, def] of Object.entries(inventory.defs ?? {})) if (key(def?.name) === wanted) ids.add(id);
    return ids;
}

/** The party stack a story name means, for `who`: their own, then the shared bag's, then anyone's. */
export function stackNamed(inventory, party, name, who) {
    const ids = defsNamed(inventory, name);
    const rows = stackIds(inventory).map(id => inventory.stacks[id]).filter(stack => ids.has(stack.def) && stack.qty > 0 && partyOwns(party, stack.owner));
    return rows.find(stack => stack.owner === who) ?? rows.find(stack => stack.owner === 'party') ?? rows[0] ?? null;
}

/** Why a dose would do nothing for `actor`, in the story's words ("Mira is at full HP"). */
export function noNeedWords(actor, def) {
    const sheet = sheetOf(actor);
    const effect = def?.effect ?? {};
    const cures = Array.isArray(effect.cure) && effect.cure.length;
    if (effect.heal > 0 && !(effect.mp > 0) && !cures) return `${sheet.name} is at full HP`;
    if (effect.mp > 0 && !(effect.heal > 0) && !cures) return `${sheet.name} is at full MP`;
    if (cures && !(effect.heal > 0) && !(effect.mp > 0)) return `${sheet.name} has nothing for the ${def.name} to cure`;
    return `${sheet.name} does not need the ${def.name} now`;
}

/**
 * What a story use comes to, before anything is changed: { ok: true, stack, def, actor, doses }
 * (doses: how many would help, at least 1) or { ok: false, reason, def?, actor? }.
 * `inFight`: a fight is going on.
 */
export function planStoryUse({ inventory, party, name, stack: stackId = '', who, qty = 1, inFight = false }) {
    const actor = who ? party.actors?.[who] ?? null : null;
    const stack = stackId ? inventory.stacks?.[stackId] ?? null : stackNamed(inventory, party, name, who);
    const def = stack ? inventory.defs?.[stack.def] ?? null : null;
    const label = (def?.name ?? String(name ?? '').trim()) || 'that';
    if (!actor) return { ok: false, reason: `nobody of that name is in the party; the ${label} stays in the bag`, def };
    if (!stack || !def || !(stack.qty > 0) || !partyOwns(party, stack.owner)) return { ok: false, reason: `there is no ${label} among the party's things; nothing is used`, def, actor };
    if (def.kind !== 'consumable') return { ok: false, reason: `the ${def.name} is not something to use up; it stays with the party`, def, actor };
    if (!helpsOutside(def.effect)) return { ok: false, reason: `the ${def.name} is for a fight; it stays in the bag`, def, actor };
    if (inFight) return { ok: false, reason: `${actor.name} is in a fight: the ${def.name} is used on a fight turn, so it stays in the bag for now`, def, actor };
    let sheet = sheetOf(actor);
    let doses = 0;
    for (let n = 0; n < Math.min(qty, stack.qty, MAX_DOSES); n++) {
        const outcome = useItemOutside(sheet, { name: def.name, effect: def.effect });
        if (!outcome.used) break;
        sheet = outcome.sheet;
        doses += 1;
    }
    if (!doses) return { ok: false, reason: `${noNeedWords(actor, def)}; the ${def.name} stays in the bag`, def, actor };
    return { ok: true, stack, def, actor, doses };
}

export { inventoryOf };
