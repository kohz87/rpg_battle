// Opening the creation wizard (MODULES §F12): Story Block stops a story generation while there is
// no character (the party part's canGenerate), shows its notice, and calls the blocking module's
// `onBlocked(reason, moduleId)` hook. That notice (or the hook) calls openCreation(api) with an
// api that can open a dialog screen:
//
//   api.dialog.open(screenId, opts) | api.openDialog(screenId, opts) | api.mounts.dialog.open(…)
//   (Story Block's dialog mount: opts { draft, random, submitLabel, onDone, onClose })
//
// plus, optionally, api.view() (SPEC §6 view; its `persona` when the host gives one). The name,
// background and default portrait are the SillyTavern persona's (persona.js). The dialog gets no
// `random`: the Talents step has its own Random (widget rpg-battle.talent-roll, which previews
// `creation.rollTalent` and commits that preview in place), so the footer shows Random nowhere. An
// import from the Start step (widget rpg-battle.import-pick) makes the character itself; its
// `rpg-battle:created` event closes the dialog.

import { STATS } from '../../rules.js';
import { personaFor } from './persona.js';
import { CREATE_SCREEN_ID } from './screen.js';
import { CREATED_EVENT } from './wizard-widgets.js';

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
        if (typeof fn === 'function') return { open: (id, opts) => fn.call(owner, id, opts), current: () => (typeof owner?.current === 'function' ? owner.current() : null) };
    }
    return null;
}

const plainCopy = value => JSON.parse(JSON.stringify(value ?? {}));

/**
 * Opens the character creation wizard (screen `rpg-battle/create`) as a dialog.
 * → { ok: true, handle } | { ok: false, code: 'NO_DIALOG' | 'REFUSED', message }
 * opts: { draft? (race, talents, points, portrait to start from), step? (index), view?, persona? }.
 * A wizard already open is brought back, not opened twice.
 */
export function openCreation(api, opts = {}) {
    const dialog = dialogOf(api);
    if (!dialog) return { ok: false, code: 'NO_DIALOG', message: 'Story Block cannot show the character creation window here.' };
    let view = opts.view ?? null;
    if (!view && typeof api?.view === 'function') {
        try { view = api.view(); } catch { view = null; }
    }
    const party = view?.state?.domains?.party;
    if (party?.pc && party.actors?.[party.pc]) return { ok: false, code: 'REFUSED', message: 'You already have a character.' };
    const current = dialog.current();
    if (current?.screenId === CREATE_SCREEN_ID && current.isOpen?.() !== false) return { ok: true, handle: current };

    const draft = startDraft(view, { prefill: isRecord(opts.draft) ? plainCopy(opts.draft) : null, persona: opts.persona ?? null });
    const handle = dialog.open(CREATE_SCREEN_ID, { draft, submitLabel: 'Create' });
    // A character imported from a file is made: the wizard has nothing left to do.
    const root = handle?.root ?? handle?.el ?? null;
    root?.addEventListener?.(CREATED_EVENT, event => handle?.close?.(event?.detail?.result ?? null));
    if (Number.isInteger(opts.step)) handle?.goTo?.(opts.step);
    return { ok: true, handle };
}
