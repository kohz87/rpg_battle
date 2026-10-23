// RPG Battle v2, part **screens**: the view queries the default screens read (SPEC §13.1 `data`).
//
// A template has no arithmetic and no way to filter or group a list (TEMPLATES.md §1.2), so what a
// screen shows that is not a plain field of the state is worked out here, once per drawing: an
// actor's EXP to the next level, their condition badges and active effects, what they wear with its
// condition, skills as the skill-tree widget's nodes (tiers, states, uses), each member as ss.hero props, stats as radar axes, the Trade page's rows with
// their short prices, the Crafting page's recipes, and one thing's details for Story Block's Inventory
// rows. Packs and cards that restyle a screen can bind the same queries. Other parts' queries are read
// with `tryQuery`: one this build lacks (or whose feature is off) leaves its section out.
//
// Every query is `(state, args, tools)` (MODULES §F3) and returns plain copies. The other parts are
// read only through their queries (`tools.query('party.actors')`, `trade.*`, `inventory.*`) or as
// plain state, with v1's pure rules for the numbers (src/*.js); nothing here changes anything. Pure and deterministic: the same state and settings
// give the same rows in the same order.

import { DEFAULT_RULES, STATS, checkModifier, makeRules, statCap, xpToNext } from '../../rules.js';
import { DEFAULT_SKILLS, findSkill } from '../../skills.js';
import { useItemOutside } from '../../recovery.js';
import { levelTag, maxLevel, xpLabel } from '../../terms.js';
import { isMaterial } from '../../trade.js';
import { growthOf } from '../party/sheets.js';
import { clockOf, fitParty, minutesLeft } from '../party/pools.js';
import { gearLimits } from '../../items.js';
import { paperdollOf } from './paperdoll.js';

export const MODULE_ID = 'rpg-battle';

// The Crafting screen's recipes per character (the template's rows, not ss.listcard): at most 200, as before.
export const RECIPES_MAX = 200;

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
const capital = text => String(text ?? '').replace(/^\s*\p{L}/u, letter => letter.toUpperCase()).trim();

export const STAT_NAMES = Object.freeze({
    STR: 'Strength', VIT: 'Vitality', AGI: 'Agility', DEX: 'Dexterity', INT: 'Intelligence', LUK: 'Luck', CHA: 'Charisma',
});

// ---------------------------------------------------------------------------------------------------
// Settings and the other parts' queries

/**
 * RPG Battle's settings: given in `args.settings`, else the host's (`sdk.settings('rpg-battle')`, flat,
 * each part's keys under its part id: `party.xpBase`, src/v2/module.js), else what the query's tools
 * carry, else none.
 */
export function settingsFor(args, tools = null) {
    if (isRecord(args?.settings)) return args.settings;
    // The display terms as src/v2/module.js hands them to the query (a pack's under the reader's, §F25).
    const terms = isRecord(tools?.settings?.terms) ? { terms: tools.settings.terms } : {};
    try {
        const sdk = globalThis.StoryBlock?.sdk;
        const found = typeof sdk?.settings === 'function' ? sdk.settings(MODULE_ID) : null;
        if (isRecord(found)) return { ...found, ...terms };
    } catch {
        // No host: the tools' settings, if any.
    }
    return isRecord(tools?.settings) ? tools.settings : {};
}

/**
 * v1's rules with the reader's 'Character' settings that change what these screens show (the party
 * part's keys, read as `party.<key>` in the module's settings or bare), and a rules file's own
 * `rules` and `terms` (module-wide keys).
 */
export function rulesFor(settings = {}) {
    const s = isRecord(settings) ? settings : {};
    const own = isRecord(s.rules) ? s.rules : {};
    const character = { ...(isRecord(own.character) ? own.character : {}) };
    for (const key of ['statCap', 'xpBase', 'maxLevel', 'activeSkills']) {
        const value = s[`party.${key}`] ?? s[key];
        if (Number.isInteger(value)) character[key] = value;
    }
    return makeRules({ ...own, character, ...(isRecord(s.terms) ? { terms: { ...DEFAULT_RULES.terms, ...s.terms } } : {}) });
}

// Another query through the tools (MODULES §F3); undefined when there are no tools, it is not
// registered (another part's that is not in this build yet, or its feature is off), or it throws:
// the section that reads it is then left out, never an error.
export function tryQuery(tools, name, args = {}) {
    if (typeof tools?.query !== 'function') return undefined;
    try {
        const found = tools.query(name, args);
        return found === null ? undefined : found;
    } catch {
        return undefined;
    }
}

// The party with every member's numbers as they stand now (party/pools.js: pools fitted to 0…max).
const partyOf = state => {
    const party = state?.domains?.party;
    return isRecord(party) ? fitParty(party, { minutes: clockOf(state) }) : { pc: null, order: [], actors: {}, custom: {} };
};
const inventoryOf = state => {
    const inventory = state?.domains?.inventory;
    return isRecord(inventory) ? inventory : { defs: {}, stacks: {}, wallets: {} };
};

/** The party's people in display order (your character first), then anyone the order leaves out. */
function peopleOf(party) {
    const actors = isRecord(party.actors) ? party.actors : {};
    const order = (Array.isArray(party.order) ? party.order : []).filter(id => actors[id]);
    const rest = Object.keys(actors).sort().filter(id => !order.includes(id));
    const ids = [...order, ...rest];
    if (party.pc && ids.includes(party.pc)) return [party.pc, ...ids.filter(id => id !== party.pc)];
    return ids;
}

// ---------------------------------------------------------------------------------------------------
// Actor cards

const CONDITION_LOOK = [
    [/poison/i, 'fa-skull-crossbones', 'bad'],
    [/burn|fire|scorch/i, 'fa-fire', 'bad'],
    [/bleed/i, 'fa-droplet', 'bad'],
    [/stun|daze/i, 'fa-face-dizzy', 'warn'],
    [/slow/i, 'fa-hourglass-half', 'warn'],
    [/weak|tired|exhaust|fatigue/i, 'fa-arrow-trend-down', 'warn'],
    [/shield|ward/i, 'fa-shield-halved', 'good'],
    [/regen|bless|inspired|hasted?/i, 'fa-heart-circle-plus', 'good'],
    [/guard/i, 'fa-shield', 'good'],
    [/curse|hex|doom/i, 'fa-ghost', 'bad'],
    [/fear|frighten|terror/i, 'fa-face-flushed', 'warn'],
    [/\b(?:sick\w*|ill|diseased?|fever\w*)\b/i, 'fa-virus', 'bad'],
];

/**
 * A condition as ss.badge props: an icon and tone by its kind, and its rounds left as the counter
 * (a party condition's `stacks` are the rounds a fight left; 1 is "no rounds", MODULES §B1).
 */
export function conditionBadge(condition, index = 0, minutes = null) {
    const kind = String(condition?.kind ?? '').trim() || 'unwell';
    const [, icon, tone] = CONDITION_LOOK.find(([pattern]) => pattern.test(kind)) ?? [null, 'fa-circle-exclamation', 'neutral'];
    const stacks = int(condition?.stacks, 1);
    // One a fight left, on the story clock (party/pools.js): the story minutes it has left.
    const left = minutesLeft(condition, minutes);
    if (left !== null && left > 0) return { id: `${kind}-${index}`, kind, label: capital(kind), showLabel: true, icon, tone, counter: left, unit: 'min left' };
    return { id: `${kind}-${index}`, kind, label: capital(kind), showLabel: true, icon, tone, counter: stacks > 1 ? stacks : null, unit: stacks > 1 ? 'turns left' : '' };
}

/**
 * A condition as ss.status props (WIDGETS.md): the same icon and tone, its turns left (or story minutes
 * left, `unit` 'minutes'); with no end it has no counter, which the badge shows as "∞".
 */
export function conditionStatus(condition, index = 0, minutes = null) {
    const badge = conditionBadge(condition, index, minutes);
    return { id: badge.id, kind: badge.kind, label: badge.label, icon: badge.icon, tone: badge.tone, left: badge.counter, unit: badge.unit === 'min left' ? 'minutes' : 'turns' };
}

// Story Block's ss.hero keeps at most 6 bars and 12 status badges (view/widgets/hero.js BAR_MAX, STATUS_MAX);
// the lists are cut here, where they are made, so the screen says what it shows.
export const HERO_BARS_MAX = 6;
export const HERO_STATUS_MAX = 12;

/**
 * A member as ss.hero props (WIDGETS.md): name, portrait and the line on the pill; the HP bar, then MP and
 * SP when the member has them, then the EXP bar labelled with the Terms' word; and the conditions as status
 * badges. `pools` are { hp, mp, sp: { cur, max } }.
 */
export function heroOf({ name, portrait = '', line = '', pools = {}, xp = null, xpName = 'EXP', xpText = '', statuses = [] }) {
    const bars = [];
    const add = (kind, label, pool) => {
        if (pool && pool.max > 0) bars.push({ kind, label, value: pool.cur, max: pool.max });
    };
    add('hp', 'HP', pools.hp);
    add('mp', 'MP', pools.mp);
    add('sp', 'SP', pools.sp);
    if (xp) bars.push({ kind: 'exp', label: xpName, value: xp.cur, max: xp.max, text: xpText });
    return {
        name: String(name ?? ''),
        portrait: String(portrait ?? ''),
        line: String(line ?? ''),
        bars: bars.slice(0, HERO_BARS_MAX),
        statuses: (Array.isArray(statuses) ? statuses : []).slice(0, HERO_STATUS_MAX),
    };
}

const SKILL_ICONS = Object.freeze({ physical: 'fa-hand-fist', magic: 'fa-wand-sparkles', heal: 'fa-kit-medical', buff: 'fa-shield-halved', debuff: 'fa-skull' });

/** A skill's uses toward its next level (v1 skillText: rules.masteryUses), in plain words. */
export function skillProgress(skill, rules = DEFAULT_RULES) {
    const level = int(skill?.level, 1);
    if (level >= int(rules.masteryMax, 5)) return 'top level';
    const need = Number(rules.masteryUses?.[level]);
    if (!(need > 0)) return '';
    return `${Math.min(need, Math.max(0, int(skill?.uses)))}/${need} uses to Lv ${level + 1}`;
}

/** An actor's skills with what the library says about each: tier, type, cost. */
function skillsOf(actor, party, rules) {
    const library = [...DEFAULT_SKILLS, ...Object.values(isRecord(party.custom) ? party.custom : {})];
    const most = int(rules.masteryMax, 5);
    return (Array.isArray(actor.skills) ? actor.skills : []).map(skill => {
        const found = findSkill(library, skill?.name);
        const type = String(found?.type ?? '');
        return {
            name: String(skill?.name ?? ''),
            level: int(skill?.level, 1),
            max: most,
            // The uses toward the next level (beta.1 live test: "skill xp didn't increase"; a fight's
            // uses count when it is settled): "2/5 uses to Lv 2", "top level" at the most.
            progress: skillProgress(skill, rules),
            uses: int(skill?.uses),
            active: skill?.active !== false,
            tier: int(found?.tier, 0),
            type,
            icon: SKILL_ICONS[type] ?? 'fa-star',
            cost: Number.isFinite(found?.mp) ? `${found.mp} ${type === 'physical' ? 'SP' : 'MP'}` : '',
            note: String(found?.description ?? ''),
        };
    }).filter(skill => skill.name);
}

/**
 * Skills as the skill-tree widget's node list (src/v2/screens/skill-tree.js, the node shape there): one node per
 * skill, its tier as the library gives it, the level as the badge, and the state: `maxed` at the cap,
 * `available` with no uses yet, `learned` otherwise (today's skills have no requirements, so no lines are drawn).
 * Those in use come first; the widget groups them by tier.
 */
export function skillNodes(skills) {
    return [...skills].sort((a, b) => Number(b.active) - Number(a.active)).map(skill => {
        const state = skill.level >= skill.max ? 'maxed' : skill.uses === 0 ? 'available' : 'learned';
        return {
            id: skill.name,
            name: skill.name,
            icon: skill.icon,
            tier: skill.tier,
            level: skill.level,
            max: skill.max,
            uses: skill.uses,
            state,
            requires: [],
            // The badge is about 30px: the digit only; the hint says "Lv 2 · 2/5 uses to Lv 3" (cut at 60 characters).
            hint: cutTo(`Lv ${skill.level}${skill.progress ? ` · ${skill.progress}` : ''}`, 60),
            inUse: skill.active,
            kind: skill.type,
            note: skill.note,
            facts: [skill.cost ? `Costs ${skill.cost}` : ''].filter(Boolean),
        };
    });
}

const cutTo = (text, max) => Array.from(String(text ?? '')).slice(0, max).join('');

function pool(value) {
    const max = Math.max(0, int(value?.max));
    return { cur: Math.min(max, Math.max(0, int(value?.cur))), max };
}

/** One actor's card: everything the Party, HUD and status screens show of them. */
export function actorCard(actor, party, { rules = DEFAULT_RULES, portrait = null, minutes = null } = {}) {
    const level = Math.max(1, int(actor.level, 1));
    const top = maxLevel(rules);
    const atTop = level >= top;
    const need = xpToNext(level, rules);
    const xp = atTop ? { cur: 1, max: 1 } : { cur: Math.min(need, Math.max(0, int(actor.xp))), max: need };
    const hp = pool(actor.hp);
    const points = Math.max(0, int(actor.points));
    const cap = statCap(rules);
    const statsRecord = isRecord(actor.stats) ? actor.stats : {};
    const stats = STATS.map(key => {
        const value = int(statsRecord[key], rules.character.startStat);
        const mod = checkModifier(value, rules);
        return { key, label: STAT_NAMES[key], value, mod: mod > 0 ? `+${mod}` : mod < 0 ? String(mod) : '', room: Math.max(0, Math.min(points, cap - value)) };
    });
    const largest = Math.max(...stats.map(stat => stat.value), 1);
    const axisMax = Math.min(cap, Math.max(10, Math.ceil(largest / 5) * 5));
    const skills = skillsOf(actor, party, rules);
    const you = actor.id === party.pc;
    const role = capital(actor.role);
    const who = you ? 'You' : actor.control === 'player' ? 'Companion · you lead' : 'Companion';
    const card = {
        id: actor.id,
        name: String(actor.name ?? ''),
        you,
        kind: actor.kind ?? (you ? 'pc' : 'companion'),
        companion: !you,
        // The two per-companion switches (party.edit, MODULES §F29, §F49): who gives orders in a
        // fight, and who spends their stat points.
        control: actor.control ?? 'auto',
        growth: you ? 'manual' : growthOf(actor),
        role,
        level,
        line: [levelTag(level, rules), role, who].filter(Boolean).join(' · '),
        // The reader's (or the pack's) word for XP (MODULES §F25), the EXP meter's label.
        xpName: xpLabel(rules) === 'XP' ? 'EXP' : xpLabel(rules),
        portrait: typeof portrait === 'string' && portrait ? portrait : typeof actor.portrait === 'string' && actor.portrait ? actor.portrait : '',
        hp,
        mp: pool(actor.mp),
        sp: pool(actor.sp),
        low: hp.max > 0 && hp.cur > 0 && hp.cur * 10 < hp.max * 3,
        down: hp.max > 0 && hp.cur === 0,
        xp,
        xpText: atTop ? 'Top level' : `${xp.cur} / ${need}`,
        points,
        spend: points > 0,
        // The draft key of this spending: a new level or a spend starts from zero again.
        spendKey: `${actor.id}_l${level}_p${points}`.replace(/\W/g, '_'),
        stats,
        statAxes: stats.map(stat => ({ label: stat.key, value: stat.value, max: axisMax })),
        statuses: (Array.isArray(actor.conditions) ? actor.conditions : []).map((entry, index) => conditionStatus(entry, index, minutes)),
        skills,
        skillNodes: skillNodes(skills),
        activeCount: skills.filter(skill => skill.active).length,
        activeCap: int(rules.character.activeSkills, 6),
    };
    card.hero = heroOf({
        name: card.name,
        portrait: card.portrait,
        line: card.line,
        pools: { hp: card.hp, mp: card.mp, sp: card.sp },
        xp: card.xp,
        xpName: card.xpName,
        xpText: card.xpText,
        statuses: card.statuses,
    });
    return card;
}

/**
 * An active effect from the party part's `party.effects` (MODULES §F100 feature `rpg-battle.effects`:
 * timed effects that fade on the story clock, and those a worn piece gives) as ss.badge props, its
 * time left and source in the spoken label ("Blessed, 2 h left, from a potion").
 */
export function effectBadge(effect, index = 0) {
    const name = capital(effect?.name ?? '') || 'Effect';
    const tone = ['good', 'bad', 'neutral'].includes(effect?.tone) ? effect.tone : 'neutral';
    const [, icon] = CONDITION_LOOK.find(([pattern]) => pattern.test(name)) ?? [null, tone === 'bad' ? 'fa-arrow-trend-down' : 'fa-wand-magic-sparkles'];
    const left = String(effect?.left ?? '').trim();
    const source = String(effect?.source ?? '').trim();
    return {
        id: String(effect?.id ?? `${name}-${index}`), kind: 'effect', label: [name, left ? `${left} left` : '', source ? `from ${source}` : ''].filter(Boolean).join(', '),
        text: left ? `${name} · ${left}` : name, showLabel: true, icon, tone, counter: null, unit: '',
    };
}

/** `actorId`'s active effects as badges; [] without the party part's effects (or with the feature off). */
function effectsOf(tools, actorId) {
    const found = tryQuery(tools, 'party.effects', { actor: actorId });
    return (Array.isArray(found) ? found : []).filter(isRecord).slice(0, 24).map(effectBadge);
}

/**
 * A member carrying too much (the party part's `party.encumbered`, from Story Block's encumbrance):
 * { text: 'Encumbered: AGI and DEX checks −2', penalty, stats } or null.
 */
function burdenOf(tools, actorId) {
    const found = tryQuery(tools, 'party.encumbered', { actor: actorId });
    const text = isRecord(found) ? String(found.text ?? '').trim() : '';
    return text ? { text, penalty: int(found.penalty), stats: (Array.isArray(found.stats) ? found.stats : []).map(String) } : null;
}

/**
 * `rpg-battle.cards({ settings? })`: a card per party member, your character first, each with what
 * they wear (`gear`, from items.gear and items.condition), their active effects (`effects`) and
 * whether they carry too much (`encumbered`, null when not).
 */
export function cards(state, args = {}, tools = null) {
    const party = partyOf(state);
    const inventory = inventoryOf(state);
    const rules = rulesFor(settingsFor(args, tools));
    // party.actors gives each member's portrait (the persona's, or NSD's for an NPC companion).
    const listed = tryQuery(tools, 'party.actors', {});
    const portraits = new Map((Array.isArray(listed) ? listed : []).map(entry => [entry?.id, entry?.portrait ?? null]));
    const limits = slotLimits(tools);
    const members = peopleOf(party).map(id => ({ id, name: String(party.actors[id]?.name ?? id) }));
    return copy(peopleOf(party).map(id => {
        const pieces = gearOf(tools, id);
        return {
            ...actorCard(party.actors[id], party, { rules, portrait: portraits.get(id), minutes: clockOf(state) }),
            gear: pieces,
            paperdoll: paperdollOf({
                actorId: id, pieces, limits, members,
                keys: Object.fromEntries(pieces.map(piece => [piece.stack, inventory.stacks?.[piece.stack]?.equipped ?? ''])),
                qtys: Object.fromEntries(pieces.map(piece => [piece.stack, inventory.stacks?.[piece.stack]?.qty ?? 1])),
                twoHanded: pieces.some(piece => piece.counted && piece.slot === 'weapon' && inventory.defs?.[inventory.stacks?.[piece.stack]?.def]?.tags?.includes('two-handed')),
                bag: bagOf(state, tools, id),
            }),
            effects: effectsOf(tools, id),
            encumbered: burdenOf(tools, id),
        };
    }));
}

/** How many worn pieces and accessories count in the rules in force (items.slots; the rules' default without it). */
function slotLimits(tools) {
    const found = tryQuery(tools, 'items.slots', {});
    if (isRecord(found) && Number.isFinite(found.worn) && Number.isFinite(found.accessory)) return { worn: found.worn, accessory: found.accessory };
    return gearLimits(DEFAULT_RULES);
}

/**
 * The bag's pieces that `actorId` could put on, by the slot they fill: { [group]: [{ id, name }] }. A piece
 * the party carries goes to the main character (items.canWear decides the rest, the same rule item.equip keeps).
 */
function bagOf(state, tools, actorId) {
    const inventory = inventoryOf(state);
    const party = partyOf(state);
    const out = {};
    for (const id of Object.keys(inventory.stacks ?? {}).sort()) {
        const stack = inventory.stacks[id];
        const def = inventory.defs?.[stack?.def];
        if (!stack || !(stack.qty > 0) || stack.equipped || def?.kind !== 'equipment' || !PAPERDOLL_GROUPS.includes(def.slot)) continue;
        const wearer = stack.owner === 'party' ? party.pc : stack.owner;
        if (wearer !== actorId) continue;
        const check = tryQuery(tools, 'items.canWear', { actor: actorId, stack: id });
        if (!check || check.ok !== true) continue;
        (out[def.slot] ??= []).push({ id, name: String(def.name ?? id) });
    }
    return out;
}

const PAPERDOLL_GROUPS = Object.freeze(['weapon', 'offhand', 'armour', 'worn', 'accessory']);

/**
 * `rpg-battle.heroes({ settings? })`: every member as ss.hero props at this reply's pools (`party.pools`,
 * which the status card under each reply reads), by id. A condition the pools say has worn off is left out.
 */
export function heroes(state, args = {}, tools = null) {
    const pools = tryQuery(tools, 'party.pools', {});
    const out = {};
    for (const card of cards(state, args, tools)) {
        const pool = isRecord(pools?.[card.id]) ? pools[card.id] : {};
        const worn = new Set(Array.isArray(pool.lapsed) ? pool.lapsed : []);
        out[card.id] = heroOf({
            name: card.name,
            portrait: card.portrait,
            line: card.line,
            pools: { hp: pool.hp ?? card.hp, mp: pool.mp ?? card.mp, sp: pool.sp ?? card.sp },
            statuses: card.statuses.filter(status => !worn.has(status.kind)),
        });
    }
    return copy(out);
}

/**
 * The HUD's "points to spend" badge (MODULES §F91) from the party part's `party.toSpend` (everyone
 * with points, your character first): { on, total, text, title }. Without that query, your own
 * character's points.
 */
function toSpendOf(tools, pc) {
    const found = tryQuery(tools, 'party.toSpend', {});
    const people = isRecord(found) && Array.isArray(found.people)
        ? found.people.filter(isRecord).map(person => ({ name: String(person.name ?? ''), points: Math.max(0, int(person.points)) })).filter(person => person.points > 0)
        : pc && pc.points > 0 ? [{ name: pc.name, points: pc.points }] : [];
    const total = isRecord(found) && Number.isFinite(found.total) ? Math.max(0, int(found.total)) : people.reduce((sum, person) => sum + person.points, 0);
    return {
        on: total > 0,
        total,
        text: `${total} to spend`,
        title: total > 0 ? `Stat points to spend: ${people.map(person => `${person.name} ${person.points}`).join(', ')}` : '',
    };
}

/**
 * `rpg-battle.hud({ settings? })`: { ready, pc: card | null, toSpend }. (Checks no longer wait for
 * the reader, MODULES §F80: they are rolled in the reply that writes them, so the HUD counts none.)
 */
export function hud(state, args = {}, tools = null) {
    const party = partyOf(state);
    const pcId = party.pc && party.actors?.[party.pc] ? party.pc : null;
    const pc = pcId ? cards(state, args, tools).find(card => card.id === pcId) ?? null : null;
    return copy({ ready: Boolean(pc), pc, toSpend: toSpendOf(tools, pc) });
}

// ---------------------------------------------------------------------------------------------------
// Gear, item details and the carry line
//
// Story Block's Inventory is the one bag (MODULES §F99): Equip, Take off, Give and Drop are there. What
// only RPG Battle knows about a thing (a piece's slot and stats, its condition and refinement, what a
// draught does and for whom) is `rpg-battle.itemDetail`, drawn in each Inventory row by the widget
// `rpg-battle.item-detail` (item-detail.js), and the worn pieces are listed on each Party card.

const SLOT_LABELS = Object.freeze({ weapon: 'Weapon', offhand: 'Off-hand', armour: 'Armour', armor: 'Armour', worn: 'Worn', accessory: 'Accessory', head: 'Head', hands: 'Hands', feet: 'Feet', waist: 'Waist' });
const slotLabel = slot => SLOT_LABELS[slot] ?? capital(String(slot ?? '').replace(/-\d+$/, ''));

function effectText(effect) {
    if (!isRecord(effect)) return '';
    const parts = [];
    if (int(effect.heal) > 0) parts.push(`+${int(effect.heal)} HP`);
    if (int(effect.mp) > 0) parts.push(`+${int(effect.mp)} MP`);
    if (int(effect.sp) > 0) parts.push(`+${int(effect.sp)} SP`);
    const cure = (Array.isArray(effect.cure) ? effect.cure : []).map(String).filter(Boolean);
    if (cure.length) parts.push(`cures ${cure.join(', ')}`);
    if (int(effect.damage) > 0) parts.push(`${int(effect.damage)} damage`);
    return parts.join(' · ');
}

const statText = stats => (isRecord(stats) ? Object.entries(stats).filter(([, value]) => Number.isFinite(value) && value !== 0).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`).join(', ') : '');
const helpsNow = effect => isRecord(effect) && (int(effect.heal) > 0 || int(effect.mp) > 0 || (Array.isArray(effect.cure) && effect.cure.length > 0));

/** How each wear band reads (the gear part's `items.condition` names the band; code set it). */
export const BANDS = Object.freeze({
    good: Object.freeze({ label: 'Good', tone: 'good', icon: 'fa-shield-halved' }),
    worn: Object.freeze({ label: 'Worn', tone: 'warn', icon: 'fa-shield-halved' }),
    tattered: Object.freeze({ label: 'Tattered', tone: 'bad', icon: 'fa-shield-virus' }),
    broken: Object.freeze({ label: 'Broken', tone: 'bad', icon: 'fa-heart-crack' }),
});

/**
 * The gear part's `items.condition { stack }` as the screens show it: { condition, refine }.
 * `condition` { band, label, tone, icon, cur, max, text } or null (wear off, not equipment, or no
 * gear part yet); `refine` { level, label: '+2', text: 'Refined +2' } or null (0, or refine off).
 */
export function conditionView(found) {
    if (!isRecord(found)) return { condition: null, refine: null };
    const key = String(found.band ?? '').toLowerCase();
    const look = Object.hasOwn(BANDS, key) ? BANDS[key] : null;
    const max = Number.isFinite(found.max) ? Math.max(0, int(found.max)) : 0;
    const cur = Number.isFinite(found.cur) ? Math.min(max, Math.max(0, int(found.cur))) : 0;
    const condition = look ? { band: key, label: look.label, tone: look.tone, icon: look.icon, cur, max, meter: max > 0, text: max > 0 ? `${look.label} · ${cur}/${max}` : look.label } : null;
    const level = Math.max(0, Math.min(9, int(found.refine)));
    const refine = level > 0 ? { level, label: `+${level}`, text: `Refined +${level}` } : null;
    return { condition, refine };
}

/** One piece's condition from the gear part, or { condition: null, refine: null } without it. */
const conditionFor = (tools, stack) => conditionView(tryQuery(tools, 'items.condition', { stack }));

/**
 * What `actorId` wears, from the items part's `items.gear` (stats capped by their level), with each
 * piece's condition and refinement from `items.condition`: [{ stack, name, slot, slotLabel, rarity,
 * stats, counted, why, condition, refine }]. [] without the items part.
 */
function gearOf(tools, actorId) {
    const found = tryQuery(tools, 'items.gear', { actor: actorId });
    if (!isRecord(found)) return [];
    // The items part names a refined piece with its level ("Iron Sword +2"); the card shows the level
    // as its own tag, so the name is the piece's own.
    const plainName = entry => {
        const name = String(entry?.name ?? '');
        const tag = ` +${int(entry?.refine)}`;
        return int(entry?.refine) > 0 && name.endsWith(tag) ? name.slice(0, -tag.length) : name;
    };
    const piece = (entry, counted) => ({
        stack: String(entry?.stack ?? ''), name: plainName(entry), slot: String(entry?.slot ?? ''), slotLabel: slotLabel(entry?.slot),
        rarity: String(entry?.rarity ?? 'common'), stats: counted ? statText(entry?.stats) : '', counted, why: counted ? '' : capital(entry?.why ?? 'not counted'),
        ...conditionFor(tools, entry?.stack),
    });
    return [
        ...(Array.isArray(found.counted) ? found.counted : []).map(entry => piece(entry, true)),
        ...(Array.isArray(found.unused) ? found.unused : []).map(entry => piece(entry, false)),
    ].filter(entry => entry.stack && entry.name);
}

/**
 * `rpg-battle.itemDetail({ stack })`: what RPG Battle adds to a Story Block Inventory row, or null for
 * a stack that is gone or that RPG Battle has nothing to say about (money, plain goods without a note).
 * { stack, kind, slot, slotLabel, stats, effect, wearer, helps: [names], condition, refine, lines }.
 * `lines` is the same in short plain text ("Weapon · ATK +3", "Worn by Ren", "+30 HP · would help
 * Lyra"), for a host that only prints text.
 */
export function itemDetail(state, args = {}, tools = null) {
    const id = typeof args?.stack === 'string' ? args.stack : '';
    const inventory = inventoryOf(state);
    const stack = id && isRecord(inventory.stacks) && Object.hasOwn(inventory.stacks, id) ? inventory.stacks[id] : null;
    const def = stack && isRecord(inventory.defs) && Object.hasOwn(inventory.defs, stack.def) ? inventory.defs[stack.def] : null;
    if (!isRecord(stack) || !isRecord(def) || def.kind === 'money') return null;
    const party = partyOf(state);
    const nameOf = who => String(party.actors?.[who]?.name ?? who);
    const out = { stack: id, kind: String(def.kind ?? 'goods'), slot: '', slotLabel: '', stats: '', effect: '', wearer: '', helps: [], condition: null, refine: null, lines: [] };
    if (def.kind === 'equipment' && def.slot) {
        out.slot = String(def.slot);
        out.slotLabel = slotLabel(def.slot);
        out.stats = statText(def.stats);
        const wearer = stack.owner === 'party' ? party.pc : stack.owner;
        if (stack.equipped && wearer && party.actors?.[wearer]) out.wearer = nameOf(wearer);
        Object.assign(out, conditionFor(tools, id));
        out.lines.push([out.slotLabel, out.stats].filter(Boolean).join(' · '));
        if (out.wearer) out.lines.push(`Worn by ${out.wearer}`);
        const worn = [out.condition?.text, out.refine?.text].filter(Boolean).join(' · ');
        if (worn) out.lines.push(worn);
    } else if (def.kind === 'consumable' && helpsNow(def.effect)) {
        out.effect = effectText(def.effect);
        // Who a dose would do something for now, by the rule item.use applies (v1 useItemOutside).
        const people = peopleOf(party);
        out.helps = people.filter(who => {
            const actor = party.actors?.[who];
            const sheet = {
                name: String(actor?.name ?? ''), hp: pool(actor?.hp), mp: pool(actor?.mp),
                conditions: (Array.isArray(actor?.conditions) ? actor.conditions : []).map(entry => ({ name: entry?.kind, stacks: entry?.stacks })),
            };
            try {
                return useItemOutside(sheet, { name: def.name, effect: def.effect }).used === true;
            } catch {
                return false;
            }
        }).map(nameOf);
        out.lines.push([out.effect, out.helps.length ? `would help ${out.helps.join(', ')}` : 'nobody needs it now'].join(' · '));
    } else {
        return null;
    }
    out.lines = out.lines.filter(Boolean);
    return copy(out);
}

/** The carry line from `items.carry` (no `add`): { on, text, over }; off (text '') without the limit. */
export function carryText(view) {
    if (!isRecord(view) || view.on !== true) return { on: false, text: '', over: false };
    // What things add (MODULES §F106): "+80 carry" beside the one it counts for.
    const plus = n => (int(n) > 0 ? ` (+${int(n)} carry)` : '');
    const people = (Array.isArray(view.people) ? view.people : []).map(person => `${person.name} ${int(person.load)}/${int(person.capacity)}${plus(person.bonus)}`);
    const added = int(view.bagBonus) + (Array.isArray(view.people) ? view.people : []).reduce((sum, person) => sum + int(person.bonus), 0);
    const text = [`Carrying ${int(view.load)} of ${int(view.capacity)}${people.length > 1 ? plus(view.bagBonus) : plus(added)}`, ...(people.length > 1 ? people : [])].join(' · ');
    return { on: true, text, over: int(view.load) > int(view.capacity) };
}

/** `rpg-battle.carry`: the carry limit's line (MODULES §F39) for the Party screen: { on, text, over }. */
export const carry = (state, args = {}, tools = null) => carryText(tryQuery(tools, 'items.carry', {}));

// ---------------------------------------------------------------------------------------------------
// Trade

/** The trader kinds the Trade page offers (v1 0.5.38), with who they are and whether they take commissions. */
export const TRADERS = Object.freeze([
    { kind: 'general', label: 'General store', commissions: false },
    { kind: 'apothecary', label: 'Apothecary', commissions: true },
    { kind: 'smith', label: 'Smith', commissions: true },
    { kind: 'crafter', label: 'Bone-carver', commissions: true },
    { kind: 'fence', label: 'Fence', commissions: false },
    { kind: 'guild', label: 'Guild', commissions: false },
]);

/** The chat's one currency (MODULES §F1): `inventory.currency` → { name, short }, else gold. */
function currencyFrom(tools) {
    const found = tryQuery(tools, 'inventory.currency', {});
    const name = String(found?.name ?? '').trim() || 'gold';
    const short = String(found?.short ?? '').trim() || name[0].toLowerCase();
    return { name, short };
}

const shortPrice = (amount, currency) => `${Math.max(0, int(amount))} ${currency.short}`;
const longPrice = (amount, currency) => `${Math.max(0, int(amount))} ${currency.name}`;

// A def as v1's isMaterial reads an item (a slot is gear, an effect a consumable).
function asV1Item(def) {
    const effect = isRecord(def?.effect) && Object.keys(def.effect).length ? def.effect : null;
    return { name: def?.name ?? '', kind: def?.kind ?? 'goods', slot: def?.slot ?? null, effect, note: def?.note ?? '', rarity: def?.rarity ?? 'common' };
}

/**
 * `rpg-battle.trade`: the Trade page's rows from the trade part's queries (trade.market,
 * trade.shops — a pack's shops for the place stand in for the generic traders —, trade.stock,
 * trade.quote, trade.orders) and the purse (inventory.wallet, MODULES §F1):
 * { open, place, line, shortage, purse, sell, traders, crafters, materials, orders } (`shortage`:
 * the line for a shortage here, MODULES §F36, else ''). Prices are whole
 * amounts of the one currency, shown short ("12 g") with the long words in each button's title.
 */
export function trade(state, args = {}, tools = null) {
    const currency = currencyFrom(tools);
    const market = tryQuery(tools, 'trade.market', {});
    const party = partyOf(state);
    const inventory = inventoryOf(state);
    const wallet = tryQuery(tools, 'inventory.wallet', { owner: 'party' }) ?? inventory.wallets?.party ?? {};
    const coin = Math.max(0, int(wallet?.coin));
    const open = market?.open === true;
    const place = String(market?.place ?? state?.domains?.scene?.place?.name ?? '') || 'Somewhere';
    // Why prices are what they are here (MODULES §F107: "Town · coastal: fish −20%"), with the reader's word.
    const prices = [market?.why || (market?.tier ? `${market.tier} prices` : ''), market?.level ? `${market.level} prices` : ''].filter(Boolean).join(' · ');
    const out = {
        open,
        available: market !== undefined && market !== null,
        place,
        line: !market ? 'Trade is not set up in this chat.' : open ? ['Market', prices].filter(Boolean).join(' · ') : 'No market here: trade in a settlement, or with a trader on the road.',
        shortage: market?.shortage ? `Shortage${market.shortage.reason ? `: ${market.shortage.reason}` : ''} · no restock, prices at ${int(market.shortage.prices, 150)}%${market.shortage.until ? ` until ${market.shortage.until}` : ''}` : '',
        purse: shortPrice(coin, currency),
        purseTitle: `${longPrice(coin, currency)} in the purse`,
        sell: [], traders: [], crafters: [], materials: [], orders: [],
    };

    const defs = isRecord(inventory.defs) ? inventory.defs : {};
    const ours = owner => owner === 'party' || Boolean(party.actors?.[owner]);
    const goods = Object.keys(isRecord(inventory.stacks) ? inventory.stacks : {}).sort()
        .map(id => inventory.stacks[id])
        .filter(stack => isRecord(stack) && stack.qty > 0 && !stack.equipped && ours(stack.owner) && defs[stack.def] && !['money', 'quest'].includes(defs[stack.def].kind))
        .sort((a, b) => String(defs[a.def].name).localeCompare(String(defs[b.def].name), 'en') || (a.id < b.id ? -1 : 1));

    if (open) {
        for (const stack of goods) {
            const def = defs[stack.def];
            const quote = tryQuery(tools, 'trade.quote', { type: 'sell', stack: stack.id, qty: 1 });
            const each = quote?.ok ? int(quote.each ?? quote.total) : null;
            out.sell.push({
                stack: stack.id, name: String(def.name ?? ''), qty: stack.qty, note: stack.qty > 1 ? '' : String(def.note ?? ''),
                each, price: each === null ? '—' : shortPrice(each, currency),
                title: each === null ? `Sell one ${def.name}` : `Sell one ${def.name} for ${longPrice(each, currency)}`,
            });
        }
        // The packs' shops for this place when there are any (trade.shops), else the generic traders.
        const packed = tryQuery(tools, 'trade.shops', {});
        const shops = Array.isArray(packed) && packed.length ? packed.map(shop => ({ kind: shop.slug, label: shop.name })) : TRADERS;
        shops.forEach((trader, index) => {
            const stock = tryQuery(tools, 'trade.stock', { kind: trader.kind });
            const rows = (Array.isArray(stock?.items) ? stock.items : []).map(item => ({
                def: String(item?.def?.id ?? ''), name: String(item?.def?.name ?? ''), note: String(item?.note ?? item?.def?.note ?? ''),
                rarity: String(item?.def?.rarity ?? 'common'), cost: int(item?.price), price: shortPrice(item?.price, currency),
                title: `Buy ${item?.def?.name ?? 'it'} for ${longPrice(item?.price, currency)}`,
            })).filter(row => row.def && row.name);
            out.traders.push({ kind: trader.kind, label: trader.label, shop: String(stock?.shop ?? trader.kind), first: index === 0, items: rows });
        });
        out.crafters = TRADERS.filter(trader => trader.commissions).map(trader => ({ kind: trader.kind, label: trader.label }));
        out.materials = goods.filter(stack => isMaterial(asV1Item(defs[stack.def]))).map(stack => ({ stack: stack.id, name: `${defs[stack.def].name}${stack.qty > 1 ? ` (${stack.qty})` : ''}` }));
    }

    const orders = tryQuery(tools, 'trade.orders', {});
    out.orders = (Array.isArray(orders) ? orders : []).map(order => ({
        id: String(order?.id ?? ''), name: String(order?.piece?.name ?? 'A piece'), crafter: capital(order?.crafter ?? ''),
        due: order?.due === true, collect: order?.due === true && open,
        status: order?.due === true ? (open ? 'ready' : 'ready: collect at a market') : 'not ready yet',
    })).filter(order => order.id);
    return copy(out);
}

// ---------------------------------------------------------------------------------------------------
// Crafting (MODULES §F102, feature `rpg-battle.crafting`)

const OUTCOMES = Object.freeze([
    ['fail', 'Fail', 'bad'], ['normal', 'Normal', 'neutral'], ['fine', 'Fine', 'good'], ['masterwork', 'Masterwork', 'accent'],
]);
const pct = value => Math.max(0, Math.min(100, int(value)));

/**
 * `rpg-battle.crafting`: the read-only Crafting screen's rows from the craft part's `craft.view`
 * (crafting is story-driven, `! craft X | with: …`; code rolls it, so there are no buttons):
 * { on, empty, people: [{ id, name, skills, count, recipes: [{ id, name, craft, station, stationOk, ready,
 * why, materials: [{ name, need, have, ok, text }], missing, chances: [{ key, label, pct, tone }],
 * dc }] }] }. `on` is false without the craft part (or with the feature off): the screen says so.
 */
export function crafting(state, args = {}, tools = null) {
    const found = tryQuery(tools, 'craft.view', {});
    if (!isRecord(found)) return { on: false, empty: true, people: [] };
    const people = (Array.isArray(found.people) ? found.people : []).filter(isRecord).slice(0, 12).map(person => {
        const recipes = (Array.isArray(person.recipes) ? person.recipes : []).filter(isRecord).slice(0, RECIPES_MAX).map(recipe => {
            const materials = (Array.isArray(recipe.materials) ? recipe.materials : []).filter(isRecord).slice(0, 24).map(entry => {
                const need = Math.max(1, int(entry.need, 1));
                const have = Math.max(0, int(entry.have));
                return { name: String(entry.name ?? ''), need, have, ok: have >= need, text: `${Math.min(have, 999)}/${need}` };
            }).filter(entry => entry.name);
            const station = isRecord(recipe.station) && String(recipe.station.name ?? '').trim() ? recipe.station : null;
            const chances = isRecord(recipe.chances) ? OUTCOMES.map(([key, label, tone]) => ({ key, label, pct: pct(recipe.chances[key]), tone })).filter(entry => entry.pct > 0) : [];
            return {
                id: String(recipe.id ?? recipe.name ?? ''), name: String(recipe.name ?? ''), craft: capital(recipe.craft ?? ''),
                station: station ? (station.here === true ? `At ${station.name}` : `Needs ${station.name}`) : '',
                stationOk: !station || station.here === true,
                materials, missing: materials.filter(entry => !entry.ok).length,
                ready: recipe.ready === true, why: String(recipe.why ?? ''),
                chances, dc: Number.isFinite(recipe.dc) ? int(recipe.dc) : null,
            };
        }).filter(recipe => recipe.name);
        // Their craft skills by rank ("Alchemy 2 · Smithing 1"), those with a rank only.
        const skills = (Array.isArray(person.skills) ? person.skills : []).filter(isRecord).filter(skill => int(skill.rank) > 0).slice(0, 8)
            .map(skill => `${capital(skill.craft ?? '')} ${int(skill.rank)}`).filter(line => line.trim()).join(' · ');
        return { id: String(person.id ?? ''), name: String(person.name ?? ''), skills, count: recipes.length, recipes };
    }).filter(person => person.name);
    return copy({ on: true, empty: people.every(person => person.recipes.length === 0), people });
}

/** The view queries, by name (merged into the module's queries by the coordinator). */
export const viewQueries = Object.freeze({
    'rpg-battle.cards': cards,
    'rpg-battle.heroes': heroes,
    'rpg-battle.hud': hud,
    'rpg-battle.itemDetail': itemDetail,
    'rpg-battle.carry': carry,
    'rpg-battle.crafting': crafting,
    'rpg-battle.trade': trade,
});
