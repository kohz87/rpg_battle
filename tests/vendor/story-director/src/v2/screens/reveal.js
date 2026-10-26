// Story Director v2, part screens: behind the scenes, hidden until the reader reveals it (v1's Director tab
// "Hide behind the scenes", Story Block v1's "Hide off-screen until revealed").
//
// What the world does where {{user}} is not (agendas, planned beats, clocks, secrets) is the story's
// to surprise the reader with, so the Director screen and the arc panel show only how much there is
// and a Reveal button, and none of it is put into the page until then. The prompt still gets all of it:
// only the reader's view is hidden. The choice is per chat and remembered in this browser (its storage,
// keyed by the chat's id), never story state: a swipe or a delete does not hide it again, and nothing
// is saved into the chat. The setting `screens.hideBehind` (on by default) turns the hiding off for
// every chat. Pure but for the browser's storage and SillyTavern's chat id, both injectable.

export const MODULE_ID = 'story-director';
export const HIDE_SETTING = 'screens.hideBehind';
/** The thread kinds behind the scenes, in the order the screen shows them, with their headings. */
export const BEHIND_KINDS = Object.freeze([['agenda', 'Off-screen'], ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets']]);
export const BEHIND = new Set(BEHIND_KINDS.map(([kind]) => kind));

const STORE_KEY = 'story-director.reveal';
const ROOM = 200;

function liveSdk() {
    try {
        return globalThis.StoryBlock?.sdk ?? null;
    } catch {
        return null;
    }
}

/** The open chat's id from SillyTavern (a group chat's too), or '' when there is none. */
export function stChatId() {
    try {
        const st = globalThis.SillyTavern?.getContext?.();
        const id = typeof st?.getCurrentChatId === 'function' ? st.getCurrentChatId() : st?.chatId;
        return id === undefined || id === null ? '' : String(id);
    } catch {
        return '';
    }
}

/** The browser's storage as `{ get(key), set(key, value) }` (JSON), or memory when it cannot be used. */
export function browserStore(storage = null) {
    const memory = new Map();
    const area = () => {
        try {
            return storage ?? globalThis.localStorage ?? null;
        } catch {
            return null;
        }
    };
    return {
        get(key) {
            try {
                const raw = area()?.getItem?.(key);
                if (typeof raw === 'string') return JSON.parse(raw);
            } catch { /* storage blocked or the value damaged: memory's copy */ }
            return memory.has(key) ? structuredClone(memory.get(key)) : null;
        },
        set(key, value) {
            memory.set(key, structuredClone(value));
            try { area()?.setItem?.(key, JSON.stringify(value)); } catch { /* memory keeps it for this page */ }
        },
    };
}

/**
 * The reveal choice: `{ revealed(chatId?), set(on, chatId?), hidden({ sdk }), subscribe(fn) }`. `hidden`
 * is whether the open chat hides behind the scenes now (the setting on and not revealed). `deps`:
 * { store (browserStore), chatId () → id, settings () → the module's settings }.
 */
export function createReveal({ store = browserStore(), chatId = stChatId, settings = () => liveSdk()?.settings?.(MODULE_ID) ?? null } = {}) {
    const listeners = new Set();
    const read = () => {
        const value = store.get(STORE_KEY);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };
    const api = {
        guard() {
            let values = null;
            try { values = settings(); } catch { values = null; }
            return values?.[HIDE_SETTING] !== false;
        },
        revealed(id = chatId()) {
            return Object.hasOwn(read(), String(id ?? ''));
        },
        set(on, id = chatId()) {
            const key = String(id ?? '');
            const all = read();
            if (on) all[key] = 1;
            else delete all[key];
            // The oldest choices go past ROOM chats (object keys keep the order they were added in).
            const keys = Object.keys(all);
            for (const old of keys.slice(0, Math.max(0, keys.length - ROOM))) delete all[old];
            store.set(STORE_KEY, all);
            for (const fn of [...listeners]) {
                try { fn(); } catch { /* a widget that is gone */ }
            }
        },
        hidden() {
            return api.guard() && !api.revealed();
        },
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
    return api;
}

/** The page's reveal choice (the widgets share it). */
export const reveal = createReveal();
