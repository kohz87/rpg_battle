// RPG Battle v2, offering an open trainer (RB open trainers §4.2, §5, §6): the story's `+ trainer` line and the reader's "Make this a
// trainer" both come here. `planTrainer` is the one pure function that decides, from the pin, the `training` slice before the block, the
// binding and what was recorded; the live path and the replay guard both call it, so a trainer is stored only if the guard will accept it
// on the same story. It asks no query: where the party is, who is present, the NPC record and the die are read once by the caller, kept
// in the guard's `recorded`, and handed back on replay. `commitTrainer` attaches the guard and the claim and writes the offer.

import { buildGuard } from '../progress/guard.js';
import { indexOfState } from '../rules/graph.js';
import { epochOf, isId, isRecordId, isTrainerOfferId } from '../rules/ids.js';
import { pinned } from '../quests/seams.js';
import { formatMoney, oneCurrency } from '../../items.js';
import { currencyFrom } from '../trade/core.js';
import { money } from '../quests/parse.js';
import { MAX_OFFERS, MAX_OFFER_FEE, NAME_MAX, TEXT_MAX } from './domain.js';
import { nameKey } from './trainers.js';

export const KIND = 'trainer.open';
/** The dice a fee is rolled on: one d1000 scaled into the template's range (RB open trainers §5.2). */
export const FEE_DIE = '1d1000';

const refuse = (code, message) => ({ ok: false, code, message });
const noop = (message) => ({ ok: true, noop: true, message });
const plain = value => typeof value === 'string' && !/[<>\p{Cc}]/u.test(value);
const length = value => [...value].length;
const lower = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

/** A place's name as an offer keeps it for display: flattened, no markup, cut by code points. */
export const flatName = value => [...String(value ?? '').replace(/[<>\p{Cc}]/gu, ' ').replace(/\s+/gu, ' ').trim()].slice(0, NAME_MAX).join('');

/** The fee a recorded die gives: coinMin at 1, coinMax at 1000. */
export function feeFor(range, die) {
    return range.coinMin + Math.floor((range.coinMax - range.coinMin) * (die - 1) / 999);
}

/** The template a `like:` names, by its id or slug; a fixed trainer's slug is not one. */
export const templateOfLike = (ix, like) => ix.trainerTemplates.find(entry => entry.id === like || entry.slug === like) ?? null;

/** The entries of a `teaches:` label: split on , and ;, trimmed, empty ones dropped. */
export const teachesOf = value => String(value ?? '').split(/[,;]/u).map(part => part.trim()).filter(Boolean);

/** The skills of `template` the entries name, in the template's order, each once; or { entry } for the first that names none or two. */
function narrow(ix, template, entries) {
    const keep = new Set();
    for (const entry of entries) {
        const wanted = lower(entry);
        const found = template.skills.filter(skill => lower(skill) === wanted || lower(skill.split('/')[1]) === wanted || lower(ix.skill(skill)?.name) === wanted);
        if (found.length !== 1) return { entry };
        keep.add(found[0]);
    }
    return { skills: template.skills.filter(skill => keep.has(skill)) };
}

/** The money words of a fee in the chat's one currency. */
/**
 * The money words of a fee. Where Jobs from the story shows its rules block they are the chat's coins as a job's reward is written ("4 gold"); elsewhere (strict mode,
 * a pin with no open quest template) they are RPG Battle 2.2.0's, in the chat's one currency. `coined`: true or false when the way the line was read decides it (a Re-read of an unchanged
 * line is read as it first was, whatever the switch says now), null to ask.
 */
export function feeWords(query, fee, coined = null) {
    const currency = typeof query === 'function' ? currencyFrom(query) : null;
    let coins = coined === true;
    if (coined === null) try { coins = typeof query === 'function' && query('quest.offerBlockOn', {}) === true; } catch { coins = false; }
    return coins ? money(fee, currency) : formatMoney(fee, oneCurrency(currency));
}

/** "A, B and C". */
const list = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * What offering a trainer does on this state.
 *   ix        the pinned index (rules/graph.js)
 *   training  the training slice before the block (offers)
 *   binding   { template, name, text, skills } — `like:` as written, the name, the text, the narrowing as written or null
 *   by        'story' | 'reader'
 *   recorded  { place: id | null, where, npc: id | null, present: boolean | null, die?, id? } — what was read when the block was planned;
 *             on replay also the `die` and the `id` it made
 *   roll()    the live path's d1000 (called once, after every check has passed); newId() its `tn_` id (asked until one is unused);
 *             readNpc() the NPC record id for display (asked once, last); a replay has none of these and reads `recorded`
 * → { ok: false, code, message } | { ok: true, noop: true, message } | { ok: true, offer, facts, kept, summary }
 * `facts` are what the guard hashes; `kept` is what it hands back on replay.
 */
export function planTrainer({ ix, training, binding, by, recorded, roll = null, newId = null, readNpc = null }) {
    const offers = training?.offers ?? {};
    // A reader's click names someone the scene lists (the caller read `scene.present`; a replay reads it back from the record).
    if (by === 'reader' && recorded.present !== true) return refuse('NOT_FOUND', `${binding.name} is not here.`);
    const name = binding.name;
    const entries = binding.skills;
    if (typeof name !== 'string' || !name || length(name) > NAME_MAX || !plain(name) || name.trim() !== name
        || typeof binding.text !== 'string' || length(binding.text) > TEXT_MAX || !plain(binding.text)) {
        return refuse('INVALID', `Name the trainer in at most ${NAME_MAX} characters and say what they teach in at most ${TEXT_MAX}, with no markup.`);
    }
    const template = typeof binding.template === 'string' ? templateOfLike(ix, binding.template) : null;
    if (!template) return refuse('RULES_MISMATCH', 'Choose an open trainer template of this world\'s rules explicitly.');
    let skills = template.skills;
    if (entries !== null) {
        if (!Array.isArray(entries) || !entries.length || !entries.every(entry => typeof entry === 'string' && entry)) return refuse('INVALID', 'An open trainer\'s | teaches: names the skills, or is left out.');
        const narrowed = narrow(ix, template, entries);
        if (narrowed.entry !== undefined) return refuse('REFUSED', `${template.name} does not teach ${narrowed.entry}; a trainer teaches only what its template lists.`);
        skills = narrowed.skills;
    }
    const key = nameKey(name);
    if (ix.trainers.some(entry => nameKey(entry.name) === key)) return refuse('REFUSED', `${name} is already a trainer of this world.`);
    const held = Object.values(offers).find(offer => nameKey(offer.name) === key);
    if (held) {
        if (recorded.place !== null && held.place === recorded.place) return noop(`${name} already teaches here.`);
        return refuse('REFUSED', `${name} already teaches at ${held.where || 'another place'}; a trainer stays where it was offered.`);
    }
    if (!isId(recorded.place)) return refuse('DEPENDENCY_UNAVAILABLE', 'Where the party is cannot be told, so the trainer has no place to stand.');
    if (Object.keys(offers).length >= MAX_OFFERS) return refuse('REFUSED', `This chat has ${MAX_OFFERS} story trainers; no more can be offered.`);
    const die = Number.isInteger(recorded.die) ? recorded.die : roll?.();
    if (!Number.isInteger(die) || die < 1 || die > 1000) return refuse('INVALID', 'The fee die was not recorded.');
    const fee = feeFor(template.fee, die);
    if (!Number.isSafeInteger(fee) || fee < 1 || fee > MAX_OFFER_FEE) return refuse('RULES_MISMATCH', 'The template\'s fee range is not usable.');
    let id = recorded.id ?? null;
    if (id === null) {
        for (let n = 0; n < 64 && id === null; n += 1) {
            const drawn = newId?.();
            if (isTrainerOfferId(drawn) && !Object.hasOwn(offers, drawn)) id = drawn;
        }
        if (id === null) return refuse('CONFLICT', 'No unused trainer id is available.');
    } else if (!isTrainerOfferId(id) || Object.hasOwn(offers, id)) return refuse('CONFLICT', 'That trainer id is not free.');
    const where = flatName(recorded.where);
    // The NPC record is read once, live, and only for an offer that is going to be made (a replay has it in the record).
    const seen = recorded.npc === undefined ? readNpc?.() : recorded.npc;
    const npc = isRecordId(seen) ? seen : null;
    const offer = {
        id, template: template.id, name, text: binding.text, skills: [...skills], fee, minutes: 60, eventTemplates: [...template.eventTemplates],
        rank: template.rank, place: recorded.place, where, npc, by,
    };
    const facts = {
        template: offer.template, name, text: offer.text, by, skills: offer.skills, fee, place: offer.place, where, npc, id,
        // What was there before is hashed as the two facts the offer needed (the name free, room for one more), never as how many other trainers
        // there were: a count would turn off every later offer when an unrelated earlier trainer's reply is deleted.
        present: by === 'reader' ? true : null, before: { room: true, nameFree: true },
    };
    const kept = { die, id, place: offer.place, where, npc, present: facts.present };
    const names = skills.map(skill => ix.skill(skill)?.name ?? skill);
    return { ok: true, offer, facts, kept, summary: { skills: names, where: where || 'this place' } };
}

/**
 * Writes the offer a plan made: the guard (replay-bound for a story line), the claim of the name, the offer.
 * → the result of the line or command.
 */
export function commitTrainer(ctx, plan, binding, by, coined = null) {
    const pin = pinned(ctx.read('rules'));
    const source = ctx.source ?? ctx.fail('FAILED', 'There is no reply yet to hold this trainer.');
    const guard = buildGuard({ hash: value => ctx.hash(value), owner: 'rpg-battle', epoch: epochOf(ctx), source, rulesHash: pin.hash, kind: KIND, payload: { binding, by }, inputs: plan.facts });
    ctx.replayGuard(by === 'story' ? { ...guard, replyBound: true } : guard, plan.kept);
    const { offer } = plan;
    if (!ctx.claim(`rb:${epochOf(ctx)}:trainer:${ctx.hash({ trainer: nameKey(offer.name) }).slice(0, 16)}`)) ctx.fail('CLAIMED', 'That trainer was already offered.');
    const training = ctx.draft('training');
    training.offers ??= {};
    training.offers[offer.id] = offer;
    const fee = feeWords(ctx.query, offer.fee, coined);
    return {
        summary: `${offer.name} will teach ${list(plan.summary.skills)} at ${plan.summary.where} for ${fee} a session.`,
        narrate: true,
        data: { trainer: offer.id, fee: offer.fee, place: offer.place, where: offer.where, template: offer.template, skills: offer.skills, by },
    };
}

/** The plan of a line or a click on the live state (the caller has read `recorded`; the die and the id are drawn here, after the checks). */
export function liveTrainer(ctx, ix, binding, by, recorded, readNpc) {
    return planTrainer({ ix, training: ctx.read('training'), binding, by, recorded, readNpc, roll: () => ctx.roll(FEE_DIE).total, newId: () => ctx.id('tn') });
}

/**
 * hooks.replayGuard for `trainer.open`: the pin, the epoch, then the same plan on the state before the block with what was recorded.
 * Asks no query. undefined for any other guard.
 */
export function replayTrainer({ state, hash }, info) {
    const guard = info?.guard;
    if (guard?.predicate?.kind !== KIND) return undefined;
    const pin = pinned(state?.domains?.rules);
    if (!pin || pin.hash !== guard.rulesHash || guard.epoch !== epochOf(state) || guard.version !== 2) return { ok: false, reason: 'The trainer rules or epoch changed.' };
    const payload = guard.predicate.payload;
    const binding = payload?.binding;
    const by = payload?.by;
    if (!binding || typeof binding !== 'object' || !['story', 'reader'].includes(by) || !info.recorded || typeof info.recorded !== 'object') return { ok: false, reason: 'The trainer offer is not whole.' };
    const ix = indexOfState(state);
    if (!ix) return { ok: false, reason: 'The trainer rules or epoch changed.' };
    const plan = planTrainer({ ix, training: state?.domains?.training, binding, by, recorded: info.recorded });
    if (!plan.ok) return { ok: false, reason: plan.message };
    if (plan.noop) return { ok: false, reason: plan.message };
    const expected = buildGuard({ hash, owner: guard.owner, epoch: guard.epoch, source: info.source, rulesHash: pin.hash, kind: KIND, payload, inputs: plan.facts });
    return expected.inputHash === guard.inputHash ? { ok: true } : { ok: false, reason: 'The trainer offer evidence changed.' };
}
