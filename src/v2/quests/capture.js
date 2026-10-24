// RB owns quest lines. Narration proposes offers/progress/turn-ins; code owns acceptance and rewards.
import { offerQuest } from './commands.js';
import { ask, boundary, call, pinned, templateOf, threadOf } from './seams.js';

import { turnInKey } from './credit.js';

export const QUEST_GRAMMAR = '+ quest Name — a frozen quest offer; + quest Name after the reader accepts; ~ quest Name | progress: … | met: yes; - quest Name — done|failed|abandoned';
export function createCapture({ settleQuest = null, captureObjective = null, guardIntent = null } = {}) {
    return (ctx, line) => {
        const key = String(line.name ?? '').trim();
        let thread = threadOf(ctx.query, { key });
        if (thread && !thread.rpg && thread.kind === 'quest' && !thread.acceptance) {
            return { summary: 'Quest from an earlier version (read only).', narrate: false, data: { quest: thread.id } };
        }
        if (line.op === '+') {
            if (!thread) {
                const pin = pinned(ctx.read('rules'));
                const template = templateOf(pin, key);
                if (!template) return ctx.fail('RULES_MISMATCH', 'This offer has no frozen quest template.');
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
            if (line.labels?.met && typeof captureObjective === 'function') return captureObjective(ctx, thread, line);
            // A progress note or "met" by itself supplies no B3 proof and never changes the reward.
            return { summary: `Progress proposed for ${thread.key}; validated objective evidence is required.`, narrate: false,
                data: { quest: thread.id, held: true, reply: ctx.reply?.sid ?? null } };
        }
        return ctx.fail('INVALID', 'Quest lines use +, ~, - or !.');
    };
}
