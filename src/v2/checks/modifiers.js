// The checks part's modifiers (MODULES §F78, §F80): code's own, by a fixed rule, the same in the
// tail's table (what the model is told before it writes) and at capture (what the result is worked
// out with). The reader never adds or changes one. Pure.
//
// The rule, in full:
// 1. **The stat.** Every check is answered by one stat: the one written (`stat:`), else the one
//    its skill word means (party/checks.js statForCheck: stealth → DEX, climb → STR, …, else LUK).
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

import { DEFAULT_RULES, STATS, checkModifier } from '../../rules.js';
import { statForCheck } from '../party/checks.js';

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
    return out;
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

/** A member as the rule reads them: { actor, extras }. `defs`: the inventory's defs (for item tags). */
export function memberOf(query, actor, defs = {}) {
    return { actor, extras: extrasOf({ actor, talents: talentsOf(query, actor), items: itemsOf(query, actor, defs) }) };
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
    return `${head}${extras.length ? `; ${extras.join(', ')}` : ''}.`;
}
