// A turn (docs/v2/SPEC.md §4, §5): Story Suite's SillyTavern wiring.
//
// Before the reply (the generation interceptor, for normal, swipe, regenerate and continue):
// flush pending saves, let modules add cues (beforeGenerate), collect the untold receipts and
// assemble the two prompt texts; the static part goes in-prompt, this reply's part in-chat at
// depth 0. Quiet and impersonate generations (and any other kind) get both slots emptied.
// At prompt-ready: hidden change blocks leave the prompt history, and when the preset left out
// the Main Prompt (SillyTavern then drops in-prompt text) the static part is put back at the
// start of this reply's part, for the story's own prompt only.
// A module's canGenerate hook may stop a story generation first (the interceptor's abort).
// After the reply (MESSAGE_RECEIVED for the carrier the interceptor prepared): read its
// <Changes> block, run each line as its owner's capture command (cause 'story'), append what
// was accepted, record what the reply was told, save once. A line no module takes, or one its
// owner rejects, goes to the Problems list; nothing is thrown at the reader.
//
// turn.js receives the SillyTavern context and the host parts; it never imports the store or
// the command bus (their interfaces are docs/v2/SPEC.md §12).

import { extractBlock, hideBlock, parseChanges, stripBlock } from './capture.js';
import { CAPTURE_PREFIX } from './registry.js';
import { STATIC_MARKER, assemble } from './prompt.js';
import { ensureModules, makeView } from './sdk.js';

export const STATIC_KEY = 'story_suite_static';
export const TAIL_KEY = 'story_suite_tail_1';
// Story Block v1's keys (0.9.21+ and before), cleared on load so an old copy never lingers.
export const V1_KEYS = Object.freeze([
    ['story_suite_static_story_block', 'static'],
    ['story_suite_tail_1_story_block', 'tail'],
    ['story_block', 'static'],
]);
export const FOREGROUND = Object.freeze(['normal', 'swipe', 'regenerate', 'continue']);
export const INTERCEPTOR_NAME = 'storyBlockGenerationInterceptor';
// SillyTavern's extension_prompt_types and extension_prompt_roles, when the context lacks them.
const IN_PROMPT = 0;
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;
const MAX_PROBLEMS = 200;

const defaultNotify = reason => globalThis.toastr?.warning?.(reason, 'Story Suite');

export const normalizeType = type => String(type ?? 'normal').trim().toLowerCase() || 'normal';

/**
 * SillyTavern runs its macros over extension prompts, which would rewrite a `{{user}}` or
 * `<USER>` inside a name the story introduced. A zero-width space keeps them as written.
 */
export function defuseMacros(text) {
    return String(text ?? '')
        .replace(/\{\{/g, '{​{')
        .replace(/<(USER|BOT|CHAR|CHARIFNOTGROUP|GROUP)>/gi, '<​$1>');
}

/**
 * `{{user}}` and `{{char}}` in the static and tail text become the persona's and the character's
 * names (SillyTavern's substituteParams when the context has it, else name1 / name2); any other
 * macro is left for defuseMacros. Both names are fixed for a chat, so the static text stays
 * byte-identical reply after reply.
 */
export function substituteNames(text, ctx) {
    const cache = new Map();
    const name = macro => {
        const key = macro.toLowerCase();
        if (!cache.has(key)) {
            let value = null;
            try { value = typeof ctx?.substituteParams === 'function' ? ctx.substituteParams(`{{${key}}}`) : null; } catch { value = null; }
            if (typeof value !== 'string' || value === `{{${key}}}`) value = key === 'user' ? ctx?.name1 : ctx?.name2;
            cache.set(key, typeof value === 'string' && value ? value : null);
        }
        return cache.get(key);
    };
    return String(text ?? '').replace(/\{\{\s*(user|char)\s*\}\}/gi, (whole, macro) => name(macro) ?? whole);
}

// Message content is a string or, for multimodal prompts, a list of parts.
function mapContent(content, transform) {
    if (typeof content === 'string') return transform(content);
    if (!Array.isArray(content)) return content;
    return content.map(part => {
        if (typeof part === 'string') return transform(part);
        if (part && typeof part === 'object' && typeof part.text === 'string') return { ...part, text: transform(part.text) };
        return part;
    });
}
function contentText(content) {
    const texts = [];
    mapContent(content, text => { texts.push(text); return text; });
    return texts.join('\n');
}
const firstLine = text => String(text ?? '').split('\n').find(line => line.trim())?.trim() ?? '';
const isCarrier = message => Boolean(message) && !message.is_user;

/**
 * Chat completion, the story's own prompt: puts back what SillyTavern left out. When the static
 * text is missing (the preset has no Main Prompt) it goes at the start of this reply's part;
 * when that is missing too, both go in as one system message right before the reply (before a
 * trailing assistant message, a Continue's own text). Returns what it did: '' | 'static' | 'both'.
 */
export function restoreMissing(chat, staticText, tailText) {
    if (!Array.isArray(chat) || !staticText) return '';
    const has = text => {
        const marker = firstLine(text);
        return marker ? chat.findIndex(message => contentText(message?.content).includes(marker)) : -1;
    };
    if (has(STATIC_MARKER) >= 0 || has(staticText) >= 0) return '';
    const at = tailText ? has(tailText) : -1;
    if (at >= 0) {
        const message = chat[at];
        let done = false;
        message.content = mapContent(message.content, part => {
            if (done || !part.includes(firstLine(tailText))) return part;
            done = true;
            const index = part.indexOf(firstLine(tailText));
            return `${part.slice(0, index)}${staticText}\n\n${part.slice(index)}`;
        });
        return 'static';
    }
    const index = chat.length && chat.at(-1)?.role === 'assistant' ? chat.length - 1 : chat.length;
    chat.splice(index, 0, { role: 'system', content: [staticText, tailText].filter(Boolean).join('\n\n') });
    return 'both';
}

/**
 * Wires one SillyTavern context. `deps`: { ctx, store, bus, registry, settings, events?,
 * onBlocked?(reason, moduleId), notify?(reason, moduleId) (default: a toastr warning),
 * initial?() → the initial State for a chat with none (default registry.initialState(); the host
 * adds the packs' start, SPEC §2.6) }.
 * `settings` is createSettings() (settings() → host settings, settings(id) → a module's).
 * Returns { interceptor, install, uninstall, onPromptReady, onTextPromptReady, onMessageReceived,
 * onChatChanged, onTimelineChanged, onGenerationEnded, preview, problems, clearProblems,
 * session }.
 */
export function createTurn({ ctx, store, bus, registry, settings, events = null, onBlocked = null, notify = defaultNotify, initial = () => registry.initialState() }) {
    const types = () => ctx?.extension_prompt_types ?? ctx?.extensionPromptTypes ?? {};
    const roles = () => ctx?.extension_prompt_roles ?? ctx?.extensionPromptRoles ?? {};
    const position = place => (place === 'static' ? types().IN_PROMPT ?? IN_PROMPT : types().IN_CHAT ?? IN_CHAT);
    const hostSettings = () => (typeof settings === 'function' ? settings() : settings ?? {});
    let session = null;
    let listeners = [];
    const problemLog = [];
    const blocks = [];

    function setPrompt(key, text, place) {
        if (typeof ctx?.setExtensionPrompt !== 'function') return;
        ctx.setExtensionPrompt(key, text, position(place), 0, false, roles().SYSTEM ?? ROLE_SYSTEM);
    }
    function setPrompts(staticText, tailText) {
        setPrompt(STATIC_KEY, staticText, 'static');
        setPrompt(TAIL_KEY, tailText, 'tail');
    }
    const clearPrompts = () => setPrompts('', '');

    function problem(entry) {
        const item = { module: null, code: 'PROBLEM', ...entry };
        problemLog.push(item);
        if (problemLog.length > MAX_PROBLEMS) problemLog.splice(0, problemLog.length - MAX_PROBLEMS);
        console.warn(`[Story Suite] ${item.module ? `${item.module}: ` : ''}${item.message}`);
        return item;
    }

    const view = () => makeView({ store, registry, settings, chat: ctx?.chat });
    const hasCarrier = () => (ctx?.chat ?? []).some(isCarrier);
    const lastCarrier = () => (ctx?.chat ?? []).findLastIndex(isCarrier);

    function rebuild() {
        store.rebuild();
        if (hasCarrier()) store.ensureInitial(initial());
        events?.emit('head', { index: store.headIndex() });
    }

    // beforeGenerate (§4.1 step 3): each hook may return lines for the tail, or commands to
    // commit now as `system` receipts: string[] | { lines?: string[], commands?: [{ type, payload }] }.
    async function runCues() {
        const cues = {};
        let committed = false;
        for (const { moduleId, fn } of registry.hookEntries('beforeGenerate')) {
            let out;
            try { out = await fn(view()); } catch (error) {
                problem({ module: moduleId, code: 'FAILED', message: `beforeGenerate failed: ${error?.message ?? error}` });
                continue;
            }
            const lines = Array.isArray(out) ? out : Array.isArray(out?.lines) ? out.lines : [];
            if (lines.length) cues[moduleId] = lines.filter(line => typeof line === 'string');
            for (const command of Array.isArray(out?.commands) ? out.commands : []) {
                const result = await bus.command(command?.type, command?.payload ?? {}, { cause: 'system' });
                if (result?.ok) {
                    committed = true;
                    events?.emit('committed', { receipt: result.receipt });
                } else problem({ module: moduleId, code: result?.code ?? 'FAILED', message: `The cue "${command?.type}" was not committed: ${result?.message ?? 'unknown error'}` });
            }
        }
        if (committed) await store.flush();
        return cues;
    }

    function build(cues = {}) {
        const untold = store.untold();
        const result = assemble({ registry, view: view(), untold, settings: hostSettings(), cues });
        for (const message of result.problems) problem({ code: 'FAILED', message });
        return { ...result, untold };
    }

    /** SillyTavern's generate interceptor: (chat, contextSize, abort, type). */
    // canGenerate (MODULES §F12): every module may hold a story generation back, e.g. until the
    // player character exists. `false` or { ok: false, reason } blocks; the first one is the answer.
    // A hook that throws is logged and does not block (a bug must not lock the reader out).
    async function blockedBy() {
        for (const { moduleId, fn } of registry.hookEntries('canGenerate')) {
            let answer;
            try { answer = await fn(view()); } catch (error) {
                problem({ module: moduleId, code: 'FAILED', message: `canGenerate failed: ${error?.message ?? error}` });
                continue;
            }
            if (answer === false || (answer && typeof answer === 'object' && answer.ok === false)) {
                const name = registry.module(moduleId)?.name ?? moduleId;
                const reason = typeof answer?.reason === 'string' && answer.reason.trim() ? answer.reason.trim() : `${name} is not ready for the story to go on yet.`;
                return { moduleId, reason };
            }
        }
        return null;
    }

    function block({ moduleId, reason }, abort) {
        session = null;
        clearPrompts();
        try { abort?.(true); } catch (error) { console.warn('[Story Suite] the generation could not be stopped', error); }
        try { notify?.(reason, moduleId); } catch { /* a missing toastr is not an error */ }
        for (const fn of [registry.module(moduleId)?.hooks?.onBlocked, onBlocked]) {
            if (typeof fn !== 'function') continue;
            try { fn(reason, moduleId); } catch (error) {
                problem({ module: moduleId, code: 'FAILED', message: `onBlocked failed: ${error?.message ?? error}` });
            }
        }
        blocks.push({ moduleId, reason });
    }

    async function interceptor(_chat, _contextSize, abort, type) {
        const kind = normalizeType(type);
        if (!FOREGROUND.includes(kind)) {
            // A quiet prompt built while the reply's own is pending must not carry its text; the
            // reply's prompt gets it back at the quiet prompt's prompt-ready (below).
            // A reply already on its way keeps its session, so it is still captured.
            if (session && !session.prompted) session.background += 1;
            clearPrompts();
            return;
        }
        if (!ctx?.chat) return;
        try {
            await store.flush();
            // A Regenerate removes the old reply before this runs, without an event for it.
            if (store.headIndex() !== lastCarrier()) store.rebuild();
            if (hasCarrier()) store.ensureInitial(initial());
            await ensureModules({ store, bus, registry, events });
            const blocked = await blockedBy();
            if (blocked) {
                block(blocked, abort);
                return;
            }
            const cues = await runCues();
            const built = build(cues);
            const chat = ctx.chat;
            const last = chat.length - 1;
            const index = kind === 'swipe' || kind === 'continue' ? last : chat.length;
            session = {
                type: kind,
                index,
                untold: built.untold.map(receipt => receipt.id),
                staticText: defuseMacros(substituteNames(built.staticText, ctx)),
                tailText: defuseMacros(substituteNames(built.tailText, ctx)),
                parts: built.parts,
                // A Continue whose reply already held a block was captured then; only a block
                // the continuation adds is read.
                captured: kind === 'continue' && extractBlock(chat[last]?.mes) !== null,
                prompted: false,
                background: 0,
                restored: '',
            };
            setPrompts(session.staticText, session.tailText);
        } catch (error) {
            session = null;
            clearPrompts();
            problem({ code: 'FAILED', message: `The reply's notes could not be built: ${error?.message ?? error}` });
        }
    }

    function stripHistory(chat) {
        for (const message of chat) {
            if (message?.role !== 'assistant') continue;
            const content = mapContent(message.content, text => (extractBlock(text) === null ? text : stripBlock(text)));
            if (content !== message.content) message.content = content;
        }
    }

    // A background prompt seen while the reply's own is pending: its slots were emptied for it;
    // fill them again for the reply. True when this prompt was the background one.
    function backgroundPrompt() {
        if (!session || session.prompted || session.background <= 0) return false;
        session.background -= 1;
        if (!session.background) setPrompts(session.staticText, session.tailText);
        return true;
    }

    /** CHAT_COMPLETION_PROMPT_READY: { chat, dryRun }. */
    function onPromptReady(eventData) {
        if (!eventData || eventData.dryRun === true || !Array.isArray(eventData.chat)) return;
        stripHistory(eventData.chat);
        if (backgroundPrompt() || !session || session.prompted) return;
        session.prompted = true;
        session.restored = restoreMissing(eventData.chat, session.staticText, session.tailText);
    }

    /** GENERATE_AFTER_COMBINE_PROMPTS (text completion): { prompt, dryRun }. */
    function onTextPromptReady(eventData) {
        if (!eventData || eventData.dryRun === true || typeof eventData.prompt !== 'string') return;
        // Only the hidden form: the static text's own example block must stay.
        const hidden = new RegExp(`\\s*<!--\\s*STORY_SUITE_V2\\b[\\s\\S]*?-->`, 'g');
        eventData.prompt = eventData.prompt.replace(hidden, '');
        if (backgroundPrompt() || !session || session.prompted) return;
        session.prompted = true;
        const missing = [session.staticText, session.tailText].filter(text => text && !eventData.prompt.includes(firstLine(text)));
        if (missing.length) {
            session.restored = missing.length === 2 ? 'both' : missing[0] === session.staticText ? 'static' : 'tail';
            if (missing.includes(session.staticText)) eventData.prompt = `${session.staticText}\n${eventData.prompt}`;
            if (missing.includes(session.tailText)) eventData.prompt = `${eventData.prompt}\n${session.tailText}`;
        }
    }

    // Runs the reply's change lines; returns { receipts, problems }.
    // Each line runs on the state the lines before it left (bus.run's `state`), as its owner's
    // capture handler (bus.run's `capture`), and is stored on the reply before the next one runs.
    async function captureLines(index, lines) {
        const receipts = [];
        const found = [];
        let state = store.head();
        // ctx.carrier and ctx.chat for the capture handlers (MODULES §F2's capture context).
        const message = ctx?.chat?.[index];
        const carrier = { index, swipe: Number.isInteger(message?.swipe_id) ? message.swipe_id : 0 };
        const reader = (ctx?.chat ?? []).slice(0, index).findLast(item => item?.is_user);
        const chat = { lastUser: String(reader?.mes ?? ''), reply: stripBlock(String(message?.mes ?? '')) };
        for (const line of lines) {
            const entry = registry.capture(line.kind);
            if (!entry) {
                found.push(problem({ index, line: line.raw, code: 'UNKNOWN_KIND', message: `No module keeps "${line.kind}", so "${line.raw}" was not used.` }));
                continue;
            }
            let result;
            try {
                result = await bus.run(`${CAPTURE_PREFIX}${entry.kind}`, { ...line, kind: entry.kind, word: line.kind }, { cause: 'story', state, capture: entry, carrier, chat });
                if (result?.ok) store.append({ ops: result.ops, receipt: result.receipt });
            } catch (error) {
                result = { ok: false, code: 'FAILED', message: error?.message ?? String(error) };
            }
            if (!result?.ok) {
                found.push(problem({ module: entry.moduleId, index, line: line.raw, code: result?.code ?? 'FAILED', message: `"${line.raw}" was not used: ${result?.message ?? 'unknown error'}` }));
                continue;
            }
            state = result.state ?? store.head();
            receipts.push(result.receipt);
            events?.emit('committed', { receipt: result.receipt });
        }
        return { receipts, problems: found };
    }

    /** MESSAGE_RECEIVED: (messageId, type). */
    async function onMessageReceived(messageId) {
        const id = Number(messageId);
        const current = session;
        if (!current || !Number.isInteger(id) || id !== current.index) return null;
        session = null;
        clearPrompts();
        const message = ctx?.chat?.[id];
        if (!isCarrier(message)) return null;
        try {
            if (store.headIndex() !== id) store.rebuild();
            store.ensureInitial(initial());
            if (store.headIndex() !== id) {
                problem({ index: id, code: 'FAILED', message: 'The reply is not the last message that keeps the story, so its changes were not read.' });
                return null;
            }
            const block = current.captured ? null : extractBlock(message.mes);
            const parsed = block === null ? { lines: [], problems: [] } : parseChanges(block);
            const problems = parsed.problems.map(text => problem({ index: id, code: 'UNREADABLE', message: text }));
            const result = await captureLines(id, parsed.lines);
            problems.push(...result.problems);

            // What this reply was told; a Continue keeps what the reply was told before.
            const before = current.type === 'continue' ? message.extra?.storySuite?.narrated ?? [] : [];
            store.setNarrated(id, [...new Set([...before, ...current.untold])]);

            let edited = false;
            if (block !== null) {
                const hidden = hideBlock(message.mes);
                if (hidden !== message.mes) {
                    message.mes = hidden;
                    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = hidden;
                    edited = true;
                }
            }
            if (store.dirty()) await store.flush();
            else if (edited) await ctx.saveChat?.();
            if (edited) ctx.updateMessageBlock?.(id, message);
            const turn = { index: id, type: current.type, receipts: result.receipts, problems, told: current.untold };
            events?.emit('turn', turn);
            return turn;
        } catch (error) {
            problem({ index: id, code: 'FAILED', message: `The reply's changes could not be kept: ${error?.message ?? error}` });
            return null;
        }
    }

    /** CHAT_CHANGED: a new chat (or the same one reloaded). */
    async function onChatChanged() {
        session = null;
        clearPrompts();
        rebuild();
        await ensureModules({ store, bus, registry, events });
    }

    /** Deleted messages, swipes, a greeting picked: the state is rebuilt from what is stored. */
    function onTimelineChanged() {
        rebuild();
    }

    /** GENERATION_ENDED / GENERATION_STOPPED: a spent note never reaches a later prompt. */
    function onGenerationEnded() {
        if (session?.prompted) clearPrompts();
    }

    function install({ globalName = INTERCEPTOR_NAME } = {}) {
        for (const [key, place] of V1_KEYS) setPrompt(key, '', place);
        clearPrompts();
        if (globalName) globalThis[globalName] = interceptor;
        const source = ctx?.eventSource;
        const names = ctx?.eventTypes ?? ctx?.event_types ?? {};
        const on = (event, fn) => {
            if (!event || typeof source?.on !== 'function') return;
            source.on(event, fn);
            listeners.push([event, fn]);
        };
        on(names.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        on(names.GENERATE_AFTER_COMBINE_PROMPTS, onTextPromptReady);
        on(names.MESSAGE_RECEIVED, onMessageReceived);
        on(names.GENERATION_ENDED, onGenerationEnded);
        on(names.GENERATION_STOPPED, onGenerationEnded);
        on(names.CHAT_CHANGED, onChatChanged);
        for (const event of [names.MESSAGE_DELETED, names.MESSAGE_SWIPED, names.MESSAGE_SWIPE_DELETED, names.CHARACTER_FIRST_MESSAGE_SELECTED]) on(event, onTimelineChanged);
        return api;
    }

    function uninstall({ globalName = INTERCEPTOR_NAME } = {}) {
        const source = ctx?.eventSource;
        for (const [event, fn] of listeners) (source?.removeListener ?? source?.off)?.call(source, event, fn);
        listeners = [];
        if (globalName && globalThis[globalName] === interceptor) delete globalThis[globalName];
        clearPrompts();
    }

    const api = {
        interceptor,
        install,
        uninstall,
        onPromptReady,
        onTextPromptReady,
        onMessageReceived,
        onChatChanged,
        onTimelineChanged,
        onGenerationEnded,
        /** What the next ordinary reply would be sent, without changing anything (no cues run). */
        preview: () => build().parts,
        /** The Problems list, oldest first; `moduleId` narrows it (null: the host's own). */
        problems: moduleId => problemLog.filter(item => moduleId === undefined || item.module === moduleId).map(item => ({ ...item })),
        clearProblems: () => { problemLog.length = 0; },
        /** Generations a canGenerate hook stopped: [{ moduleId, reason }], oldest first. */
        blocked: () => blocks.map(item => ({ ...item })),
        /** The pending reply's session (for status and tests), or null. */
        session: () => (session ? { ...session } : null),
    };
    return api;
}
