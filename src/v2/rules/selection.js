// P01: the reader chooses one checked pack before creating a character. The pin is a guarded
// UI receipt on the current reply, just like creation; replay uses its stored ops, never installed packs.
import { initialRules, pinRules, pinOf } from './pin.js';
import { initialProgress } from '../progress/domain.js';
import { initialTraining, trainingForPin } from '../training/domain.js';
import { registerPackDefs } from './items.js';
import { buildGuard } from '../progress/guard.js';
import { epochOf, isHash, isObject } from './ids.js';
import { canonicalJson } from './hash.js';

export const compatibleHost = flight => flight?.hostApi === 2 && flight.restore === 'idle'
    && flight.peers?.some(peer => peer.module === 'story-director' && peer.enabled && /^2\./.test(peer.version ?? ''));

// A surviving actor, including an old legacy actor, makes this a running character timeline.
const emptySlice = (slice, initial) => !slice || canonicalJson(slice) === canonicalJson(initial());
export const canPin = state => !pinOf(state) && !state?.domains?.party?.pc
    && Object.keys(state?.domains?.party?.actors ?? {}).length === 0
    && emptySlice(state?.domains?.rules, initialRules) && emptySlice(state?.domains?.progress, initialProgress)
    && emptySlice(state?.domains?.training, initialTraining);

const fields = ['pack', 'version', 'rulesHash', 'packHash'];
const validChoice = value => isObject(value) && Object.keys(value).length === fields.length
    && fields.every(key => Object.hasOwn(value, key)) && typeof value.pack === 'string' && value.pack.length > 0
    && typeof value.version === 'string' && value.version.length > 0 && isHash(value.rulesHash) && isHash(value.packHash);
const inputs = payload => ({ pack: payload.pack, version: payload.version, rulesHash: payload.rulesHash, packHash: payload.packHash });

export function pinReplay({ state, hash }, { guard, source } = {}) {
    if (guard?.predicate?.kind !== 'rules.pin') return undefined;
    const payload = guard.predicate.payload;
    if (!validChoice(payload) || !canPin(state) || guard.replyBound !== true || guard.rulesHash !== null || guard.epoch !== epochOf(state)) return { ok: false, reason: 'This character timeline can no longer pin rules.' };
    const expected = buildGuard({ hash, owner: guard.owner, epoch: guard.epoch, source, rulesHash: null,
        kind: 'rules.pin', payload, inputs: inputs(payload) });
    return { ok: expected.inputHash === guard.inputHash };
}

export function selectionPart({ preflight }) {
    const eligible = flight => flight?.hostApi === 2 && ['empty', 'legacy', 'current'].includes(flight.classification);
    const ready = () => {
        try {
            const flight = preflight();
            return compatibleHost(flight) && eligible(flight);
        } catch { return false; }
    };
    return {
        queries: {
            'rules.selection'(state, _args, tools) {
                const pin = pinOf(state);
                if (pin) return { state: 'pinned', offers: [], packHash: pin.identity.packHash };
                if (!eligible(preflight()) || !canPin(state)) return { state: 'legacy', offers: [] };
                let entries;
                try { entries = tools.query('packs.rules', { resolve: true }); } catch { entries = []; }
                const offers = (Array.isArray(entries) ? entries : []).filter(entry => entry.pin && validChoice({
                    pack: entry.pack, version: entry.version, rulesHash: entry.pin.rulesHash, packHash: entry.pin.packHash,
                })).map(entry => ({ pack: entry.pack, version: entry.version, name: entry.name,
                    rulesHash: entry.pin.rulesHash, packHash: entry.pin.packHash }));
                return { state: offers.length ? 'offered' : 'legacy', offers };
            },
        },
        commands: {
            'rules.pin'(ctx, payload) {
                if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Choose a rules pack yourself in Setup.');
                if (!validChoice(payload)) ctx.fail('INVALID', 'Choose a pack, version and both hashes from Setup.');
                if (!ready()) ctx.fail('DEPENDENCY_UNAVAILABLE', 'Rules pinning needs Story Block and Story Director ready.');
                const state = { domains: Object.fromEntries(['party', 'rules', 'progress', 'training'].map(name => [name, ctx.read(name)])) };
                if (!canPin(state)) ctx.fail('REFUSED', 'A running character timeline keeps its rules. Start a new character timeline to choose again.');
                let found;
                try { found = ctx.query('packs.rules', { pack: payload.pack, resolve: true }); } catch { ctx.fail('DEPENDENCY_UNAVAILABLE', 'Story Block cannot resolve this rules pack.'); }
                const given = found?.find(entry => entry.pack === payload.pack)?.pin;
                if (!given || given.packKey !== payload.pack || given.packVersion !== payload.version
                    || given.rulesHash !== payload.rulesHash || given.packHash !== payload.packHash) {
                    ctx.fail('STALE', 'That rules pack changed or was disabled. Open Setup again to choose its current version.');
                }
                const rules = initialRules();
                const problem = pinRules(rules, given);
                if (problem) ctx.fail('RULES_MISMATCH', problem);
                const source = ctx.source ?? ctx.fail('REFUSED', 'A first reply must exist to hold this character timeline\'s rules.');
                ctx.replayGuard({ ...buildGuard({ hash: value => ctx.hash(value), owner: ctx.module, epoch: epochOf(ctx),
                    source, rulesHash: null, kind: 'rules.pin', payload, inputs: inputs(payload) }), replyBound: true });
                Object.assign(ctx.draft('rules'), rules);
                Object.assign(ctx.draft('progress'), initialProgress());
                Object.assign(ctx.draft('training'), trainingForPin(given.resolved));
                registerPackDefs(ctx);
                return { summary: `Rules pinned: ${payload.pack} ${payload.version}.`, narrate: false,
                    data: { rulesHash: given.rulesHash, packHash: given.packHash, packId: given.packKey, version: given.packVersion } };
            },
        },
        hooks: { replayGuard: pinReplay },
    };
}
