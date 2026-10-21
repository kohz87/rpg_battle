// A fake Story Block for the return part's tests: a chat of carriers holding receipts the way the
// store keeps them (`extra.storySuite.receipts`, each receipt with its rev), the head state after
// each receipt (the fake's own bookkeeping, standing in for the store's replay), and an sdk with
// query, command (the return part's commands on a fake ctx, SPEC §3.2), receipts(), chat() and
// rewind({ index, beforeRev }) as MODULES §F17 describes it: the chat is cut after carrier `index`,
// that carrier keeps only its receipts before `beforeRev`, and the head is the state they leave.
// The party's real commands (party.create, party.applyResult) make your character and kill them.

import { part as partyPart } from '../../../../src/v2/party/index.js';
import { createReturnPart } from '../../../../src/v2/return/index.js';

const clone = value => structuredClone(value);

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

export class Rejection extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

function makeCtx(working, { own, commands, rev }) {
    const touched = new Set();
    const ctx = {
        receiptId: `rc_${String(rev).padStart(8, '0')}`,
        rev,
        touched,
        read: domain => deepFreeze(clone(working.domains[domain])),
        draft: domain => {
            if (!own.includes(domain)) throw new Rejection('NOT_OWNER', `Not the owner of ${domain}.`);
            touched.add(domain);
            return working.domains[domain];
        },
        call: (type, payload) => {
            if (!commands[type]) throw new Rejection('UNKNOWN_COMMAND', `No command ${type}.`);
            return commands[type](ctx, payload);
        },
        claim: key => {
            if (working.meta.claims[key]) return false;
            working.meta.claims[key] = true;
            return true;
        },
        rng: () => 0.5,
        roll: () => ({ total: 10, dice: [10] }),
        settings: () => ({}),
        time: () => null,
        fail: (code, message) => { throw new Rejection(code, message); },
        query: () => null,
    };
    return ctx;
}

/** Runs a command on a copy of `state`: { ok, state, result } or { ok: false, code, message }. */
export function runCommand(state, handler, payload, { own = ['party'], commands = partyPart.commands } = {}) {
    const working = clone(state);
    const ctx = makeCtx(working, { own, commands, rev: state.meta.rev + 1 });
    try {
        const result = handler(ctx, payload);
        for (const domain of ctx.touched) {
            const errors = partyPart.domains[domain]?.validate(working.domains[domain], working) ?? [];
            if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' ') };
        }
        working.meta.rev += 1;
        return { ok: true, state: working, result };
    } catch (error) {
        return { ok: false, code: error.code ?? 'FAILED', message: error.message };
    }
}

/** The state of a chat whose character is Ren (alive), at `place`. */
export function aliveState(place = 'the Old Weir') {
    const base = {
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            party: partyPart.domains.party.initial(),
            inventory: { defs: {}, stacks: {}, wallets: {}, aliases: {} },
            scene: { place: { name: place, kind: 'wild', region: '' }, present: [] },
            combat: { offers: [], session: null, beaten: [], last: null },
        },
    };
    const made = runCommand(base, partyPart.commands['party.create'], { name: 'Ren', points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } });
    if (!made.ok) throw new Error(made.message);
    return made.state;
}

/** `state` after a lost fight to the death, through the party's own party.applyResult. */
export function killed(state) {
    const pc = state.domains.party.actors[state.domains.party.pc];
    const out = runCommand(state, partyPart.commands['party.applyResult'], {
        outcome: 'defeat',
        stakes: 'death',
        actors: [{ id: pc.id, hp: { cur: 0, max: pc.hp.max }, mp: { ...pc.mp }, down: true, conditions: [], uses: {} }],
    });
    if (!out.ok) throw new Error(out.message);
    return out.state;
}

export const FIGHT = 'fi_dead0001';
export const OTHER_FIGHT = 'fi_won00001';

/**
 * A fake host. Build the chat with `greeting()`, `user()`, `reply()` and `receipt(type, data, {
 * state })` (a receipt on the last carrier, with the head state after it); then use `sdk`.
 */
export function createHost({ withReceipts = true, withChat = true, withRewind = true, rewindAnswer = null } = {}) {
    const chat = [];
    const after = new Map();            // rev → head state after that receipt
    let head = null;
    const calls = { rewind: [], command: [] };
    const returnPart = createReturnPart({ host: () => sdk });

    const lastCarrier = () => {
        for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user) return i;
        return -1;
    };
    const carrier = (mes = '') => ({ is_user: false, mes, swipe_id: 0, extra: { storySuite: { v: 2, sid: `sw_${chat.length}`, swipe: 0, ops: [], receipts: [], narrated: [] } } });

    const host = {
        chat,
        calls,
        get head() { return head; },
        greeting(state) {
            chat.push(carrier('The greeting.'));
            head = clone(state);
            after.set(head.meta.rev, head);
            return host;
        },
        user(mes = 'I go on.') { chat.push({ is_user: true, mes, extra: {} }); return host; },
        reply(mes = 'A reply.') { chat.push(carrier(mes)); return host; },
        /** A receipt on the head carrier; `state` is the head after it (default: head with rev bumped). */
        receipt(type, data = {}, { state = null, cause = 'ui', module = 'rpg-battle' } = {}) {
            const next = clone(state ?? head);
            next.meta.rev = head.meta.rev + 1;
            const receipt = { id: `rc_${String(next.meta.rev).padStart(8, '0')}`, type, module, cause, seed: 1, summary: type, narrate: false, data, rev: next.meta.rev };
            chat[lastCarrier()].extra.storySuite.receipts.push(receipt);
            after.set(next.meta.rev, next);
            head = next;
            return host;
        },
        sdk: null,
    };

    const query = (name, args) => {
        const answer = name === 'party.pc' ? partyPart.queries['party.pc'](head, args) : returnPart.queries[name](head, args, {});
        return answer === undefined ? undefined : clone(answer);
    };

    const sdk = {
        query,
        async command(type, payload, options = {}) {
            calls.command.push({ type, payload, options });
            // As Story Block's sdk.command: a module's command is the reader's action, never another cause.
            const cause = options?.cause !== undefined ? options.cause : 'ui';
            if (cause !== 'ui') return { ok: false, code: 'REFUSED', message: `"${cause}" is kept for Story Block itself.` };
            const handler = returnPart.commands[type];
            if (!handler) return { ok: false, code: 'UNKNOWN_COMMAND', message: `No command ${type}.` };
            const out = runCommand(head, handler, payload, { own: [], commands: returnPart.commands });
            if (!out.ok) return out;
            const receipt = { id: `rc_${String(out.state.meta.rev).padStart(8, '0')}`, type, module: 'rpg-battle', cause, seed: 1, ...out.result, rev: out.state.meta.rev };
            chat[lastCarrier()].extra.storySuite.receipts.push(receipt);
            after.set(out.state.meta.rev, out.state);
            head = out.state;
            return { ok: true, receipt };
        },
        view: () => ({ state: head, query, chat: { length: chat.length, lastUser: '' } }),
    };
    if (withReceipts) sdk.receipts = () => {
        const out = [];
        chat.forEach((message, index) => {
            if (message.is_user) return;
            for (const receipt of message.extra.storySuite.receipts) out.push({ index, receipt: clone(receipt) });
        });
        return out;
    };
    if (withChat) sdk.chat = () => chat;
    if (withRewind) sdk.rewind = async ({ index, beforeRev }) => {
        calls.rewind.push({ index, beforeRev });
        if (rewindAnswer) return rewindAnswer;
        chat.splice(index + 1);
        const record = chat[index].extra.storySuite;
        record.receipts = record.receipts.filter(receipt => receipt.rev < beforeRev);
        const kept = beforeRev - 1;
        head = clone(after.get(kept) ?? head);
        return { ok: true };
    };
    host.sdk = sdk;
    host.part = returnPart;
    return host;
}
