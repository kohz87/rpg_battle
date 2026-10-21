// RPG Battle v2, part `return`: the pure half (MODULES §F17). Whether your character is dead,
// where the chat goes back to when they are (the reply and the meta.rev just before the fatal
// fight's combat.start), the receipts of the current line of history read from the chat when the
// host gives the chat rather than a receipt list, and the cue the next reply is told after the
// return. Nothing here touches the DOM or the sdk.

export const MODULE_ID = 'rpg-battle';
const STORE_KEY = 'storySuite';
const FIGHT_ID = /^fi_[0-9a-z]{8}$/;
const MAX_PLACE = 60;

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isReceipt = value => isObject(value) && typeof value.type === 'string' && Number.isInteger(value.rev);
const ours = receipt => receipt.module === undefined || receipt.module === MODULE_ID;

export const isFightId = value => typeof value === 'string' && FIGHT_ID.test(value);

/** A place name as the cue and the card show it: one line, 60 characters at most, '' for none. */
export function cleanPlace(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, MAX_PLACE).trim();
}

/** Your character's actor in `state`, or null when there is none yet. */
export function pcOf(state) {
    const party = state?.domains?.party;
    return party?.pc ? party.actors?.[party.pc] ?? null : null;
}

/**
 * Is your character dead? party.applyResult marks a lost fight to the death on your character
 * with the condition `dead` (and HP 0); that mark is what is read here.
 */
export function isDead(state) {
    const pc = pcOf(state);
    return !!pc && Array.isArray(pc.conditions) && pc.conditions.some(entry => entry?.kind === 'dead');
}

/**
 * The receipts on the current line of history, read from SillyTavern's chat array the way Story
 * Block's store reads it (persist.js readRecord): each carrier's `extra.storySuite.receipts`,
 * skipping user messages, malformed records and a record SillyTavern copied into another swipe.
 * → [{ index, receipt }] in chat order.
 */
export function logFromChat(messages) {
    const out = [];
    if (!Array.isArray(messages)) return out;
    messages.forEach((message, index) => {
        const record = recordOf(message);
        if (!record) return;
        for (const receipt of record.receipts) if (isReceipt(receipt)) out.push({ index, receipt });
    });
    return out;
}

function recordOf(message) {
    if (!isObject(message) || message.is_user) return null;
    const record = message.extra?.[STORE_KEY];
    if (!isObject(record) || record.v !== 2 || !Array.isArray(record.receipts)) return null;
    const swipe = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    if (record.swipe === undefined || record.swipe === swipe) return record;
    if (typeof record.sid !== 'string') return null;
    const copied = (message.swipe_info ?? []).some((info, at) => at !== swipe && info?.extra !== message.extra
        && info?.extra?.[STORE_KEY]?.sid === record.sid);
    return copied ? null : record;
}

/** A receipt log as given ([{ index, receipt }]), cleaned: well-formed entries only, oldest rev first. */
export function cleanLog(log) {
    if (!Array.isArray(log)) return [];
    return log
        .filter(entry => isObject(entry) && Number.isInteger(entry.index) && entry.index >= 0 && isReceipt(entry.receipt))
        .map((entry, at) => ({ entry, at }))
        .sort((a, b) => (a.entry.receipt.rev - b.entry.receipt.rev) || (a.at - b.at))
        .map(({ entry }) => entry);
}

/**
 * Where Return goes (MODULES §F17), or null: null while your character is alive, and null when
 * the receipts do not show the fight that killed them. The fatal fight is the latest fight lost
 * (a `combat.end` receipt with outcome `lost`) up to this state's meta.rev; its start is the
 * `combat.start` receipt of the same fight (`data.session`). The point is that start's reply
 * (`index`) and its rev (`beforeRev`: the start and everything after it on that reply are what
 * the return drops). `place`: the start receipt's `data.place` when combat records one, else
 * the scene's place in this state, else ''. `fight`: the fight's id.
 */
export function findReturnPoint(state, log) {
    if (!isDead(state)) return null;
    const upTo = Number.isInteger(state?.meta?.rev) ? state.meta.rev : Infinity;
    const entries = cleanLog(log).filter(entry => entry.receipt.rev <= upTo && ours(entry.receipt));
    let end = -1;
    for (let at = entries.length - 1; at >= 0; at--) {
        const receipt = entries[at].receipt;
        if (receipt.type === 'combat.end' && receipt.data?.outcome === 'lost' && isFightId(receipt.data?.session)) { end = at; break; }
    }
    if (end < 0) return null;
    const fight = entries[end].receipt.data.session;
    let start = null;
    for (let at = end - 1; at >= 0; at--) {
        const receipt = entries[at].receipt;
        if (receipt.type === 'combat.start' && receipt.data?.session === fight) { start = entries[at]; break; }
    }
    if (!start) return null;
    const place = cleanPlace(start.receipt.data?.place) || cleanPlace(state?.domains?.scene?.place?.name);
    return { index: start.index, beforeRev: start.receipt.rev, place, fight };
}

/** The cue the next reply is told on the new branch ({{user}} becomes the persona's name in the prompt). */
export function cueText(place) {
    const at = cleanPlace(place);
    return `{{user}} is back at the moment before the fight${at ? ` at ${at}` : ''}, alive.`;
}

/** The claim that keeps the cue to one telling per fight on a line of history. */
export const cueClaim = fight => `return:${fight}`;
