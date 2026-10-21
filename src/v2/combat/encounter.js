// The `encounter` change line (MODULES §B3): the story starts a fight, code turns it into an
// offer the reader fights or turns down.
//
//   ! encounter 6 Cellar Rat Swarm — boiling out of the bins | tier: even | stakes: normal
//
// The name part is read with v1's encounter parser (story.parseEncounter), so everything v1 knew
// about how models write foes still holds: counts in digits or words, plurals made singular
// against the bestiary, swarms and packs, "(boss)", a threat word written before the name. A
// threat word is never a creature: a name that is only notes ("Even", "deadly", "to the death")
// names no foe and the line is turned down. The tier label says how dangerous the foes are to
// the party in one word; code turns it into a level when the fight starts. Pure.

import { DEFAULT_RULES } from '../../rules.js';
import { parseEncounter } from '../../story.js';
import { isNoteName } from '../../templates.js';

export const TIERS = Object.freeze(['weak', 'even', 'strong', 'deadly']);
export const STAKES = Object.freeze(['normal', 'death']);
export const MAX_COUNT = 9;
const MAX_FOES = 6;
const MAX_NOTE = 160;
const MAX_PLACE = 60;

// The words a tier may be written as (v1's threat words, story.js), as one of the four tiers.
// v1's "trivial" is the weakest the offer shape has.
const TIER_WORDS = {
    trivial: 'weak', feeble: 'weak', puny: 'weak',
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
 * { ok: true, foes: [{ name, count, tier, boss?, wave? }], stakes, place, note } or
 * { ok: false, message } saying in plain words why it cannot be one. `bestiary` is the list
 * names are matched against (the chat's creatures, then the shipped ones).
 */
export function readEncounter(line, { bestiary, rules = DEFAULT_RULES } = {}) {
    if (line?.op && line.op !== '!' && line.op !== '+') {
        return { ok: false, message: `An encounter is written with "!" (it happens), not "${line.op}".` };
    }
    const name = tidy(line?.name, 200);
    if (!name) return { ok: false, message: 'The encounter names no foe.' };
    if (isNoteName(name)) return { ok: false, message: `"${name}" says how a fight is, not who is in it: name the foes.` };

    const tierText = labelOf(line?.labels, 'tier', 'threat');
    const tier = tierText ? tierOf(tierText) : 'even';
    if (!tier) return { ok: false, message: `"${tierText}" is not a tier: write weak, even, strong or deadly.` };
    const stakesText = labelOf(line?.labels, 'stakes');
    const stakes = stakesOf(stakesText);
    if (!stakes) return { ok: false, message: `"${stakesText}" is not a stake: write normal or death.` };

    const rows = parseEncounter(name, bestiary, rules).filter(row => row?.name && !isNoteName(row.name));
    if (!rows.length) return { ok: false, message: `No foe could be read from "${name}".` };
    const foes = rows.slice(0, MAX_FOES).map(row => {
        // A threat word the story put on the foe itself ("3 weak wolves") is that foe's tier.
        const own = row.threat ? tierOf(row.threat) : null;
        const foe = { name: tidy(row.name, 48), count: Math.min(MAX_COUNT, Math.max(1, Math.round(Number(row.count) || 1))), tier: own ?? tier };
        if (row.boss) foe.boss = true;
        if (Number(row.wave) >= 1) foe.wave = Math.round(Number(row.wave));
        return foe;
    }).filter(foe => foe.name);
    if (!foes.length) return { ok: false, message: `No foe could be read from "${name}".` };
    return {
        ok: true,
        foes,
        stakes,
        place: tidy(labelOf(line?.labels, 'place', 'at', 'where'), MAX_PLACE),
        note: tidy(line?.text, MAX_NOTE),
    };
}

/** "Cellar Rat Swarm ×6 (even), Rat King (boss, strong)" for an offer's foes. */
export function foesText(foes, { tiers = true } = {}) {
    return (foes ?? []).map(foe => {
        const count = foe.count > 1 ? ` ×${foe.count}` : '';
        const notes = [foe.boss ? 'boss' : '', tiers ? foe.tier : ''].filter(Boolean).join(', ');
        return `${foe.name}${count}${notes ? ` (${notes})` : ''}`;
    }).join(', ');
}
