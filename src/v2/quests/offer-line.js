// The key a line of the story is known by in the record it made (quests/offer-capture.js, training/offer-capture.js): a Re-read of the same line finds its record and reuses what it settled
// (GENERATIVE_OFFERS_SPEC §7.3). Runs of white space and the edges of the line do not count, so an edit that only moves spaces is the same line. A record made before this kept the key of the
// line as written, which a line without extra spaces still has.
const squeeze = raw => String(raw ?? '').replace(/\s+/gu, ' ').trim();
const hash16 = (ctx, raw) => ctx.hash({ raw }).slice(0, 16);

/** The 16 hex a new record keeps for `line`. */
export const lineKey = (ctx, line) => hash16(ctx, squeeze(line?.raw));

/** Every key a record of `line` may hold: the key above, and the line as written (records made before white space was left out). */
export const lineKeys = (ctx, line) => [...new Set([lineKey(ctx, line), hash16(ctx, line?.raw)])];
