// The neutral typed-intent adapter reads only the reader's whole sentences and story.evidence.
import { neutralAcceptance, threadWriteId } from './thread-writes.js';

export function acceptIntent(ctx, thread) {
    const words = ctx.chat?.lastUser;
    if (typeof words !== 'string' || !words.trim()) return false;
    const sentences = words.split(/(?:\.{1,3}|[!?;\n])+/u).map(s => s.trim()).filter(s => s.split(/\s+/u).length >= 2);
    for (const sentence of sentences) {
        if ([...sentence].length > 240) continue;
        const candidate = { id: 'pf_00000000', owner: 'story-director', kind: 'acceptance', payload: { thread: thread.id, words: sentence } };
        if (!neutralAcceptance(thread, [candidate], candidate.id, { cause: ctx.cause, caller: ctx.caller }).ok) continue;
        const proof = ctx.proof({ kind: 'acceptance', payload: candidate.payload });
        if (thread.rpg) ctx.call('quest.take', { id: thread.id });
        else ctx.call('threads.accept', { write: threadWriteId(ctx, `accept:${thread.id}`), thread: thread.id,
            expectedHash: ctx.query('threads.hash', { thread: thread.id }), acceptance: proof.id });
        return true;
    }
    return false;
}

export function intentCommand(ctx, { thread } = {}) {
    if (ctx.cause !== 'story' && ctx.cause !== 'system' || ctx.caller && !['story-director', 'rpg-battle'].includes(ctx.caller)) return ctx.fail('REFUSED', 'Intent capture belongs to Story Director.');
    const found = ctx.query('director.thread', { id: thread });
    if (!found || !found.offer) return ctx.fail('REFUSED', 'There is no offered goal to accept.');
    if (!acceptIntent(ctx, found)) return ctx.fail('REFUSED', 'The reader did not accept this offer.');
    return { summary: `Accepted ${found.key}.`, narrate: false, data: { thread } };
}
