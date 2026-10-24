// Test helper: a whole Story Block host (the vendored runtime and testkit) with RPG Battle's rules-v2 parts as
// they will be registered, plus the two things they read that other modules own, as small test stand-ins:
//   * a party (`party.actor`, `party.pc`) whose members have earned XP; their level is worked out from the
//     pinned curve with progress/level.js, like the real party's fitted level;
//   * Story Director's clock (`director.time`), set by the story line `~ time <minute>`.
// The module under test is registered as `rpg-battle` (guards name their owner module) with test-only commands
// for what the real payers will do later: pin a ruleset, start a character, record a paid attempt. Story lines:
//   ! xp <actor> | n: <xp>                       earned XP (a counter, like the real party's)
//   ! attempt <actor> | skill: s00 | form: s00-base | key: k1 [| kind: combat|narrative|training] [| minute: n]
//   ~ time <minute>                              the clock
import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { pinOf, pinRules, rulesParts } from '../../../../src/v2/rules/index.js';
import { recordAttempt, recordBasicClass, recordCombatUses } from '../../../../src/v2/progress/index.js';
import { part as trainingPart } from '../../../../src/v2/training/index.js';

const [[, rulesPart], [, progressPart]] = rulesParts;
import { levelFromEarned } from '../../../../src/v2/progress/level.js';
import { storedPool } from '../../../../src/v2/party/pools.js';
import { ACTOR, FRIEND, fixturePin, ref } from './fixture.js';

/** Story Director's clock as the story sets it: `~ time <minute>` is a set (ctx.absolute), like the real tracker's. */
export const CLOCK = {
    id: 'fake-director', name: 'Fake Story Director clock', version: '0.0.0',
    domains: { director: { initial: () => ({ time: { minutes: null } }), validate: () => [], counters: ['time/minutes'] } },
    queries: { 'director.time': state => ({ minutes: state?.domains?.director?.time?.minutes ?? null, text: '' }) },
    capture: {
        kinds: { time: { grammar: '~ time <minute>' } },
        apply(ctx, line) {
            const time = ctx.draft('director').time;
            ctx.absolute('director', '/time/minutes');
            time.minutes = Number(String(line.name ?? '').trim());
            return { summary: `Story time: ${time.minutes}.`, narrate: false };
        },
    },
};

/**
 * Story Director as far as training reads it: the clock (`~ time`), where the party is (`~ here <place id>` and the canonical
 * `atlas.canonical`) and `director.advance { minutes, cause, reason }` (system, a short cause label, one advance for a cause).
 */
/** The tier of each place for `world.areaTier` (a test sets it; an unlisted place is unknown). */
export const AREA_TIERS = {};

export const SD = {
    ...CLOCK,
    id: 'story-director',
    domains: { director: { initial: () => ({ time: { minutes: null }, here: null, advanced: {} }), validate: () => [], counters: ['time/minutes'] } },
    queries: {
        ...CLOCK.queries,
        'world.areaTier': (state, { place } = {}) => (Object.hasOwn(AREA_TIERS, place)
            ? { place, tier: AREA_TIERS[place], source: 'place', sourceId: place, allowedFoes: [], allowedTags: [], lore: [] }
            : { place: place ?? null, tier: null, source: 'unknown', sourceId: null, allowedFoes: [], allowedTags: [], lore: [] }),
        'atlas.canonical': state => { const id = state?.domains?.director?.here ?? null; return id ? { id, name: id, atlasId: null, regionId: null, source: 'pack' } : null; },
    },
    commands: {
        // Story Director's event adapter: a code-validated event proves a flag change, then asks for it (contract §3 rules.flagSet).
        'sd.event'(ctx, { flag, value, evidence = null, expectedHash = null, write = null } = {}) {
            const proof = evidence ?? ctx.proof({ kind: 'event', payload: { flag, value } }).id;
            const read = ctx.query('rules.flags', {});
            return ctx.call('rules.flagSet', { write: write ?? ctx.id('wr'), key: flag, value, evidence: proof, expectedHash: expectedHash ?? read.hash });
        },
        // Only the proof of an event (the adapter that asks for the flag comes in a later reply).
        'sd.prove'(ctx, { flag, value }) { return { summary: 'Event.', narrate: false, data: { evidence: ctx.proof({ kind: 'event', payload: { flag, value } }).id } }; },
        'director.advance'(ctx, payload = {}) {
            if (ctx.cause === 'ui') ctx.fail('REFUSED', 'director.advance: a click cannot move the clock.');
            if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(String(payload.cause ?? ''))) ctx.fail('INVALID', 'director.advance: "cause" must be a short label.');
            if (!Number.isInteger(payload.minutes) || payload.minutes < 1 || payload.minutes > 1440) ctx.fail('INVALID', 'director.advance: minutes 1-1440.');
            const director = ctx.draft('director');
            if (director.time.minutes === null) ctx.fail('REFUSED', 'director.advance: the clock is not set.');
            if (Object.hasOwn(director.advanced, payload.cause)) return { summary: 'Already taken.', narrate: false, data: { minutes: director.time.minutes, from: director.time.minutes, advanced: 0, held: 'once' } };
            const from = director.time.minutes;
            director.time.minutes += payload.minutes;
            director.advanced[payload.cause] = true;
            return { summary: `${payload.minutes} minutes pass.`, narrate: false, data: { minutes: director.time.minutes, from, advanced: payload.minutes } };
        },
    },
    capture: {
        kinds: {
            ...CLOCK.capture.kinds,
            here: { grammar: '~ here <place id>' },
        },
        apply(ctx, line) {
            if (line.kind === 'here') {
                ctx.draft('director').here = String(line.name);
                return { summary: `The party is at ${line.name}.`, narrate: false };
            }
            return CLOCK.capture.apply(ctx, line);
        },
    },
};

export const PARTY = {
    id: 'rb-test-party', name: 'Test party', version: '0.0.0',
    domains: { tparty: { initial: () => ({ order: [], members: {} }), counters: ['members/*/earned'], validate: () => [] } },
    commands: {
        'tp.add'(ctx, { id, name }) {
            const tp = ctx.draft('tparty');
            if (!tp.members[id]) { tp.members[id] = { id, name, earned: 0 }; tp.order.push(id); }
            return { summary: `${name} joins.`, narrate: false };
        },
    },
    queries: {
        'party.actor': (state, { id } = {}) => {
            const m = state?.domains?.tparty?.members?.[id];
            const pin = pinOf(state);
            if (!m || !pin) return null;
            const { level, xp } = levelFromEarned(m.earned, pin.resolved.constants);
            return { id: m.id, name: m.name, level, xp, earned: m.earned };
        },
        'party.pc': state => {
            const id = state?.domains?.tparty?.order?.[0];
            return id ? { id } : null;
        },
    },
    capture: {
        kinds: { xp: { grammar: '! xp ac_id | n: amount' } },
        apply(ctx, line) {
            const m = ctx.draft('tparty').members[line.name];
            if (!m) ctx.fail('NOT_FOUND', `No member ${line.name}.`);
            m.earned += Number(line.labels.n);
            return { summary: `${m.name} earns ${line.labels.n} XP.`, narrate: false };
        },
    },
};

/** The rules-v2 parts as one module, with the test-only commands and lines. `given`: what to pin (default: the golden pack); `id`: the module id (guards name it). */
export function rulesModule({ given = fixturePin(), id = 'rpg-battle' } = {}) {
    return {
        id, name: 'RPG Battle rules (test)', version: '2.0.0-test',
        domains: { ...rulesPart.domains, ...progressPart.domains, ...trainingPart.domains },
        commands: {
            ...rulesPart.commands,
            ...progressPart.commands,
            ...trainingPart.commands,
            'test.pin'(ctx) {
                const problem = pinRules(ctx.draft('rules'), given);
                if (problem) ctx.fail('REFUSED', problem);
                return { summary: 'Rules pinned.', narrate: false };
            },
            // An adapter of this module (craft, trade, loot) registering a generated item, and a rule event setting a flag.
            'test.register'(ctx, payload) { return ctx.call('rules.registerItem', payload); },
            'test.flagSet'(ctx, payload) { return ctx.call('rules.flagSet', payload); },
            'test.start'(ctx, { actor, class: cls }) {
                recordBasicClass(ctx, { actor, class: cls });
                return { summary: 'Started.', narrate: false };
            },
            // Writes records straight into the progress slice, unguarded, to set a scene up without playing it out: the
            // choices (each claimed, as a played choice is) and `uses` credited uses of each form, every use on a reply and a
            // story day of its own so no cap is in play.
            'test.seed'(ctx, { choices = [], uses = {}, actor = ACTOR }) {
                const progress = ctx.draft('progress');
                for (const choice of choices) {
                    progress.choices[`${choice.actor}|${choice.milestone}`] = choice;
                    ctx.claim(`rb:ep_00000000:${choice.kind === 'class' ? 'class' : 'path'}:${choice.actor}:${choice.milestone}`);
                }
                let n = Object.keys(progress.attempts).length;
                for (const [form, count] of Object.entries(uses)) {
                    for (let i = 0; i < count; i += 1) {
                        n += 1;
                        const id = `at_${n.toString(36).padStart(8, '0')}`;
                        const reply = `sr_${n.toString(36).padStart(8, '0')}`;
                        const source = { sid: ctx.source.sid, swipeKey: ctx.source.swipeKey, evidence: ctx.source.evidence };
                        progress.attempts[id] = { actor, skill: form.replace(/-base.*$/, ''), form, kind: 'narrative', source, capSource: { ...source, sid: reply }, cost: null, session: null, minute: null };
                        progress.credits[id] = { award: 1, reason: null, minute: (100000 + n) * DAY + 600, day: 100000 + n, reply };
                        ctx.claim(`rb:ep_00000000:credit:${id}`);
                    }
                }
                return { summary: 'Seeded.', narrate: false };
            },
            // A summon or pet of a fight, as the summon command (track B4) will leave it.
            'test.unit'(ctx, unit) {
                ctx.draft('progress').temporary[unit.id] = { kind: 'summon', owner: ACTOR, template: ref('s00'), fight: 'cf_00000001', name: 'Grey wolf', level: 5, hp: { cur: 20, max: 20 }, mp: { cur: 0, max: 0 }, sp: { cur: 5, max: 5 }, ended: null, ...unit };
                return { summary: 'Unit.', narrate: false };
            },
            'test.coin'(ctx, { amount }) {
                ctx.call('wallet.receive', { owner: 'party', amount, note: 'test' });
                return { summary: 'Coin.', narrate: false };
            },
            'test.combatEnd'(ctx, input) {
                return { summary: 'Fight ended.', narrate: false, data: recordCombatUses(ctx, input) };
            },
            // Sets a member's pool as the party keeps it (the module that owns the party writes it).
            'test.pool'(ctx, { actor, pool, cur }) {
                const member = ctx.draft('party').actors[actor];
                member[pool] = storedPool({ cur, max: member[pool].max });
                return { summary: 'Pool set.', narrate: false };
            },
            'test.attempt'(ctx, input) {
                const made = recordAttempt(ctx, input);
                return { summary: 'Attempt.', narrate: false, data: made };
            },
        },
        queries: { ...rulesPart.queries },
        capture: {
            kinds: { ...progressPart.kinds, attempt: { grammar: '! attempt ac_id | skill: s | form: f | key: k' } },
            apply(ctx, line) {
                if (line.kind === 'skill-use') return progressPart.kinds['skill-use'].apply(ctx, line);
                const l = line.labels;
                const input = { actor: line.name, skill: ref(l.skill), form: ref(l.form), kind: l.kind ?? 'narrative', key: l.key };
                if (l.minute !== undefined) input.minute = Number(l.minute);
                const made = recordAttempt(ctx, input);
                return { summary: `Attempt ${l.key}.`, narrate: false, data: made };
            },
        },
        hooks: { ...progressPart.hooks },
    };
}

/** A host with the stand-ins and the module; `ui(type, payload)` is the reader's click. */
export async function world(t, { given, modules = [] } = {}) {
    const host = await createHost({ modules: [CLOCK, PARTY, rulesModule({ given }), ...modules], core: false });
    t.after(() => host.close());
    t.mock.method(console, 'warn', () => {});
    const w = {
        host,
        ui: (type, payload = {}) => host.bus.command(type, payload, { cause: 'ui' }),
        q: (name, args = {}) => host.sdk.query(name, args),
        head: () => host.head(),
        slice: name => host.head().domains[name],
        progress: (actor = ACTOR) => host.sdk.query('rules.progress', { actor }),
        problems: () => host.store.problems(),
        reply: (text, lines = []) => (lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text),
        async say(text, lines = []) { return host.send('Go on.', w.reply(text, lines)); },
    };
    return w;
}

let keys = 0;
/** A fresh attempt key. */
export const nextKey = () => `k${(keys += 1)}`;
export const DAY = 1440;

/**
 * Plays replies until `forms` (refs of forms) of `actor` have `uses` credited uses each, as the caps allow: two
 * of a skill and six in all to a reply, thirty a day. The clock is set at the start of each reply to
 * `day * 1440 + 600`, moving to the next day every five replies, starting at `day`.
 * Returns the day after the last reply.
 */
export async function grind(w, { actor = ACTOR, forms, uses = 35, day = 1 } = {}) {
    const left = new Map(forms.map(form => [form, uses]));
    let replies = 0;
    while ([...left.values()].some(n => n > 0)) {
        const lines = [`~ time ${day * DAY + 600}`];
        for (const [form, n] of left) {
            const skill = form.replace(/-base.*$/, '');
            for (let i = 0; i < Math.min(2, n); i += 1) lines.push(`! attempt ${actor} | skill: ${skill.replace('pack.fixture/', '')} | form: ${form.replace('pack.fixture/', '')} | key: ${nextKey()}`);
            left.set(form, n - Math.min(2, n));
        }
        await w.say(`Practice ${replies}.`, lines);
        replies += 1;
        if (replies % 5 === 0) day += 1;
    }
    return day + 1;
}

/** A character in the party with the golden pack pinned and the basic class chosen: the start of every scenario. */
export async function started(t, options = {}) {
    const w = await world(t, options);
    await w.say('Dawn.');
    for (const [type, payload] of [['test.pin', {}], ['tp.add', { id: ACTOR, name: 'Astra' }], ['test.start', { actor: ACTOR, class: ref('c0') }]]) {
        const result = w.host.bus.command(type, payload, { cause: 'ui' });
        if (!result.ok) throw new Error(`${type}: ${result.code} ${result.message}`);
    }
    return w;
}

export { ACTOR, FRIEND, fixturePin, ref };


/**
 * The real RPG Battle module (party, creation, items, trade, ...) with the rules-v2 parts merged into it the way the lead
 * will register them: one module, `rpg-battle`, so the new commands may change the party's state and guards name it. The
 * character is made with the real command and starts in class c0 of the golden pack. `companions`: names of companions
 * added with the real internal command, each in class c0.
 */
/** The real module with the rules-v2 module's pieces merged into it, as module.js will register them (one module id, one module). */
export function mergeInto(base, extra) {
    return {
        ...base,
        domains: { ...base.domains, ...extra.domains },
        commands: { ...base.commands, ...extra.commands },
        queries: { ...base.queries, ...extra.queries },
        capture: {
            ...base.capture,
            kinds: { ...base.capture.kinds, ...extra.capture.kinds },
            apply(ctx, line) { return Object.hasOwn(extra.capture.kinds, line?.kind) ? extra.capture.apply(ctx, line) : base.capture.apply(ctx, line); },
        },
        hooks: { ...base.hooks, ...extra.hooks },
    };
}

export async function realWorld(t, { companions = [], modules = [], pin = true, character = true, settings = {}, reader = null, given = undefined, sd = false } = {}) {
    const { createModule, MODULE_ID } = await import('../../../../src/v2/module.js');
    const extra = rulesModule({ given });
    let sdk = null;
    const base = createModule({ settings: () => ({ ...(sdk?.settings(MODULE_ID) ?? {}), ...settings }) });
    const merged = mergeInto(base, extra);
    const host = await createHost({ modules: [sd === true ? SD : sd || CLOCK, merged, CALLER, ...modules], ...(reader ? { settings: { modules: { [MODULE_ID]: reader } } } : {}) });
    sdk = host.sdk;
    const saved = globalThis.StoryBlock;
    globalThis.StoryBlock = { apiVersion: 2, ready: Promise.resolve(sdk), sdk };
    t.after(() => {
        host.close();
        if (saved === undefined) delete globalThis.StoryBlock; else globalThis.StoryBlock = saved;
    });
    t.mock.method(console, 'warn', () => {});
    const ok = (out, what) => { if (!out.ok) throw new Error(`${what}: ${out.code} ${out.message}`); return out; };
    const internal = (type, payload = {}) => host.sdk.command('rbtest.call', { type, payload });
    if (character) ok(await host.sdk.command('party.create', { name: 'Astra', preset: 'fighter' }), 'party.create');
    const pc = character ? host.sdk.query('party.pc').id : null;
    // Without a character the story waits (canGenerate); setting the start card aside lets the replies come.
    if (!character) ok(await host.sdk.command('creation.skipStart', {}), 'creation.skipStart');
    await host.send('Dawn.', 'The road.');
    const mates = [];
    if (pin) ok(host.bus.command('test.pin', {}, { cause: 'ui' }), 'test.pin');
    if (pin && character) {
        ok(host.bus.command('test.start', { actor: pc, class: ref('c0') }, { cause: 'ui' }), 'test.start');
        for (const name of companions) mates.push(ok(await internal('party.addCompanion', { name, level: 1, class: ref('c0') }), 'party.addCompanion').receipt.data.actor);
    }
    return {
        host, pc, mates, internal,
        ui: (type, payload = {}) => host.bus.command(type, payload, { cause: 'ui' }),
        q: (name, args = {}) => host.sdk.query(name, args),
        head: () => host.head(),
        slice: name => host.head().domains[name],
        problems: () => host.store.problems(),
        say: (text, lines = []) => host.send('Go on.', lines.length ? `${text}\n\n<Changes>\n${lines.join('\n')}\n</Changes>` : text),
        progress: (actor = pc) => host.sdk.query('rules.progress', { actor }),
    };
}

// A tiny module that sends an internal command as another part would (the real party commands refuse a bare click).
const CALLER = { id: 'rb-test-caller', name: 'Caller', version: '0.0.0', commands: { 'rbtest.call': (ctx, { type, payload } = {}) => ctx.call(type, payload ?? {}) } };
