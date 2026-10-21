// RPG Battle v2, part `return` (MODULES §F17): death is a return in time. When a lost fight to
// the death has left your character dead, generation stops (canGenerate) and the reader is
// offered Return: the chat goes back, as a SillyTavern branch so the old timeline is kept, to
// the reply where the fatal fight began, without that fight (Story Block's sdk.rewind drops
// the reply's receipts from the fight's combat.start on). On the new branch a receipt (the
// reader's own action, cause `ui`: Story Block's sdk keeps `system` for itself, B4r2-6) tells the
// next reply, once (claim `return:<fight id>`), that you are back at that moment, alive. No
// memory rules are imposed.
//
// Host API this part needs (from Story Block):
//   sdk.rewind({ index, beforeRev }) → Promise<{ ok: true } | { ok: false, code, message }>:
//     branches the chat at carrier `index`, drops that carrier's receipts (and their ops) with
//     rev >= beforeRev, switches to the branch and rebuilds, so the next sdk.command commits on
//     the branch's head (carrier `index`).
//   The receipts of the current line of history, synchronously, as [{ index, receipt }] in
//   chat order: `tools.receipts()` in the query tools (preferred), else `sdk.receipts()`, else
//   `sdk.chat()` (SillyTavern's chat array, read here as the store reads it).
// The sdk is `globalThis.StoryBlock.sdk` unless createReturnPart is given another.

import { cueClaim, cueText, cleanPlace, findReturnPoint, isDead, isFightId, logFromChat } from './point.js';
import { renderReturnCard, validateCardProps } from './card.js';

export { cueText, findReturnPoint, isDead, logFromChat } from './point.js';

export const DEAD_REASON = 'You died. Return in time, or swipe/delete back.';
export const WIDGET = 'rpg-battle.return-card';

const defaultHost = () => globalThis.StoryBlock?.sdk ?? null;

/** The receipt log a source gives (tools or sdk): its receipts(), else its chat(); null when it gives neither. */
export function logOf(source) {
    if (!source) return null;
    try {
        if (typeof source.receipts === 'function') {
            const log = source.receipts();
            if (Array.isArray(log)) return log;
        }
        if (typeof source.chat === 'function') {
            const chat = source.chat();
            if (Array.isArray(chat)) return logFromChat(chat);
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * canGenerate(view) (MODULES §F12, §F17): no story reply continues a dead run. While your
 * character is dead the answer is no, with the way out.
 */
export function canGenerate(view) {
    return isDead(view?.state) ? { ok: false, reason: DEAD_REASON } : { ok: true };
}

/**
 * return.cue({ fight, place }) (sent as the reader's action, after the rewind): the next reply is told you
 * are back at the moment before the fight, alive. Told once per fight on a line of history
 * (CLAIMED after); refused where your character is still dead (the return did not happen).
 */
function cue(ctx, payload = {}) {
    if (!isFightId(payload?.fight)) ctx.fail('INVALID', 'That is not a fight to return from.');
    if (payload.place !== undefined && typeof payload.place !== 'string') ctx.fail('INVALID', 'A place is a name.');
    if (isDead({ domains: { party: ctx.read('party') } })) ctx.fail('REFUSED', 'Your character is still dead here: the return did not happen.');
    if (!ctx.claim(cueClaim(payload.fight))) ctx.fail('CLAIMED', 'The return was already told on this branch.');
    const place = cleanPlace(payload.place);
    return { summary: cueText(place), narrate: true, data: { fight: payload.fight, place } };
}

/**
 * Return in time through `sdk` ({ query, command, rewind }): the point is found on the dead
 * timeline, the chat rewinds to it, then the cue is committed on the new branch.
 * → { ok: true, point, receipt } | { ok: false, code, message, point?, rewound? }.
 */
export async function returnInTime(sdk) {
    if (!sdk || typeof sdk.query !== 'function' || typeof sdk.command !== 'function') {
        return { ok: false, code: 'UNSUPPORTED', message: 'Story Block is not ready. Swipe or delete back instead.' };
    }
    let point;
    try {
        point = sdk.query('return.point');
    } catch (error) {
        return { ok: false, code: 'FAILED', message: error?.message || 'The moment before the fight could not be found.' };
    }
    if (!point) return { ok: false, code: 'NOT_FOUND', message: 'There is no moment before the fight to return to. Swipe or delete back instead.' };
    if (typeof sdk.rewind !== 'function') {
        return { ok: false, code: 'UNSUPPORTED', message: 'This Story Block cannot return in time yet. Swipe or delete back instead.', point };
    }
    let rewound;
    try {
        rewound = await sdk.rewind({ index: point.index, beforeRev: point.beforeRev });
    } catch (error) {
        return { ok: false, code: 'FAILED', message: error?.message || 'The return did not work.', point };
    }
    if (rewound && rewound.ok === false) {
        return { ok: false, code: rewound.code ?? 'FAILED', message: rewound.message ?? 'The return did not work.', point };
    }
    // An ordinary command (cause `ui`): Story Block's sdk refuses any other cause from a module.
    // Told once per fight on a line of history by its claim, so a second click changes nothing.
    const told = await sdk.command('return.cue', { fight: point.fight, place: point.place });
    if (!told?.ok) return { ok: false, code: told?.code ?? 'FAILED', message: told?.message ?? 'The return was made but could not be told.', point, rewound: true };
    return { ok: true, point, receipt: told.receipt };
}

/**
 * The part. `host`: () => the sdk (default globalThis.StoryBlock.sdk), used for the receipts
 * when the query tools do not give them and for the card's rewind when its api has none.
 */
export function createReturnPart({ host = defaultHost } = {}) {
    const sdk = () => {
        try { return host() ?? null; } catch { return null; }
    };
    return {
        commands: { 'return.cue': cue },
        queries: {
            /** → { index, beforeRev, place, fight } | null (null while your character lives). */
            'return.point': (state, args, tools) => findReturnPoint(state, logOf(tools) ?? logOf(sdk()) ?? []),
        },
        hooks: { canGenerate },
        widgets: {
            [WIDGET]: {
                props: { point: { type: 'object', required: false, default: null } },
                validate: validateCardProps,
                render: (el, props, api) => renderReturnCard(el, props, api, { host: sdk, returnInTime }),
            },
        },
    };
}

export const part = createReturnPart();
