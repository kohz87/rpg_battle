// Test helper: the contract's golden rules pack (RB_CONTRACT §10 "Golden fixture seed"), checked and expanded
// by Story Block's own rules checker (the vendored copy), so the pinned ruleset in these tests is the one the
// real checker gives and never a hand-made one. H is its rulesHash.
import { RULES_V2_CONSTANTS, RULES_V2_PROGRESSION, canonicalizeJson, sha256, validateRulesPack } from '../../../vendor/story-block/src/v2/packs/rules-v2.js';

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

const withConstants = new Map();
/** The golden pack checked under other numbers (Story Block's checker applies them): `over` is laid over RULES_V2_CONSTANTS. */
export function pinWith(over) {
    const key = JSON.stringify(over);
    if (!withConstants.has(key)) {
        const checked = validateRulesPack(smallRulesPack(), { constants: { ...RULES_V2_CONSTANTS, ...over } });
        if (!checked.ok) throw new Error(`the golden pack does not check under ${key}: ${JSON.stringify(checked.errors)}`);
        withConstants.set(key, Object.freeze({
            resolved: checked.resolved, rulesHash: checked.rulesHash, progression: RULES_V2_PROGRESSION,
            packKey: 'fixture', packVersion: '2.0.0', packHash: checked.packHash,
            constantsHash: sha256(JSON.stringify(canonicalizeJson(checked.resolved.constants))),
        }));
    }
    return withConstants.get(key);
}

/**
 * The golden pack with item rules, a recipe, a shop and a quest that asks for flags: Rope (goods), Iron Sword (a one-handed weapon),
 * the recipe that forges the sword, the market that sells rope, and the bell quest (flags bell.rung, gate.open).
 */
export function inputsPack() {
    const pack = trainerPack();
    const row = (slug, name, over = {}) => ({ slug, name, kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...over });
    pack.content.items = [row('rope', 'Rope'), row('sword', 'Iron Sword', { kind: 'equipment', rarity: 'uncommon', value: 30, stack: false, slot: 'weapon', stats: { ATK: 3 } })];
    pack.content.rules[0].itemRules = [
        { def: 'rope', allowedSlots: [], hands: 0, requires: {}, weight: 1 },
        { def: 'sword', allowedSlots: ['weapon'], hands: 1, requires: { STR: 3 }, weight: 5 },
    ];
    pack.content.recipes = [{ slug: 'forge-blade', name: 'Forge a blade', craft: 'smithing', makes: 'sword', qty: 1, materials: [{ item: 'rope', qty: 1 }], fee: 0, minutes: 10, dc: 10, stat: 'STR' }];
    pack.content.shops = [{ slug: 'market', name: 'Market', place: 'pack.fixture/haven', kind: 'general', stock: [{ item: 'rope', qty: 5, price: 3 }] }];
    pack.content.quests = [{
        slug: 'bell', name: 'The bell', category: 'side', giver: null, turnInPlace: null,
        requirements: [{ kind: 'flag', key: 'bell.rung', value: true }, { kind: 'flag', key: 'gate.open', value: false }],
        objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/mill' }],
        reward: { coin: 0, xp: 0, items: [] }, durationMinutes: null, repeat: null, chain: null,
    }];
    return pack;
}
export const inputsPin = () => {
    const pin = pinFor('inputs', inputsPack());
    const def = (slug, name, over = {}) => ({ id: `pack.fixture/${slug}`, name, kind: 'goods', rarity: 'common', value: 2, stack: true, slot: null, stats: {}, effect: {}, tags: [], note: '', ...over });
    return Object.freeze({ ...pin, defs: { 'pack.fixture/rope': def('rope', 'Rope'), 'pack.fixture/sword': def('sword', 'Iron Sword', { kind: 'equipment', rarity: 'uncommon', value: 30, stack: false, slot: 'weapon', stats: { ATK: 3 } }) } });
};

/**
 * The golden pack with three fighting skills at the first tier: s00 hurts one foe and heals one ally (a mixed form), s01 strikes and
 * may stun, s02 shields its user and raises STR for a few rounds. The other tiers stay as they are.
 */
export function fightPack() {
    const pack = smallRulesPack();
    const skills = pack.content.rules[0].skills;
    const set = (slug, base) => { skills.find(skill => skill.slug === slug).base = base; };
    set('s00', { type: 'magic', stat: 'INT', unit: null, cost: { mp: 4, sp: 0, cooldown: 1 }, effects: [
        { op: 'damage', target: 'one', power: 60, element: 'fire', damageType: 'magic' },
        { op: 'heal', target: 'ally', power: 50, element: 'none', damageType: null },
    ] });
    set('s01', { type: 'physical', stat: 'STR', unit: null, cost: { mp: 0, sp: 2, cooldown: 0 }, effects: [
        { op: 'damage', target: 'one', power: 80, element: 'none', damageType: 'physical' },
        { op: 'condition', target: 'one', kind: 'stun', chance: 100, rounds: 1 },
    ] });
    set('s02', { type: 'buff', stat: 'INT', unit: null, cost: { mp: 3, sp: 0, cooldown: 2 }, effects: [
        { op: 'shield', target: 'self', power: 50, element: 'none', damageType: null },
        { op: 'stat', target: 'self', stat: 'STR', amount: 1, rounds: 2 },
    ] });
    // A tier-1 skill that mends its user a little each turn (a regeneration, whose strength the fight resolves and the party record does not keep).
    set('s12', { type: 'magic', stat: 'INT', unit: null, cost: { mp: 3, sp: 0, cooldown: 2 }, effects: [{ op: 'condition', target: 'self', kind: 'regen', chance: 100, rounds: 4 }] });
    // A tier-1 skill that calls a unit (a unit costs 12 of a tier's budget): half the caster's stats and pools, three rounds, the first class's forms.
    skills.find(skill => skill.slug === 's11').base = { type: 'physical', stat: 'STR', cost: { mp: 0, sp: 2, cooldown: 3 }, effects: [{ op: 'damage', target: 'one', power: 60, element: 'none', damageType: 'physical' }], unit: { kind: 'summon', class: 'c0', statShare: 50, poolShare: 50, rounds: 3 } };
    return pack;
}
export const fightPin = () => pinFor('fight', fightPack());
