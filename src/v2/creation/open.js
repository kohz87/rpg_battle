// Opening the creation wizard (MODULES §F12): Story Block stops a story generation while there is
// no character (the party part's canGenerate), shows its notice, and calls the blocking module's
// `onBlocked(reason, moduleId)` hook. That notice (or the hook) calls openCreation(api) with an
// api that can open a dialog screen:
//
//   api.dialog.open(screenId, opts) | api.openDialog(screenId, opts) | api.mounts.dialog.open(…)
//   (Story Block's dialog mount: opts { draft, random, submitLabel, onDone, onClose })
//
// plus, optionally, api.view() (SPEC §6 view; its `persona` when the host gives one), else api.query
// ('party.pc') to tell you already have a character. Three ways in: that notice / onBlocked hook, the
// widget `rpg-battle.create-character` (create-button.js: the Party screen's empty state, the HUD, the
// card under a reply) and Story Block's Home ("Before you start", which runs onBlocked). The name,
// background and default portrait are the SillyTavern persona's (persona.js). The dialog gets no
// `random`: the Talents step has its own Random (widget rpg-battle.talent-roll, which previews
// `creation.rollTalent` and commits that preview in place), so the footer shows Random nowhere. An
// import from the Start step (widget rpg-battle.import-pick) makes the character itself, closes its own dialog and
// says "<Name> is ready" (so also when Story Block's start card opened the wizard, which does not come through here);
// its `rpg-battle:created` event is what closes this dialog first.

import { STATS } from '../../rules.js';
import { personaFor } from './persona.js';
import { CREATE_SCREEN_ID } from './screen.js';
import { CREATED_EVENT } from './wizard-widgets.js';
import { showCreated } from './notice.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The wizard's starting draft: the persona's name, background and avatar (MODULES §F22: never
 * typed in the wizard), no ready-made character, race or talents, every stat at 0 points.
 * `prefill` (a pack's ready-made character, or a draft being reopened) sets preset, race,
 * talents, points and portrait only.
 */
export function startDraft(view = null, { prefill = null, persona = null } = {}) {
    const who = persona ?? personaFor(view);
    const given = isRecord(prefill) ? prefill : {};
    const points = Object.fromEntries(STATS.map(stat => [stat, Number.isInteger(given.points?.[stat]) ? given.points[stat] : 0]));
    return {
        name: who.name,
        background: who.background,
        preset: typeof given.preset === 'string' ? given.preset : '',
        race: typeof given.race === 'string' ? given.race : '',
        talents: Array.isArray(given.talents) ? given.talents.filter(id => typeof id === 'string') : [],
        points,
        portrait: typeof given.portrait === 'string' && given.portrait.trim() ? given.portrait.trim() : who.avatar,
    };
}

function dialogOf(api) {
    for (const [owner, fn] of [[api?.dialog, api?.dialog?.open], [api, api?.openDialog], [api?.mounts?.dialog, api?.mounts?.dialog?.open]]) {
        if (typeof fn === 'function') return { owner, open: (id, opts) => fn.call(owner, id, opts), current: () => (typeof owner?.current === 'function' ? owner.current() : null) };
    }
    return null;
}

const plainCopy = value => JSON.parse(JSON.stringify(value ?? {}));

// The wizard opened last through each dialog api: a host whose dialog api has no `current()` (an older
// Story Block gave only `open`) still gets the open one back instead of a second.
const lastOpened = new WeakMap();
const stillOpen = handle => handle?.screenId === CREATE_SCREEN_ID && typeof handle.isOpen === 'function' && handle.isOpen() === true;

// Whether you already have a character: the view's party (when the api gives a view), else `party.pc`.
function hasCharacter(api, view) {
    const party = view?.state?.domains?.party;
    if (party) return Boolean(party.pc && party.actors?.[party.pc]);
    if (typeof api?.query !== 'function') return false;
    try { return isRecord(api.query('party.pc', {})); } catch { return false; }
}

/**
 * Opens the character creation wizard (screen `rpg-battle/create`) as a dialog.
 * → { ok: true, handle } | { ok: false, code: 'NO_DIALOG' | 'REFUSED', message }
 * opts: { draft? (race, talents, points, portrait to start from), step? (index), view?, persona?,
 * notify? (title, text) in place of the toast }. A wizard already open is brought back, not opened
 * twice. When the character is made (Create, or an import), "<Name> is ready" is shown as a toast.
 */
export function openCreation(api, opts = {}) {
    const dialog = dialogOf(api);
    if (!dialog) return { ok: false, code: 'NO_DIALOG', message: 'Story Block cannot show the character creation window here.' };
    let view = opts.view ?? null;
    if (!view && typeof api?.view === 'function') {
        try { view = api.view(); } catch { view = null; }
    }
    if (hasCharacter(api, view)) return { ok: false, code: 'REFUSED', message: 'You already have a character.' };
    const current = dialog.current();
    if (current?.screenId === CREATE_SCREEN_ID && current.isOpen?.() !== false) return { ok: true, handle: current };
    const last = dialog.owner && typeof dialog.owner === 'object' ? lastOpened.get(dialog.owner) : null;
    if (stillOpen(last)) return { ok: true, handle: last };

    const draft = startDraft(view, { prefill: isRecord(opts.draft) ? plainCopy(opts.draft) : null, persona: opts.persona ?? null });
    let told = false;
    const tell = result => {
        if (told || !result?.ok) return;
        told = true;
        showCreated(result, draft, opts.notify);
    };
    const handle = dialog.open(CREATE_SCREEN_ID, { draft, submitLabel: 'Create', onDone: tell });
    if (!handle) return { ok: false, code: 'NO_DIALOG', message: 'Story Block cannot show the character creation window here.' };
    if (dialog.owner && typeof dialog.owner === 'object') lastOpened.set(dialog.owner, handle);
    // A character imported from a file is made: the wizard has nothing left to do.
    const root = handle?.root ?? handle?.el ?? null;
    root?.addEventListener?.(CREATED_EVENT, event => {
        tell(event?.detail?.result ?? null);
        handle?.close?.(event?.detail?.result ?? null);
    });
    if (Number.isInteger(opts.step)) handle?.goTo?.(opts.step);
    return { ok: true, handle };
}
