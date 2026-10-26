// Story Director v2, part **arc**: planning, on the reader's side of the page (not story state).
//
// The planner is one model call, on the planner's own connection profile, through Story Block's
// `sdk.callModel({ profile, system, prompt, maxTokens, signal, feature })` → `{ ok, text, error, message }`
// (MODULES §G; Story Block
// ARC_NEEDS_STORY_BLOCK or newer). Without it the arc panel says so plainly and shows no buttons. What
// comes back is read strictly (plan.js readPlan) and waits for the reader's review (Accept, Discard,
// Plan again; Accept without reading while behind the scenes is hidden), unless they chose to accept
// planned arcs automatically (setting `arc.autoAccept`, off by default): then a plan the planner made, by the
// reader's Plan arc or by itself, is accepted at once through the same strict reading and commands, and the
// arc panel says quietly that an arc began (nothing of it while behind the scenes is hidden). Only Accept writes anything, and it does so as the reader's commands
// (commands.js), so the plan is ops on the latest reply like any reader action: replay is the same as
// live, and deleting or swiping that reply takes the plan back.
//
// The waiting plan and when a plan was last asked for are the reader's, kept per chat in the browser's
// storage (screens/reveal.js browserStore), so a swipe never throws a plan away and a reload keeps it.
// Planning by itself (setting `arc.trigger: auto`) runs after a reply: when the story has threads but no
// arc, when every beat of the arc played out (the arc is ended first), when no beat is due within the
// stall window, or when open threads run low (v1 autoPlanReason); never while a plan waits or one is
// being asked for.

import { makeCalendar } from '../../calendar.js';
import { browserStore, reveal as pageReveal, stChatId } from '../screens/reveal.js';
import { ACCEPT, END, UPDATE } from './commands.js';
import { FEATURE, arcQuery, currentArc, threadsWithArc } from './domain.js';
import { REASON_TEXT, autoPlanReason, noteMark, planText, plannerRequest, readPlan, trackerSummary } from './plan.js';
import { arcSettings } from './settings.js';
import { fightsAmong } from '../fights.js';

export const MODULE_ID = 'story-director';
/** The Story Block that gives modules a model call (`sdk.callModel`). */
export const ARC_NEEDS_STORY_BLOCK = '2.0.0-beta.1';
export const NEEDS_TEXT = `Arc planning needs Story Block ${ARC_NEEDS_STORY_BLOCK} or newer (it asks the planner through Story Block). Update Story Block to plan arcs.`;
const STORE_KEY = 'story-director.arc';
/** How long the planner may take (Story Block's callModel keeps it between 1 s and 10 min). */
export const PLANNER_TIMEOUT_MS = 180_000;
const CHAT_ROOM = 50;
// The most of the recent story the planner reads, in characters (the newest kept).
const RECENT_CHARS = 24000;
const MARKUP = /<!--[\s\S]*?-->|<(think|thinking|reasoning|Changes)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

function liveSdk() {
    try {
        return globalThis.StoryBlock?.sdk ?? null;
    } catch {
        return null;
    }
}

function stChat() {
    try {
        const chat = globalThis.SillyTavern?.getContext?.()?.chat;
        return Array.isArray(chat) ? chat : [];
    } catch {
        return [];
    }
}

function toast(kind, text) {
    try { globalThis.toastr?.[kind]?.(text, 'Story Director'); } catch { /* no toasts here */ }
}

const isCarrier = message => Boolean(message) && !message.is_user && !message.is_system;

/** A message's story text for the planner: the hidden change lines and reasoning taken out. */
export function storyText(message) {
    return String(message?.mes ?? '').replace(MARKUP, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The last `count` messages of the story as "Name: text", the newest RECENT_CHARS characters at most. */
export function recentStory(chat, count) {
    const messages = (Array.isArray(chat) ? chat : []).filter(message => message && !message.is_system).slice(-Math.max(1, count));
    const parts = messages.map(message => `${message.name || (message.is_user ? 'User' : 'Narrator')}: ${storyText(message)}`);
    let text = parts.join('\n\n');
    if (text.length > RECENT_CHARS) text = text.slice(text.length - RECENT_CHARS);
    return text;
}

/**
 * The arc planner for one page. `deps` (tests): { sdk () → Story Block's sdk, chat () → the chat's
 * messages, chatId () → its id, store (browserStore), reveal (screens/reveal.js), notify(kind, text) }.
 * Returns { status(), plan({ reason }), accept(text?, { auto }), seen(), discard(), end(), cancel(), onTurn(turn), subscribe(fn) }.
 */
export function createArcController({ sdk = liveSdk, chat = stChat, chatId = stChatId, store = browserStore(), reveal = pageReveal, notify = toast } = {}) {
    const listeners = new Set();
    let busy = null;          // { chat, controller } while the planner is asked
    let error = '';
    let errorChat = '';

    const host = () => {
        try {
            return sdk() ?? null;
        } catch {
            return null;
        }
    };
    const emit = () => {
        for (const fn of [...listeners]) {
            try { fn(); } catch { /* a widget that is gone */ }
        }
    };
    const featureOn = api => (typeof api?.feature === 'function' ? api.feature(FEATURE) !== false : true);
    const settingsOf = api => {
        try {
            return arcSettings(api?.settings?.(MODULE_ID));
        } catch {
            return arcSettings(null);
        }
    };

    // ---- what is kept per chat (the browser's storage) -----------------------------------------
    const all = () => {
        const value = store.get(STORE_KEY);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    };
    const chatEntry = id => {
        const entry = all()[String(id ?? '')];
        return entry && typeof entry === 'object' ? entry : {};
    };
    function keep(id, change) {
        const key = String(id ?? '');
        const every = all();
        const next = { ...(every[key] ?? {}), ...change };
        for (const name of Object.keys(next)) if (next[name] === null || next[name] === undefined) delete next[name];
        delete every[key];
        if (Object.keys(next).length) every[key] = next;
        const keys = Object.keys(every);
        for (const old of keys.slice(0, Math.max(0, keys.length - CHAT_ROOM))) delete every[old];
        store.set(STORE_KEY, every);
    }
    const draftOf = id => {
        const draft = chatEntry(id).draft;
        return draft && typeof draft === 'object' && typeof draft.text === 'string' ? draft : null;
    };

    // ---- the story as the planner reads it -------------------------------------------------------
    function situation(api) {
        let view = null;
        try { view = api.view?.() ?? null; } catch { view = null; }
        const state = view?.state ?? null;
        const director = state?.domains?.director ?? null;
        let calendar = null;
        try {
            const config = api.query?.('director.calendar', {});
            calendar = config ? makeCalendar(config) : null;
        } catch {
            calendar = null;
        }
        const minutes = director?.time?.minutes;
        let nowText = '';
        try { nowText = String(api.query?.('director.time', {})?.text ?? ''); } catch { nowText = ''; }
        const fights = (() => {
            try {
                const modules = api.modules?.();
                return Array.isArray(modules) ? fightsAmong(modules, MODULE_ID) : true;
            } catch {
                return true;
            }
        })();
        return {
            state,
            threads: threadsWithArc(director),
            arc: arcQuery(state),
            current: currentArc(state?.domains?.arc),
            calendar,
            now: Number.isSafeInteger(minutes) ? minutes : null,
            nowText,
            place: String(state?.domains?.scene?.place?.name ?? ''),
            fights,
        };
    }
    const substitute = (api, text) => {
        try {
            const out = api.substitute?.(text);
            return typeof out === 'string' ? out : text;
        } catch {
            return text;
        }
    };
    const replyCount = (messages, from) => messages.slice(Math.min(from, messages.length - 1) + 1).filter(isCarrier).length;

    // ---- what the panel shows ------------------------------------------------------------------------
    function status() {
        const api = host();
        const id = chatId();
        const available = Boolean(api) && typeof api.callModel === 'function';
        return {
            available,
            needs: available ? '' : NEEDS_TEXT,
            on: featureOn(api),
            busy: Boolean(busy) && busy.chat === id,
            error: errorChat === id ? error : '',
            draft: draftOf(id),
            hidden: reveal?.hidden?.() ?? false,
            began: begunOf(id, api),
            arc: api ? arcQuery((() => { try { return api.view?.()?.state ?? null; } catch { return null; } })()) : { current: null, previous: null, count: 0 },
        };
    }

    function fail(id, text) {
        error = text;
        errorChat = id;
        emit();
        return { ok: false, message: text };
    }

    /** Asks the planner for the next arc; the plan waits for review (or is used at once). */
    async function plan({ reason = 'manual' } = {}) {
        const api = host();
        const id = chatId();
        if (!api || typeof api.callModel !== 'function') return fail(id, NEEDS_TEXT);
        if (!featureOn(api)) return { ok: false, message: 'Arc planning is turned off (Features).' };
        if (busy) return { ok: false, message: 'The next arc is already being planned.' };
        const messages = chat();
        const settings = settingsOf(api);
        const seen = situation(api);
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        busy = { chat: id, controller };
        error = '';
        errorChat = id;
        // Asked for, whatever comes of it: a failed or discarded plan waits too before "running low" asks again.
        keep(id, { asked: { index: Math.max(0, messages.length - 1) } });
        emit();
        try {
            const mark = noteMark(settings.note);
            // Used once (v1 0.8.7): an arc planned with this note is already the current one, unless the
            // reader keeps the note for every plan.
            const noteUsed = Boolean(mark) && (settings.keepNote || seen.current?.note !== mark);
            const previous = seen.current ?? null;
            const request = plannerRequest({
                template: settings.prompt,
                genre: settings.genre,
                now: seen.nowText,
                place: seen.place,
                note: noteUsed ? settings.note : '',
                previousArc: previous ? `${previous.key}${previous.desc ? ` — ${previous.desc}` : ''}` : '',
                tracker: trackerSummary(seen.threads),
                recent: recentStory(messages, settings.recent),
                fights: seen.fights,
            });
            const answer = await api.callModel({
                profile: settings.profile,
                system: substitute(api, request.system),
                prompt: substitute(api, request.prompt),
                maxTokens: settings.maxTokens,
                signal: controller?.signal,
                feature: FEATURE,
                // A plan reads a long stretch of the story: more time than a short call.
                timeoutMs: PLANNER_TIMEOUT_MS,
            });
            if (controller?.signal?.aborted) return fail(id, 'Planning was cancelled.');
            if (!answer?.ok) return fail(id, `Planning failed: ${String(answer?.message || answer?.error || 'no answer came back')}`);
            const read = readPlan(String(answer.text ?? ''), { calendar: seen.calendar, now: seen.now, fights: seen.fights, userName: substitute(api, '{{user}}') });
            const errors = read.findings.filter(entry => entry.severity === 'error');
            if (errors.length) return fail(id, `The plan could not be used: ${errors.map(entry => entry.text).join(' ')}`);
            const draft = { text: planText(read), findings: read.findings, reason, note: mark, noteUsed };
            keep(id, { draft });
            // Accept planned arcs automatically: the same strict reading and the same commands as Accept.
            if (settings.autoAccept && chatId() === id) return await accept(draft.text, { auto: true });
            if (reason !== 'manual') notify('info', `A new arc plan is ready in the Director tab (${REASON_TEXT[reason] ?? reason}).`);
            return { ok: true, draft };
        } catch (thrown) {
            return fail(id, `Planning failed: ${thrown?.message ?? thrown}`);
        } finally {
            busy = null;
            emit();
        }
    }

    /**
     * Accepts the waiting plan (or `text`, the reader's edit of it): the arc and its threads, as commands.
     * `auto`: accepted by itself (setting `arc.autoAccept`): the Director screen notes quietly that an arc
     * began (the arc's id, kept per chat in this browser), and the toast names nothing of the plan.
     */
    async function accept(text = null, { auto = false } = {}) {
        const api = host();
        const id = chatId();
        if (!api) return fail(id, NEEDS_TEXT);
        const draft = draftOf(id);
        const given = typeof text === 'string' ? text : draft?.text ?? '';
        const settings = settingsOf(api);
        const result = await api.command(ACCEPT, { plan: given, reason: draft?.reason ?? 'manual', note: draft?.note ?? noteMark(settings.note) });
        if (!result?.ok) return fail(id, result?.message ?? 'The plan could not be accepted.');
        const { arc, pending = [] } = result.receipt?.data ?? {};
        const skipped = [];
        for (const line of pending) {
            const out = await api.command(UPDATE, { arc, line });
            if (!out?.ok) skipped.push(out?.message ?? line);
        }
        keep(id, { draft: null, began: auto && typeof arc === 'string' ? { arc } : null });
        error = skipped.length ? `The arc is tracked, but ${skipped.length === 1 ? 'one change' : `${skipped.length} changes`} could not be made: ${skipped.join(' ')}` : '';
        errorChat = id;
        emit();
        notify(auto ? 'info' : 'success', auto ? 'A new arc began (accepted without review). See the Director tab.' : 'The new arc is being tracked.');
        return result;
    }

    // The arc accepted by itself that the panel still notes: `{ arc }` while it is the current arc (a swipe
    // or delete that took the plan's reply away takes the note with it), else null.
    function begunOf(id, api) {
        const began = chatEntry(id).began;
        if (!began || typeof began.arc !== 'string') return null;
        let current = null;
        try { current = currentArc(api?.view?.()?.state?.domains?.arc); } catch { current = null; }
        return current?.id === began.arc ? { arc: began.arc } : null;
    }

    /** The reader read the note that an arc began by itself. */
    function seen() {
        keep(chatId(), { began: null });
        emit();
        return { ok: true };
    }

    function discard() {
        keep(chatId(), { draft: null });
        error = '';
        emit();
        return { ok: true };
    }

    /** Ends the current arc; with planning by itself on, plans the next. */
    async function end({ reason = 'the arc ended', plan: next = null } = {}) {
        const api = host();
        const id = chatId();
        if (!api) return fail(id, NEEDS_TEXT);
        const result = await api.command(END, { reason });
        if (!result?.ok) return fail(id, result?.message ?? 'The arc could not be ended.');
        emit();
        const again = next ?? settingsOf(api).trigger === 'auto';
        if (again && typeof api.callModel === 'function') await plan({ reason: 'arc-end' });
        return result;
    }

    function cancel() {
        busy?.controller?.abort?.();
    }

    /** After a reply (Story Block's `turn` event): plans by itself when the reader chose it and the story calls for it. */
    async function onTurn(turn = {}) {
        if (turn?.type === 'reread' || turn?.type === 'late') return null;
        const api = host();
        if (!api || typeof api.callModel !== 'function' || !featureOn(api) || busy) return null;
        const settings = settingsOf(api);
        if (settings.trigger !== 'auto') return null;
        const id = chatId();
        if (draftOf(id)) return null;
        const messages = chat();
        const asked = chatEntry(id).asked;
        const since = Number.isSafeInteger(asked?.index) ? replyCount(messages, asked.index) : Infinity;
        const seen = situation(api);
        const reason = autoPlanReason({
            threads: seen.threads,
            arc: seen.current ? { id: seen.current.id, active: seen.current.active } : null,
            now: seen.now,
            calendar: seen.calendar,
            stallDays: settings.stallDays,
            lowThreads: settings.lowThreads,
            repliesSincePlan: since,
        });
        if (!reason) return null;
        if (reason === 'arc-end') {
            const ended = await api.command(END, { reason: 'every beat played out' });
            if (!ended?.ok) return null;
        }
        return plan({ reason });
    }

    return {
        status,
        plan,
        accept,
        seen,
        discard,
        end,
        cancel,
        onTurn,
        /** Behind the scenes shown (true) or hidden again for the open chat (Review). */
        reveal(on = true) {
            reveal?.set?.(on, chatId());
        },
        subscribe(fn) {
            listeners.add(fn);
            const off = reveal?.subscribe?.(fn);
            return () => {
                listeners.delete(fn);
                off?.();
            };
        },
    };
}

let shared = null;
/** The page's planner (the arc panel and index.js share it). */
export function arcController() {
    shared ??= createArcController();
    return shared;
}
