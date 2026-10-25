// B3 requirement meanings, evaluated over public projections. Gear and ancestry never qualify.
const held = message => ({ ok: false, code: 'REFUSED', message });

export function evaluateRequirements(requirements, inputs) {
    const subject = inputs.party?.active?.find(actor => actor.id === inputs.party.pc);
    for (const requirement of requirements) {
        let met = false;
        switch (requirement.kind) {
            case 'class': met = !!subject && requirement.classes.includes(subject.class); break;
            case 'level': met = !!subject && subject.level >= requirement.min; break;
            case 'stat': met = !!subject && subject.stats?.[requirement.stat] >= requirement.min; break;
            case 'flag': met = Object.hasOwn(inputs.flags?.values ?? {}, requirement.key)
                && inputs.flags.values[requirement.key] === requirement.value; break;
            case 'place': met = inputs.place?.id === requirement.place; break;
            case 'quest': met = inputs.threads?.some(thread => thread.rpg?.template === requirement.template
                && thread.rpg.state === 'done' && thread.rpg.settlement?.outcome === 'done') === true; break;
            case 'thread': met = inputs.threads?.some(thread => thread.id === requirement.thread
                && !thread.rpg && thread.status === 'resolved' && thread.ended?.outcome === 'done') === true; break;
            case 'item': {
                const owners = new Set(['party', ...(inputs.activeActors ?? [])]);
                const quantity = (inputs.items ?? []).filter(item => owners.has(item.owner)
                    && (item.def?.id ?? item.def) === requirement.def).reduce((sum, item) => sum + item.qty, 0);
                met = Number.isSafeInteger(quantity) && quantity >= requirement.qty;
                break;
            }
            default: return { ok: false, code: 'INVALID', message: 'Unknown quest requirement.' };
        }
        if (!met) return held(`The ${requirement.kind} requirement is not met.`);
    }
    return { ok: true };
}
