// Cards under replies (fix 8e): the socket a module uses to put a card under an assistant message (WIDGETS.md, "Cards under
// replies"; the README's "How modules connect" table). A module declares `cards: { <id>: { for(state, message, ctx) → card | null } }`.
// `for` is asked about each assistant message, oldest first, with that message's own state and its SillyTavern message object; the
// first message whose answer is a card gets it, so a card id shows once per chat. A card the module stops returning goes away on the
// next draw (a character made, a fight ended); a swipe or a delete moves or removes it with its message.
//
// A card: { tone: 'accent'|'bad'|'good'|'info', icon: 'ph-…' | 'fa-…', title, text?, rows?: [{ icon?, text, tag?, tagTone? }] (at most 4),
// actions?: [{ id, label, icon?, primary?, command?, payload?, open? }] (at most 3), later?: true|false }. An action runs its `command`
// (sdk.command, recorded with the reply) or opens its `open` screen in the game view; `later` adds a Later button that folds the card
// into one line. Text is plain: the host prints it, never parses it. `normalizeCard` drops what it cannot read; a card without a title
// is no card.
//
// The Later state is the viewer's (localStorage, per chat and message): it is not game state, so it is never in a command or a save.
// Pure except for the storage that `laterStore` takes; no DOM.

import { oneLine } from '../text.js';

export const CARD_TONES = Object.freeze(['accent', 'bad', 'good', 'info']);
export const CARD_ROWS_MAX = 4;
export const CARD_ACTIONS_MAX = 3;
const ICON = /^(ph-[a-z0-9-]+(:fill)?|fa-[a-z0-9-]+)$/;
const COMMAND = /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i;
const LATER_KEY = 'story-block.replyCards.later';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iconOf = (value, fallback) => (typeof value === 'string' && ICON.test(value.trim()) ? value.trim() : fallback);

function rowOf(raw) {
    if (!isRecord(raw)) return null;
    const text = oneLine(raw.text ?? '', 120);
    if (!text) return null;
    const tag = oneLine(raw.tag ?? '', 24);
    return { icon: iconOf(raw.icon, ''), text, tag, tagTone: CARD_TONES.includes(raw.tagTone) ? raw.tagTone : 'info' };
}

function actionOf(raw, at) {
    if (!isRecord(raw)) return null;
    const label = oneLine(raw.label ?? '', 32);
    const command = typeof raw.command === 'string' && COMMAND.test(raw.command) ? raw.command : '';
    const open = typeof raw.open === 'string' && /^[A-Za-z0-9._\-/]{1,120}$/.test(raw.open) ? raw.open : '';
    if (!label || (!command && !open)) return null;
    const id = oneLine(raw.id ?? '', 40) || `action-${at}`;
    return {
        id,
        label,
        icon: iconOf(raw.icon, ''),
        primary: raw.primary === true,
        command,
        payload: isRecord(raw.payload) ? raw.payload : {},
        open,
    };
}

/** A module's card, read: { tone, icon, title, text, rows, actions, later } or null when it has no title. */
export function normalizeCard(raw) {
    if (!isRecord(raw)) return null;
    const title = oneLine(raw.title ?? '', 60);
    if (!title) return null;
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(rowOf).filter(Boolean).slice(0, CARD_ROWS_MAX);
    const actions = (Array.isArray(raw.actions) ? raw.actions : []).map(actionOf).filter(Boolean).slice(0, CARD_ACTIONS_MAX);
    return {
        tone: CARD_TONES.includes(raw.tone) ? raw.tone : 'info',
        icon: iconOf(raw.icon, 'ph-star'),
        title,
        text: oneLine(raw.text ?? '', 200),
        rows,
        actions,
        later: raw.later === true,
    };
}

/**
 * The cards of every assistant message, by index: `entries` are the registry's [{ moduleId, id, fn }] (id: "<module>/<card>"),
 * `carriers` the assistant messages' indexes (oldest first), `messageAt(index)` the message, `stateAt(index)` the state after it,
 * `query(name, args, state)` the queries. → Map index → [{ key, card }]; a card id appears at most once (the first message).
 */
export function scanReplyCards(entries, { carriers = [], messageAt = () => null, stateAt = () => null, query = () => null, chatId = '' } = {}) {
    const out = new Map();
    for (const { id, fn } of Array.isArray(entries) ? entries : []) {
        if (typeof fn !== 'function') continue;
        for (const index of carriers) {
            const state = stateAt(index);
            let answer;
            try {
                answer = fn(state, messageAt(index), { index, chatId, query: (name, args) => query(name, args, state) });
            } catch {
                continue;
            }
            const card = normalizeCard(answer);
            if (!card) continue;
            if (!out.has(index)) out.set(index, []);
            out.get(index).push({ key: id, card });
            break;
        }
    }
    return out;
}

/**
 * The viewer's Later state: `laterStore(storage)` with storage { getItem, setItem } (localStorage by default). This page keeps its own
 * copy (read once), and each change is written to the storage when there is one; a storage that throws or holds junk is read as
 * nothing folded, and a change the storage refuses lasts this page only. Never throws.
 */
export function laterStore(storage = globalThis.localStorage) {
    let kept = null;
    const load = () => {
        if (kept) return kept;
        try {
            const parsed = JSON.parse(storage?.getItem?.(LATER_KEY) ?? '{}');
            kept = isRecord(parsed) ? parsed : {};
        } catch {
            kept = {};
        }
        return kept;
    };
    return {
        /** Whether the card (`${chatId}|${index}|${key}`) is folded. */
        has: key => load()[key] === true,
        /** Folds (on) or opens the card. */
        set(key, on) {
            const all = load();
            if (on) all[key] = true;
            else delete all[key];
            try { storage?.setItem?.(LATER_KEY, JSON.stringify(all)); } catch { /* the choice lasts this page only */ }
        },
    };
}
