// The last fight's summary as parts, for the Fight screen (screen.js): a result line, one row per
// party member with the pools the fight left, the key moments, the foes' fates, the loot and the growth
// line. Built once, by combat.end, from the same result and helpers as the summary text the story is
// told (handoff.js), and kept beside that text on `combat.last`; the text itself is unchanged. The
// screen draws these with its template and the ss.meter widget only: every value is plain text,
// one line, cut by code points, so nothing in it is read as markup. Pure.

import { grouped, lootList, outcomeLine, xpText } from '../../handoff.js';
import { stateWords } from '../../narrative.js';

export const MAX_MEMBERS = 8;
export const MAX_MOMENTS = 6;
export const MAX_LOOT = 20;
const LINE = 300;

const flat = (text, max = LINE) => Array.from(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
const whole = value => Math.max(0, Math.round(Number(value) || 0));
const pool = value => (value && typeof value === 'object' ? { cur: whole(value.cur), max: whole(value.max) } : null);
// A moment as a list item: its own end punctuation goes, as in the summary's sentence.
const moment = text => flat(String(text ?? '').trim().replace(/[.;,\s]+$/, ''));

/**
 * lastParts(result, { names, pcName, rules, currency, notes }) → {
 *   outcome: 'victory' | 'fled' | 'defeat', result: text,
 *   party: [{ name, down, state, hp: { cur, max }, mp: { cur, max }, sp: { cur, max } | null }],
 *   moments: [text], foes: [text], loot: [text] (victory only), growth: text, notes: [text] }
 * `result` is combat.js summarize's; `notes` the summary's last sentences (left behind, deaths, wear).
 */
export function lastParts(result, { names = {}, pcName = 'the hero', rules, currency, notes = [] } = {}) {
    const outcome = result?.outcome === 'victory' || result?.outcome === 'fled' ? result.outcome : 'defeat';
    const party = (result?.party ?? []).slice(0, MAX_MEMBERS).map(member => {
        const hp = pool(member.hp) ?? { cur: 0, max: 0 };
        const mp = pool(member.mp) ?? { cur: 0, max: 0 };
        const down = Boolean(member.down);
        const shownHp = down ? { ...hp, cur: 0 } : hp;
        return {
            name: flat(names?.[member.memberId] ?? member.name, 60),
            down,
            state: flat(stateWords({ ...member, hp: shownHp, mp }, rules).text, 120),
            hp: shownHp, mp, sp: down ? null : pool(member.sp),
        };
    });
    const foes = [];
    if (result?.defeated?.length) foes.push(`Foes defeated: ${grouped(result.defeated)}.`);
    if (result?.parleyed?.length) foes.push(`Stood down after parley: ${grouped(result.parleyed)}.`);
    if (result?.fled?.length) foes.push(`Fled: ${grouped(result.fled)}.`);
    return {
        outcome,
        result: flat(outcomeLine(result ?? {}, result?.stakes ?? 'normal', pcName)),
        party,
        moments: (result?.keyMoments ?? []).map(moment).filter(Boolean).slice(0, MAX_MOMENTS),
        foes: foes.map(line => flat(line)),
        loot: outcome === 'victory' ? lootList(result.loot, currency).slice(0, MAX_LOOT).map(item => flat(item, 120)) : [],
        growth: outcome === 'victory' ? flat(xpText(result.xp, result?.party ?? [], names, rules)) : '',
        notes: (Array.isArray(notes) ? notes : []).map(note => flat(note)).filter(Boolean).slice(0, 4),
    };
}

const isText = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const isPool = value => value && typeof value === 'object' && Number.isInteger(value.cur) && Number.isInteger(value.max);

/** Problems with a stored `parts` (combat's validator adds them); [] when it is well formed. */
export function partsProblems(parts) {
    if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return ['combat.last.parts must be a record.'];
    const ok = ['victory', 'fled', 'defeat'].includes(parts.outcome) && isText(parts.result, LINE) && isText(parts.growth, LINE)
        && Array.isArray(parts.party) && parts.party.length <= MAX_MEMBERS
        && parts.party.every(m => isText(m?.name, 60) && typeof m.down === 'boolean' && isText(m.state, 120) && isPool(m.hp) && isPool(m.mp) && (m.sp === null || isPool(m.sp)))
        && [['moments', MAX_MOMENTS, LINE], ['foes', 3, LINE], ['loot', MAX_LOOT, 120], ['notes', 4, LINE]]
            .every(([key, most, max]) => Array.isArray(parts[key]) && parts[key].length <= most && parts[key].every(item => isText(item, max)));
    return ok ? [] : ['combat.last.parts must be { outcome, result, party, moments, foes, loot, growth, notes }.'];
}
