// Test helper: progress slices built directly (no host), and the pinned index of the golden pack.
import { indexOf } from '../../../../src/v2/rules/graph.js';
import { initialRules, pinOf, pinRules } from '../../../../src/v2/rules/pin.js';
import { ACTOR, H, fixturePin, ref } from './fixture.js';

export function golden() {
    const slice = initialRules();
    const problem = pinRules(slice, fixturePin());
    if (problem) throw new Error(problem);
    return indexOf(pinOf({ domains: { rules: slice } }));
}

const rulesHash = () => H();

export const basic = (actor, cls) => ({ actor, milestone: 0, kind: 'class', previous: null, selected: ref(cls), skills: ['0', '1', '2'].map(n => ref(`s${cls.slice(1)}${n}`)), rulesHash: rulesHash() });
export const promo = (actor, milestone, from, to) => ({ actor, milestone, kind: 'class', previous: ref(from), selected: ref(to), skills: ['0', '1', '2'].map(n => ref(`s${to.slice(1)}${n}`)), rulesHash: rulesHash() });
export const step = (actor, milestone, skill, fromForm, option, n) => ({ actor, milestone, kind: 'path', skill: ref(skill), fromForm: ref(fromForm), option: ref(option), step: n, rulesHash: rulesHash() });

const SR = n => `sr_${n.toString(36).padStart(8, '0')}`;
const num = (prefix, n) => `${prefix}_${n.toString(36).padStart(8, '0')}`;

/**
 * A progress slice: `choices` (records as the builders above make them) and `uses` ({ formRef: credited uses } for
 * the actor), each use a credited attempt of its own on a reply of its own on day 0 (the caps are not in play).
 */
export function slice({ actor = ACTOR, choices = [], uses = {} } = {}) {
    const out = { schema: 2, choices: {}, attempts: {}, credits: {}, roster: { active: null }, temporary: {}, sealed: { forms: {}, days: {}, folded: 0 }, batches: {} };
    for (const choice of choices) out.choices[`${choice.actor}|${choice.milestone}`] = choice;
    let n = 0;
    for (const [form, count] of Object.entries(uses)) {
        const full = form.includes('/') ? form : ref(form);
        const skill = full.replace(/-base.*$/, '');
        for (let i = 0; i < count; i += 1) {
            n += 1;
            const id = num('at', n);
            const source = { sid: SR(n), swipeKey: num('sw', n), evidence: num('ev', n) };
            out.attempts[id] = { actor, skill, form: full, kind: 'narrative', source, capSource: source, cost: null, session: null, minute: null };
            out.credits[id] = { award: 1, reason: null, minute: 600, day: 0, reply: source.sid };
        }
    }
    return out;
}

/** The chain of choices of a character who took every promotion: c0 → c1 → c2 → c3. */
export const promoted = (actor = ACTOR) => [basic(actor, 'c0'), promo(actor, 10, 'c0', 'c1'), promo(actor, 20, 'c1', 'c2'), promo(actor, 30, 'c2', 'c3')];

export { ACTOR, H, ref };
