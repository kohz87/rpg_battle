// The `encounter` change line (MODULES §B3): the story starts a fight, code turns it into an
// offer the reader fights or turns down.
//
//   ! encounter 3 Wolf — circling the camp | tier: weak | stakes: normal
//
// The name part is read with v1's encounter parser (story.parseEncounter), so everything v1 knew
// about how models write foes still holds: counts in digits or words, plurals made singular
// against the bestiary, swarms and packs, "(boss)", a threat word written before the name. A
// threat word is never a creature: a name that is only notes ("Even", "deadly", "to the death")
// names no foe and the line is turned down. The tier label says how dangerous the foes are to
// the party in one word; code turns it into a level when the fight starts.
//
// A `rank: D` label instead (MODULES §F91) names a rank on the suite's one ladder (`party.ranks`,
// terms.js rankLadder): code picks the foes' level inside that rank's band (rankLevel: the level
// nearest your character's), and the foe keeps `rank` and `level` beside a `tier` worked out
// from the level gap, so a fight that does not read the level yet still has a tier. A written
// rank is never more dangerous than `deadly`: a rank whose band starts further above your
// character than a deadly foe would be is held to the highest rank that does not (`said` keeps
// what the story wrote). A fight with a boss is never below strong: a boss is never made smaller
// (setup.tierPower), so the line's tier and the boss's own are read as at least strong.
//
// Every foe the story writes is fought (the field takes them in waves, setup.planWaves): every row
// is read, and a count past MAX_COUNT ("12 cellar rats") is kept, split into rows of at most
// MAX_COUNT. One line brings at most MAX_ENCOUNTER_FOES foes; past it, bosses keep their places
// first and the last foes written stay out, and the result says so (`cut`, told as a Problem). Pure.

import { DEFAULT_RULES, threatForGap, threatStep } from '../../rules.js';
import { parseEncounter } from '../../story.js';
import { isNoteName } from '../../templates.js';
import { maxLevel, rankAt, rankNamed } from '../../terms.js';

// v1's five threat words (story.THREATS): 'trivial' is a tier of its own, two steps below the
// party (rules.threat.offsets), never read as 'weak'.
export const TIERS = Object.freeze(['trivial', 'weak', 'even', 'strong', 'deadly']);
export const STAKES = Object.freeze(['normal', 'death']);
export const MAX_COUNT = 9;
// The most foes one encounter line brings (six rows of nine, the most a line could bring before).
export const MAX_ENCOUNTER_FOES = 54;
const MAX_NOTE = 160;
const MAX_PLACE = 60;

// The words a tier may be written as (v1's threat words, story.js), as one of the tiers.
const TIER_WORDS = {
    trivial: 'trivial', feeble: 'trivial', puny: 'trivial',
    weak: 'weak', minor: 'weak', easy: 'weak', low: 'weak', lesser: 'weak',
    even: 'even', fair: 'even', matched: 'even', equal: 'even', normal: 'even', medium: 'even',
    strong: 'strong', tough: 'strong', dangerous: 'strong', high: 'strong', hard: 'strong',
    deadly: 'deadly', lethal: 'deadly', overwhelming: 'deadly', elite: 'deadly', calamity: 'deadly',
};

const tidy = (text, max) => String(text ?? '').replace(/[\r\n|<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** A tier word as one of TIERS, or null for a word that is none. */
export function tierOf(word) {
    return TIER_WORDS[String(word ?? '').trim().toLowerCase()] ?? null;
}

/** 'death' for "death", "to the death", "lethal stakes"; 'normal' for "normal" or nothing; else null. */
export function stakesOf(word) {
    const text = String(word ?? '').trim().toLowerCase();
    if (!text || text === 'normal' || text === 'none' || text === 'defeat') return 'normal';
    if (/\bdeath\b/.test(text) || text === 'lethal') return 'death';
    return null;
}

const labelOf = (labels, ...names) => {
    for (const name of names) {
        const value = labels?.[name];
        if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    return '';
};

/**
 * A parsed change line ({ op, kind, name, text, labels }) as an offer's fields:
 * { ok: true, foes: [{ name, count, tier, boss?, wave? }], cut?, stakes, place, note } or
 * { ok: false, message } saying in plain words why it cannot be one. `cut` ([{ name, count }]) is
 * what stayed out past MAX_ENCOUNTER_FOES (cutText words it). `bestiary` is the list
 * names are matched against (the chat's creatures, then the shipped ones).
 */
export function readEncounter(line, { bestiary, rules = DEFAULT_RULES, ranks = null, pcLevel = 1, literal = false, leadingCount = false } = {}) {
    if (line?.op && line.op !== '!' && line.op !== '+') {
        return { ok: false, message: `An encounter is written with "!" (it happens), not "${line.op}".` };
    }
    const name = tidy(line?.name, 200);
    if (!name) return { ok: false, message: 'The encounter names no foe.' };
    if (isNoteName(name)) return { ok: false, message: `"${name}" says how a fight is, not who is in it: name the foes.` };

    const tierText = labelOf(line?.labels, 'tier', 'threat');
    const tier = tierText ? tierOf(tierText) : 'even';
    if (!tier) return { ok: false, message: `"${tierText}" is not a tier: write trivial, weak, even, strong or deadly.` };
    const stakesText = labelOf(line?.labels, 'stakes');
    const stakes = stakesOf(stakesText);
    if (!stakes) return { ok: false, message: `"${stakesText}" is not a stake: write normal or death.` };

    const rankText = labelOf(line?.labels, 'rank');
    let ranked = null;
    if (rankText) {
        ranked = rankFoe(rankText, { ranks, pcLevel, rules });
        if (!ranked.ok) return ranked;
    }

    if (literal && (typeof line.name !== 'string' || line.name.trim().length > 48 || /[<>|\p{Cc}]/u.test(line.name))) return { ok: false, message: 'A variant names one literal foe, up to 48 characters.' };
    // A named kind (`| like:`) is one literal name; with Jobs from the story on, a count in front of it ("6 Culvert Rats") is how many of them, as the job's terms write it.
    const counted = literal && leadingCount ? /^(\d{1,2})\s+(\S.*)$/u.exec(line.name.trim()) : null;
    const rows = literal ? [{ name: counted ? counted[2] : line.name.trim(), count: counted ? Number(counted[1]) : 1, written: counted ? Number(counted[1]) : 1, counted: true }] : parseEncounter(name, bestiary, rules).filter(row => row?.name && !isNoteName(row.name));
    if (!rows.length) return { ok: false, message: `No foe could be read from "${name}".` };
    // A fight with a boss is never below strong (the user's call, wave C): a boss is never made
    // smaller, so "a weak boss" would be a weak fight that is not. The line's tier, and the boss's
    // own, below strong are read as strong, and the offer and its receipt say so.
    // A ranked boss fight too: its foes keep their rank's level, their tier is held to strong.
    const bossFight = rows.some(row => row?.boss);
    const atLeastStrong = value => (bossFight && TIERS.indexOf(value) < TIERS.indexOf('strong') ? 'strong' : value);
    const lineTier = atLeastStrong(tier);
    const read = rows.map(row => {
        // A threat word the story put on the foe itself ("3 weak wolves") is that foe's tier.
        const own = row.threat ? tierOf(row.threat) : null;
        const written = ranked ? atLeastStrong(ranked.tier) : own ?? lineTier;
        // The number written, past MAX_COUNT too (story.parseGroup keeps it as `written`).
        const count = Math.max(1, Math.round(Number(row.written ?? row.count) || 1));
        const foe = { name: tidy(row.name, 48), count, tier: row.boss ? atLeastStrong(written) : written };
        if (ranked) Object.assign(foe, { rank: ranked.rank, level: ranked.level, ...(ranked.said ? { said: ranked.said } : {}) });
        if (row.boss) foe.boss = true;
        if (Number(row.wave) >= 1) foe.wave = Math.round(Number(row.wave));
        return { foe, counted: Boolean(row.counted) };
    }).filter(({ foe }) => foe.name);
    const { kept, cut } = withinEncounter(read);
    const foes = kept.flatMap(({ foe, counted }) => rowsOf(foe, counted));
    if (!foes.length) return { ok: false, message: `No foe could be read from "${name}".` };
    return {
        ok: true,
        foes,
        ...(cut.length ? { cut } : {}),
        stakes,
        place: tidy(labelOf(line?.labels, 'place', 'at', 'where'), MAX_PLACE),
        note: tidy(line?.text, MAX_NOTE),
    };
}

/**
 * The foes read from a line held to MAX_ENCOUNTER_FOES in all: bosses take their places first, then
 * the rest in the order written; what does not fit stays out. → { kept (in the order written), cut:
 * [{ name, count }] }. Entries are { foe, counted }.
 */
function withinEncounter(read) {
    let room = MAX_ENCOUNTER_FOES;
    const keep = new Map();
    for (const entry of [...read.filter(({ foe }) => foe.boss), ...read.filter(({ foe }) => !foe.boss)]) {
        const n = Math.min(room, entry.foe.count);
        room -= n;
        keep.set(entry, n);
    }
    const kept = [];
    const cut = [];
    for (const entry of read) {
        const n = keep.get(entry) ?? 0;
        if (n > 0) kept.push({ ...entry, foe: { ...entry.foe, count: n } });
        if (n >= entry.foe.count) continue;
        const same = cut.find(other => other.name === entry.foe.name);
        if (same) same.count += entry.foe.count - n;
        else cut.push({ name: entry.foe.name, count: entry.foe.count - n });
    }
    return { kept, cut };
}

/** A foe of any count as offer rows of at most MAX_COUNT each, `counted` (a count the story wrote) kept on each. */
function rowsOf(foe, counted) {
    const out = [];
    for (let left = foe.count; left > 0; left -= MAX_COUNT) {
        const row = { ...foe, count: Math.min(MAX_COUNT, left) };
        // A count the story wrote (story.parseGroup): kept by quest sizing; not part of the offer's data.
        if (counted) Object.defineProperty(row, 'counted', { value: true, enumerable: false });
        out.push(row);
    }
    return out;
}

/** "60 foes are written; one fight brings 54 at most: 6 Cellar Rat stay out." for a line's `cut`; '' for none. */
export function cutText(cut, written) {
    if (!Array.isArray(cut) || !cut.length) return '';
    return `${written} foes are written; one fight brings ${MAX_ENCOUNTER_FOES} at most: ${cut.map(entry => `${entry.count} ${entry.name}`).join(', ')} stay out.`;
}

/** What a `rank:` is read with, from a command's ctx: { ranks (party.ranks), pcLevel }; none when the queries are not there. */
export function rankContext(ctx) {
    const ask = (name, args) => {
        try { return ctx.query(name, args); } catch { return null; }
    };
    const ranks = ask('party.ranks', {});
    const level = Number(ask('party.pc', {})?.level);
    return { ranks: Array.isArray(ranks) ? ranks : null, pcLevel: Number.isInteger(level) && level >= 1 ? level : 1 };
}

/**
 * The level a foe of `rank` comes at for a character of `pcLevel`: the level in the rank's band
 * nearest the character's (inside it: the character's own), held to `most` and the level cap.
 */
export function rankLevel(rank, pcLevel, { rules = DEFAULT_RULES, most = Infinity } = {}) {
    const pc = Math.max(1, Math.round(Number(pcLevel) || 1));
    const [lo, hi] = rank.levels;
    return Math.max(1, Math.min(maxLevel(rules), most, hi, Math.max(lo, pc)));
}

/** How many levels above the character a deadly foe is (rules.threat: offsets.deadly × step). */
export function deadlyGap(rules = DEFAULT_RULES) {
    const offset = Number(rules?.threat?.offsets?.deadly ?? DEFAULT_RULES.threat.offsets.deadly);
    return Math.max(0, Math.round((Number.isFinite(offset) ? offset : 2) * threatStep(rules)));
}

/**
 * A written rank read on `ranks` for a character of `pcLevel`: { ok: true, rank (its id), level,
 * tier, said? } or { ok: false, message }. A rank whose band starts more than deadlyGap levels
 * above the character is held to the highest one that does not (`said`: the rank written).
 */
export function rankFoe(written, { ranks, pcLevel = 1, rules = DEFAULT_RULES } = {}) {
    const ladder = Array.isArray(ranks) ? ranks.filter(rank => rank && typeof rank.id === 'string' && Array.isArray(rank.levels)) : [];
    const text = tidy(written, 40);
    if (!ladder.length) return { ok: false, message: `"${text}" is not a rank here: write a tier (trivial, weak, even, strong, deadly).` };
    const found = rankNamed(text, ladder);
    if (!found) return { ok: false, message: `"${text}" is not a rank: write one of ${ladder.slice(0, 12).map(rank => rank.id).join(', ')}, or a tier.` };
    const pc = Math.max(1, Math.round(Number(pcLevel) || 1));
    const most = pc + deadlyGap(rules);
    let rank = found;
    if (found.levels[0] > most) rank = [...ladder].filter(entry => entry.levels[0] <= most).at(-1) ?? ladder[0];
    const level = rankLevel(rank, pc, { rules, most });
    return { ok: true, rank: rank.id, level, tier: tierOf(threatForGap(level - pc, rules)) ?? 'even', ...(rank !== found ? { said: found.id } : {}) };
}

/** "Cellar Rat Swarm ×6 (even), Rat King (boss, strong)" for an offer's foes; a ranked foe shows its rank. */
export function foesText(foes, { tiers = true } = {}) {
    return (foes ?? []).map(foe => {
        const count = foe.count > 1 ? ` ×${foe.count}` : '';
        const notes = [foe.boss ? 'boss' : '', foe.rank ? `rank ${foe.rank}` : tiers ? foe.tier : ''].filter(Boolean).join(', ');
        return `${foe.name}${count}${notes ? ` (${notes})` : ''}`;
    }).join(', ');
}

/**
 * The level a tier foe's rank is read at on the card: the character's plus the tier's offset
 * (rules.threat.offsets × step, as setup.tierXpLevel counts its XP), at least 1.
 */
export function tierLevel(tier, pcLevel, rules = DEFAULT_RULES) {
    const offset = Number(rules?.threat?.offsets?.[tier] ?? DEFAULT_RULES.threat.offsets[tier]);
    const pc = Math.max(1, Math.round(Number(pcLevel) || 1));
    return Math.max(1, Math.round(pc + (Number.isFinite(offset) ? offset : 0) * threatStep(rules)));
}

/**
 * An offer's foes for its card (terms2): "Weir Rat ×8 · Soul Class I · weak", a boss "Rat King (boss) ·
 * Soul Class II · strong"; foes joined by ", ". The rank is the ladder's (`party.ranks`, the same bands the
 * party's rank and a written `rank:` use): a ranked foe's own, a tier foe's at its tier's level for a
 * character of `pcLevel` (tierLevel). The tier is the fight's word for it. No ladder: name and tier.
 */
export function foesCard(foes, { ladder = null, pcLevel = 1, rules = DEFAULT_RULES } = {}) {
    const ranks = Array.isArray(ladder) ? ladder.filter(rank => rank && typeof rank.id === 'string' && Array.isArray(rank.levels)) : [];
    return (foes ?? []).map(foe => {
        const count = foe.count > 1 ? ` ×${foe.count}` : '';
        const rank = !ranks.length ? null
            : foe.rank ? ranks.find(entry => entry.id === foe.rank) ?? rankNamed(foe.rank, ranks)
                : rankAt(Number.isInteger(foe.level) ? foe.level : tierLevel(foe.tier, pcLevel, rules), ranks);
        const title = rank ? String(rank.title || rank.id) : foe.rank ? `rank ${foe.rank}` : '';
        return [`${foe.name}${count}${foe.boss ? ' (boss)' : ''}`, title, foe.tier ?? ''].filter(Boolean).join(' · ');
    }).join(', ');
}
