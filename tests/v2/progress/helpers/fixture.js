// Test helper: the contract's golden rules pack (RB_CONTRACT §10 "Golden fixture seed"), checked and expanded
// by Story Block's own rules checker (the vendored copy), so the pinned ruleset in these tests is the one the
// real checker gives and never a hand-made one. H is its rulesHash.
import { RULES_V2_PROGRESSION, canonicalizeJson, sha256, validateRulesPack } from '../../../vendor/story-block/src/v2/packs/rules-v2.js';

export function smallRulesPack() {
    const classes = [], skills = [], branches = [];
    for (let tier = 0; tier < 4; tier++) {
        const names = [0, 1, 2].map(n => `s${tier}${n}`);
        classes.push({ slug: `c${tier}`, name: `Class ${tier}`, tier, parent: tier ? `c${tier - 1}` : null, skills: names });
        for (const slug of names) {
            skills.push({ slug, name: slug, base: { type: 'physical', stat: 'STR', unit: null,
                cost: { mp: 0, sp: 1, cooldown: 0 }, effects: [{ op: 'damage', target: 'one', power: 20 * (tier + 1), element: 'none', damageType: 'physical' }] } });
            if (tier !== 3) continue; // no starter branching
            const base = `${slug}-base`;
            for (const parent of [base, ...['g', 'a', 'b'].map(c => `${base}-${c}`)]) {
                const step = parent === base ? 1 : 2;
                for (const choice of ['a', 'b']) {
                    const transforms = step === 1
                        ? [{ op: 'set-element', at: 0, value: choice === 'a' ? 'fire' : 'ice' }]
                        : [choice === 'a' ? { op: 'set-target', at: 0, value: 'all' } : { op: 'set-element', at: 0, value: 'lightning' }];
                    branches.push({ slug: `${parent}-${choice}`, name: `${parent}-${choice}`, skill: slug, fromForm: parent, step, choice, transforms });
                }
            }
        }
    }
    return { id: 'fixture', version: '2.0.0', name: 'Fixture', requires: { storyBlock: '^2', capabilities: ['rb-rules-v2'] },
        content: { rules: [{ slug: 'rules', name: 'Fixture rules', schema: 2, classes, skills, branches, itemRules: [], trainers: [] }],
            items: [], creatures: [], shops: [], recipes: [], quests: [], places: [{ slug: 'haven', name: 'Haven', x: 0, y: 0 }, { slug: 'mill', name: 'Mill', x: 1, y: 0 }] } };
}

/** The golden pack with two trainers at Haven: Old Brann (s00, s01, 20 coin) and Gale (s02, 5 coin, one frozen event, a storm). */
export function trainerPack() {
    const pack = smallRulesPack();
    pack.content.rules[0].trainers = [
        { slug: 'mentor', name: 'Old Brann', place: 'pack.fixture/haven', skills: ['s00', 's01'], fee: 20, minutes: 60, eventTemplates: [] },
        { slug: 'stormy', name: 'Gale', place: 'pack.fixture/haven', skills: ['s02'], fee: 5, minutes: 60, eventTemplates: ['storm'] },
    ];
    pack.content.events = [{ id: 'storm', when: 'gold > 5', cue: 'A storm breaks the lesson.' }];
    return pack;
}

let cached = null;
const variants = new Map();

/** fixturePin for another pack (cached by its name). */
export function pinFor(name, pack) {
    if (!variants.has(name)) {
        const checked = validateRulesPack(pack);
        if (!checked.ok) throw new Error(`the ${name} pack does not check: ${JSON.stringify(checked.errors)}`);
        variants.set(name, Object.freeze({
            resolved: checked.resolved, rulesHash: checked.rulesHash, progression: RULES_V2_PROGRESSION,
            packKey: 'fixture', packVersion: '2.0.0', packHash: checked.packHash,
            constantsHash: sha256(JSON.stringify(canonicalizeJson(checked.resolved.constants))),
        }));
    }
    return variants.get(name);
}
export const trainersPin = () => pinFor('trainers', trainerPack());

/** What Story Block's checker gives for the golden pack, as pinRules takes it: { resolved, rulesHash, progression, … }. */
export function fixturePin() {
    if (cached) return cached;
    const checked = validateRulesPack(smallRulesPack());
    if (!checked.ok) throw new Error(`the golden pack does not check: ${JSON.stringify(checked.errors)}`);
    cached = Object.freeze({
        resolved: checked.resolved, rulesHash: checked.rulesHash, progression: RULES_V2_PROGRESSION,
        packKey: 'fixture', packVersion: '2.0.0', packHash: checked.packHash,
        constantsHash: sha256(JSON.stringify(canonicalizeJson(checked.resolved.constants))),
    });
    return cached;
}

/** The contract's H for the golden pack. */
export const H = () => fixturePin().rulesHash;

export const ref = x => `pack.fixture/${x}`;
export const ACTOR = 'ac_00000001';
export const FRIEND = 'ac_00000002';
