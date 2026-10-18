// The hand-off (DESIGN §8.2): the one short note the model gets after a fight, injected
// into the next reply only. It states the outcome as settled fact so the model narrates it
// instead of re-deciding it, and stays short (about 120 words for a typical fight) because
// it rides along with a normal prompt. Each member's numbers end in the same state words as
// the sheets' State line, so the narration of the fight and the next reply's sheet agree on
// how hurt everyone is. XP is told in the reader's terms (terms.js): "XP +38", "Power Growth
// +38", with tier titles too ("Soul Growth +38"), at the reader's XP rate. Pure.

import { DEFAULT_RULES } from './rules.js';
import { formatMoney } from './items.js';
import { stateWords } from './narrative.js';
import { maxLevel, xpGainText, xpLabel } from './terms.js';

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
    return stakes === 'death' ? `Defeated: ${pcName} is killed. ${pcName} is dead and does not come back; narrate the death, not a rescue.` : 'Defeated: the story decides what follows (captured, robbed, left for dead).';
}

// One line per member: with the state words a party of four would not fit one readable line,
// and each member's state is its own fact. Someone down needs no numbers, only the words.
function statusLines(party, names, rules) {
    return party.map(member => {
        const name = names?.[member.memberId] ?? member.name;
        const hp = member.hp ?? { cur: 0, max: 0 };
        const mp = member.mp ?? { cur: 0, max: 0 };
        const state = stateWords({ ...member, hp: member.down ? { ...hp, cur: 0 } : hp, mp }, rules).text;
        if (member.down) return `${name}: ${state}.`;
        return `${name}: HP ${hp.cur}/${hp.max}, MP ${mp.cur}/${mp.max} — ${state}.`;
    }).join('\n');
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

// Someone already at the level cap gains nothing, so they are left out of the XP line.
function xpText(xp, party, names, rules) {
    const cap = maxLevel(rules);
    const levelOf = id => party.find(member => member.memberId === id)?.level;
    const ids = party.map(member => member.memberId).filter(id => id in (xp ?? {}) && !(Number(levelOf(id)) >= cap));
    if (!ids.length) return '';
    const name = xpLabel(rules);
    const values = ids.map(id => xpGainText(xp[id]));
    if (values.every(value => value === values[0])) return ids.length === 1 ? `${name} ${values[0]}.` : `${name} ${values[0]} each.`;
    const label = id => names?.[id] ?? party.find(member => member.memberId === id)?.name ?? id;
    return `${name}: ${ids.map((id, i) => `${label(id)} ${values[i]}`).join(', ')}.`;
}

/**
 * The hand-off text for a fight's Result. `names` may rename combatants by id, `currency`
 * is rules.currency, `stakes` overrides result.stakes, `pcName` names the hero in a
 * to-the-death defeat, `rules` gives the state-word bands (rules.narrative).
 */
export function buildHandoff(result, { names = {}, currency = DEFAULT_RULES.currency, stakes, pcName, rules = DEFAULT_RULES } = {}) {
    const party = result?.party ?? [];
    const hero = pcName ?? names?.pc ?? party.find(member => member.memberId === 'pc')?.name ?? party[0]?.name ?? 'the hero';
    const lines = [HANDOFF_HEADER, outcomeLine(result ?? {}, stakes ?? result?.stakes ?? 'normal', hero)];
    if (party.length) lines.push(statusLines(party, names, rules));

    // Joined into one sentence, so a moment that opens with "The" continues in lower case.
    const moments = (result?.keyMoments ?? []).map(sentence).filter(Boolean).slice(0, 6)
        .map((moment, index) => (index > 0 ? moment.replace(/^(The|A|An) /, word => word.toLowerCase()) : moment));
    if (moments.length) lines.push(wrap(`Key moments: ${moments.join('; ')}.`));

    const aside = [];
    if (result?.parleyed?.length) aside.push(`Stood down after parley: ${grouped(result.parleyed)}.`);
    if (result?.fled?.length) aside.push(`Fled: ${grouped(result.fled)}.`);
    if (aside.length) lines.push(aside.join(' '));

    if (result?.outcome === 'victory') {
        const xp = xpText(result.xp, party, names, rules);
        lines.push(`Loot: ${lootText(result.loot, currency)}.${xp ? ` ${xp}` : ''}`);
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// A plan's hand-off (0.5)

/** "the gate" for a named stage, "stage 2" for one the story did not name. */
const stageLabel = stage => String(stage?.place ?? '').trim() || `stage ${stage?.number ?? 1}`;

/** "a", "a and b", "a, b and c". */
function andList(items) {
    if (items.length < 2) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function stageLine(stage, stakes, hero) {
    const place = String(stage.place ?? '').trim();
    const head = place ? `Stage ${stage.number}, ${place}` : `Stage ${stage.number}`;
    const rounds = plural(Math.max(0, Math.round(Number(stage.rounds) || 0)), 'round');
    if (stage.outcome === 'victory') return `${head}: victory in ${rounds}.`;
    if (stage.outcome === 'fled') return `${head}: escaped after ${rounds}.`;
    return stakes === 'death'
        ? `${head}: defeated — ${hero} is killed. ${hero} is dead and does not come back; narrate the death, not a rescue.`
        : `${head}: defeated — the story decides what follows (captured, robbed, left for dead).`;
}

/**
 * The hand-off for a plan's result (plan.planResult): the header, a line per stage fought,
 * then the stages never reached ("Not reached: the tower. Do not narrate it.") or, after Fall
 * back, "Fell back after the gate; the yard and the tower were not attempted."; then, as after
 * one fight, each member's state at the end, the key moments, who stood down or fled, and the
 * loot and XP when a stage was won (what the cleared stages gave is kept, whatever came after).
 */
export function buildPlanHandoff(result, { names = {}, currency = DEFAULT_RULES.currency, stakes, pcName, rules = DEFAULT_RULES } = {}) {
    const party = result?.party ?? [];
    const hero = pcName ?? names?.pc ?? party.find(member => member.memberId === 'pc')?.name ?? party[0]?.name ?? 'the hero';
    const stages = result?.stages ?? [];
    const fought = stages.filter(stage => stage.outcome);
    const missed = stages.filter(stage => !stage.outcome);
    const lines = [HANDOFF_HEADER, ...fought.map(stage => stageLine(stage, stakes ?? result?.stakes ?? 'normal', hero))];
    if (missed.length && result?.withdrew) {
        const after = fought.at(-1);
        lines.push(`Fell back after ${after ? stageLabel(after) : 'the first stage'}; ${andList(missed.map(stageLabel))} ${missed.length === 1 ? 'was' : 'were'} not attempted.`);
    } else if (missed.length) {
        lines.push(`Not reached: ${missed.map(stageLabel).join(', ')}. Do not narrate ${missed.length === 1 ? 'it' : 'them'}.`);
    }
    if (party.length) lines.push(statusLines(party, names, rules));

    const moments = (result?.keyMoments ?? []).map(sentence).filter(Boolean).slice(0, 6)
        .map((moment, index) => (index > 0 ? moment.replace(/^(The|A|An) /, word => word.toLowerCase()) : moment));
    if (moments.length) lines.push(wrap(`Key moments: ${moments.join('; ')}.`));

    const aside = [];
    if (result?.parleyed?.length) aside.push(`Stood down after parley: ${grouped(result.parleyed)}.`);
    if (result?.fled?.length) aside.push(`Fled: ${grouped(result.fled)}.`);
    if (aside.length) lines.push(aside.join(' '));

    if (fought.some(stage => stage.outcome === 'victory')) {
        const xp = xpText(result.xp, party, names, rules);
        lines.push(`Loot: ${lootText(result.loot, currency)}.${xp ? ` ${xp}` : ''}`);
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Where a waiting hand-off stands (0.4.2)

const isReply = message => Boolean(message) && !message.is_user && !message.is_system;

/**
 * Where a fight started (0.4.3): the reply that was the latest when it began, as
 * { index, date, swipe } (its send date and shown swipe), or null when there was none.
 */
export function fightOrigin(chat, index) {
    const message = Array.isArray(chat) && Number.isInteger(index) && index >= 0 ? chat[index] : null;
    if (!message) return null;
    return { index, date: String(message.send_date ?? ''), swipe: Number.isInteger(message.swipe_id) ? message.swipe_id : 0 };
}

/**
 * Whether the reply a fight started from is still the one in the chat. False once it is
 * deleted, swiped to another version or replaced by a new reply in its place: the fight and
 * its result go back with it, like everything else a reply carries. An origin with only an
 * index (a chat from before 0.4.3) checks only that a reply is still there. No origin: true.
 */
export function originHolds(origin, chat = []) {
    if (!origin || !Number.isInteger(origin.index)) return true;
    const message = (Array.isArray(chat) ? chat : [])[origin.index];
    if (!isReply(message)) return false;
    if (Number.isInteger(origin.swipe) && (Number.isInteger(message.swipe_id) ? message.swipe_id : 0) !== origin.swipe) return false;
    if (origin.date && String(message.send_date ?? '') !== origin.date) return false;
    return true;
}

/**
 * Where a fight's hand-off (`pending`: { handoff, fightId, attachedTo }) stands against the
 * chat: 'none' (no result to narrate); 'waiting' (not given to a reply yet, or its reply was
 * deleted: the next reply narrates it); 'narrating' (given to the reply being generated, which
 * is not in the chat yet: `generating`); 'narrated' (its reply is there, or the story has
 * moved past it). Only 'waiting' asks the reader to return to the story.
 */
export function handoffState(pending, chat = [], { generating = false } = {}) {
    if (!pending || !pending.handoff || !originHolds(pending.origin, chat)) return 'none';
    const at = pending.attachedTo;
    if (at === null || at === undefined || !Number.isInteger(Number(at))) return 'waiting';
    const list = Array.isArray(chat) ? chat : [];
    if (list.slice(Number(at)).some(isReply)) return 'narrated';
    return generating ? 'narrating' : 'waiting';
}

/**
 * The hand-off as it should be stored now: null once a reply after the narrating one exists
 * (the story has moved past it; until then its swipes narrate the same result), unattached
 * again when its reply is gone (deleted, or never came), else unchanged.
 */
export function settleHandoff(pending, chat = [], { generating = false } = {}) {
    const state = handoffState(pending, chat, { generating });
    if (state === 'none') return null;
    const at = Number(pending.attachedTo);
    if (state === 'narrated' && (Array.isArray(chat) ? chat : []).slice(at + 1).some(isReply)) return null;
    if (state === 'waiting' && pending.attachedTo !== null && pending.attachedTo !== undefined) return { ...pending, attachedTo: null };
    return pending;
}
