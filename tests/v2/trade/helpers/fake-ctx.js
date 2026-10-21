// A fake Story Block host for the trade part's tests (SPEC §3.2, MODULES §A): one transaction
// per command on a draft of the whole state, ctx.read / draft / call / claim / rng / roll /
// settings / time / fail / receiptId / query, validators after the handler, nothing kept on a
// throw. Story Block's own commands that trade calls (inventory.consume, inventory.grant,
// wallet.pay, wallet.receive) and the scene queries are faked here with SPEC §7's shapes.

import { makeRng } from '../../../../src/rng.js';

const deepFreeze = value => {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
};
const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export class Rejection extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

// Story Block's commands, as trade expects them to behave.
const CORE_COMMANDS = {
    'inventory.consume': { owns: ['inventory'], run(ctx, { stack, qty }) {
        const inv = ctx.draft('inventory');
        const row = inv.stacks[stack];
        if (!row) ctx.fail('NOT_FOUND', 'That is not in the inventory.');
        if (!Number.isInteger(qty) || qty < 1) ctx.fail('INVALID', 'Bad qty.');
        if (row.qty < qty) ctx.fail('NOT_ENOUGH', `There is not enough ${inv.defs[row.def]?.name}.`);
        row.qty -= qty;
        if (!row.qty) delete inv.stacks[stack];
    } },
    'inventory.grant': { owns: ['inventory'], run(ctx, { def, qty, owner, from }) {
        if (!from) ctx.fail('INVALID', 'inventory.grant needs a receipt-backed cause.');
        const inv = ctx.draft('inventory');
        if (!inv.defs[def.id]) inv.defs[def.id] = copy(def);
        const same = Object.values(inv.stacks).find(row => row.def === def.id && row.owner === owner && inv.defs[def.id].stack);
        if (same) same.qty += qty;
        else {
            const id = `it_${String(Object.keys(inv.stacks).length + 1).padStart(8, '0')}`;
            inv.stacks[id] = { id, def: def.id, qty, owner, equipped: null, note: '', from };
        }
    } },
    'wallet.pay': { owns: ['inventory'], run(ctx, { owner, amount }) {
        const inv = ctx.draft('inventory');
        const purse = inv.wallets[owner] ?? { coin: 0 };
        if ((purse.coin ?? 0) < amount) ctx.fail('NOT_ENOUGH', 'There is not enough money.');
        inv.wallets[owner] = { ...purse, coin: purse.coin - amount };
    } },
    'wallet.receive': { owns: ['inventory'], run(ctx, { owner, amount }) {
        const inv = ctx.draft('inventory');
        const purse = inv.wallets[owner] ?? { coin: 0 };
        inv.wallets[owner] = { ...purse, coin: (purse.coin ?? 0) + amount };
    } },
};

const CORE_QUERIES = {
    'scene.place': state => copy(state.domains.scene?.place ?? null),
    'scene.present': state => copy(state.domains.scene?.present ?? []),
};

/**
 * A host around `part`: `state` is the whole State (SPEC §2.1); `settings`, `time` (story
 * minutes or null) and `hook(name)` may be changed between commands through the returned object.
 */
export function createHost(part, { state, settings = {}, time = null, hook = null } = {}) {
    const host = { state: copy(state), settings, time, hook, receipts: [], calls: [] };
    let counter = 0;
    const ownDomains = Object.keys(part.domains);

    function makeCtx(draft, owns, receiptId, rng) {
        const ctx = {
            receiptId,
            read: domain => deepFreeze(copy(draft.domains[domain])),
            draft: domain => {
                if (!owns.includes(domain)) throw new Rejection('NOT_OWNER', `Not the owner of ${domain}.`);
                draft.domains[domain] ??= {};
                return draft.domains[domain];
            },
            call: (type, payload) => {
                host.calls.push({ type, payload: copy(payload) });
                const core = CORE_COMMANDS[type];
                if (core) return core.run(makeCtx(draft, core.owns, receiptId, rng), copy(payload));
                const own = part.commands[type];
                if (!own) throw new Rejection('UNKNOWN_COMMAND', `No command ${type}.`);
                return own(makeCtx(draft, ownDomains, receiptId, rng), copy(payload));
            },
            claim: key => {
                draft.meta.claims ??= {};
                if (draft.meta.claims[key]) return false;
                draft.meta.claims[key] = true;
                return true;
            },
            rng: () => rng.next(),
            roll: () => ({ total: 0, dice: [] }),
            settings: () => host.settings,
            time: () => host.time,
            fail: (code, message) => { throw new Rejection(code, message); },
            query: (name, args) => {
                const query = CORE_QUERIES[name] ?? part.queries[name];
                if (!query) throw new Rejection('UNKNOWN_COMMAND', `No query ${name}.`);
                return query(deepFreeze(copy(draft)), args, { settings: host.settings });
            },
            ...(host.hook ? { hook: name => host.hook(name) } : {}),
        };
        return ctx;
    }

    host.command = (type, payload, { cause = 'ui', receiptId = null } = {}) => {
        const handler = part.commands[type];
        if (!handler) return { ok: false, code: 'UNKNOWN_COMMAND', message: `No command ${type}.` };
        const draft = copy(host.state);
        counter += 1;
        const id = receiptId ?? `rc_${counter.toString(36).padStart(8, '0')}`;
        try {
            const result = handler(makeCtx(draft, ownDomains, id, makeRng(counter)), copy(payload)) ?? {};
            for (const [domain, def] of Object.entries(part.domains)) {
                const errors = def.validate(draft.domains[domain], draft);
                if (errors.length) return { ok: false, code: 'INVALID', message: errors.join('; ') };
            }
            draft.meta.rev += 1;
            const receipt = { id, type, module: 'rpg-battle', cause, seed: counter, summary: result.summary ?? '', narrate: result.narrate !== false, data: result.data ?? {}, rev: draft.meta.rev };
            host.state = draft;
            host.receipts.push(receipt);
            return { ok: true, receipt };
        } catch (error) {
            if (error instanceof Rejection) return { ok: false, code: error.code, message: error.message };
            return { ok: false, code: 'FAILED', message: String(error?.stack ?? error) };
        }
    };

    host.query = (name, args = {}) => part.queries[name](deepFreeze(copy(host.state)), args, { settings: host.settings, hook: host.hook });
    host.view = () => ({ state: deepFreeze(copy(host.state)), settings: host.settings, query: (name, args) => (CORE_QUERIES[name] ?? part.queries[name])(host.state, args), chat: { length: 1, lastUser: '' } });
    return host;
}

// ---------------------------------------------------------------------------------------
// A chat to trade in: Bluewatch Village, Ren (level 3) with coin, materials, gear and goods.

export const def = (id, name, over = {}) => ({ id, name, kind: 'goods', rarity: 'common', value: 0, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...over });
export const stack = (id, defId, qty, over = {}) => ({ id, def: defId, qty, owner: 'party', equipped: null, note: '', from: '', ...over });

export function baseState({ place = { name: 'Bluewatch Village', kind: 'settlement', region: 'the Vale' }, present = [], coin = 500, minutes = null } = {}) {
    return {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            scene: { place, present },
            inventory: {
                defs: {
                    'story/rat-tail': def('story/rat-tail', 'Rat Tail', { kind: 'material' }),
                    'story/wolf-fang': def('story/wolf-fang', 'Wolf Fang', { kind: 'material', rarity: 'uncommon' }),
                    'story/brood-mother-skull': def('story/brood-mother-skull', 'Brood-Mother Skull', { kind: 'material', rarity: 'uncommon', note: 'MDEF, poison' }),
                    'story/iron-sword': def('story/iron-sword', 'Iron Sword', { kind: 'equipment', slot: 'weapon', stack: false, stats: { ATK: 4 } }),
                    'story/rope': def('story/rope', 'Rope'),
                    'story/old-letter': def('story/old-letter', 'Old Letter', { kind: 'quest' }),
                },
                stacks: {
                    it_00000001: stack('it_00000001', 'story/rat-tail', 5),
                    it_00000002: stack('it_00000002', 'story/wolf-fang', 3),
                    it_00000003: stack('it_00000003', 'story/brood-mother-skull', 1),
                    it_00000004: stack('it_00000004', 'story/iron-sword', 1, { equipped: 'weapon', owner: 'ac_ren00001' }),
                    it_00000005: stack('it_00000005', 'story/rope', 2),
                    it_00000006: stack('it_00000006', 'story/old-letter', 1),
                },
                wallets: { party: { coin } },
                aliases: {},
            },
            party: { pc: 'ac_ren00001', order: ['ac_ren00001'], actors: { ac_ren00001: { id: 'ac_ren00001', name: 'Ren', kind: 'pc', level: 3 } }, custom: {} },
            trade: { orders: {}, shops: {} },
            ...(minutes === null ? {} : { director: { time: { minutes }, threads: {}, keys: {}, problems: [] } }),
        },
    };
}
