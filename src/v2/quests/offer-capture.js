// RPG Battle v2, generative offers: the capture of a `+ quest` line the narrator wrote in its own words (GENERATIVE_OFFERS_SPEC §3, §5.3, §6, §7, §8).
// Everything outside the world is read once, here, while the line is captured (the place, the clock, the PC, the rank ladder, the money); the matcher
// settles the line, `planOffer` checks it and `commitOffer` writes it with a replay guard that asks nothing again. A line that cannot be an offer
// is one of the few true refusals, kept as an SD hook; a far-out line leaves no offer, only the one line told back and a record of the decision.

import { buildGuard } from '../progress/guard.js';
import { indexOfCtx } from '../rules/graph.js';
import { areaPolicyNow } from '../rules/items.js';
import { offeredQuest } from './outcomes.js';
import { ladderFrom } from './ranks.js';
import { ask, boundary, call, freshThreadId, guardQuestInputs, pinned, recordQuestInputs, templates, threadOf, writeId } from './seams.js';
import { FAR_TOLD, MATCHER, flat, farLineOf, farReasonOf, settledTerms, shownOf } from './offer-bands.js';
import { MAX_DECLINED, declinedOf, offersOf } from '../rules/offers.js';
import { lineKey, lineKeys } from './offer-line.js';
import { matchOffer, offerKey, NAME_CHARS } from './offer-match.js';
import { KIND, planOffer } from './offer-plan.js';
import { templateBinding } from './opening.js';
import { settingInt } from './offer-settings.js';

/** Story Director's own limits on new threads: per reply, and open in all. */
const NEW_PER_REPLY = 16;
const MAX_OPEN = 300;

/** The id a far-out decision is kept under: `dk_` and 12 hex of the hash of the offer key. */
export const declinedId = (ctx, name) => `dk_${ctx.hash({ key: offerKey(name) }).slice(0, 12)}`;

/** The rank ladder of the pin: the installed pack's own `ranks`, else one row per template rank, lowest level first (§2.3). */
function ladderOf(ctx, pin, packKey) {
    const own = ladderFrom(ask(ctx.query, 'packs.content', { kind: 'ranks', pack: packKey }));
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

/** What the matcher reads, asked once, live (§4). */
function liveEnv(ctx, pin, ix) {
    const rules = ctx.read('rules');
    const packKey = rules.pin?.identity?.packKey;
    const party = ask(ctx.query, 'rules.party');
    const level = party?.active?.find(actor => actor.id === party.pc)?.level;
    const here = ask(ctx.query, 'atlas.canonical', {});
    const minutes = ask(ctx.query, 'director.time')?.minutes;
    const creatures = ask(ctx.query, 'packs.content', { kind: 'creatures', pack: packKey });
    const declined = declinedOf(rules);
    const quests = ask(ctx.query, 'packs.content', { kind: 'quests', pack: packKey });
    return {
        pin, ix, ladder: ladderOf(ctx, pin, packKey), level: Number.isSafeInteger(level) ? level : null, area: areaPolicyNow(ctx.query),
        currency: ask(ctx.query, 'inventory.currency'), clock: Number.isSafeInteger(minutes), nowMinutes: Number.isSafeInteger(minutes) ? minutes : null,
        here: typeof here?.id === 'string' && here.id ? { id: here.id, name: typeof here.name === 'string' ? here.name : '' } : null,
        words: pin.resolved.manifest?.offerWords ?? null,
        order: Array.isArray(creatures) ? creatures.map(record => record?.id ?? (record?.slug ? `pack.${packKey}/${record.slug}` : null)).filter(Boolean) : [],
        // The pack's own order of its quest templates (the pin keeps them sorted by id); a pack that is not installed has none and the id order stands.
        questOrder: Array.isArray(quests) ? quests.map(record => record?.id ?? (record?.slug ? `pack.${packKey}/${record.slug}` : null)).filter(Boolean) : [],
        inputs: guardQuestInputs(ctx.query, null, {}),
        thread: name => threadOf(ctx.query, { key: name }),
        placeOf: asked => ask(ctx.query, 'atlas.canonical', { id: asked }) ?? ask(ctx.query, 'atlas.canonical', { name: asked }),
        declined: key => Object.hasOwn(declined, `dk_${ctx.hash({ key }).slice(0, 12)}`),
    };
}

/** The stored offer of this very line on this reply, if a Re-read is running (§7.3): its settled binding is reused, whatever the matcher is now. */
function earlier(ctx, line) {
    const sid = ctx.source?.sid;
    const offers = offersOf(ctx.standing?.domains?.rules);
    if (!sid) return null;
    const want = lineKeys(ctx, line);
    return Object.values(offers).find(offer => offer.sid === sid && want.includes(offer.line)) ?? null;
}

/** The refusal of a line that cannot be an offer: a Problem on the reply, and an SD hook with the narrator's words so Make this a quest still works on it. */
function refusal(ctx, line, code, message) {
    const name = flat(line.name, NAME_CHARS);
    let thread = name ? threadOf(ctx.query, { key: name }) : null;
    if (name && !thread) {
        const id = freshThreadId(ctx);
        const out = ctx.call('threads.offer', { write: writeId(ctx, `goal:${id}`), thread: id, kind: 'hook', key: name,
            summary: flat(line.labels?.goal ?? line.labels?.text ?? line.text ?? name, 240), fields: {}, expectedHash: null });
        if (out?.ok === false && out.code === 'LIMITED') code = 'LIMIT';
        thread = out?.ok === false ? null : threadOf(ctx.query, { id });
    }
    return { summary: `Quest refused: ${message}`, problem: `Quest refused: ${message}`, narrate: false, data: { quest: thread?.id ?? null, code, message, refused: true } };
}

/** The far-out decision: nothing is offered; the narrator is told once, and the decision is kept under the name's key. */
function farOut(ctx, line, result, env) {
    const text = farLineOf(result, env.currency);
    const id = declinedId(ctx, result.name);
    const known = declinedOf(ctx.read('rules'));
    if (!Object.hasOwn(known, id) && Object.keys(known).length < MAX_DECLINED) {
        const { reason, suggestion } = farReasonOf(result, env.currency);
        call(ctx, 'rules.recordOffer', { write: writeId(ctx, `declined:${id}`), declined: id, record: { v: 1, matcher: MATCHER, sid: ctx.source.sid, name: flat(result.name, NAME_CHARS),
            reason: flat(reason, 200), suggestion: flat(suggestion, 200), band: 'far', kind: 'job', said: result.said ?? {} } });
    }
    // Two far-out lines of a reply are told; more are counted in the tail.
    const told = Object.values(declinedOf(ctx.read('rules'))).filter(row => row.sid === ctx.source.sid).length <= FAR_TOLD;
    // `data.v2.source`: the reply, where a trimmed receipt keeps it, so the Adjustments log finds this decision's reply when no guarded receipt of the reply is left.
    return { summary: text, narrate: told, data: { declined: id, band: 'far', why: result.why, v2: { source: { sid: ctx.source.sid } } } };
}

/** Writes an offer the matcher (or an earlier read) settled: the guard, the thread with its quest, and the record. */
function commitOffer(ctx, line, env, result) {
    const { settled } = result;
    const template = templateBinding(env.pin, settled.template);
    const thread = result.link ? threadOf(ctx.query, { id: result.link }) : null;
    // A place the job names is read once, here, like the area: the guard asks for it no more.
    const placeRecord = settled.place ? result.placeRecord ?? ask(ctx.query, 'atlas.canonical', { id: settled.place.id }) : null;
    const external = { area: { ...env.area, tier: settled.area.tier }, places: settled.place ? { [settled.place.id]: placeRecord } : {}, ...recordQuestInputs(ctx.query, { rpg: template }) };
    const inputs = guardQuestInputs(ctx.query, null, external);
    const plan = planOffer({ pin: env.pin, ix: env.ix, thread, inputs, external, combat: ctx.read('combat') }, settled);
    if (!plan.ok) return { failed: plan };
    const title = flat(line.name, NAME_CHARS);
    // The technical limits (§6.3): Story Director's own, which it keeps only for the threads it makes itself, are kept here for the jobs RPG Battle makes.
    const mine = Object.values(offersOf(ctx.read('rules'))).filter(offer => offer.sid === ctx.source.sid).length;
    const open = (ask(ctx.query, 'director.threads') ?? []).filter(row => row.status === 'active').length;
    if (!thread && (mine >= NEW_PER_REPLY || open >= MAX_OPEN)) return { failed: { code: 'LIMIT', message: mine >= NEW_PER_REPLY ? `One reply offers at most ${NEW_PER_REPLY} new jobs.` : `${MAX_OPEN} threads are open; close or finish some first.` } };
    // The host's cursor is read only once the offer is going to be made: a line that reads it must carry a guard.
    const { source, epoch } = boundary(ctx);
    const id = thread?.id ?? freshThreadId(ctx);
    const quest = offeredQuest({ ...plan.concrete, name: title }, id);
    const fields = { goal: settled.text, ...(settled.giver ? { giver: settled.giver } : {}), ...(result.said.due ? { due: result.said.due } : {}) };
    if (thread) {
        if (!thread.offer) {
            quest.state = 'active'; quest.acceptedAt = thread.acceptance.minute; quest.acceptedCursor = structuredClone(thread.acceptance.cursor);
            quest.deadline = plan.durationMinutes === null ? null : quest.acceptedAt + plan.durationMinutes;
            if (quest.deadline !== null && !Number.isSafeInteger(quest.deadline)) return { failed: { code: 'INVALID', message: 'The deadline overflowed.' } };
        }
        call(ctx, 'threads.link', { write: writeId(ctx, `open:${id}`), thread: id, quest, expectedHash: ctx.query('threads.hash', { thread: id }) });
    } else {
        const out = ctx.call('threads.offer', { write: writeId(ctx, `offer:${id}`), thread: id, kind: 'hook', key: title, summary: settled.text, fields, expectedHash: null, quest });
        if (out?.ok === false) return { failed: { code: out.code === 'LIMITED' ? 'LIMIT' : out.code ?? 'REFUSED', message: out.message ?? 'The offer could not be made.' } };
    }
    const guard = buildGuard({ hash: value => ctx.hash(value), owner: 'rpg-battle', epoch, source, rulesHash: env.pin.hash, kind: KIND,
        payload: { settled, thread: thread?.id ?? null, title, matcher: result.matcher ?? MATCHER }, inputs: plan.facts });
    ctx.replayGuard({ ...guard, replyBound: true }, { external, ladderRow: env.ladder.find(row => String(row.id).toLowerCase() === String(settled.rank).toLowerCase()) ?? null,
        level: env.level, now: env.nowMinutes });
    call(ctx, 'rules.recordOffer', { write: writeId(ctx, `record:${id}`), thread: id, record: { v: 1, matcher: result.matcher ?? MATCHER, line: lineKey(ctx, line),
        sid: source.sid, name: title, said: result.said, settled, band: result.band, notes: result.notes, where: result.where, shown: shownOf(result, env.currency) } });
    // The terms of the first few jobs of a reply are told next turn; the rest are only counted, in the tail (quests/prompt.js).
    const told = mine < settingInt(ctx.settings?.(), 'offerTermsPerReply', 1, 6);
    const terms = settledTerms(result, title, env.currency);
    return { receipt: { summary: terms, narrate: told, data: { quest: id, reward: quest.reward, band: result.band, notes: result.notes } } };
}

/** What a read of the line comes to: a receipt, or a refusal when it cannot be an offer (the world no longer lets a settled one be made). */
function finish(ctx, line, env, result) {
    if (result.kind === 'noop') return { receipt: { summary: result.message, narrate: false, data: { quest: null, held: true } } };
    if (result.kind === 'refuse') return { failed: { code: result.code, message: result.message } };
    if (result.kind === 'far') return { receipt: farOut(ctx, line, result, env) };
    return commitOffer(ctx, line, env, result);
}

/**
 * A `+ quest` line the generative path reads (the caller has checked the feature, the pin and the routing of §3.1). On a Re-read of an unchanged
 * line the earlier decision is reused, whatever the matcher is now; if the world no longer lets it stand, the line is read afresh.
 */
export function captureOffer(ctx, line) {
    const pin = pinned(ctx.read('rules'));
    const ix = indexOfCtx(ctx);
    if (!pin || !ix) return undefined;
    const env = liveEnv(ctx, pin, ix);
    const kept = earlier(ctx, line);
    let done = null;
    if (kept && !env.thread(flat(line.name, NAME_CHARS))) {
        done = finish(ctx, line, env, { kind: 'offer', band: kept.band, settled: kept.settled, said: kept.said, notes: kept.notes, where: kept.where, matcher: kept.matcher, link: null });
    }
    if (!done || done.failed) done = finish(ctx, line, env, matchOffer(env, line));
    return done.failed ? refusal(ctx, line, done.failed.code ?? 'REFUSED', done.failed.message) : done.receipt;
}
