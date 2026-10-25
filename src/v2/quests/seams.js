// Public owner projections at planning time; replay uses the state-only projection below.
import { indexOfState } from '../rules/graph.js';
import { partyView, activeIds } from '../rules/sheet.js';
import { actors as partyActors } from '../party/queries.js';
import { rulesFlags } from '../rules/flags.js';
export const copy = value => structuredClone(value);
export const ask = (query, name, args = {}) => { try { return query(name, args) ?? null; } catch { return null; } };
export const resultData = out => out?.receipt?.data ?? out?.data ?? out;
export const fail = (ctx, out) => ctx.fail(out.code ?? 'DEPENDENCY_UNAVAILABLE', out.message ?? 'A quest prerequisite is unavailable.');
export const same = (hash, a, b) => hash(a) === hash(b);
export const writeId = (ctx, key) => {
    if (!ctx.source || typeof ctx.hash !== 'function') return ctx.fail('DEPENDENCY_UNAVAILABLE', 'Quest writes require a host Source.');
    return `wr_${ctx.hash({ source: ctx.source, writer: key }).slice(0, 8)}`;
};
export function call(ctx, type, payload) {
    const out = ctx.call(type, payload);
    if (out?.ok === false) fail(ctx, out);
    return resultData(out);
}
export function threadOf(query, payload = {}) {
    return ask(query, 'director.thread', payload.id ? { id: payload.id } : { key: payload.key });
}
export function pinned(slice) {
    return slice?.rulesVersion === 2 && /^[0-9a-f]{64}$/.test(slice.rulesHash ?? '') && slice.pin?.resolved
        ? { hash: slice.rulesHash, resolved: slice.pin.resolved } : null;
}
export function templates(pin) {
    const table = pin?.resolved?.quests;
    return Array.isArray(table) ? table : table && typeof table === 'object' ? Object.values(table) : [];
}
export function templateOf(pin, selector) {
    return templates(pin).find(t => t.id === selector || t.name === selector) ?? null;
}
export function freshThreadId(ctx) {
    for (let n = 0; n < 64; n++) {
        const id = ctx.id('th');
        if (!ask(ctx.query, 'director.thread', { id })) return id;
    }
    return ctx.fail('CONFLICT', 'No unused thread ID is available.');
}

/** D1 is the only cursor/epoch source. Missing host support always holds the action. */
export function boundary(ctx) {
    const cursor = typeof ctx.cursor === 'function' ? ctx.cursor() : null;
    const record = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
    if (!record(ctx.epoch) || !ctx.source || !cursor || !['sid', 'swipeKey', 'block'].every(k => record(cursor[k]))
        || !Number.isSafeInteger(cursor.op) || cursor.op < 0 || !Number.isSafeInteger(cursor.rev) || cursor.rev < 0
        || cursor.sid !== ctx.source.sid || cursor.swipeKey !== ctx.source.swipeKey) return ctx.fail('DEPENDENCY_UNAVAILABLE', 'Quests require the host cursor and epoch.');
    return { cursor, source: ctx.source, epoch: ctx.epoch };
}

export function questInputs(query, thread = null) {
    const party = ask(query, 'rules.party');
    const items = ask(query, 'inventory.items');
    const proofs = ask(query, 'story.evidence');
    const clock = ask(query, 'director.time');
    const place = ask(query, 'atlas.canonical');
    return { party, items, proofs, clock, place, threads: ask(query, 'director.threads'), flags: ask(query, 'rules.flags'),
        ...recordQuestInputs(query, thread),
        activeActors: Array.isArray(party?.active) ? party.active.filter(a => ['pc', 'companion'].includes(a.kind)).map(a => a.id) : null };
}

/** Foreign place/presence and carry settings are read once, while planning, never by a guard. */
export function recordQuestInputs(query, thread) {
    const quest = thread?.rpg;
    if (!quest) return {};
    const out = {};
    const prefix = ask(query, 'quest.replayInputs') ?? {};
    if (quest.turnInPlace !== null || quest.requirements.some(row => row.kind === 'place')) {
        out.place = ask(query, 'atlas.canonical');
        out.placeSource = copy(prefix.scenePlace ?? null);
        out.placeRef = out.place?.atlasId ? prefix.placeRefs?.[out.place.atlasId] ?? null : null;
    }
    if (quest.giver !== null) {
        const identity = ask(query, 'npc.identity', { id: quest.giver });
        const present = ask(query, 'scene.present');
        out.giverSource = identity?.id === quest.giver ? identity.name : null;
        out.giverPresent = !!identity && identity.id === quest.giver && Array.isArray(present) && present.includes(identity.name);
    }
    if (quest.reward.items.length) {
        const party = ask(query, 'rules.party');
        const defs = ask(query, 'inventory.definitions');
        const items = ask(query, 'inventory.items');
        const carry = ask(query, 'items.carry');
        if (!Array.isArray(party?.active) || !Array.isArray(defs) || !Array.isArray(items) || !carry) return { ...out, carry: null };
        const active = party.active.filter(actor => ['pc', 'companion'].includes(actor.kind));
        const owners = new Set(['party', ...active.map(actor => actor.id)]);
        const frozen = {};
        for (const def of defs) {
            const rule = ask(query, 'rules.item', { def: def.id });
            if (Number.isSafeInteger(rule?.weight) && rule.weight >= 0) frozen[def.id] = { ...def, weight: rule.weight };
        }
        const stacks = items.filter(item => owners.has(item.owner));
        out.carry = stacks.some(item => !frozen[item.def?.id ?? item.def]) ? null : {
            inventory: { defs: frozen, stacks: Object.fromEntries(stacks.map(item => [item.stack, {
                id: item.stack, def: item.def?.id ?? item.def, qty: item.qty, owner: item.owner, equipped: item.equipped ?? null,
            }])) },
            party: { order: active.map(actor => actor.id), actors: Object.fromEntries(active.map(actor => [actor.id, actor])) },
            settings: { carryLimit: carry.on, carrySize: carry.size, carryItems: (carry.bonuses ?? []).map(bonus => ({
                item: frozen[items.find(item => item.stack === bonus.stack)?.def]?.name ?? '', carry: bonus.carry,
            })).filter(entry => entry.item) },
        };
    }
    return out;
}

/** E1 guard projection. Reads prefix state only; never settings, receipts or another query.
 * Raw cross-owner reads are confined to this replay seam (the E1 exception).
 * Foreign place/giver/carry inputs ride with the block. No settings or live query is read here.
 */
export function replayInputs(state, { reply = null } = {}) {
    const domains = state?.domains ?? {};
    const threads = Object.values(domains.director?.threads ?? {}).map(({ track: _track, ...thread }) => copy(thread));
    const members = partyActors(state).filter(actor => ['pc', 'companion'].includes(actor.kind));
    const active = activeIds(domains.progress?.roster, members, domains.party?.pc);
    let party = { pc: domains.party?.pc ?? null, active: members.filter(actor => active.includes(actor.id)) };
    // The pin's sheet adapter derives current class and fitted level; no gear can qualify a base stat.
    if (domains.rules?.pin?.resolved?.manifest) party = partyView(indexOfState(state), state,
        name => name === 'party.actors' ? members : []);
    const activeActors = party?.active?.map(actor => actor.id) ?? [];
    const items = Object.values(domains.inventory?.stacks ?? {})
        .filter(stack => domains.inventory?.defs?.[stack.def])
        .map(stack => ({ stack: stack.id, def: stack.def, qty: stack.qty, owner: stack.owner, equipped: stack.equipped ?? null }));
    const tally = reply ? domains.inventory?.perReply?.[reply] : null;
    const storyCoin = reply ? { reply, coin: tally?.coin ?? 0, vouched: tally?.vouched ?? 0, claimed: state?.meta?.claims?.[`storycoin:${reply}`] === true } : null;
    const flags = domains.rules?.pin?.resolved?.manifest ? rulesFlags(state, {}) : null;
    return { storyCoin, threads, party: copy(party), flags, activeActors, items,
        clock: { minutes: domains.director?.time?.minutes ?? null }, place: null,
        scenePlace: copy(domains.scene?.place ?? null), present: copy(domains.scene?.present ?? []), placeRefs: copy(domains.atlas?.placeRefs ?? {}) };
}

export function guardQuestInputs(query, reply = null, recorded = {}) {
    const inputs = query('quest.replayInputs', { reply });
    const facts = { ...inputs, ...recorded, proofs: query('story.evidence', {}) };
    // Recorded identities are useful only while the scene and its canonical binding survive in the prefix.
    if (Object.hasOwn(recorded, 'place')) {
        const here = inputs.scenePlace;
        const source = recorded.placeSource;
        const samePlace = here && source && ['name', 'kind', 'region'].every(key => here[key] === source[key]);
        const sameRef = !recorded.place?.atlasId || inputs.placeRefs?.[recorded.place.atlasId] === recorded.placeRef;
        if (!samePlace || !sameRef) facts.place = null;
    }
    if (Object.hasOwn(recorded, 'giverPresent')) facts.giverPresent = recorded.giverPresent === true
        && typeof recorded.giverSource === 'string' && inputs.present?.includes(recorded.giverSource) === true;
    return facts;
}

// B's epochOf uses this genesis epoch until the host savepoints domain is installed.
export const stateEpoch = state => state?.domains?.savepoints?.epoch ?? 'ep_00000000';
