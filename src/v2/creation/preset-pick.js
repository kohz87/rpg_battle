// The widget `rpg-battle.preset-pick` (MODULES §F9, §F14, §F22; WIDGETS.md contract): the packs'
// ready-made characters as cards in the creation wizard. Choosing one fills the wizard's draft
// with its race, talents and points (and `preset`, so creation.finish teaches its skills); "My
// own", or the chosen card's button clicked again, clears them again. It writes the dialog's draft only, never the state: creation.finish
// checks every rule. The name and background stay the persona's. Built with createElement and
// textContent only: nothing from data is read as markup.

import { STATS } from '../../rules.js';
import { cardImage } from './choice-pick.js';

export const PRESET_WIDGET = 'rpg-battle.preset-pick';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 500) => (typeof value === 'string' ? value.slice(0, max) : '');

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/** The draft fields a preset fills: { preset, race, talents, points (every stat) }. */
export function presetDraft(preset) {
    const points = Object.fromEntries(STATS.map(stat => [stat, Number.isInteger(preset?.points?.[stat]) ? preset.points[stat] : 0]));
    return {
        preset: str(preset?.id, 120),
        race: str(preset?.race, 120),
        talents: Array.isArray(preset?.talents) ? preset.talents.filter(id => typeof id === 'string') : [],
        points,
    };
}

/** The draft fields "My own" (or un-picking the chosen character) sets: nothing picked, every stat at 0. */
const MY_OWN = () => ({ preset: '', race: '', talents: [], points: Object.fromEntries(STATS.map(stat => [stat, 0])) });

function draftApi(api) {
    if (isRecord(api?.draft) && typeof api.draft.set === 'function') return api.draft;
    if (typeof api?.onDraft === 'function') return { set: (path, value) => api.onDraft(path, value), get: () => undefined };
    return null;
}

/** render(el, props, api) → { update(nextProps), destroy() }. props: { presets | value: [preset] }. */
export function renderPresetPick(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w rpg-presets');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Ready-made characters');
    el.append(root);
    let current = { ...props };

    const fill = fields => {
        const draft = draftApi(api);
        if (!draft) return;
        for (const [key, value] of Object.entries(fields)) {
            try { draft.set(key, value); } catch { /* the dialog reports its own problems */ }
        }
    };

    const pick = fields => {
        fill(fields);
        current = { ...current, chosen: fields.preset };
        draw();
    };

    function draw() {
        root.textContent = '';
        const list = (Array.isArray(current.value) ? current.value : Array.isArray(current.presets) ? current.presets : []).filter(isRecord);
        // `chosen` (the template passes the draft's preset, so the cards redraw when it changes), else the draft.
        let chosen = typeof current.chosen === 'string' ? str(current.chosen, 120) : '';
        if (typeof current.chosen !== 'string') {
            try { chosen = str(draftApi(api)?.get?.('preset'), 120); } catch { chosen = ''; }
        }
        for (const preset of list) {
            const card = make(doc, 'div', 'rpg-preset');
            card.setAttribute('data-preset', str(preset.id, 120));
            if (chosen && chosen === preset.id) card.classList.add('rpg-preset-chosen');
            // A picture only when the preset has a real one, and only while it loads: no empty box.
            const image = cardImage(preset.image);
            if (image) {
                const img = make(doc, 'img', 'rpg-preset-img');
                img.setAttribute('alt', '');
                img.setAttribute('loading', 'lazy');
                img.setAttribute('referrerpolicy', 'no-referrer');
                img.addEventListener('error', () => img.remove());
                img.setAttribute('src', image);
                card.append(img);
            }
            card.append(make(doc, 'div', 'rpg-preset-name', str(preset.name, 80)));
            const parts = [str(preset.raceName, 80), str(preset.talentNames, 300)].filter(Boolean).join(' · ');
            if (parts) card.append(make(doc, 'div', 'rpg-preset-origin', parts));
            if (str(preset.skillNames, 300)) card.append(make(doc, 'div', 'rpg-preset-skills', `Skills: ${str(preset.skillNames, 300)}`));
            if (str(preset.note)) card.append(make(doc, 'div', 'rpg-preset-note', str(preset.note)));
            const go = make(doc, 'button', 'menu_button rpg-preset-go', chosen === preset.id ? 'Chosen (click to clear)' : 'Start from this');
            go.type = 'button';
            go.setAttribute('aria-pressed', chosen === preset.id ? 'true' : 'false');
            // The chosen one clicked again is put back: as "My own", nothing picked.
            go.addEventListener('click', () => pick(chosen === preset.id ? MY_OWN() : presetDraft(preset)));
            card.append(go);
            root.append(card);
        }
        const own = make(doc, 'button', 'menu_button rpg-preset-own', 'My own');
        own.type = 'button';
        own.setAttribute('aria-pressed', chosen ? 'false' : 'true');
        own.addEventListener('click', () => pick(MY_OWN()));
        root.append(own);
    }

    draw();
    return {
        update(next = {}) {
            current = { ...next };
            draw();
        },
        destroy() {
            root.remove();
        },
    };
}

export const presetPick = Object.freeze({
    props: Object.freeze({
        presets: Object.freeze({ type: 'array', required: false, default: [] }),
        value: Object.freeze({ type: 'array', required: false, default: [] }),
        chosen: Object.freeze({ type: 'string', required: false, default: '' }),
    }),
    validate(props = {}) {
        const problems = [];
        for (const key of ['presets', 'value']) if (props[key] !== undefined && !Array.isArray(props[key])) problems.push(`${key} must be a list of ready-made characters.`);
        return problems;
    },
    render: renderPresetPick,
});
