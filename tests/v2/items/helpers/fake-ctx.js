// A fake command ctx (SPEC §3.2) for the items part's tests, with the commands it calls faked
// in the shapes of SPEC §7 (inventory) and MODULES §B1 (party). `run` works like the command
// bus: the handler runs on a copy of the state; a throw rejects the whole command and leaves
// the state as it was (nothing saved); success keeps the copy and returns the receipt fields.

const clone = value => JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
}

class CommandError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

const fail = (code, message) => { throw new CommandError(code, message); };

// The other owners' commands, as their specs describe them.
const OWNERS = {
    'inventory.consume'(draft, { stack, qty = 1 }) {
        const entry = draft.domains.inventory.stacks[stack];
        if (!entry) fail('NOT_FOUND', 'No such stack.');
        if (!Number.isInteger(qty) || qty < 1 || entry.qty < qty) fail('NOT_ENOUGH', 'Not enough left.');
        entry.qty -= qty;
        if (entry.qty === 0) delete draft.domains.inventory.stacks[stack];
    },
    'inventory.equip'(draft, { stack, slot }) {
        const entry = draft.domains.inventory.stacks[stack];
        if (!entry) fail('NOT_FOUND', 'No such stack.');
        entry.equipped = slot;
    },
    'inventory.unequip'(draft, { stack }) {
        const entry = draft.domains.inventory.stacks[stack];
        if (!entry) fail('NOT_FOUND', 'No such stack.');
        entry.equipped = null;
    },
    'inventory.transfer'(draft, { stack, to, qty }) {
        const stacks = draft.domains.inventory.stacks;
        const entry = stacks[stack];
        if (!entry) fail('NOT_FOUND', 'No such stack.');
        if (qty === entry.qty) {
            entry.owner = to;
            return;
        }
        entry.qty -= qty;
        const id = `it_split${Object.keys(stacks).length.toString(36).padStart(3, '0')}`;
        stacks[id] = { ...clone(entry), id, qty, owner: to, equipped: null };
    },
    'party.heal'(draft, { actor, hp = 0, cure = [] }) {
        const entry = draft.domains.party.actors[actor];
        if (!entry) fail('NOT_FOUND', 'No such actor.');
        entry.hp.cur = Math.min(entry.hp.max, entry.hp.cur + hp);
        entry.conditions = entry.conditions.filter(condition => !cure.includes(condition.kind));
    },
    'party.restore'(draft, { actor, mp = 0 }) {
        const entry = draft.domains.party.actors[actor];
        if (!entry) fail('NOT_FOUND', 'No such actor.');
        entry.mp.cur = Math.min(entry.mp.max, entry.mp.cur + mp);
    },
};

/**
 * makeCtx({ state, settings, handlers }) → { run(type, payload), state(), calls, ctx }.
 * `handlers` are the commands under test ({ 'item.use': fn, … }); `calls` lists every
 * ctx.call of the last run, in order.
 */
export function makeCtx({ state, settings = {}, handlers = {}, queries = {} }) {
    let committed = clone(state);
    let draft = null;
    const claims = new Set();
    const harness = { calls: [], saves: 0 };
    const ctx = {
        receiptId: 'rc_test0001',
        read: domain => deepFreeze(clone(draft.domains[domain])),
        draft: domain => fail('NOT_OWNER', `The items part owns no domain (${domain}).`),
        call(type, payload) {
            harness.calls.push({ type, payload: clone(payload) });
            const owner = OWNERS[type];
            if (!owner) fail('UNKNOWN_COMMAND', `No command ${type}.`);
            return owner(draft, clone(payload)) ?? {};
        },
        claim(key) {
            if (claims.has(key)) return false;
            claims.add(key);
            return true;
        },
        rng: () => 0.5,
        roll: () => ({ total: 7, dice: [3, 4] }),
        settings: () => clone(settings),
        time: () => null,
        query: (name, args) => queries[name](deepFreeze(clone(draft)), args),
        fail,
    };
    harness.ctx = ctx;
    harness.state = () => clone(committed);
    harness.run = (type, payload) => {
        harness.calls = [];
        draft = clone(committed);
        try {
            const result = handlers[type](ctx, payload);
            committed = draft;
            harness.saves += 1;
            return { ok: true, receipt: { type, summary: result.summary, narrate: result.narrate, data: result.data } };
        } catch (error) {
            if (!(error instanceof CommandError)) throw error;
            return { ok: false, code: error.code, message: error.message };
        } finally {
            draft = null;
        }
    };
    return harness;
}
