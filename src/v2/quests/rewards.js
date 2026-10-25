// Quest reward capacity uses the item owner's pure carry calculation and frozen rule weights.
import { canCarry } from '../items/carry.js';

export function canReceive(items, inputs, consumed = []) {
    const snapshot = inputs.carry;
    if (!snapshot) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', message: 'Frozen reward carry inputs are unavailable.' };
    const active = inputs.party?.active?.filter(actor => ['pc', 'companion'].includes(actor.kind));
    if (!active?.length || !Array.isArray(inputs.items)) return { ok: false, code: 'DEPENDENCY_UNAVAILABLE', message: 'The active party carry inputs are unavailable.' };
    const owners = new Set(['party', ...active.map(actor => actor.id)]);
    const inventory = { defs: structuredClone(snapshot.inventory.defs), stacks: Object.fromEntries(inputs.items
        .filter(item => owners.has(item.owner)).map(item => [item.id ?? item.stack, { ...item, id: item.id ?? item.stack, def: item.def?.id ?? item.def }])) };
    if (Object.values(inventory.stacks).some(stack => !inventory.defs[stack.def])) return { ok: false, code: 'RULES_MISMATCH', message: 'A carried item has no frozen weight.' };
    for (const entry of consumed) {
        const stack = inventory.stacks[entry.stack];
        if (!stack || stack.qty < entry.qty) return { ok: false, code: 'NOT_ENOUGH', message: 'The quest materials are no longer available.' };
        stack.qty -= entry.qty;
    }
    const add = items.map(item => ({ def: inventory.defs[item.def], qty: item.qty }));
    if (add.some(item => !item.def)) return { ok: false, code: 'RULES_MISMATCH', message: 'A reward has no frozen definition and item rule.' };
    const party = { order: active.map(actor => actor.id), actors: Object.fromEntries(active.map(actor => [actor.id, actor])) };
    const checked = canCarry(inventory, party, { add, settings: snapshot.settings });
    return checked.ok ? { ok: true } : { ok: false, code: 'REFUSED', message: checked.message };
}
