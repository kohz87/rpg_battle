// Two widgets of the creation wizard (MODULES §F9, §F12, §F66; WIDGETS.md contract), each placed on the
// one step it belongs to, so the dialog's own footer has no Random button on the other steps:
//
//   rpg-battle.talent-roll    the Talents step's Random: previews `creation.rollTalent` with the
//                             wizard's draft and shows what it rolled; Keep commits exactly that
//                             preview (SPEC §13.6: the roll shown is the roll kept) and the step is
//                             drawn again, now listing the kept talent; Roll again previews anew.
//   rpg-battle.import-pick    the Start step's "Import character": the reader picks a character file
//                             (`party.export`'s file, JSON), and `creation.import` runs with it and the
//                             persona's name, background and portrait from the draft (MODULES §F22).
//                             After it worked the widget sends a bubbling `rpg-battle:created` event (which
//                             openCreation's dialog closes on), then closes the wizard's dialog itself and
//                             says "<Name> is ready" unless that was done: the wizard also opens from Story
//                             Block's start card, which does not go through openCreation.
//
//   rpg-battle.rules-pin      the wizard's rules choice (shown first while a rules pack is offered and none is pinned): the very
//                             `rpg-battle.command-button` Setup uses, bound to the same `rules.pin` button spec, so the pin has
//                             one path and one guard. When it worked the widget marks the draft (`rulesPinned`), which draws
//                             the step again, now past the choice.
//   rpg-battle.draft-start    the Start step's first line, drawn as nothing: when the wizard opened with an empty draft
//                             (Story Block's start card sends no persona, so one switched since the card was drawn
//                             counts), it fills the draft with startDraft() and the persona of this moment.
//
// The first two write nothing but through those commands; creation.rollTalent and creation.import check every
// rule. Built with createElement and textContent only: nothing from data or the file is read as markup.

export const TALENT_ROLL_WIDGET = 'rpg-battle.talent-roll';
export const IMPORT_PICK_WIDGET = 'rpg-battle.import-pick';
export const DRAFT_START_WIDGET = 'rpg-battle.draft-start';
export const RULES_PIN_WIDGET = 'rpg-battle.rules-pin';
/** The event an import that worked sends from the widget, bubbling to the dialog. */
export const CREATED_EVENT = 'rpg-battle:created';
/** The largest character file read (a file is a few KB; this is far above any real one). */
export const FILE_LIMIT = 512 * 1024;

import { CHARACTER_FILE_VERSION } from '../party/portable.js';
import { startDraft } from './draft.js';
import { showCreated, wasTold } from './notice.js';
import { CREATE_SCREEN_ID } from './screen.js';
import { renderCommandButton } from '../screens/rules/widgets.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The longest note the widgets show (a refusal can quote a file's own words). */
const NOTE_LIMIT = 400;
const str = (value, max = 300) => (typeof value === 'string' ? Array.from(value).slice(0, max).join('') : '');
const plainCopy = value => JSON.parse(JSON.stringify(value ?? {}));

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function button(doc, className, label) {
    const node = make(doc, 'button', `ss-button ${className}`, label);
    node.type = 'button';
    return node;
}

/** The dialog's draft as the widget api gives it ({} when the host gives none). */
function draftOf(api) {
    try {
        const value = typeof api?.draft?.value === 'function' ? api.draft.value() : null;
        return isRecord(value) ? plainCopy(value) : {};
    } catch {
        return {};
    }
}

// The step is drawn again from the head after a commit: the dialog redraws on any draft write, so the
// draft's own talents are written back unchanged.
function redraw(api, draft) {
    try {
        if (typeof api?.draft?.set === 'function') api.draft.set('talents', Array.isArray(draft.talents) ? draft.talents : []);
        else api?.onDraft?.('talents', Array.isArray(draft.talents) ? draft.talents : []);
    } catch { /* the dialog reports its own problems */ }
}

// ---------------------------------------------------------------------------------------------------
// rpg-battle.talent-roll

/** render(el, props, api) → { update, destroy }. props: { label? }. */
export function renderTalentRoll(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w rpg-roll');
    const roll = button(doc, 'rpg-roll-go', str(props.label, 40) || 'Random talent');
    const result = make(doc, 'p', 'rpg-roll-result');
    result.setAttribute('role', 'status');
    const keep = button(doc, 'rpg-roll-keep', 'Keep it');
    keep.hidden = true;
    root.append(roll, keep, result);
    el.append(root);
    let token = null;
    let busy = false;

    const show = (text, kept = false) => {
        result.textContent = str(text, NOTE_LIMIT);
        result.toggleAttribute?.('data-problem', !kept && !token && Boolean(text));
        keep.hidden = !token;
        roll.textContent = token ? 'Roll again' : str(props.label, 40) || 'Random talent';
    };

    const once = async work => {
        if (busy) return;
        busy = true;
        roll.disabled = true;
        keep.disabled = true;
        try {
            await work();
        } catch (error) {
            token = null;
            show(error?.message ?? 'That did not work.');
        } finally {
            busy = false;
            roll.disabled = false;
            keep.disabled = false;
        }
    };

    roll.addEventListener('click', () => once(async () => {
        if (typeof api.preview !== 'function') {
            token = null;
            return show('Rolling a talent is not available here.');
        }
        const out = await api.preview('creation.rollTalent', draftOf(api));
        token = out?.ok ? out.token ?? null : null;
        show(out?.ok ? str(out.receipt?.summary, 300) : out?.message ?? 'That did not work.');
    }));

    keep.addEventListener('click', () => once(async () => {
        if (!token || typeof api.commit !== 'function') return;
        const kept = token;
        token = null;
        const out = await api.commit(kept);
        if (!out?.ok) return show(out?.message ?? 'That did not work.');
        show(str(out.receipt?.summary, 300), true);
        redraw(api, draftOf(api));
    }));

    return {
        update(next = {}) {
            props = { ...next };
            if (!token) roll.textContent = str(props.label, 40) || 'Random talent';
        },
        destroy() { root.remove(); },
    };
}

export const talentRoll = Object.freeze({
    props: Object.freeze({ label: Object.freeze({ type: 'string', required: false, default: '' }) }),
    validate: (props = {}) => (props.label !== undefined && typeof props.label !== 'string' ? ['label must be text.'] : []),
    render: renderTalentRoll,
});

// ---------------------------------------------------------------------------------------------------
// rpg-battle.import-pick

/** A picked file's text (File.text(), else FileReader). */
function readText(file, doc) {
    if (typeof file?.text === 'function') return file.text();
    const Reader = doc?.defaultView?.FileReader ?? globalThis.FileReader;
    if (typeof Reader !== 'function') return Promise.reject(new Error('This browser cannot read files here.'));
    return new Promise((resolve, reject) => {
        const reader = new Reader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('The file could not be read.'));
        reader.readAsText(file);
    });
}

/**
 * The file's character (`party.export`'s `data.character`, or the whole receipt data a file saved
 * from it may hold): { character } | { error } in plain words. RPG Battle 1's party file (its
 * Export, `rpgBattleParty`) is named as such; a version that is not a small whole number is never
 * quoted (B-rxui-5: a 400 KB version field would be a 400 KB sentence).
 */
export function characterFrom(text) {
    let parsed;
    try {
        parsed = JSON.parse(String(text ?? ''));
    } catch {
        return { error: 'That file is not a character file (it is not JSON).' };
    }
    if (isRecord(parsed) && parsed.rpgBattleParty !== undefined) {
        return { error: 'That is an RPG Battle 1 party file; this version reads character files saved from RPG Battle 2 (Save character file on the Party tab).' };
    }
    const character = isRecord(parsed?.character) ? parsed.character : parsed;
    if (!isRecord(character)) return { error: 'That file is not a character file.' };
    const version = character.rpgBattleCharacter;
    if (version !== undefined && version !== CHARACTER_FILE_VERSION) {
        const named = Number.isSafeInteger(version) && version >= 0 && version < 1000 ? `version ${version}` : 'an unknown version';
        return { error: `That character file is ${named}; this RPG Battle reads version ${CHARACTER_FILE_VERSION}.` };
    }
    return { character };
}

/**
 * Runs creation.import with a picked file and the draft's persona fields. → the command's result, or
 * { ok: false, message } when the file is too large or unreadable.
 */
export async function importFile(file, api, doc = null) {
    if (!file) return { ok: false, code: 'INVALID', message: 'Choose a character file to import.' };
    if (Number(file.size) > FILE_LIMIT) return { ok: false, code: 'INVALID', message: 'That file is too large to be a character file.' };
    if (typeof api?.command !== 'function') return { ok: false, code: 'FAILED', message: 'Importing a character is not available here.' };
    const read = characterFrom(await readText(file, doc));
    if (read.error) return { ok: false, code: 'INVALID', message: read.error };
    const draft = draftOf(api);
    const payload = { character: read.character };
    for (const key of ['name', 'background', 'portrait']) if (typeof draft[key] === 'string' && draft[key].trim()) payload[key] = draft[key];
    return api.command('creation.import', payload);
}

/**
 * An import made the character: the wizard has nothing left to do. Closes the open wizard dialog (the event above did
 * it when openCreation opened it) and says "<Name> is ready" once (the draft's name is the persona's, as the command used).
 */
function finishWizard(api, result) {
    try {
        const draft = draftOf(api);
        // The widget api's dialog, else Story Block's global sdk (the widget api of an older host has none, as for create-button.js).
        const host = typeof api?.dialog?.current === 'function' ? api.dialog : globalThis.StoryBlock?.sdk?.dialog;
        const dialog = host?.current?.() ?? null;
        if (dialog?.screenId === CREATE_SCREEN_ID && dialog.isOpen?.() !== false) dialog.close?.(result);
        if (!wasTold(result)) showCreated(result, draft, null);
    } catch { /* the character is made; a window that stays open is closed by hand */ }
}

/** render(el, props, api) → { update, destroy }. */
export function renderImportPick(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w rpg-import');
    // A button (Story Block's glass button is a button element); it opens the file picker, which stays hidden.
    const go = button(doc, 'rpg-import-go', 'Import character…');
    const input = make(doc, 'input', 'rpg-import-file');
    input.type = 'file';
    input.setAttribute('accept', '.json,application/json');
    input.setAttribute('aria-label', 'Import character: choose a character file');
    go.addEventListener('click', () => { try { input.click(); } catch { /* the picker is the browser's */ } });
    const note = make(doc, 'p', 'rpg-import-note');
    note.setAttribute('role', 'status');
    root.append(go, input, note);
    el.append(root);
    let busy = false;

    input.addEventListener('change', async () => {
        const file = input.files?.[0] ?? null;
        if (busy || !file) return;
        busy = true;
        input.disabled = true;
        note.textContent = 'Reading the file…';
        try {
            const out = await importFile(file, api, doc);
            note.textContent = str(out?.ok ? out.receipt?.summary : out?.message, NOTE_LIMIT) || 'That did not work.';
            note.toggleAttribute?.('data-problem', !out?.ok);
            if (out?.ok) {
                const View = doc.defaultView ?? globalThis;
                const Event = View.CustomEvent ?? globalThis.CustomEvent;
                if (typeof Event === 'function') root.dispatchEvent?.(new Event(CREATED_EVENT, { bubbles: true, detail: { result: out } }));
                finishWizard(api, out);
            }
        } catch (error) {
            note.textContent = str(error?.message, NOTE_LIMIT) || 'That did not work.';
            note.toggleAttribute?.('data-problem', true);
        } finally {
            busy = false;
            input.disabled = false;
            try { input.value = ''; } catch { /* some browsers keep it */ }
        }
    });

    return {
        update() {},
        destroy() { root.remove(); },
    };
}

export const importPick = Object.freeze({
    props: Object.freeze({}),
    validate: () => [],
    render: renderImportPick,
});

// ---------------------------------------------------------------------------------------------------
// rpg-battle.draft-start

/** The host's view (the persona it knows), when the widget api or the global sdk gives one. */
function viewOf(api) {
    for (const source of [api, globalThis.StoryBlock?.sdk]) {
        try {
            const view = typeof source?.view === 'function' ? source.view() : null;
            if (isRecord(view)) return view;
        } catch { /* no view: SillyTavern's persona is read */ }
    }
    return null;
}

/**
 * render(el, props, api): an empty draft is filled in place with startDraft() (the dialog holds this very object and the
 * widgets after this one, drawn next, read it); a draft that has anything in it is left as it is.
 */
export function renderDraftStart(el, props = {}, api = {}) {
    try {
        const draft = typeof api?.draft?.value === 'function' ? api.draft.value() : null;
        if (isRecord(draft) && Object.keys(draft).length === 0 && !Object.isFrozen(draft)) Object.assign(draft, startDraft(viewOf(api)));
    } catch { /* the wizard then starts as it was opened */ }
    return { update() {}, destroy() {} };
}

export const draftStart = Object.freeze({
    props: Object.freeze({}),
    validate: () => [],
    render: renderDraftStart,
});

// ---------------------------------------------------------------------------------------------------
// rpg-battle.rules-pin

/** render(el, props, api): Setup's command button for `rules.pin`; a pin that worked draws the wizard's step again. */
export function renderRulesPin(el, props = {}, api = {}) {
    const redraw = () => {
        try {
            if (isRecord(api?.draft) && typeof api.draft.set === 'function') api.draft.set('rulesPinned', true);
            else if (typeof api?.onDraft === 'function') api.onDraft('rulesPinned', true);
        } catch { /* the dialog reports its own problems */ }
    };
    const command = typeof api?.command === 'function' ? async (type, payload) => {
        const result = await api.command(type, payload);
        if (result?.ok !== false) redraw();
        return result;
    } : undefined;
    return renderCommandButton(el, props, { ...api, command });
}

export const rulesPin = Object.freeze({
    props: Object.freeze({ value: Object.freeze({ type: 'object', required: false, default: null }) }),
    validate(props = {}) { return props.value !== undefined && props.value !== null && !isRecord(props.value) ? ['value must be an object.'] : []; },
    render: renderRulesPin,
});

/** The wizard's widgets by name (with rpg-battle.preset-pick, registered by the creation part). */
export const wizardWidgets = Object.freeze({ [TALENT_ROLL_WIDGET]: talentRoll, [IMPORT_PICK_WIDGET]: importPick, [DRAFT_START_WIDGET]: draftStart, [RULES_PIN_WIDGET]: rulesPin });
