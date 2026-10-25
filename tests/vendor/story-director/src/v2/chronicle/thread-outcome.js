// P23 closes the journal in the same root as the thread and its owner's settlement.
export function threadOutcome(ctx, payload) {
    if (ctx.caller !== 'story-director') return ctx.fail('REFUSED', 'Thread outcomes come from the thread writer.');
    const chronicle = ctx.draft('chronicle');
    chronicle.questLog ??= {};
    chronicle.questLog[String(ctx.rev)] = { thread: payload.thread, text: payload.text };
    return { summary: payload.text, narrate: false, data: { thread: payload.thread } };
}
