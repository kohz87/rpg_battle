// The widget `rpg-battle.create-character` (MODULES §F12; WIDGETS.md contract): "Create your character",
// placed where the reader looks before a character exists (the Party screen's empty state, the HUD
// strip, the card under a reply). It opens the creation wizard (openCreation, open.js) through the host
// sdk the widget api gives (its `dialog.open`), else Story Block's global sdk. Character setup, not a
// story action (F95/F96): it runs no command itself; the wizard's own steps do.
//
// While you already have a character it draws nothing (the screens only place it before one exists;
// this is the guard for a stale draw). A refusal (no dialog here) is shown as one plain line under the
// button. Built with createElement and textContent only.

import { openCreation } from './open.js';

export const CREATE_BUTTON_WIDGET = 'rpg-battle.create-character';
export const CREATE_LABEL = 'Create your character';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max) => (typeof value === 'string' ? Array.from(value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim()).slice(0, max).join('') : '');

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

const canOpen = api => typeof api?.dialog?.open === 'function' || typeof api?.openDialog === 'function' || typeof api?.mounts?.dialog?.open === 'function';

/** The api openCreation gets: the widget's, else the global sdk (an older host's widget api has no dialog). */
export function creationApi(api) {
    if (canOpen(api)) return api;
    const sdk = globalThis.StoryBlock?.sdk;
    return canOpen(sdk) ? sdk : api;
}

/** Whether `api` says you already have a character (`party.pc` answers one). */
function hasCharacter(api) {
    if (typeof api?.query !== 'function') return false;
    try { return isRecord(api.query('party.pc', {})); } catch { return false; }
}

/** render(el, props, api) → { update, destroy }. props: { label?, compact? }. */
export function renderCreateButton(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w rpg-create');
    const go = make(doc, 'button', 'btn primary rpg-create-go');
    go.type = 'button';
    go.setAttribute('type', 'button');
    const glyph = make(doc, 'i', 'fa-solid fa-user-plus');
    glyph.setAttribute('aria-hidden', 'true');
    const label = make(doc, 'span', 'rpg-create-label');
    go.append(glyph, label);
    const note = make(doc, 'p', 'rpg-create-note');
    note.setAttribute('role', 'status');
    note.hidden = true;
    root.append(go, note);
    el.append(root);

    const draw = () => {
        label.textContent = str(props.label, 40) || CREATE_LABEL;
        root.classList.toggle('compact', props.compact === true);
        root.hidden = hasCharacter(api);
    };
    go.addEventListener('click', () => {
        let out;
        try { out = openCreation(creationApi(api)); } catch (error) { out = { ok: false, message: error?.message ?? 'That did not work.' }; }
        note.textContent = out?.ok ? '' : str(out?.message, 300) || 'That did not work.';
        note.hidden = Boolean(out?.ok);
    });
    draw();
    return {
        update(next = {}) {
            props = { ...next };
            draw();
        },
        destroy() { root.remove(); },
    };
}

export const createButton = Object.freeze({
    props: Object.freeze({
        label: Object.freeze({ type: 'string', required: false, default: '' }),
        compact: Object.freeze({ type: 'boolean', required: false, default: false }),
    }),
    validate(props = {}) {
        const problems = [];
        if (props.label !== undefined && typeof props.label !== 'string') problems.push('label must be text.');
        if (props.compact !== undefined && typeof props.compact !== 'boolean') problems.push('compact must be true or false.');
        return problems;
    },
    render: renderCreateButton,
});
