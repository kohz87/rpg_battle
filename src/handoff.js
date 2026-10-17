// The hand-off (DESIGN §8.2): the one short note the model gets after a fight, injected
// into the next reply only. It states the outcome as settled fact so the model narrates it
// instead of re-deciding it, and stays short (about 120 words for a typical fight) because
// it rides along with a normal prompt. Pure.

import { DEFAULT_RULES } from './rules.js';
import { formatMoney } from './items.js';

export const HANDOFF_HEADER = '[Battle resolved by RPG Battle: narrate this outcome, do not change it]';
const WRAP = 100;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function duration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    // Long fights read better in minutes; the scene clock only needs the rough figure.
    if (s >= 120) return `about ${plural(Math.round(s / 60), 'minute')}`;
    return `about ${plural(s, 'second')}`;
}

function outcomeLine(result, stakes, pcName) {
    const rounds = Math.max(0, Math.round(Number(result.rounds) || 0));
    if (result.outcome === 'victory') return `Victory in ${plural(rounds, 'round')} (${duration(result.seconds)}).`;
    if (result.outcome === 'fled') return `Escaped after ${plural(rounds, 'round')}.`;
    return stakes === 'death' ? `Defeated: ${pcName} is killed.` : 'Defeated: the story decides what follows (captured, robbed, left for dead).';
}

function statusLine(party, names) {
    return party.map(member => {
        const name = names?.[member.memberId] ?? member.name;
        if (member.down) return `${name}: down.`;
        const lasting = (member.conditions ?? []).map(condition => condition.name).filter(Boolean);
        const tail = lasting.length ? `, ${lasting.join(' and ')}` : '';
        return `${name}: HP ${member.hp.cur}/${member.hp.max}, MP ${member.mp.cur}/${member.mp.max}${tail}.`;
    }).join(' ');
}

/** Greedy word wrap, so a long line of moments stays readable in the prompt view. */
function wrap(text, width = WRAP) {
    const lines = [];
    let current = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (current && current.length + 1 + word.length > width) {
            lines.push(current);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) lines.push(current);
    return lines.join('\n');
}

// Moments are joined with '; ' into one sentence, so their own end punctuation goes.
function sentence(text) {
    return String(text ?? '').trim().replace(/[.;,\s]+$/, '');
}

/** "Goblin, Goblin, Wolf" → "Goblin ×2, Wolf": the story already knows how many there were. */
function grouped(names) {
    const counts = new Map();
    for (const name of names ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ');
}

function article(phrase) {
    return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

function lootText(loot, currency) {
    const parts = [];
    if (loot?.money > 0) parts.push(formatMoney(loot.money, currency));
    for (const item of loot?.items ?? []) {
        const qty = Math.max(1, Math.round(Number(item.qty) || 1));
        const special = ['rare', 'epic', 'legendary'].includes(item.rarity) ? `${item.rarity} ` : '';
        const name = `${special}${String(item.name ?? '').trim().toLowerCase()}`;
        parts.push(qty === 1 ? article(name) : `${name} ×${qty}`);
    }
    return parts.length ? parts.join(', ') : 'nothing';
}

function xpText(xp, party, names) {
    const ids = party.map(member => member.memberId).filter(id => id in (xp ?? {}));
    if (!ids.length) return '';
    const values = ids.map(id => Math.round(Number(xp[id]) || 0));
    if (values.every(value => value === values[0])) return ids.length === 1 ? `XP +${values[0]}.` : `XP +${values[0]} each.`;
    const label = id => names?.[id] ?? party.find(member => member.memberId === id)?.name ?? id;
    return `XP: ${ids.map((id, i) => `${label(id)} +${values[i]}`).join(', ')}.`;
}

/**
 * The hand-off text for a fight's Result. `names` may rename combatants by id, `currency`
 * is rules.currency, `stakes` overrides result.stakes, `pcName` names the hero in a
 * to-the-death defeat.
 */
export function buildHandoff(result, { names = {}, currency = DEFAULT_RULES.currency, stakes, pcName } = {}) {
    const party = result?.party ?? [];
    const hero = pcName ?? names?.pc ?? party.find(member => member.memberId === 'pc')?.name ?? party[0]?.name ?? 'the hero';
    const lines = [HANDOFF_HEADER, outcomeLine(result ?? {}, stakes ?? result?.stakes ?? 'normal', hero)];
    if (party.length) lines.push(statusLine(party, names));

    // Joined into one sentence, so a moment that opens with "The" continues in lower case.
    const moments = (result?.keyMoments ?? []).map(sentence).filter(Boolean).slice(0, 6)
        .map((moment, index) => (index > 0 ? moment.replace(/^(The|A|An) /, word => word.toLowerCase()) : moment));
    if (moments.length) lines.push(wrap(`Key moments: ${moments.join('; ')}.`));

    const aside = [];
    if (result?.parleyed?.length) aside.push(`Stood down after parley: ${grouped(result.parleyed)}.`);
    if (result?.fled?.length) aside.push(`Fled: ${grouped(result.fled)}.`);
    if (aside.length) lines.push(aside.join(' '));

    if (result?.outcome === 'victory') {
        const xp = xpText(result.xp, party, names);
        lines.push(`Loot: ${lootText(result.loot, currency)}.${xp ? ` ${xp}` : ''}`);
    }
    return lines.join('\n');
}
