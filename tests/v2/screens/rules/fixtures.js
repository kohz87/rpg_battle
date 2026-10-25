// Track C fixtures (RB_PHASE0 §10 "C: query/payload fixtures"): the golden seed and the constructors the contract gives,
// extended with the explicit C01-C19 mutations as plain query answers and command payloads. Built from public projections
// only. Real-module coverage is in real-module.test.js; peer contracts absent from this checkout stay in PENDING.
//
// Projection unit fixtures also describe peer queries that this checkout cannot implement. PENDING lists
// each one: who builds it (A, B or E; the owning module in brackets), and whether its shape is the contract's (`§3`) or
// something the contract left open that C had to make up (`gap`). A `gap` shape is a request to the lead, not a decision.

import { createHash } from 'node:crypto';
import { listItems } from '../../../vendor/story-block/src/v2/domains/inventory.js';
import { makeState } from '../helpers/state.js';

export const sha256 = text => createHash('sha256').update(text).digest('hex');
const sortKeys = value => (Array.isArray(value) ? value.map(sortKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value);
/** SHA-256 of normalized JSON: sorted keys, array order kept (RB_PHASE0 §4 Hash). */
export const hashOf = value => sha256(JSON.stringify(sortKeys(value)));

// ---- the contract's own constructors (RB_PHASE0 §10, Golden fixture seed) ------------------------------------------------

export const CONSTANTS = Object.freeze({
    levelCap: 99, startLevel: 1, startStat: 5, startPoints: 10, pointsPerLevel: 4, statCap: 99, xpPerLevel: 100,
    masteryAt: [1, 5, 12, 22, 35], usePerSkillReply: 2, usePerSkillDay: 10, usePerActorReply: 6, usePerActorDay: 30,
    trainMinutes: 60, trainCredits: 2, trainEventPercent: 10, promotionMilestones: [10, 20, 30], pathMilestones: [40, 50, 60, 70, 80, 90],
    classBudget: [12, 24, 36, 48], pathBudgetIncrement: 12, deathDc: 15, injuryMinutes: 1440, injuryCheckPenalty: -2, temporaryLimit: 6,
    promptChars: 2000, difficulty: 'normal', clockMinutesPerDay: 1440,
});

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

export function goldenSeed(H, payloadHash, lineage) {
    const source = { sid: 'sr_00000010', swipeKey: 'sw_00000010', evidence: 'ev_00000010', ordinal: 0 };
    const cursor = { sid: source.sid, swipeKey: source.swipeKey, block: 'bl_00000010', op: 0, rev: 10 };
    const actor = { id: 'ac_00000001', name: 'Astra', kind: 'pc', npc: null, npcId: null, role: 'traveller', portrait: null,
        background: '', origin: { race: null, talents: [] }, tags: [], createdAtMinute: 14400, growth: 'manual',
        control: 'player', life: 'alive', level: 1, earned: 0, levelSteps: {}, points: 0,
        stats: { STR: 15, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 },
        hp: { cur: 74, max: 74 }, mp: { cur: 32, max: 32 }, sp: { cur: 40, max: 40 }, conditions: {},
        class: 'pack.fixture/c0', classPath: ['pack.fixture/c0'],
        skills: [0, 1, 2].map(n => ({ skill: `pack.fixture/s0${n}`, form: `pack.fixture/s0${n}-base`, steps: 0 })), temporary: null };
    const friend = { ...structuredClone(actor), id: 'ac_00000002', name: 'Lyra', kind: 'companion',
        npc: 'Lyra', npcId: 'np_00000001', control: 'auto' };
    const quest = { id: 'th_job00001', template: 'story/walk', instance: 1, title: 'Visit the mill',
        category: 'side', giver: null, turnInPlace: 'pack.fixture/haven', requirements: [],
        objectives: [{ id: 'ob_00000001', kind: 'visit', place: 'pack.fixture/mill' }], evidence: {},
        reward: { coin: 30, xp: 25, items: [] }, storyCredit: { coin: 0, claims: [] }, acceptedAt: null, acceptedCursor: null,
        deadline: null, repeat: null, chain: null, state: 'offered', settlement: null };
    const snapshot = { id: 'sp_00000010', capturedAtRev: 10, label: 'Day 10 start', kind: 'day-start', name: 'Day 10 start',
        epoch: 'ep_00000001', target: cursor, eligibleFrom: cursor, minute: 14400, day: 10,
        scene: { place: 'pack.fixture/haven', text: 'Haven at dawn' }, journal: null, payloadHash,
        participants: [], lineage, available: true };
    return { H, source, cursor, actor, friend, quest, snapshot, publicOnly: true };
}

export function queryFixtures(seed) {
    const { H, actor, quest, cursor } = seed, ref = x => `pack.fixture/${x}`;
    const slots = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2'];
    const thresholds = [1, 5, 12, 22, 35];
    const masteryOf = uses => thresholds.filter(at => uses >= at).length;
    const skill = (key, form = `${key}-base`, uses = 35, steps = 0) => ({ skill: ref(key), form: ref(form), name: key,
        mastery: masteryOf(uses), uses, nextAt: thresholds.find(at => uses < at) ?? null, steps,
        formMastery: { [ref(form)]: { uses, mastery: masteryOf(uses) } } });
    const sheet = { id: actor.id, name: actor.name, role: actor.role, portrait: null, background: '', origin: actor.origin,
        kind: 'pc', npcId: null, control: 'player', life: 'alive', level: 10, xp: 0, xpToNext: 100, stats: actor.stats,
        unspent: 36, hp: { cur: 110, max: 110 }, mp: { cur: 50, max: 50 }, sp: { cur: 58, max: 58 }, conditions: [],
        class: ref('c0'), tier: 0, skills: [0, 1, 2].map(n => skill(`s0${n}`)),
        gear: Object.fromEntries(slots.map(k => [k, null])) };
    const progress = { actor: actor.id, level: 10, class: ref('c0'), tier: 0,
        checklist: sheet.skills.map(s => ({ skill: s.skill, form: s.form, mastery: s.mastery, needed: 5 })),
        promotions: [{ milestone: 10, eligible: true, choices: [ref('c1')], why: [] }], pathways: [] };
    const restoreAt = { sid: 'sr_00000015', swipeKey: 'sw_00000015', block: 'bl_00000015', op: 0, rev: 15 };
    const lastReturn = { id: 'rt_00000015', deathEvents: ['de_00000015'], batchResult: { id: 'br_00000015', hash: H }, snapshot: 'sp_00000010', target: cursor,
        restoreAt, oldEpoch: 'ep_00000001', newEpoch: 'ep_00000002', faded: { after: cursor, through: restoreAt },
        memory: 'deja-vu', cue: 'cu_00000015', status: 'complete' };
    return {
        C02: { queries: { 'rules.sheet': sheet, 'rules.progress': progress }, command: ['class.choose',
            { actor: actor.id, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: H }] },
        C03: { queries: { 'rules.sheet': sheet }, attempt: { expectedAward: 0, reason: 'mastered' } },
        C05: { queries: { 'rules.progress': { ...progress, level: 50, class: ref('c3'), tier: 3, promotions: [],
            checklist: [0, 1, 2].map(n => ({ skill: ref(`s3${n}`), form: ref(`s3${n}-base${n === 0 ? '-a' : ''}`), mastery: 5, needed: 5 })),
            pathways: [{ milestone: 50, eligible: true, skills: [0, 1, 2].map(n => { const f = `s3${n}-base${n === 0 ? '-a' : ''}`;
                return { skill: ref(`s3${n}`), fromForm: ref(f), step: n === 0 ? 2 : 1, options: ['g', 'a', 'b'].map(c => ref(`${f}-${c}`)) }; }), why: [] }] } },
            command: ['path.choose', { actor: actor.id, milestone: 50, skill: ref('s30'), fromForm: ref('s30-base-a'), option: ref('s30-base-a-g'), rulesHash: H }] },
        C07: { queries: { 'director.time': { minutes: 7200, text: 'Day 5 start' }, 'rules.quests': [{ ...quest, state: 'expired', acceptedAt: 7100,
            acceptedCursor: { sid: 'sr_00000007', swipeKey: 'sw_00000007', block: 'bl_00000007', op: 0, rev: 7 },
            deadline: 7200, settlement: { id: 'st_00000007', source: seed.source, outcome: 'expired', coinPaid: 0, xpPaid: 0, itemsPaid: [],
                claim: 'rb:ep_00000001:quest:th_job00001:1:settled' }, ready: false, blocked: ['Expired'], remainingMinutes: 0 }] } },
        C12: { queries: { 'return.status': { dead: false, point: null, pending: false, memory: 'deja-vu', lastReturn } },
            command: ['return.cue', { return: lastReturn.id }], expectedCaller: 'host-complete-token' },
        C14: { result: { ok: false, code: 'REPLAY_PREREQUISITE', message: 'The earlier prerequisite was removed.' } },
    };
}

export const H = hashOf({ pack: smallRulesPack(), schema: 2, constants: CONSTANTS });
export const seed = goldenSeed(H, sha256('fixture-payload'), sha256('fixture-lineage'));
export const QF = queryFixtures(seed);

// ---- public contracts and the remaining peer seams ------------------------------------------------------------------------------------

/**
 * Public queries and commands consumed by the screens. REAL_API names the implemented RB seams; PENDING retains peer handoffs. `owner` is the track (A, B, E) that builds it, with the
 * module that answers in brackets; `shape` says whether the contract gives the payload (`§3`, `§10`, `appendix`) or left it
 * open (`gap`: C made a minimal one up and needs the lead's decision).
 */
export const CONTRACTS = Object.freeze({
    'quest.open': { owner: 'A', shape: '{id,template,text,foe?,place?,item?}' },
    'quest.openTemplates': { owner: 'A', shape: '[{id,name,kinds}]' },
    // queries
    'rules.party': { owner: 'B', shape: '§3 PartyView' },
    'rules.progress': { owner: 'B', shape: '§3 ProgressView' },
    'rules.identity': { owner: 'B', shape: '{hash, packId, version}' },
    'rules.classes': { owner: 'B', shape: '({tier?}) -> {id,name,tier,parent,skills:Ref[3]}[]' },
    'rules.names': { owner: 'B', shape: '({refs}) -> Record<Ref,Text80>' },
    'rules.training': { owner: 'B', shape: '{actor,session,caps,offers}; offers carry skill.train payloads' },
    'rules.flags': { owner: 'B', shape: '§3 {values,hash}' },
    'rules.item': { owner: 'B', shape: 'ItemRule|null' },
    'rules.quests': { owner: 'A', shape: '§3 QuestView[]' },
    'rules.equipPlan': { owner: 'A', shape: '§3 {ok,plan}|Failure' },
    'items.slots': { owner: 'A', shape: '§3 {slots:[{key,label,blockedBy}]} plus compat counts' },
    'items.canWear': { owner: 'A', shape: '§3 {ok,why?} with targetSlot' },
    'director.contract': { owner: 'B', module: 'SD', shape: '§2' },
    'checks.policy': { owner: 'B', module: 'SD', shape: '§3 P09' },
    'atlas.policy': { owner: 'B', module: 'SD', shape: '§3 P24' },
    'atlas.canonical': { owner: 'B', module: 'SD', shape: '§3 P24' },
    'atlas.candidates': { owner: 'B', module: 'SD', shape: 'gap', note: 'atlas.placeBind needs the pack places a held place can bind to; no query lists them. Stub: ({place}) -> {place, definitions:Ref[]}' },
    'world.areaTier': { owner: 'B', module: 'SD', shape: '§3 AreaTier' },
    'journal.day': { owner: 'B', module: 'SD', shape: '§3 JournalDay' },
    'npc.identity': { owner: 'B', module: 'NSD', shape: '§8' },
    'savepoint.contract': { owner: 'E', module: 'SB', shape: '§2' },
    'savepoint.list': { owner: 'E', module: 'SB', shape: '§3 Snapshot[]' },
    'inventory.definitions': { owner: 'E', module: 'SB', shape: '§3 ItemDef[]' },
    // commands (payload fixtures; the command itself belongs to its owner)
    'class.choose': { owner: 'B', shape: '§3' }, 'path.choose': { owner: 'B', shape: '§3' }, 'skill.train': { owner: 'B', shape: '§3; rules.training offers carry the session ID' },
    'quest.take': { owner: 'A', shape: '§3' }, 'quest.abandon': { owner: 'A', shape: '§3' }, 'quest.finish': { owner: 'A', shape: '§3' },
    'party.setActive': { owner: 'B', shape: '§3' }, 'summon.end': { owner: 'B', shape: '§3' },
    'item.equip': { owner: 'A', shape: '§3 targetSlot' },
    'checks.actor': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`: host-stamped, to confirm)' },
    'checks.link': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`)' },
    'atlas.region': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`)' }, 'atlas.placeRegion': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`)' },
    'atlas.dangerSet': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`)' }, 'atlas.placeBind': { owner: 'B', module: 'SD', shape: '§3 P24 (UI omits `write`)' },
    'savepoint.make': { owner: 'E', module: 'SB', shape: '§3' },
    'creation.finish': { owner: 'B', shape: '§3 class:Ref + checkActor?:RecordId' },
    'party.acceptOffer': { owner: 'B', shape: '{offer,class?}; pinned joins require a reader-selected class' },
});

export const REAL_API = Object.freeze(['rules.party', 'rules.progress', 'rules.identity', 'rules.classes', 'rules.names', 'rules.training',
    'rules.flags', 'rules.item', 'class.choose', 'path.choose', 'skill.train', 'party.setActive', 'summon.end', 'creation.finish', 'party.acceptOffer', 'savepoint.list', 'savepoint.make', 'inventory.definitions']);
export const PENDING = Object.freeze(Object.fromEntries(Object.entries(CONTRACTS).filter(([name]) => !REAL_API.includes(name))));

// ---- names, refs and sheets ----------------------------------------------------------------------------------------------

export const ref = x => `pack.fixture/${x}`;
/** Shipped queries the views also read (not pending anything). */
export const SHIPPED_QUERIES = Object.freeze(['director.time', 'director.threads', 'chronicle.day', 'items.gear', 'items.condition', 'inventory.items', 'party.offers']);
export const PC = seed.actor.id;
export const LYRA = seed.friend.id;
export const BRAM = 'ac_00000003';
export const CASS = 'ac_00000004';
export const DOV = 'ac_00000005';
export const WOLF = 'ac_00000006';
export const SPARK = 'ac_00000007';

const CLASS_NAMES = ['Wayfarer', 'Duelist', 'Champion', 'Paragon'];
const SKILL_WORDS = ['Strike', 'Guard', 'Feint'];
export const NAMES = (() => {
    const table = {};
    CLASS_NAMES.forEach((name, tier) => {
        table[ref(`c${tier}`)] = name;
        [0, 1, 2].forEach(n => {
            const skill = `${name} ${SKILL_WORDS[n]}`;
            table[ref(`s${tier}${n}`)] = skill;
            table[ref(`s${tier}${n}-base`)] = skill;
            for (const parent of [`s${tier}${n}-base`, ...['g', 'a', 'b'].map(c => `s${tier}${n}-base-${c}`)]) {
                for (const choice of ['g', 'a', 'b']) {
                    table[ref(`${parent}-${choice}`)] = `${skill}, ${parent.endsWith('base') ? '' : `${table[ref(parent)]?.split(', ').pop()} then `}${{ g: 'generated', a: 'path A', b: 'path B' }[choice]}`;
                }
            }
        });
    });
    for (const [key, name] of Object.entries({ 'story/walk': 'Walk', 'pack.fixture/next': 'The next job', 'pack.fixture/mill': 'Mill', 'pack.fixture/haven': 'Haven', 'pack.fixture/wolf': 'Wolf', 'pack.fixture/pelt': 'Wolf pelt' })) table[key] = name;
    ['Track', 'Snare', 'Dash'].forEach((name, n) => { table[ref(`s0x${n}`)] = name; });
    return table;
})();

const THRESHOLDS = [1, 5, 12, 22, 35];
export const masteryOf = uses => THRESHOLDS.filter(at => uses >= at).length;
export const SLOT_KEYS = ['weapon', 'offhand', 'head', 'body', 'legs', 'feet', 'accessory-1', 'accessory-2'];

/** A SkillView (RB_PHASE0 §3) for skill `key` in `form`, at `uses` uses. */
export function skillView(key, form = `${key}-base`, uses = 0, steps = 0) {
    return { skill: ref(key), form: ref(form), name: NAMES[ref(key)] ?? key, mastery: masteryOf(uses), uses, nextAt: THRESHOLDS.find(at => uses < at) ?? null, steps,
        formMastery: { [ref(form)]: { uses, mastery: masteryOf(uses) } } };
}
export const skillsOf = (tier, uses = [0, 0, 0]) => [0, 1, 2].map(n => skillView(`s${tier}${n}`, `s${tier}${n}-base`, uses[n] ?? 0));
export const emptyGear = () => Object.fromEntries(SLOT_KEYS.map(key => [key, null]));

/** A SheetView (RB_PHASE0 §3). Fresh: level 1, class c0, three skills at 0 / 5. */
export function sheetOf(overrides = {}) {
    return {
        id: PC, name: 'Astra', role: 'traveller', portrait: null, background: '', origin: { race: null, talents: [] }, kind: 'pc', npcId: null,
        level: 1, xp: 0, xpToNext: 100, stats: { ...seed.actor.stats }, unspent: 0,
        hp: { cur: 74, max: 74 }, mp: { cur: 32, max: 32 }, sp: { cur: 40, max: 40 }, life: 'alive', conditions: [],
        class: ref('c0'), tier: 0, skills: skillsOf(0), gear: emptyGear(), control: 'player', ...overrides,
    };
}
export const companionOf = (id, name, overrides = {}) => sheetOf({ id, name, kind: 'companion', control: 'auto', role: 'ranger', npcId: null, ...overrides });
export const temporaryOf = (id, name, kind, overrides = {}) => ({ id, name, kind, role: kind, level: 5, hp: { cur: 20, max: 20 }, ...overrides });

export function partyOf({ active, reserve = [], temporary = [], pc = PC } = {}) {
    return { pc, active: active ?? (pc ? [sheetOf()] : []), reserve, temporary, activeLimit: 3 };
}

export function progressOf(sheet, overrides = {}) {
    return {
        actor: sheet.id, level: sheet.level, class: sheet.class, tier: sheet.tier,
        checklist: sheet.skills.map(s => ({ skill: s.skill, form: s.form, mastery: s.mastery, needed: 5 })),
        promotions: [], pathways: [], ...overrides,
    };
}

// ---- answers: the queries a screen reads, as functions of their arguments -------------------------------------------------

/** A query answer that is not registered at all (the host throws for an unknown query). */
export const MISSING = Symbol('missing query');

/** The classes the picker lists: the pack's, plus one more basic class so the picker has a choice. */
export const CLASS_VIEWS = [
    ...[0, 1, 2, 3].map(tier => ({ id: ref(`c${tier}`), name: CLASS_NAMES[tier], tier, parent: tier ? ref(`c${tier - 1}`) : null, skills: [0, 1, 2].map(n => ref(`s${tier}${n}`)) })),
    { id: ref('c0x'), name: 'Scout', tier: 0, parent: null, skills: [0, 1, 2].map(n => ref(`s0x${n}`)) },
];

/** The default answers: a ready world, day 10 at Haven, one fresh character. Overrides replace by query name. */
export function answers(overrides = {}) {
    const sheet = sheetOf();
    const base = {
        'director.time': { minutes: 14400, text: 'Day 10 start' },
        'director.contract': { api: 2, enabled: true, clock: true, tiers: true, threads: true, journal: true, checks: true },
        'savepoint.contract': { api: 2, snapshots: true, retainedChatRestore: true, participantsReady: true },
        'rules.identity': { hash: H, packId: 'fixture', version: '2.0.0' },
        'rules.names': ({ refs }) => Object.fromEntries((Array.isArray(refs) ? refs : []).filter(r => NAMES[r]).map(r => [r, NAMES[r]])),
        'rules.classes': ({ tier } = {}) => CLASS_VIEWS.filter(item => tier === undefined || item.tier === tier),
        'rules.party': partyOf({ active: [sheet] }),
        'rules.progress': ({ actor }) => (actor === PC ? progressOf(sheet) : null),
        'rules.training': ({ actor }) => (actor === PC ? trainingOf() : null),
        'rules.quests': [],
        'director.threads': [],
        'atlas.canonical': ({ id, name } = {}) => (id === undefined && name === undefined ? CANON.haven : Object.values(CANON).find(item => item.id === id) ?? null),
        'world.areaTier': ({ place }) => areaTier(place, 2, 'world', null),
        'chronicle.day': ({ day }) => ({ day, date: '', line: '', brief: '', count: 0 }),
        'journal.day': ({ day }) => journalDay(day),
        'checks.policy': checksPolicy(),
        'npc.identity': ({ id, name }) => (id === 'np_00000001' || name === 'Lyra' ? { id: 'np_00000001', nativeKey: 'lyra', name: 'Lyra' } : null),
        'savepoint.list': [seed.snapshot],
        'items.slots': ({ actor }) => slotsDescriptor(actor, {}),
        'items.gear': () => ({ actor: PC, level: 1, counted: [], unused: [], bonuses: {} }),
        'items.condition': () => null,
        'items.canWear': () => ({ ok: false, why: 'Nothing to try.' }),
        'rules.equipPlan': () => ({ ok: false, code: 'NOT_FOUND', message: 'Nothing to equip.' }),
    };
    return { ...base, ...overrides };
}

export const CANON = Object.freeze({
    haven: { id: ref('haven'), name: 'Haven', atlasId: 'pl_00000001', regionId: 'rg_00000001', source: 'pack' },
    mill: { id: ref('mill'), name: 'Mill', atlasId: null, regionId: null, source: 'pack' },
});

export function areaTier(place, tier, source, sourceId) {
    return { place, tier, source, sourceId, allowedFoes: [], allowedTags: [], lore: [] };
}

export function journalDay(day, missing = false) {
    return { day, title: `Day ${day}`, lines: missing ? [] : ['Reached Haven at dawn.'], source: missing ? 'snapshot' : 'digest', missing };
}

export function checksPolicy(overrides = {}) {
    return {
        actors: { ca_00000001: { id: 'ca_00000001', name: 'Astra', bonuses: { DEX: 1 } }, ca_00000002: { id: 'ca_00000002', name: 'Mira', bonuses: {} } },
        defaultActor: 'ca_00000001', rbActors: { ca_00000001: PC }, rbModifiers: true, social: true, hash: sha256('checks.policy.1'), ...overrides,
    };
}

export function slotsDescriptor(actor, blocked) {
    const labels = ['Main hand', 'Off hand', 'Head', 'Body', 'Legs', 'Feet', 'Accessory 1', 'Accessory 2'];
    return { accessory: 2, worn: 4, slots: SLOT_KEYS.map((key, index) => ({ key, label: labels[index], blockedBy: blocked?.[actor]?.[key] ?? null })) };
}

// ---- training projections ------------------------------------------------------------------------------------------------

export function trainingOf(overrides = {}) {
    return {
        actor: PC, session: null, caps: { day: null, skill: { used: 0, max: 10 }, actor: { used: 0, max: 30 } }, offers: [], ...overrides,
    };
}
export const trainOffer = (overrides = {}) => {
    const offer = {
    trainer: ref('mentor'), name: 'Old Brann', skill: ref('s00'), form: ref('s00-base'), fee: 20, minutes: 60, session: 'tr_00000001', blocked: [], ...overrides,
    };
    return { ...offer, payload: { actor: PC, skill: offer.skill, form: offer.form, trainer: offer.trainer, session: offer.session } };
};

// ---- the C01-C19 states ---------------------------------------------------------------------------------------------------

/** C01: before and after creation. */
export const C01 = {
    none: () => answers({ 'rules.party': partyOf({ active: [], pc: null }), 'rules.progress': () => null, 'rules.training': () => null }),
    created: () => answers({ 'rules.party': partyOf({ active: [sheetOf()] }), 'rules.progress': ({ actor }) => (actor === PC ? progressOf(sheetOf(), {
        promotions: [{ milestone: 10, eligible: false, choices: [], why: ['Reach level 10.'] }],
    }) : null) }),
    finishPayload: { name: 'Astra', class: ref('c0') },
    finishWithCheckActor: { name: 'Astra', class: ref('c0'), checkActor: 'ca_00000002' },
};

/** C02: level 10 promotion. `uses` are the three forms' uses; [35,35,22] is 5/5, 5/5, 4/5. */
export function c02({ uses = [35, 35, 35], afterSwap = false } = {}) {
    const sheet = afterSwap ? sheetOf({ level: 10, class: ref('c1'), tier: 1, skills: skillsOf(1) }) : sheetOf({ level: 10, skills: skillsOf(0, uses) });
    const ready = uses.every(count => count >= 35);
    const progress = afterSwap
        ? progressOf(sheet, { promotions: [{ milestone: 20, eligible: false, choices: [], why: ['Reach level 20.'] }, { milestone: 30, eligible: false, choices: [], why: ['Reach level 30.'] }] })
        : progressOf(sheet, {
            promotions: [{ milestone: 10, eligible: ready, choices: ready ? [ref('c1')] : [],
                why: ready ? [] : [`Needs all three forms at 5 / 5 (${uses.filter(count => count >= 35).length} of 3).`] }],
        });
    return {
        answers: answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progress : null) }),
        sheet, progress,
        command: ['class.choose', { actor: PC, milestone: 10, class: ref('c1'), expectedClass: ref('c0'), rulesHash: H }],
        receipt: { ok: true, receipt: { id: 'rc_00000001', type: 'class.choose', module: 'rpg-battle', cause: 'ui', seed: 1, summary: 'Promoted.', narrate: true, rev: 11,
            data: { v2: { schema: 2, key: 'k', epoch: 'ep_00000001', source: seed.source, rulesHash: H, guard: {}, result: {
                actor: PC, milestone: 10, previous: ref('c0'), selected: ref('c1'), skills: [0, 1, 2].map(n => ref(`s1${n}`)) } } } } },
    };
}

/** C03: all three forms mastered; an attempt awards nothing but XP still moves. */
export function c03({ xp = 0 } = {}) {
    const sheet = sheetOf({ level: 12, xp, xpToNext: 100 - xp, skills: skillsOf(0, [35, 35, 35]) });
    return {
        sheet,
        answers: answers({
            'rules.party': partyOf({ active: [sheet] }),
            'rules.progress': ({ actor }) => (actor === PC ? progressOf(sheet, { promotions: [{ milestone: 10, eligible: true, choices: [ref('c1')], why: [] }] }) : null),
            'rules.training': ({ actor }) => (actor === PC ? trainingOf({ session: {
                id: 'tr_00000002', status: 'completed', skill: ref('s00'), form: ref('s00-base'), trainer: ref('mentor'), startMinute: 14400, endMinute: 14460,
                fee: 20, credits: 2, creditsAwarded: 0, reason: 'mastered', event: null, capDay: 10 } }) : null),
        }),
    };
}

/** C04: level 90 and still the basic class: promotion 10 only, the rest and all six paths waiting. */
export function c04() {
    const sheet = sheetOf({ level: 90, xp: 0, xpToNext: null, skills: skillsOf(0, [35, 35, 35]) });
    const progress = progressOf(sheet, {
        promotions: [
            { milestone: 10, eligible: true, choices: [ref('c1')], why: [] },
            { milestone: 20, eligible: false, choices: [], why: ['Take promotion 10 first.'] },
            { milestone: 30, eligible: false, choices: [], why: ['Take promotion 20 first.'] },
        ],
        pathways: [40, 50, 60, 70, 80, 90].map(milestone => ({ milestone, eligible: false, skills: [], why: ['Needs an advanced class first.'] })),
    });
    return { sheet, progress, answers: answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progress : null) }) };
}

/** C05: level 50, tier 3; skill 0 already took Path A at step 1 and now offers step 2 from that form. */
export function c05({ missingParent = false } = {}) {
    const qf = QF.C05.queries['rules.progress'];
    const sheet = sheetOf({ level: 50, class: ref('c3'), tier: 3, skills: [
        skillView('s30', 's30-base-a', 35, 1), skillView('s31', 's31-base', 35, 0), skillView('s32', 's32-base', 35, 0)] });
    const progress = missingParent
        ? { ...qf, pathways: [{ milestone: 50, eligible: false, skills: [], why: ['The step 1 choice for this skill was removed, so its step 2 is not open. Nothing was chosen in its place.'] }] }
        : qf;
    return {
        sheet, progress, command: QF.C05.command,
        answers: answers({ 'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progress : null) }),
    };
}

/** C06: training across midnight. Day 4 minute 1410 (story minute 7170) to day 5 minute 30 (7230). */
export const MIDNIGHT = { start: 4 * 1440 + 1410, end: 5 * 1440 + 30 };
export function c06(stage = 'running') {
    const base = { id: 'tr_00000003', skill: ref('s00'), form: ref('s00-base'), trainer: ref('mentor'), fee: 20, credits: 2 };
    const stages = {
        requested: { time: MIDNIGHT.start, training: trainingOf({ session: { ...base, status: 'requested', startMinute: null, endMinute: null, creditsAwarded: 0, reason: '', event: null, capDay: null } }) },
        running: { time: MIDNIGHT.start, training: trainingOf({ session: { ...base, status: 'running', startMinute: MIDNIGHT.start, endMinute: MIDNIGHT.end, creditsAwarded: 0, reason: '', event: null, capDay: 5 } }) },
        completed: { time: MIDNIGHT.end, training: trainingOf({ session: { ...base, status: 'completed', startMinute: MIDNIGHT.start, endMinute: MIDNIGHT.end, creditsAwarded: 2, reason: '', event: null, capDay: 5 },
            caps: { day: 5, skill: { used: 2, max: 10 }, actor: { used: 2, max: 30 } } }) },
        interrupted: { time: MIDNIGHT.end, training: trainingOf({ session: { ...base, status: 'interrupted', startMinute: MIDNIGHT.start, endMinute: MIDNIGHT.end, creditsAwarded: 0, reason: '', capDay: 5,
            event: { die: 2, template: 'A <b>storm</b> ended the lesson early.' } } }) },
        capped: { time: MIDNIGHT.end, training: trainingOf({ session: { ...base, status: 'completed', startMinute: MIDNIGHT.start, endMinute: MIDNIGHT.end, creditsAwarded: 0, reason: 'skill-day', event: null, capDay: 5 },
            caps: { day: 5, skill: { used: 10, max: 10 }, actor: { used: 10, max: 30 } } }) },
    };
    const chosen = stages[stage];
    return { time: chosen.time, training: chosen.training, answers: answers({ 'director.time': { minutes: chosen.time, text: `Day ${Math.floor(chosen.time / 1440)}` }, 'rules.training': ({ actor }) => (actor === PC ? chosen.training : null),
        'rules.party': partyOf({ active: [sheetOf({ level: 12 })] }), 'rules.progress': ({ actor }) => (actor === PC ? progressOf(sheetOf({ level: 12 })) : null) }) };
}

/** C07: a quest with a deadline at 7200 seen at 7199 (active) and 7200 (expired before turn-in). */
export function c07(now = 7200) {
    const expired = QF.C07.queries['rules.quests'][0];
    const active = { ...expired, state: 'active', settlement: null, ready: false, blocked: ['Visit the mill first.'], remainingMinutes: 7200 - now };
    const quest = now >= 7200 ? { ...expired, remainingMinutes: 0 } : active;
    return { quest, answers: answers({ 'director.time': { minutes: now, text: `Day ${Math.floor(now / 1440)}` }, 'rules.quests': [quest] }) };
}
export const REPEAT_CHAIN = {
    ...QF.C07.queries['rules.quests'][0], id: 'th_job00002', title: 'Repeatable errand', state: 'done', deadline: null, ready: false, blocked: [], remainingMinutes: null,
    repeat: { cooldownMinutes: 1440, nextOfferAt: 8640 }, chain: { previous: null, next: ref('next') },
    settlement: { id: 'st_00000008', source: seed.source, outcome: 'done', coinPaid: 30, xpPaid: 25, itemsPaid: [], claim: 'rb:ep_00000001:quest:th_job00002:1:settled' },
};

/** C08: PC + 2 active, 2 reserves, 2 temporary units. */
export function c08() {
    const pc = sheetOf({ level: 8 });
    const lyra = companionOf(LYRA, 'Lyra', { npcId: 'np_00000001', level: 7 });
    const bram = companionOf(BRAM, 'Bram', { role: 'guard', level: 7 });
    const cass = companionOf(CASS, 'Cass', { role: 'scholar', level: 6 });
    const dov = companionOf(DOV, 'Dov', { role: 'thief', level: 6 });
    const party = partyOf({ active: [pc, lyra, bram], reserve: [cass, dov], temporary: [temporaryOf(WOLF, 'Grey wolf', 'summon'), temporaryOf(SPARK, 'Spark', 'pet')] });
    return { party, answers: answers({ 'rules.party': party }) };
}

/** C09: the hands. `held` is what the PC holds. */
export const GREAT = 'it_00000011', SHIELD = 'it_00000012', DAGGER = 'it_00000013', TITAN = 'it_00000014', SWORD = 'it_00000015';
const GEAR_DEFS = {
    'craft/greatsword': ['Greatsword', 'weapon'], 'craft/shield': ['Round Shield', 'offhand'], 'craft/dagger': ['Dagger', 'weapon'],
    'craft/titan-helm': ['Titan Helm', 'head'], 'craft/sword': ['Sword', 'weapon'],
};
export function handsState(base, { held }) {
    const defs = Object.fromEntries(Object.entries(GEAR_DEFS).map(([id, [name, slot]]) => [id, { id, name, kind: 'equipment', rarity: 'common', value: 0, stack: false, slot, stats: {}, effect: {}, tags: [], note: '' }]));
    const stack = (id, def, equipped = null) => ({ id, def, qty: 1, owner: 'party', equipped, note: '', from: 'rc_seed0001' });
    const stacks = [stack(SHIELD, 'craft/shield'), stack(DAGGER, 'craft/dagger'), stack(TITAN, 'craft/titan-helm')];
    if (held === 'two-handed') stacks.push(stack(GREAT, 'craft/greatsword', 'weapon'));
    else stacks.push(stack(SWORD, 'craft/sword', 'weapon'));
    return { ...base, domains: { ...base.domains, inventory: { ...base.domains.inventory, defs, stacks: Object.fromEntries(stacks.map(entry => [entry.id, entry])) } } };
}
export function c09(held = 'two-handed') {
    const twoHanded = held === 'two-handed';
    const heldStack = twoHanded ? GREAT : SWORD;
    const sheet = sheetOf({ level: 6, gear: { ...emptyGear(), weapon: heldStack } });
    const gear = { actor: PC, level: 6, counted: [{ stack: heldStack, name: twoHanded ? 'Greatsword' : 'Sword', slot: 'weapon', slotLabel: 'Main hand', stats: { ATK: 9 }, counted: true, why: '' }], unused: [], bonuses: {} };
    const canWear = ({ stack }) => ({
        [SHIELD]: twoHanded ? { ok: false, why: 'The Greatsword takes both hands, so there is no off hand.' } : { ok: true },
        [DAGGER]: { ok: true },
        [TITAN]: { ok: false, why: 'Needs STR 18. Astra has 15 (the helm\'s own bonus does not count).' },
    }[stack] ?? { ok: false, why: 'Unknown piece.' });
    const plans = {
        [`${DAGGER}|`]: twoHanded
            ? { ok: true, plan: { actor: PC, stack: DAGGER, def: 'craft/dagger', slot: 'weapon', unequip: [GREAT], move: [], rulesHash: H, inputHash: sha256('plan1') } }
            : { ok: true, plan: { actor: PC, stack: DAGGER, def: 'craft/dagger', slot: 'offhand', unequip: [], move: [], rulesHash: H, inputHash: sha256('plan2') } },
        [`${DAGGER}|weapon`]: { ok: true, plan: { actor: PC, stack: DAGGER, def: 'craft/dagger', slot: 'weapon', unequip: [heldStack], move: [], rulesHash: H, inputHash: sha256('plan3') } },
        [`${DAGGER}|offhand`]: twoHanded ? { ok: false, code: 'REFUSED', message: 'The Greatsword takes both hands.' } : { ok: true, plan: { actor: PC, stack: DAGGER, def: 'craft/dagger', slot: 'offhand', unequip: [], move: [], rulesHash: H, inputHash: sha256('plan4') } },
        [`${SHIELD}|`]: twoHanded ? { ok: false, code: 'REFUSED', message: 'The Greatsword takes both hands.' } : { ok: true, plan: { actor: PC, stack: SHIELD, def: 'craft/shield', slot: 'offhand', unequip: [], move: [], rulesHash: H, inputHash: sha256('plan5') } },
    };
    const state = handsState(makeState(), { held });
    return {
        sheet, held, state,
        answers: answers({
            'rules.party': partyOf({ active: [sheet] }), 'rules.progress': ({ actor }) => (actor === PC ? progressOf(sheet) : null),
            'inventory.items': () => listItems(state.domains.inventory),
            'items.slots': ({ actor }) => slotsDescriptor(actor, twoHanded ? { [PC]: { offhand: GREAT } } : {}),
            'items.gear': () => gear,
            'items.condition': ({ stack }) => (stack === heldStack ? { stack, band: 'good', cur: 90, max: 100, refine: 0, name: twoHanded ? 'Greatsword' : 'Sword', factor: 1 } : null),
            'items.canWear': canWear,
            'rules.equipPlan': ({ stack, targetSlot }) => plans[`${stack}|${targetSlot ?? ''}`] ?? { ok: false, code: 'NOT_FOUND', message: 'No plan.' },
        }),
    };
}

/** C13: the dependency states. */
export const C13 = {
    ready: () => answers(),
    missingSd: () => answers({ 'director.contract': MISSING, 'director.time': MISSING, 'atlas.canonical': MISSING, 'world.areaTier': MISSING, 'chronicle.day': MISSING, 'journal.day': MISSING, 'checks.policy': MISSING }),
    disabledSd: () => answers({ 'director.contract': { api: 2, enabled: false, clock: false, tiers: false, threads: false, journal: false, checks: false } }),
    incompatibleSd: () => answers({ 'director.contract': { api: 2, enabled: true, clock: true, tiers: false, threads: true, journal: true, checks: false } }),
    wrongApiSd: () => answers({ 'director.contract': { api: 1, enabled: true } }),
    noSavepoints: () => answers({ 'savepoint.contract': MISSING }),
    unsetClock: () => answers({ 'director.time': { minutes: null, text: '' } }),
    unknownTier: () => answers({ 'world.areaTier': ({ place }) => areaTier(place, null, 'unknown', null) }),
    unknownPlace: () => answers({ 'atlas.canonical': () => null }),
    journalOff: () => answers({ 'chronicle.day': () => null }),
    socialOff: () => answers({ 'checks.policy': checksPolicy({ social: false }) }),
    nsdAbsent: () => answers({ 'npc.identity': MISSING }),
};

/** Story Block's module status (`sdk.modules()`, E2): what the host says about each module. */
export const mod = (id, status = 'ready', reason = null) => ({ id, name: id, version: '2.0.0', domains: [], commands: [], kinds: [], tabs: [], features: [], status, reason });
export const HOST = {
    ready: () => [mod('story-block'), mod('story-director'), mod('rpg-battle')],
    rbDormant: () => [mod('story-block'), mod('rpg-battle', 'dormant', 'waiting for story-director')],
    rbDormantSdWaiting: () => [mod('story-block'), mod('story-director', 'dormant', 'waiting for a peer'), mod('rpg-battle', 'dormant', 'waiting for story-director')],
    sdOld: () => [mod('story-block'), mod('story-director'), mod('rpg-battle')],
    restoring: () => [mod('story-block'), mod('story-director'), mod('rpg-battle', 'restore-pending', 'a restore holds it')],
};
/** RB dormant: none of RPG Battle's own rules queries answer, Story Director is absent. */
export const rbDormantAnswers = () => answers({
    'rules.party': MISSING, 'rules.progress': MISSING, 'rules.training': MISSING, 'rules.quests': MISSING, 'rules.identity': MISSING,
    'director.contract': MISSING, 'director.time': MISSING, 'atlas.canonical': MISSING, 'world.areaTier': MISSING, 'chronicle.day': MISSING, 'journal.day': MISSING, 'checks.policy': MISSING,
});

/** C14: replay. A manual save the deleted reply carried is simply not listed. */
export const C14 = {
    result: QF.C14.result,
    savesBefore: () => [seed.snapshot, { ...seed.snapshot, id: 'sp_00000012', kind: 'manual', name: 'Before the mill', label: 'Before the mill', minute: 15000, day: 10 }],
    savesAfter: () => [seed.snapshot],
    missingBytes: () => [{ ...seed.snapshot, available: false }],
};

/** C15: Story Block + Story Director only. */
export const thread = (overrides = {}) => ({ id: 'th_hook00001', key: 'Find the lost bell', kind: 'hook', summary: 'The bell went missing from the chapel.', fields: {}, status: 'active', offer: true, taken: null, ended: null, ...overrides });
export function c15(stage = 'offered') {
    const stages = {
        offered: [thread()],
        accepted: [thread({ offer: false, taken: { rev: 12 }, acceptance: { source: seed.source, cursor: seed.cursor, minute: 14400, proof: 'ev_00000012' } })],
        closed: [thread({ offer: false, taken: { rev: 12 }, status: 'resolved', ended: { rev: 14, reason: 'found it', outcome: 'done' } })],
    };
    return { threads: stages[stage], answers: Object.fromEntries([
        ['director.time', { minutes: 14400, text: 'Day 10 start' }], ['director.threads', stages[stage]],
    ]) };
}
/** RB repeat/chain: the old thread is terminal, the repeat is a fresh th_ with the same key. */
export function c15Repeat() {
    const done = { ...thread({ id: 'th_job00001', key: 'Visit the mill', kind: 'hook', offer: false, status: 'resolved', taken: { rev: 11 }, ended: { rev: 13, reason: 'done', outcome: 'done' } }), rpg: { ...seed.quest, state: 'done' } };
    const again = { ...thread({ id: 'th_job00009', key: 'Visit the mill', kind: 'hook', offer: true }), rpg: { ...seed.quest, id: 'th_job00009', instance: 1, state: 'offered' } };
    const quests = [
        { ...seed.quest, state: 'done', ready: false, blocked: [], remainingMinutes: null, settlement: { id: 'st_00000011', source: seed.source, outcome: 'done', coinPaid: 30, xpPaid: 25, itemsPaid: [], claim: 'c' } },
        { ...seed.quest, id: 'th_job00009', state: 'offered', ready: false, blocked: [], remainingMinutes: null },
    ];
    return { done, again, quests };
}

/** C16: check links. */
export function c16(overrides = {}) {
    return { policy: checksPolicy(overrides.policy), answers: answers({ 'checks.policy': checksPolicy(overrides.policy), ...(overrides.answers ?? {}) }) };
}

/** C17: world identity. */
export const RG_NORTH = 'rg_00000001', RG_SOUTH = 'rg_00000002';
export function atlasPolicy(overrides = {}) {
    const policy = {
        regions: [{ id: RG_NORTH, name: 'North Marches', aliases: ['The Marches'] }, { id: RG_SOUTH, name: 'Southreach', aliases: [] }],
        placeRegions: { [ref('haven')]: RG_NORTH }, placeRefs: { pl_00000001: ref('haven') },
        danger: { world: { tier: 2, allowedFoes: [], allowedTags: [], lore: [] }, regions: { [RG_NORTH]: { tier: 4, allowedFoes: [ref('wolf')], allowedTags: ['beast'], lore: ['Cold hills.'] } }, places: {} },
        ...overrides,
    };
    return { ...policy, hash: hashOf(policy) };
}
export function c17(overrides = {}) {
    const policy = atlasPolicy(overrides.policy);
    return { policy, answers: answers({
        'atlas.policy': policy,
        'atlas.canonical': ({ id, name } = {}) => (id === undefined && name === undefined ? CANON.haven : Object.values(CANON).find(item => item.id === id) ?? null),
        'world.areaTier': ({ place }) => (place === ref('haven') ? areaTier(place, 4, 'region', RG_NORTH) : areaTier(place, 2, 'world', null)),
        ...(overrides.answers ?? {}),
    }) };
}

/** C18: generated inputs. */
export function c18(overrides = {}) {
    const defs = [
        { id: 'story/bone-charm', name: 'Bone Charm', kind: 'equipment', rarity: 'common' }, { id: 'craft/iron-blade', name: 'Iron Blade', kind: 'equipment', rarity: 'uncommon' },
        { id: 'trade/ale-common-l3', name: 'Ale', kind: 'consumable', rarity: 'common' }, { id: 'pack.fixture/rope', name: 'Rope', kind: 'goods', rarity: 'common' },
        { id: 'story/<b>odd</b>', name: 'Odd <b>one</b>', kind: 'goods', rarity: 'common' },
    ];
    const flags = { values: { 'bell.rung': true, 'gate.open': false }, hash: sha256('flags.1') };
    const calls = [];
    return { defs, flags, calls, answers: answers({
        'inventory.definitions': ({ ids } = {}) => { calls.push(['inventory.definitions', ids]); return defs; },
        'rules.flags': ({ keys } = {}) => { calls.push(['rules.flags', keys]); return flags; },
        'rules.item': ({ def }) => { calls.push(['rules.item', def]); return def === 'craft/iron-blade' || def === 'story/bone-charm' ? { def, allowedSlots: ['weapon'], hands: 1, requires: {}, weight: 1, unique: false } : null; },
        ...(overrides.answers ?? {}),
    }) };
}

/** C19: native identity. */
export function c19(stage = 'linked') {
    const names = { linked: 'Lyra', renamed: 'Lyra Vale' };
    const identity = ({ id, name }) => {
        if (stage === 'unknown' || stage === 'restored') return null;
        const shown = names[stage] ?? 'Lyra';
        if (id === 'np_00000001' || (name && [shown, 'Lyra'].includes(name))) return { id: 'np_00000001', nativeKey: 'lyra', name: shown };
        return null;
    };
    return { identity, answers: answers({ 'npc.identity': identity }) };
}
