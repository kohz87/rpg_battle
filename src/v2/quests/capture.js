// RB owns quest lines. Narration proposes offers/progress/turn-ins; code owns acceptance and rewards.
import { openingPlan, commitOpening, templateBinding } from './opening.js';
import { offerQuest } from './commands.js';
import { ask, boundary, call, pinned, templateOf, threadOf, freshThreadId, writeId } from './seams.js';

import { turnInKey } from './credit.js';
import { captureOffer } from './offer-capture.js';
import { hasOpenQuests, keepRoute, lineHash, readsFreely } from './offer-feature.js';
import { offersOf } from '../rules/offers.js';

// The labels that make a line an offer (GENERATIVE_OFFERS_SPEC §3.1); a line about a thread that already exists without any of them is its acceptance.
const OFFER_LABELS = ['like', 'type', 'goal', 'target', 'foe', 'item', 'count', 'reward', 'due', 'deadline', 'difficulty', 'rank'];

/**
 * For a chat recorded before routes were kept: how this very line was first read, from what the reply left in the state. An offer record of this reply with this line's hash is the
 * free reading ('on'); a thread the reply opened by `| like:` (not there before it, with no offer record) of the template and text the line names is 2.2.0's ('off'). A line that
 * names something else is an edited line: undefined.
 */
function earlierRoute(ctx, line, key, before) {
    const standing = ctx.standing?.domains;
    if (!standing) return undefined;
    const sid = ctx.source?.sid;
    const offers = offersOf(standing.rules);
    const hash = lineHash(ctx, line);
    if (Object.values(offers).some(offer => offer.sid === sid && offer.line === hash)) return 'on';
    if (before) return undefined;
    const id = standing.director?.keys?.[String(key).trim().toLowerCase()];
    const thread = id ? standing.director.threads?.[id] : null;
    if (!thread?.rpg || offers[id]) return undefined;
    const pin = pinned(ctx.read('rules'));
    const labels = line.labels ?? {};
    const like = pin && Object.hasOwn(labels, 'like') ? templateBinding(pin, labels.like) : null;
    if (!like || like.id !== thread.rpg.template) return undefined;
    if (typeof labels.text === 'string' && typeof thread.fields?.goal === 'string' && thread.fields.goal !== labels.text) return undefined;
    return 'off';
}

export const QUEST_GRAMMAR = '+ quest Name — a frozen quest offer; + quest Name after the reader accepts; ~ quest Name | progress: … | met: yes; - quest Name — done|failed|abandoned';
export function createCapture({ settleQuest = null, captureObjective = null, guardIntent = null } = {}) {
    return (ctx, line) => {
        const key = String(line.name ?? '').trim();
        let thread = threadOf(ctx.query, { key });
        if (thread && !thread.rpg && thread.kind === 'quest' && !thread.acceptance) {
            return { summary: 'Quest from an earlier version (read only).', narrate: false, data: { quest: thread.id } };
        }
        // Jobs from the story (feature on, the pin has open templates): a free-form line is read, settled and recorded (offer-capture.js). A closed
        // pack quest by its name, and a line about a thread that exists without any offer label (its acceptance), go on as they always did.
        // A Re-read of an unchanged line reads it the way it was first read, whatever the switch says now (offer-feature.js).
        if (line.op === '+') {
            const pin = pinned(ctx.read('rules'));
            const closed = !thread && pin && templateOf(pin, key) && !templateOf(pin, key).open;
            const labelled = OFFER_LABELS.some(label => Object.hasOwn(line.labels ?? {}, label));
            if (pin && hasOpenQuests(pin) && !closed && (!thread || labelled)) {
                const free = readsFreely(ctx, line, () => earlierRoute(ctx, line, key, Boolean(thread)));
                keepRoute(ctx, line, free);
                if (free) {
                    const out = captureOffer(ctx, line);
                    if (out) return out;
                }
            }
        }
        if (line.op === '+' && Object.hasOwn(line.labels ?? {}, 'like') && pinned(ctx.read('rules'))) {
            const labels = line.labels ?? {};
            const binding = { template: labels.like, text: labels.text,
                ...Object.fromEntries(['foe', 'place', 'item'].filter(k => Object.hasOwn(labels, k)).map(k => [k, labels[k]])) };
            let plan = openingPlan(ctx, binding, thread);
            if (Object.keys(labels).some(k => !['like', 'text', 'foe', 'place', 'item'].includes(k))) plan = { ok: false, code: 'INVALID', message: 'An open offer cannot supply numbers or extra objective kinds.' };
            if (plan.ok) return commitOpening(ctx, binding, thread, plan, key);
            if (!thread) {
                const id = freshThreadId(ctx);
                call(ctx, 'threads.offer', { write: writeId(ctx, `goal:${id}`), thread: id, kind: 'hook', key,
                    summary: typeof labels.text === 'string' ? labels.text.slice(0, 240) : key, fields: {}, expectedHash: null });
                thread = threadOf(ctx.query, { id });
            }
            return { summary: `Quest refused: ${plan.message}`, problem: `Quest refused: ${plan.message}`, narrate: false,
                data: { quest: thread.id, code: plan.code, message: plan.message, refused: true } };
        }
        if (line.op === '+') {
            if (!thread) {
                const pin = pinned(ctx.read('rules'));
                const template = templateOf(pin, key);
                if (!template || template.open) return ctx.fail('RULES_MISMATCH', 'This offer has no frozen quest template.');
                const id = offerQuest(ctx, template);
                return { summary: `Offered ${template.name}.`, narrate: false, data: { quest: id } };
            }
            if (!thread.rpg || thread.rpg.state === 'offered') {
                const taken = call(ctx, 'threads.intent', { thread: thread.id });
                return { summary: `Takes on ${thread.key}.`, narrate: false, data: taken };
            }
            return { summary: `Already following ${thread.key}.`, narrate: false, data: { quest: thread.id } };
        }
        if (!thread?.rpg) return ctx.fail('NOT_FOUND', 'There is no such RPG quest.');
        if (line.op === '-' || line.op === '!') {
            const reason = String(line.text ?? '').trim();
            if (/\b(?:abandon|give up|gave up)\b/iu.test(reason)) {
                const words = ctx.chat?.lastUser ?? '';
                if (!/\b(?:i|we)\s+(?:give up|abandon|quit)\b/iu.test(words) || !words.toLowerCase().includes(key.toLowerCase())) return ctx.fail('REFUSED', 'The reader did not give up this quest.');
                return call(ctx, 'quest.abandon', { id: thread.id });
            }
            if (/\bfailed\b/iu.test(reason)) {
                if (!settleQuest) return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The guarded settlement adapter is unavailable.');
                return settleQuest(ctx, thread, { id: thread.id, by: 'story' }, 'failed');
            }
            if (!guardIntent) return ctx.fail('DEPENDENCY_UNAVAILABLE', 'The guarded turn-in adapter is unavailable.');
            guardIntent(ctx, thread);
            const { epoch } = boundary(ctx);
            const intent = turnInKey(epoch, thread.rpg, ctx.reply.sid);
            ctx.claim(intent);
            return { summary: `Turn-in proposed for ${thread.key}.`, narrate: false, data: { quest: thread.id, intent, reply: ctx.reply.sid } };
        }
        if (line.op === '~') {
            if (Object.hasOwn(line.labels ?? {}, 'met') && typeof captureObjective === 'function') return captureObjective(ctx, thread, line);
            // A progress note or "met" by itself supplies no B3 proof and never changes the reward.
            return { summary: `Progress proposed for ${thread.key}; validated objective evidence is required.`, narrate: false,
                data: { quest: thread.id, held: true, reply: ctx.reply?.sid ?? null } };
        }
        return ctx.fail('INVALID', 'Quest lines use +, ~, - or !.');
    };
}
