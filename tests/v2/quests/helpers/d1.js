// Test-only D1 handoff until the host supplies cursor()/epoch. Production has no alternate source.
export function withD1(definition) {
    const context = ctx => ({ ...ctx, epoch: 'ep_00000000', cursor: () => ({ sid: ctx.source.sid,
        swipeKey: ctx.source.swipeKey, block: `bl_${ctx.hash({ source: ctx.source }).slice(0, 8)}`, op: 0, rev: ctx.rev }) });
    return { ...definition, commands: Object.fromEntries(Object.entries(definition.commands ?? {})
        .map(([key, fn]) => [key, (ctx, payload) => fn(context(ctx), payload)])),
    ...(definition.capture ? { capture: { ...definition.capture, apply: (ctx, line) => definition.capture.apply(context(ctx), line) } } : {}) };
}
