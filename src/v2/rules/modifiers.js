// The checks part's modifiers (MODULES §F78, §F80): code's own, by a fixed rule, the same in the
// tail's table (what the model is told before it writes) and at capture (what the result is worked
// out with). The reader never adds or changes one. Pure.
//
// The rule, in full:
// 1. **The stat.** Every check is answered by one stat: the one written (`stat:`), else the one
//    its skill word means (rules/check-words.js statForCheck: stealth → DEX, climb → STR, …, else LUK).
//    Its modifier is v1's check modifier of the member's **base** stat (rules.checkModifier:
//    (stat − 5) ÷ 2 rounded down, from −3 to +10; gear does not count, as in v1's Checks line).
// 2. **Topics.** A check's skill word falls under none, one or more fixed topics (TOPICS below:
//    `perception` for notice/search/spot/listen…, `stealth` for sneak/hide…, `lock` for
//    lock/pick/disarm/trap…, and so on). Only the skill word counts, never the text after it.
// 3. **What applies to a topic,** each with a fixed amount:
//    * a skill the member has in use (active) whose **name** falls under the topic: **+2**;
//    * a talent the member took at creation whose **tags** say the topic (TALENT_TOPICS: a talent
//      tagged `perception` → perception, `labour` → strength and climb, …; a tag that is itself a
//      topic's name or word counts too), or, with no tags known, whose name falls under it: **+1**;
//    * an item the member or the party's shared bag carries (not money, a consumable or a quest
//      thing) whose **name or tags** say the topic (ITEM_TOPICS: rope → climb, lockpicks → lock,
//      lantern → perception, …; a tag that is a topic's name counts): **+1**, and only one item
//      counts for a check (the first by name).
//    Together these add at most **+3** (EXTRA_CAP); the stat is on top of that. One source counts
//    once, even when it falls under two of the check's topics.
// 4. **Effects** (feature `rpg-battle.effects`, party/effects.js): a timed buff or debuff on the
//    member (or on everyone) whose `on` is `all`, the check's stat, or one of its topics adds its
//    amount (code's: ±1 to ±3 by its word band), each effect once; all of them together move a
//    check by at most ±3 (EFFECT_CAP), on top of the stat and the extras.
// 5. **Encumbered** (Story Block's `inventory.encumbrance`, its feature `story-block.encumbrance`):
//    a member over their own carry capacity, or everyone when the party's whole load is over its
//    capacity, has its `penalty` (−2) on checks of its `stats` (AGI, DEX), outside every cap. Without
//    the query, nothing.

import { DEFAULT_RULES, STATS, checkModifier } from '../../rules.js';
import { statForCheck } from './check-words.js';

/** The fixed topics and the skill words that fall under each (tested against the skill word). */
export const TOPICS = Object.freeze({
    perception: /\b(?:percep\w*|notic\w*|spot\w*|search\w*|look\w*|listen\w*|investigat\w*|insight\w*|awareness|watch\w*|scout\w*)\b/,
    stealth: /\b(?:stealth\w*|sneak\w*|hid(?:e|es|ing)|hidden|creep\w*|prowl\w*|skulk\w*)\b/,
    lock: /\b(?:lock\w*|pick\w*|disarm\w*|trap\w*|sleight\w*|pickpocket\w*)\b/,
    climb: /\b(?:climb\w*|scal(?:e|es|ing)|swim\w*|jump\w*|leap\w*|athlet\w*)\b/,
    strength: /\b(?:strength|lift\w*|carry\w*|break\w*|smash\w*|push\w*|pull\w*|forc(?:e|es|ing)|grappl\w*|wrestl\w*|haul\w*)\b/,
    speed: /\b(?:run|runs|running|chas\w*|dodg\w*|escap\w*|evad\w*|acrobat\w*|reflex\w*|balanc\w*|tumbl\w*|speed)\b/,
    endurance: /\b(?:endur\w*|stamina|fortitude|resist\w*|poison\w*|toughness|constitution|march\w*)\b/,
    will: /\b(?:will|willpower|resolve|courage|fear|nerve|resist\w*|steel\w*)\b/,
    social: /\b(?:social|persua\w*|decept\w*|deceiv\w*|bluff\w*|charm\w*|negotiat\w*|haggl\w*|barter\w*|convinc\w*|perform\w*|intimidat\w*|lie|lying|diplomac\w*|etiquette)\b/,
    lore: /\b(?:lore|arcan\w*|knowledge|histor\w*|recall\w*|deciph\w*|stud\w*|magic|religion|medicine|read\w*)\b/,
    nature: /\b(?:nature|surviv\w*|track\w*|forag\w*|navigat\w*|hunt\w*|wilderness|herb\w*)\b/,
    animals: /\b(?:animals?|ride|rides|riding|tam(?:e|es|ing)|handl\w*|calm\w*|horse\w*)\b/,
    craft: /\b(?:craft\w*|repair\w*|mend\w*|forg(?:e|es|ing)|tinker\w*|build\w*|smith\w*)\b/,
    luck: /\b(?:luck\w*|chance|gambl\w*|fortune|guess\w*)\b/,
});

export const TOPIC_NAMES = Object.freeze(Object.keys(TOPICS));

/** What a talent's tag means (the built-in talents' tags, creation/content.js). */
export const TALENT_TOPICS = Object.freeze({
    perception: ['perception'], endurance: ['endurance'], social: ['social'], speed: ['speed'], lore: ['lore'],
    luck: ['luck'], labour: ['strength', 'climb'], dark: ['stealth'], nature: ['nature'], craft: ['craft', 'lock'],
    will: ['will'], animals: ['animals'],
});

/** What an item's name says it helps with. */
export const ITEM_TOPICS = Object.freeze([
    [/\b(?:rope|ropes|grappl\w*|climbing)\b/, 'climb'],
    [/\b(?:lockpicks?|picks|thieves'? tools|skeleton key)\b/, 'lock'],
    [/\b(?:lantern|torch|lamp|spyglass|lens)\b/, 'perception'],
    [/\b(?:map|maps|compass)\b/, 'nature'],
    [/\b(?:tools|toolkit|kit|hammer|tongs)\b/, 'craft'],
    [/\b(?:lute|flute|harp|drum|instrument|fine clothes)\b/, 'social'],
    [/\b(?:book|tome|journal|scroll case|notes)\b/, 'lore'],
    [/\b(?:soft boots|dark cloak|shadow cloak)\b/, 'stealth'],
    [/\b(?:lucky|clover|rabbit'?s foot)\b/, 'luck'],
]);

export const AMOUNTS = Object.freeze({ skill: 2, talent: 1, item: 1 });
export const EXTRA_CAP = 3;
export const EFFECT_CAP = 3;
const ITEM_KINDS_LEFT_OUT = ['money', 'consumable', 'quest'];

const lower = value => ` ${String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()} `;

/** The topics a text falls under (a topic's own name counts), in TOPICS order. */
export function topicsOf(text) {
    const said = lower(text);
    if (!said.trim()) return [];
    return TOPIC_NAMES.filter(name => TOPICS[name].test(said) || said.includes(` ${name} `));
}

/** The topics a list of tags says: a talent tag's meaning, a topic's name, or a topic's word. */
function tagTopics(tags, table = TALENT_TOPICS) {
    const out = new Set();
    for (const tag of Array.isArray(tags) ? tags : []) {
        const key = String(tag ?? '').trim().toLowerCase();
        for (const topic of table[key] ?? []) out.add(topic);
        for (const topic of topicsOf(key)) out.add(topic);
    }
    return TOPIC_NAMES.filter(name => out.has(name));
}

/** The topics an item's name and tags say. */
export function itemTopics(item) {
    const said = lower(item?.name);
    const out = new Set(ITEM_TOPICS.filter(([pattern]) => pattern.test(said)).map(([, topic]) => topic));
    for (const topic of tagTopics(item?.tags, {})) out.add(topic);
    return TOPIC_NAMES.filter(name => out.has(name));
}

/**
 * What a member brings beyond the stat, by the rule above: [{ source: 'skill'|'talent'|'item',
 * name, topics, amount }], skills first, then talents, then items, each by name. `talents`:
 * [{ name, tags }]; `items`: [{ name, kind, tags }] they or the shared bag carry.
 */
export function extrasOf({ actor, talents = [], items = [] } = {}) {
    const out = [];
    const seen = new Set();
    const add = (source, name, topics) => {
        const key = `${source}:${String(name).toLowerCase()}`;
        if (!topics.length || seen.has(key)) return;
        seen.add(key);
        out.push({ source, name: String(name), topics, amount: AMOUNTS[source] });
    };
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'en');
    for (const skill of [...(actor?.skills ?? [])].filter(entry => entry?.active !== false && entry?.name).sort(byName)) add('skill', skill.name, topicsOf(skill.name));
    for (const talent of [...talents].filter(entry => entry?.name).sort(byName)) {
        const known = Array.isArray(talent.tags) && talent.tags.length;
        add('talent', talent.name, known ? tagTopics(talent.tags) : topicsOf(talent.name));
    }
    for (const item of [...items].filter(entry => entry?.name && !ITEM_KINDS_LEFT_OUT.includes(entry.kind)).sort(byName)) add('item', item.name, itemTopics(item));
    return out;
}

/** v1's check modifier of a member's base stat (an unknown stat counts as the start value). */
export function statModifier(actor, stat, rules = DEFAULT_RULES) {
    const value = actor?.stats?.[stat];
    return checkModifier(Number.isFinite(value) ? value : rules.character.startStat, rules);
}

/** { STR: n, … } for every stat: the table's first half. */
export function statModifiers(actor, rules = DEFAULT_RULES) {
    return Object.fromEntries(STATS.map(stat => [stat, statModifier(actor, stat, rules)]));
}

/**
 * The modifiers of one check, by the rule: [{ source: 'stat', amount, reason: STAT }, then each
 * extra whose topics meet the check's, as { source, amount, reason: its name }], the extras
 * together at most +3 and one item at most. `member` is { actor, extras } (memberOf).
 */
export function modifiersFor(member, skill, stat = null, rules = DEFAULT_RULES) {
    const used = statForCheck(skill, stat);
    const out = [{ source: 'stat', amount: statModifier(member?.actor, used, rules), reason: used }];
    const wanted = new Set(topicsOf(skill));
    let left = EXTRA_CAP;
    let item = false;
    for (const extra of member?.extras ?? []) {
        if (left <= 0) break;
        if (!extra.topics.some(topic => wanted.has(topic))) continue;
        if (extra.source === 'item') {
            if (item) continue;
            item = true;
        }
        const amount = Math.min(extra.amount, left);
        left -= amount;
        out.push({ source: extra.source, amount, reason: extra.name });
    }
    // Encumbered: the host's penalty on checks of its stats, outside the caps.
    const burden = member?.burden;
    if (burden && burden.stats.includes(used)) out.push({ source: 'effect', amount: burden.penalty, reason: 'Encumbered' });
    // Effects: each that matches once, all together within ±EFFECT_CAP.
    let up = EFFECT_CAP;
    let down = EFFECT_CAP;
    for (const effect of member?.effects ?? []) {
        const amount = effectAmount(effect, used, wanted);
        if (!amount) continue;
        const kept = amount > 0 ? Math.min(amount, up) : -Math.min(-amount, down);
        if (!kept) continue;
        if (kept > 0) up -= kept;
        else down += kept;
        out.push({ source: 'effect', amount: kept, reason: String(effect.name).slice(0, 60) });
    }
    return out;
}

/** What one effect adds to a check answered by `stat` with topics `wanted` (its largest matching entry, by size). */
function effectAmount(effect, stat, wanted) {
    let best = 0;
    for (const entry of Array.isArray(effect?.checks) ? effect.checks : []) {
        if (!(entry.on === 'all' || entry.on === stat || wanted.has(entry.on))) continue;
        if (Math.abs(entry.amount) > Math.abs(best)) best = entry.amount;
    }
    return Number.isInteger(best) ? best : 0;
}

// ---------------------------------------------------------------------------------------
// Gathering what a member has, through queries (a command's ctx or a view's / query's tools)

function ask(query, name, args) {
    if (typeof query !== 'function') return null;
    try {
        return query(name, args) ?? null;
    } catch {
        return null;
    }
}

/** The talents a member took ([{ name, tags }]): their origin's, with tags from creation.content. */
export function talentsOf(query, actor) {
    const taken = Array.isArray(actor?.origin?.talents) ? actor.origin.talents : [];
    const legacy = ['talents', 'abilities', 'traits'].flatMap(field => (Array.isArray(actor?.[field]) ? actor[field] : []))
        .map(entry => (typeof entry === 'string' ? { name: entry } : entry)).filter(entry => entry?.name);
    if (!taken.length && !legacy.length) return [];
    const offered = taken.length ? ask(query, 'creation.content', {})?.talents : null;
    const tagsOf = id => (Array.isArray(offered) ? offered.find(entry => entry?.id === id)?.tags ?? [] : []);
    return [
        ...taken.filter(entry => entry?.name).map(entry => ({ name: String(entry.name), tags: tagsOf(entry.id) })),
        ...legacy.map(entry => ({ name: String(entry.name), tags: Array.isArray(entry.tags) ? entry.tags : [] })),
    ];
}

/** What a member carries, and the party's shared bag: [{ name, kind, tags }] (tags from the defs). */
export function itemsOf(query, actor, defs = {}) {
    const rows = [...(ask(query, 'inventory.items', { owner: actor?.id }) ?? []), ...(ask(query, 'inventory.items', { owner: 'party' }) ?? [])];
    const seen = new Set();
    return rows.filter(row => row && row.qty > 0 && !seen.has(row.stack) && seen.add(row.stack))
        .map(row => ({ name: row.name, kind: row.kind, tags: defs?.[row.def]?.tags ?? [] }));
}

/** The effects on a member now ([{ name, checks }]; party.effects, [] while the feature is off). */
export function effectsOf(query, actor) {
    const list = actor?.id ? ask(query, 'party.effects', { actor: actor.id }) : null;
    return (Array.isArray(list) ? list : []).filter(effect => effect?.name && Array.isArray(effect.checks) && effect.checks.length)
        .map(effect => ({ name: String(effect.name), checks: effect.checks.map(entry => ({ on: entry.on, amount: entry.amount })) }));
}

/**
 * Whether Story Block says `actor` is encumbered (`inventory.encumbrance`: they are named in `who`,
 * or the whole party is over its capacity): { penalty (a whole number below 0), stats: [STAT] }, or
 * null (not encumbered, no such query, or an answer that is not one).
 */
export function encumbranceOf(query, actorId) {
    const found = actorId ? ask(query, 'inventory.encumbrance', {}) : null;
    if (!found || typeof found !== 'object' || found.encumbered !== true) return null;
    const penalty = Number(found.penalty);
    if (!Number.isInteger(penalty) || penalty >= 0) return null;
    const named = Array.isArray(found.who) && found.who.some(person => person?.id === actorId);
    if (!named && found.party !== true) return null;
    const stats = (Array.isArray(found.stats) ? found.stats : []).filter(stat => STATS.includes(stat));
    return stats.length ? { penalty: Math.max(-10, penalty), stats } : null;
}

/** A member as the rule reads them: { actor, extras, effects, burden }. `defs`: the inventory's defs (for item tags). */
export function memberOf(query, actor, defs = {}) {
    return {
        actor, extras: extrasOf({ actor, talents: talentsOf(query, actor), items: itemsOf(query, actor, defs) }), effects: effectsOf(query, actor),
        burden: encumbranceOf(query, actor?.id),
    };
}

/** The rules checks read: v1's, with a rules file's `checks` numbers (settings `rules.checks`) over them. */
export function rulesFor(settings) {
    const own = settings && typeof settings === 'object' ? settings.rules?.checks : null;
    return own && typeof own === 'object' ? { ...DEFAULT_RULES, checks: { ...DEFAULT_RULES.checks, ...own } } : DEFAULT_RULES;
}

const signed = amount => (amount < 0 ? `−${-amount}` : `+${amount}`);

/**
 * The table's line for one member: "Ren (you): STR +0, VIT +1, AGI +1, DEX +2, INT +0, LUK +0,
 * CHA +0; +2 stealth (Sneak), +1 perception (Keen Eyes)."
 */
export function tableLine(member, { you = false, rules = DEFAULT_RULES } = {}) {
    const stats = statModifiers(member.actor, rules);
    const head = `${member.actor?.name ?? 'Someone'}${you ? ' (you)' : ''}: ${STATS.map(stat => `${stat} ${signed(stats[stat])}`).join(', ')}`;
    const extras = member.extras.map(extra => `${signed(extra.amount)} ${extra.topics.join('/')} (${extra.name})`);
    const effects = (member.effects ?? []).flatMap(effect => effect.checks.map(entry => `${signed(entry.amount)} ${entry.on === 'all' ? 'all checks' : STATS.includes(entry.on) ? `${entry.on} checks` : entry.on} (${effect.name})`));
    const burden = member.burden ? member.burden.stats.map(stat => `${signed(member.burden.penalty)} ${stat} checks (Encumbered)`) : [];
    const more = [...extras, ...effects, ...burden];
    return `${head}${more.length ? `; ${more.join(', ')}` : ''}.`;
}
