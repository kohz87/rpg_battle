// Quest inputs are public owner projections. The only raw slice read here is RB's own pinned rules.
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

export function questInputs(query) {
    const party = ask(query, 'rules.party');
    const items = ask(query, 'inventory.items');
    const proofs = ask(query, 'story.evidence');
    const clock = ask(query, 'director.time');
    const place = ask(query, 'atlas.canonical');
    return { party, items, proofs, clock, place,
        activeActors: Array.isArray(party?.active) ? party.active.filter(a => ['pc', 'companion'].includes(a.kind)).map(a => a.id) : null };
}

/** E1 guard projection. Reads prefix state only; never settings, receipts or another query.
 * Raw cross-owner reads are confined to this replay seam (the E1 exception).
 * Canonical place/giver and requirements await B3's state projections.
 */
export function replayInputs(state, { reply = null } = {}) {
    const domains = state?.domains ?? {};
    const threads = Object.values(domains.director?.threads ?? {}).map(({ track: _track, ...thread }) => copy(thread));
    const party = domains.party ?? null;
    const active = party?.active ?? party?.order ?? [];
    const activeActors = active.filter(id => ['pc', 'companion'].includes(party?.actors?.[id]?.kind));
    const items = Object.values(domains.inventory?.stacks ?? {})
        .filter(stack => domains.inventory?.defs?.[stack.def])
        .map(stack => ({ stack: stack.id, def: stack.def, qty: stack.qty, owner: stack.owner }));
    const tally = reply ? domains.inventory?.perReply?.[reply] : null;
    const storyCoin = reply ? { reply, coin: tally?.coin ?? 0, vouched: tally?.vouched ?? 0, claimed: state?.meta?.claims?.[`storycoin:${reply}`] === true } : null;
    return { storyCoin, threads, party: copy(party), activeActors, items,
        clock: { minutes: domains.director?.time?.minutes ?? null }, place: null };
}

export function guardQuestInputs(query, reply = null) {
    const inputs = query('quest.replayInputs', { reply });
    return { ...inputs, proofs: query('story.evidence', {}) };
}

// B's epochOf uses this genesis epoch until the host savepoints domain is installed.
export const stateEpoch = state => state?.domains?.savepoints?.epoch ?? 'ep_00000000';
