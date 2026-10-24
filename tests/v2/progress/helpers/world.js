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
import { part as rulesPart, pinOf, pinRules } from '../../../../src/v2/rules/index.js';
import { part as progressPart, recordAttempt, recordBasicClass } from '../../../../src/v2/progress/index.js';
import { levelFromEarned } from '../../../../src/v2/progress/level.js';
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
        domains: { ...rulesPart.domains, ...progressPart.domains },
        commands: {
            ...rulesPart.commands,
            ...progressPart.commands,
            'test.pin'(ctx) {
                const problem = pinRules(ctx.draft('rules'), given);
                if (problem) ctx.fail('REFUSED', problem);
                return { summary: 'Rules pinned.', narrate: false };
            },
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
                    ctx.claim(`rb:ep_00000001:${choice.kind === 'class' ? 'class' : 'path'}:${choice.actor}:${choice.milestone}`);
                }
                let n = Object.keys(progress.attempts).length;
                for (const [form, count] of Object.entries(uses)) {
                    for (let i = 0; i < count; i += 1) {
                        n += 1;
                        const id = `at_${n.toString(36).padStart(8, 's')}`;
                        const reply = `sr_${n.toString(36).padStart(8, 's')}`;
                        const source = { sid: ctx.source.sid, swipeKey: ctx.source.swipeKey, evidence: ctx.source.evidence };
                        progress.attempts[id] = { actor, skill: form.replace(/-base.*$/, ''), form, kind: 'narrative', source, capSource: { ...source, sid: reply }, cost: null, session: null, minute: null };
                        progress.credits[id] = { award: 1, reason: null, minute: n * DAY + 600, day: n, reply };
                        ctx.claim(`rb:ep_00000001:credit:${id}`);
                    }
                }
                return { summary: 'Seeded.', narrate: false };
            },
            'test.attempt'(ctx, input) {
                const made = recordAttempt(ctx, input);
                return { summary: 'Attempt.', narrate: false, data: made };
            },
        },
        queries: { ...rulesPart.queries },
        capture: {
            kinds: { attempt: { grammar: '! attempt ac_id | skill: s | form: f | key: k' } },
            apply(ctx, line) {
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
