// RPG Battle v2, generative offers: the rules block the narrator is given and the world it is made from (GENERATIVE_OFFERS_SPEC §2). The block is a
// `context.parts` piece of the quests part; it is non-empty only while the chat pins rules with at least one open quest template and Jobs from the story
// is on, so every other chat keeps its prompt byte for byte. It is generated from the pin (and the installed pack's own ranks and foe order, when it is
// installed), so it is the same on every reply of a chat. Pure apart from the queries it is handed.

import { defaultRank, ladderFrom, rangeText } from './ranks.js';
import { money } from './parse.js';
import { ask, templates } from './seams.js';
import { cut, flat } from './offer-bands.js';
import { kindOf } from './offer-rules.js';

export const GUIDE_RANKS = 4;
export const GUIDE_EXAMPLES = 3;
const LINE_CHARS = 200;

/** The rank ladder of a pin: the installed pack's own `ranks`, else one row per template rank, lowest level first (§2.3). `query` is any query function. */
export function ladderOf(query, pin, packKey) {
    const own = ladderFrom(ask(query, 'packs.content', { kind: 'ranks', pack: packKey }));
    if (own) return own;
    const rows = new Map();
    for (const template of templates(pin).filter(entry => entry?.open === true)) {
        const row = rows.get(template.rank) ?? { id: template.rank, title: template.rank, levels: [Infinity, 0], reward: [Infinity, 0] };
        const level = template.requirements.find(entry => entry.kind === 'level')?.min ?? 1;
        row.levels = [Math.min(row.levels[0], level), Math.max(row.levels[1], level)];
        row.reward = [Math.min(row.reward[0], template.reward.coinMin), Math.max(row.reward[1], template.reward.coinMax)];
        rows.set(template.rank, row);
    }
    return [...rows.values()].sort((a, b) => a.levels[0] - b.levels[0]);
}

/** The foe refs of the installed pack in its own order (the pin keeps them sorted), or [] when the pack is not installed. */
export function foeOrderOf(query, packKey) {
    const creatures = ask(query, 'packs.content', { kind: 'creatures', pack: packKey });
    return Array.isArray(creatures) ? creatures.map(record => record?.id ?? (record?.slug ? `pack.${packKey}/${record.slug}` : null)).filter(Boolean) : [];
}

const KIND_WORDS = Object.freeze([['story', 'story tasks'], ['kill', 'hunts'], ['collect', 'deliveries'], ['visit', 'journeys']]);

/** The foes of a rank row, by level then pack order. */
function foesOfRank(pin, ladder, order, row) {
    const place = new Map(order.map((ref, index) => [ref, index]));
    const at = foe => (place.has(foe.id) ? place.get(foe.id) : order.length);
    return Object.values(pin.resolved.foes ?? {}).filter(foe => defaultRank(ladder, 'normal', foe.level)?.id === row.id)
        .sort((a, b) => a.level - b.level || at(a) - at(b) || (a.id < b.id ? -1 : 1));
}

/** The first, the middle and the last of a list, `count` of them spread evenly (fewer when the list is short). */
function spread(list, count) {
    if (!list.length || count < 1) return [];
    if (count === 1) return [list[0]];
    const picks = new Set();
    for (let i = 0; i < count; i += 1) picks.add(Math.floor((list.length - 1) * i / (count - 1)));
    return [...picks].map(index => list[index]);
}

/** The grading guide (§2.3): one line per ladder row that has an open quest template. */
export function gradingGuide({ pin, ladder, order = [], currency, ranks = GUIDE_RANKS, examples = GUIDE_EXAMPLES }) {
    const open = templates(pin).filter(template => template?.open === true);
    const lines = [];
    for (const row of ladder) {
        if (lines.length >= ranks) break;
        const mine = open.filter(template => String(template.rank).toLowerCase() === String(row.id).toLowerCase());
        if (!mine.length) continue;
        const low = Math.min(...mine.map(template => template.reward.coinMin));
        const high = Math.max(...mine.map(template => template.reward.coinMax));
        const kinds = KIND_WORDS.filter(([kind]) => mine.some(template => kindOf(template) === kind)).map(([, word]) => word);
        const foes = spread(foesOfRank(pin, ladder, order, row), examples).map(foe => flat(foe.name, 80));
        const levels = row.levels ? `levels ${row.levels[0]}–${row.levels[1]}, ` : '';
        lines.push(cut(`Rank ${row.id} (${flat(row.title, 40)}, ${levels}pays ${rangeText({ reward: [low, high] }, currency)}): ${kinds.join(', ')}${foes.length ? `; foes like ${foes.join(', ')}` : ''}.`, LINE_CHARS));
    }
    return lines;
}

/** The first open template of a kind in rank order (the pack's order is not in the pin): a job's example reward and a teacher's example fee. */
function firstOpen(pin, ladder, pick) {
    const rank = template => {
        const at = ladder.findIndex(row => String(row.id).toLowerCase() === String(template.rank).toLowerCase());
        return at < 0 ? ladder.length : at;
    };
    return templates(pin).filter(template => template?.open === true && pick(template)).sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1))[0] ?? null;
}

/**
 * The rules block text for a pin, or '' when the pin has no open quest template (§2.2). `trainers`: the pin's open trainer templates in the pack's order.
 * `guide: false` leaves out the grading guide and its header line (offerGuideRanks 0).
 */
export function offerBlock({ pin, ladder, order = [], currency, trainers = [], ranks = GUIDE_RANKS, examples = GUIDE_EXAMPLES }) {
    const open = templates(pin).filter(template => template?.open === true);
    if (!open.length) return '';
    const sample = firstOpen(pin, ladder, template => kindOf(template) === 'kill') ?? firstOpen(pin, ladder, () => true);
    const reward = money(sample.reward.coinMin, currency);
    const lines = [
        'Jobs and teachers: write them your way. These labels help code read them; code keeps the numbers inside this world\'s limits.',
        `Job: + quest Name | giver: who | type: hunt, cull, gather, deliver, explore, escort or task | goal: what to do, with a count | reward: an amount | due: how long, e.g. in 3 days | difficulty: easy, normal or hard. Example: + quest Cellar Trouble | giver: the innkeeper | type: cull | goal: kill 4 rats in the cellar | reward: ${reward} | due: in 2 days | difficulty: easy`,
        ...(trainers.length ? [`Teacher: + trainer Name — what they teach | fee: an amount. Example: + trainer Old Soldier — spear and shield drills | fee: ${money(trainers[0].fee.coinMin, currency)}`] : []),
        'Every job needs a deadline (due:). Code settles the template, rank, count, reward, XP, deadline and fee and tells you the terms on the next turn; use them from then on. A job offered in this reply can be taken up from {{user}}\'s next message (then write + quest Name).',
        'A hunt or cull counts only foes beaten in a fight: ! encounter 4 Foe (the terms name the foe). A gathering counts what the party holds when it is handed in: loot first, else + item as the story gives it.',
    ];
    const guide = ranks > 0 ? gradingGuide({ pin, ladder, order, currency, ranks, examples }) : [];
    if (guide.length) lines.push('Job ranks here (a hunt takes its foe\'s rank; otherwise difficulty and {{user}}\'s rank decide):', ...guide);
    return lines.join('\n');
}

/** Whether the rules block (and with it the shorter slug-free lines of §2.4) applies to this pin. */
export const blockApplies = pin => Boolean(pin?.resolved) && templates(pin).some(template => template?.open === true);
