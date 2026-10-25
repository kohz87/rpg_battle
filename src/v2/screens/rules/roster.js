// RPG Battle v2, screens for the rules-v2 views (track C): the Roster page's view query, `rpg-battle.rosterView`.
//
// Who is in the party (rules.party: PC plus two active, the rest in reserve, summons and pets as temporary units), what
// each wears in the eight slots (items.slots, with the SheetView's gear), what a bag piece would do on them
// (items.canWear and rules.equipPlan, both read-only and track A's; the planner answers once rules are pinned) and whether a companion's dossier is still found
// (npc.identity, pending NSD). The page asks and shows. The slot a piece takes, what it displaces and why it is refused
// are the answers' words; the page never adds a piece's own bonuses to its requirement, never picks a slot the reader
// did not ask for, and never sends rules.registerItem or rules.flagSet.
//
// Buttons and their payloads:
//   party.setActive { actors }        the active ids after the change (the command refuses more than the limit, no PC,
//                                     a dead or temporary member, or an active fight)
//   item.unequip { stack }            by the slot tiles (tap to arm, tap again), the widget rpg-battle.equipment
//   item.equip { stack, to, targetSlot? }  `to` is the member; targetSlot only when the reader picks a slot
//   summon.end { actor, reason:'dismissed' }  the owner's Dismiss on a temporary unit

import { ASK, ask, isParty, isRecord, isText } from './ask.js';
import { btn, clip } from './format.js';
import { conditionStatus, conditionView, heroOf, statText } from '../view.js';

export const SLOT_ORDER = Object.freeze(['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2']);
export const SLOT_LABELS = Object.freeze({
    weapon: 'Main hand', offhand: 'Off hand', head: 'Head', body: 'Body', legs: 'Legs', feet: 'Feet', 'accessory-1': 'Accessory 1', 'accessory-2': 'Accessory 2',
});

/** The most bag pieces one member's Equip list shows (the rest are in Inventory). */
export const BAG_PIECES_MAX = 12;

const isSlots = value => isRecord(value) && Array.isArray(value.slots) && value.slots.every(item => isRecord(item) && isText(item.key) && isText(item.label));

const toneOfBand = { good: 'good', worn: 'warn', tattered: 'bad', broken: 'bad' };

/**
 * A worn piece's stats as one line ("ATK +3, DEF +1"). items.gear gives a record ({ ATK: 3 }); it is formatted here, never passed
 * through a text clip (which would show a record as blank). A line of text is kept as it is, cut to the tile's width.
 */
export const statLine = stats => clip(typeof stats === 'string' ? stats : statText(stats), 120);

/** The slot descriptors in the fixed order: the query's, or the eight default names when it does not answer yet (pending A). */
export function slotList(found) {
    if (found.status === ASK.OK) {
        const byKey = new Map(found.value.slots.map(item => [item.key, item]));
        const known = SLOT_ORDER.filter(key => byKey.has(key)).map(key => ({ key, label: clip(byKey.get(key).label, 40), blockedBy: byKey.get(key).blockedBy ?? null }));
        return { known: true, slots: known };
    }
    return { known: false, slots: SLOT_ORDER.map(key => ({ key, label: SLOT_LABELS[key], blockedBy: null })) };
}

/** What the member wears, from items.gear's counted and unused entries: Map stack id → entry. */
function wornTable(tools, actorId) {
    const found = ask(tools, 'items.gear', { actor: actorId }, isRecord);
    const table = new Map();
    if (found.status !== ASK.OK) return table;
    for (const entry of [...(Array.isArray(found.value.counted) ? found.value.counted : []), ...(Array.isArray(found.value.unused) ? found.value.unused : [])]) {
        if (isRecord(entry) && isText(entry.stack)) table.set(entry.stack, entry);
    }
    return table;
}

const inventoryItems = tools => {
    const found = ask(tools, 'inventory.items', {}, Array.isArray);
    return found.status === ASK.OK ? found.value : [];
};
const stackName = (items, stackId) => clip(items.find(item => item.stack === stackId)?.name ?? stackId, 80);

/**
 * The slot tiles of one member, in the shape the equipment widget draws: one per slot in order; a filled slot is the
 * stack the SheetView's gear names; an empty slot that something blocks says what blocks it.
 */
export function slotTilesOf({ sheet, slots, worn, tools }) {
    const items = inventoryItems(tools);
    return slots.map(slot => {
        const stackId = sheet.gear?.[slot.key] ?? null;
        if (!stackId) {
            const note = slot.blockedBy ? `Blocked by ${stackName(items, slot.blockedBy)}` : '';
            return { key: slot.key, group: slot.key, label: slot.label, filled: false, empty: true, extra: false, stack: '', name: '', stats: '', why: '', cond: '', condTone: '', condBroken: false, meter: false, cur: 0, max: 0, note };
        }
        const entry = worn.get(stackId) ?? null;
        const found = ask(tools, 'items.condition', { stack: stackId });
        const { condition, refine } = conditionView(found.status === ASK.OK ? found.value : null);
        const max = condition?.max ?? 0;
        return {
            key: slot.key, group: slot.key, label: slot.label, filled: true, empty: false, extra: false, stack: stackId,
            name: clip(`${entry?.name ?? stackName(items, stackId)}${refine ? ` ${refine.label}` : ''}`, 80),
            stats: statLine(entry?.stats), why: '', cond: condition ? condition.text : '', condTone: toneOfBand[condition?.band] ?? '',
            condBroken: condition?.band === 'broken', meter: max > 0, cur: condition?.cur ?? 0, max, note: '',
        };
    });
}

/**
 * The bag pieces a member could put on and what the answers say about each. Nothing here writes: each row has the
 * verdict (`ok` with the plan's slot and what it displaces, or the refusal's words) and, only when the default is legal,
 * the other slots the plan also allows, each of which sends targetSlot when the reader presses it.
 */
export function bagRows({ tools, sheet, slots }) {
    const items = inventoryItems(tools);
    const pieces = items.filter(item => isRecord(item) && item.owner === 'party' && !item.equipped && item.qty > 0 && item.kind === 'equipment')
        .sort((a, b) => (a.stack < b.stack ? -1 : 1))
        .slice(0, BAG_PIECES_MAX);
    const labelOf = key => slots.find(slot => slot.key === key)?.label ?? key;
    return pieces.map(stack => {
        const name = stackName(items, stack.stack);
        const wear = ask(tools, 'items.canWear', { actor: sheet.id, stack: stack.stack });
        const verdict = wear.status === ASK.OK ? wear.value : null;
        const base = { stack: stack.stack, name, options: [], blocked: '', default: null };
        if (!verdict) return { ...base, blocked: 'Whether this fits is not available yet.' };
        if (verdict.ok !== true) return { ...base, blocked: clip(verdict.why ?? 'It cannot be worn.', 240) };
        const plan = ask(tools, 'rules.equipPlan', { stack: stack.stack, actor: sheet.id });
        if (plan.status !== ASK.OK) return { ...base, blocked: 'The slot for this piece is not available yet.' };
        if (plan.value.ok !== true) return { ...base, blocked: clip(plan.value.message ?? 'It cannot be worn.', 240) };
        const chosen = plan.value.plan;
        const swaps = (Array.isArray(chosen.unequip) ? chosen.unequip : []).map(id => stackName(items, id));
        const row = {
            ...base,
            default: {
                label: `Equip to ${labelOf(chosen.slot)}`, slot: chosen.slot, swapsText: swaps.length ? `Takes off ${swaps.join(', ')}.` : '',
                payload: { stack: stack.stack, to: sheet.id },
                button: btn('item.equip', { stack: stack.stack, to: sheet.id }, `Equip to ${labelOf(chosen.slot)}`, { tone: 'primary' }),
            },
        };
        for (const slot of slots) {
            if (slot.key === chosen.slot) continue;
            const other = ask(tools, 'rules.equipPlan', { stack: stack.stack, actor: sheet.id, targetSlot: slot.key });
            if (other.status !== ASK.OK || other.value.ok !== true) continue;
            const displaced = (Array.isArray(other.value.plan.unequip) ? other.value.plan.unequip : []).map(id => stackName(items, id));
            const payload = { stack: stack.stack, to: sheet.id, targetSlot: slot.key };
            row.options.push({ slot: slot.key, label: `Put on ${slot.label}`, swapsText: displaced.length ? `Takes off ${displaced.join(', ')}.` : '', payload, button: btn('item.equip', payload, `Put on ${slot.label}`) });
        }
        return row;
    });
}

export function npcModel(sheet, tools) {
    if (sheet.kind === 'pc') return { show: false, state: 'none', text: '' };
    const probe = ask(tools, 'npc.identity', { name: ' ' });
    if (typeof sheet.npcId !== 'string' || !sheet.npcId) {
        return probe.status === ASK.MISSING
            ? { show: true, state: 'absent', text: 'NPC State Delta is not installed, so there is no dossier for this companion.' }
            : { show: true, state: 'none', text: 'No dossier is linked to this companion.' };
    }
    if (probe.status === ASK.MISSING) return { show: true, state: 'absent', text: 'NPC State Delta is not answering, so the dossier link is kept but cannot be read now.' };
    const found = ask(tools, 'npc.identity', { id: sheet.npcId });
    if (found.status === ASK.OK && isText(found.value.name)) return { show: true, state: 'linked', text: `Dossier: ${clip(found.value.name, 80)}.`, dossierName: clip(found.value.name, 80) };
    return { show: true, state: 'unresolved', text: 'The dossier for this companion cannot be found. Death, relationship and recruit actions wait until it is.' };
}

function memberModel(sheet, ctx) {
    const { party, tools, minutes, activeIds, full } = ctx;
    const slotInfo = slotList(ask(tools, 'items.slots', { actor: sheet.id }, isSlots));
    const you = sheet.id === party.pc;
    const worn = wornTable(tools, sheet.id);
    const tiles = slotTilesOf({ sheet, slots: slotInfo.slots, worn, tools });
    const isActive = activeIds.includes(sheet.id);
    const down = sheet.life === 'downed' || sheet.life === 'dead' || sheet.life === 'gravely-injured';
    return {
        id: sheet.id, name: clip(sheet.name, 80), you, kind: sheet.kind ?? 'companion', role: clip(sheet.role ?? '', 80), open: you, active: isActive, life: sheet.life ?? 'alive', down,
        lifeText: down ? ({ downed: 'Downed', dead: 'Dead', 'gravely-injured': 'Gravely injured' }[sheet.life] ?? '') : '',
        hero: heroOf({
            name: clip(sheet.name, 80), portrait: typeof sheet.portrait === 'string' ? sheet.portrait : '',
            line: `Lv ${sheet.level} · ${clip(sheet.role ?? '', 40) || 'Adventurer'}${you ? ' · You' : ''}`,
            pools: { hp: sheet.hp, mp: sheet.mp, sp: sheet.sp },
            statuses: (Array.isArray(sheet.conditions) ? sheet.conditions : []).map((entry, index) => conditionStatus(entry, index, minutes)),
        }),
        control: sheet.control === 'player' ? 'You lead' : 'On their own',
        tiles, slotsKnown: slotInfo.known, bag: bagRows({ tools, sheet, slots: slotInfo.slots }),
        npc: npcModel(sheet, tools),
        canRest: isActive && !you,
        restPayload: { actors: activeIds.filter(id => id !== sheet.id) },
        restButton: btn('party.setActive', { actors: activeIds.filter(id => id !== sheet.id) }, 'Rest in reserve'),
        canActivate: !isActive && !down,
        activatePayload: { actors: [...activeIds, sheet.id] },
        activateButton: btn('party.setActive', { actors: [...activeIds, sheet.id] }, 'Make active', {
            tone: 'primary', disabled: full, title: full ? 'The active party is full. Rest someone in reserve first.' : '',
        }),
    };
}

/** rpg-battle.rosterView({}) → { state, reason, limit, activeText, full, active, reserve, temporary }. */
export function rosterView(state, args, tools) {
    const found = ask(tools, 'rules.party', {}, isParty);
    if (found.status === ASK.MISSING || found.status === ASK.EMPTY) return { state: 'unavailable', reason: 'The rules are not answering yet. Check the Setup page.', active: [], reserve: [], temporary: [] };
    if (found.status === ASK.MALFORMED) return { state: 'mismatch', reason: 'The rules answered in a form this version does not understand.', active: [], reserve: [], temporary: [] };
    const party = found.value;
    if (party.pc === null && party.active.length === 0) return { state: 'no-character', reason: '', active: [], reserve: [], temporary: [] };
    const time = ask(tools, 'director.time', {});
    const minutes = time.status === ASK.OK && Number.isSafeInteger(time.value.minutes) ? time.value.minutes : null;
    const activeIds = party.active.map(sheet => sheet.id);
    const full = activeIds.length >= party.activeLimit;
    const ctx = { party, tools, minutes, activeIds, full };
    return {
        state: 'ready', reason: '', limit: party.activeLimit, activeCount: activeIds.length, activeText: `${activeIds.length} / ${party.activeLimit} active`, full,
        active: party.active.map(sheet => memberModel(sheet, ctx)),
        reserve: party.reserve.map(sheet => memberModel(sheet, ctx)),
        temporary: party.temporary.map(unit => ({
            id: unit.id, name: clip(unit.name, 80), detail: [clip(unit.role ?? '', 40), isRecord(unit.hp) ? `HP ${unit.hp.cur} / ${unit.hp.max}` : ''].filter(Boolean).join(' · '),
            dismissPayload: { actor: unit.id, reason: 'dismissed' },
            dismissButton: btn('summon.end', { actor: unit.id, reason: 'dismissed' }, 'Dismiss'),
        })),
        temporaryNote: 'Summons and pets fight beside you for a fight only. They are outside the party limit, carry nothing and cannot save you from a wipe.',
    };
}
