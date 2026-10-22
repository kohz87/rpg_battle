// RPG Battle v2, part **screens**: the widgets the default screens and Story Block's Inventory place
// (SPEC §13.5, WIDGETS.md contract: render(el, props, api) → { update, destroy }).
//
//   rpg-battle.item-detail       what only RPG Battle knows about one of the party's things, for a row of
//                                Story Block's Inventory (the one bag, MODULES §F99): a piece's slot and
//                                stats, who wears it, its condition band and refinement; a draught's
//                                effect and whom it would help now. Props { stack } (it asks the query
//                                `rpg-battle.itemDetail`), or the detail bound as `value`. Nothing is
//                                drawn for a thing RPG Battle has nothing to add to.
//   rpg-battle.character-file    "Save character file": your character as a file to keep or take into
//                                another story (MODULES §F66). It previews `party.export` (which changes
//                                nothing, so nothing is stored) and saves the receipt's `data.character`
//                                as `data.fileName`.
//
// Built with createElement and textContent only: nothing from data is read as markup, and classes come
// from fixed lists (a band name picks one of four). The base look is one <style data-rpg-screens>
// added to the document by the first widget drawn, every rule inside :where() so a screen's own CSS
// overrides it, coloured from Story Block's widget tokens and SillyTavern's theme.

export const ITEM_DETAIL_WIDGET = 'rpg-battle.item-detail';
export const CHARACTER_FILE_WIDGET = 'rpg-battle.character-file';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 300) => (typeof value === 'string' ? Array.from(value).slice(0, max).join('') : '');
const BAND_NAMES = Object.freeze(['good', 'worn', 'tattered', 'broken']);

export const WIDGET_CSS = `
:where(.rpg-id) { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; font-size: 0.82em;
  color: var(--ss-w-muted, color-mix(in srgb, var(--SmartThemeBodyColor, #ddd) 65%, transparent)); }
:where(.rpg-id-line) { min-width: 0; overflow-wrap: anywhere; }
:where(.rpg-id-chip) { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 999px; white-space: nowrap;
  font-weight: 600; color: var(--ss-w-fg, var(--SmartThemeBodyColor, #ddd)); --rpg-tone: var(--ss-w-good, #3fb27f);
  background: color-mix(in srgb, var(--rpg-tone) 18%, transparent); border: 1px solid color-mix(in srgb, var(--rpg-tone) 45%, transparent); }
:where(.rpg-id-chip[data-band="worn"]) { --rpg-tone: var(--ss-w-warn, #e2a336); }
:where(.rpg-id-chip[data-band="tattered"]), :where(.rpg-id-chip[data-band="broken"]) { --rpg-tone: var(--ss-w-bad, #e5534b); }
:where(.rpg-id-chip.rpg-id-refine) { --rpg-tone: var(--ss-w-accent, var(--ss-accent, var(--SmartThemeQuoteColor, #8b7cf6))); }
:where(.rpg-id-bar) { display: inline-block; width: 3.2em; height: 4px; border-radius: 2px; overflow: hidden;
  background: color-mix(in srgb, var(--SmartThemeBodyColor, #ddd) 15%, transparent); }
:where(.rpg-id-bar > span) { display: block; height: 100%; width: calc(var(--rpg-ratio, 0) * 100%); background: var(--rpg-tone); }
:where(.rpg-file) { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
:where(.rpg-file-note) { font-size: 0.82em; color: var(--ss-w-muted, inherit); overflow-wrap: anywhere; }
:where(.rpg-file-note[data-tone="bad"]) { color: var(--ss-w-bad, #e5534b); }
`;

/** Adds the widgets' base look to `doc` once. */
export function ensureWidgetCss(doc) {
    const head = doc?.head ?? doc?.body;
    if (!head || head.querySelector?.('style[data-rpg-screens]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-rpg-screens', '');
    style.textContent = WIDGET_CSS;
    head.appendChild(style);
}

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function icon(doc, name) {
    const node = make(doc, 'i', `fa-solid ${/^fa-[a-z0-9-]+$/.test(name) ? name : 'fa-circle'}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

// ---------------------------------------------------------------------------------------------------
// rpg-battle.item-detail

function detailFor(props, api) {
    if (isRecord(props.value)) return props.value;
    const stack = str(props.stack, 120);
    if (!stack || typeof api?.query !== 'function') return null;
    try {
        const found = api.query('rpg-battle.itemDetail', { stack });
        return isRecord(found) ? found : null;
    } catch {
        return null;
    }
}

/** Draws one detail into `root` (emptied first); hidden when there is nothing to add. */
export function drawItemDetail(root, detail) {
    const doc = root.ownerDocument;
    root.replaceChildren();
    root.hidden = !isRecord(detail);
    if (!isRecord(detail)) return;
    root.setAttribute('data-kind', ['equipment', 'consumable'].includes(detail.kind) ? detail.kind : 'other');
    const lines = Array.isArray(detail.lines) ? detail.lines : [];
    if (detail.kind === 'equipment') {
        const head = [str(detail.slotLabel, 40), str(detail.stats, 200)].filter(Boolean).join(' · ');
        if (head) root.append(make(doc, 'span', 'rpg-id-line', head));
        if (str(detail.wearer, 80)) root.append(make(doc, 'span', 'rpg-id-line rpg-id-wearer', `Worn by ${str(detail.wearer, 80)}`));
        const refine = isRecord(detail.refine) ? detail.refine : null;
        if (refine && Number(refine.level) > 0) {
            const chip = make(doc, 'span', 'rpg-id-chip rpg-id-refine', str(refine.label, 8));
            chip.setAttribute('title', str(refine.text, 40));
            chip.setAttribute('aria-label', str(refine.text, 40));
            root.append(chip);
        }
        const condition = isRecord(detail.condition) ? detail.condition : null;
        if (condition && BAND_NAMES.includes(condition.band)) {
            const chip = make(doc, 'span', 'rpg-id-chip rpg-id-band');
            chip.setAttribute('data-band', condition.band);
            chip.append(icon(doc, condition.band === 'broken' ? 'fa-heart-crack' : 'fa-shield-halved'), make(doc, 'span', '', str(condition.label, 20)));
            const max = Number(condition.max) || 0;
            if (max > 0) {
                const bar = make(doc, 'span', 'rpg-id-bar');
                bar.style.setProperty?.('--rpg-ratio', String(Math.max(0, Math.min(1, (Number(condition.cur) || 0) / max))));
                bar.append(make(doc, 'span'));
                chip.append(bar);
            }
            chip.setAttribute('title', str(condition.text, 60));
            chip.setAttribute('aria-label', `Condition: ${str(condition.text, 60)}`);
            root.append(chip);
        }
    } else {
        for (const line of lines.slice(0, 4)) root.append(make(doc, 'span', 'rpg-id-line', str(line, 300)));
    }
}

/** render(el, props, api) → { update(nextProps), destroy() }. props: { stack } or { value: detail }. */
export function renderItemDetail(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    ensureWidgetCss(doc);
    const root = make(doc, 'div', 'ss-w rpg-id');
    el.append(root);
    drawItemDetail(root, detailFor(props, api));
    return {
        update(next = {}) { drawItemDetail(root, detailFor(next, api)); },
        destroy() { root.remove(); },
    };
}

export const itemDetailWidget = Object.freeze({
    props: Object.freeze({
        stack: Object.freeze({ type: 'string', required: false, default: '' }),
        value: Object.freeze({ type: 'object', required: false, default: null }),
    }),
    validate(props = {}) {
        const problems = [];
        if (props.stack !== undefined && typeof props.stack !== 'string') problems.push('stack must be a stack id (text).');
        if (props.value !== undefined && props.value !== null && !isRecord(props.value)) problems.push('value must be an item detail object.');
        return problems;
    },
    render: renderItemDetail,
});

// ---------------------------------------------------------------------------------------------------
// rpg-battle.character-file

/**
 * Hands `text` to the reader as a file called `fileName` (a Blob link clicked once). → true when it
 * was offered. Uses only the page's own objects; no network.
 */
export function saveTextFile(doc, fileName, text) {
    const view = doc?.defaultView ?? globalThis;
    const BlobType = view.Blob ?? globalThis.Blob;
    const urls = view.URL ?? globalThis.URL;
    if (typeof BlobType !== 'function' || typeof urls?.createObjectURL !== 'function') return false;
    const href = urls.createObjectURL(new BlobType([text], { type: 'application/json' }));
    const link = doc.createElement('a');
    link.href = href;
    link.setAttribute('download', fileName);
    link.hidden = true;
    (doc.body ?? doc.documentElement).appendChild(link);
    try {
        link.click?.();
    } finally {
        link.remove();
        setTimeout(() => urls.revokeObjectURL?.(href), 1000);
    }
    return true;
}

// A file name as party.export gives it, made safe for the file system: letters, digits, dot, dash.
const safeName = name => (str(name, 120).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'character.rpg-battle.json');

/**
 * render(el, props, api) → { update, destroy }. props: { label? }. The button previews party.export
 * (api.preview; falls back to api.command where a host has no preview) and saves the file; a refusal
 * ("Make your character first.") shows beside it. `api.saveFile(fileName, text)` replaces the save
 * (a host or a test).
 */
export function renderCharacterFile(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    ensureWidgetCss(doc);
    const root = make(doc, 'div', 'ss-w rpg-file');
    const button = make(doc, 'button', 'btn ghost rpg-file-go');
    button.type = 'button';
    const label = make(doc, 'span', '', str(props.label, 60) || 'Save character file');
    button.append(icon(doc, 'fa-file-export'), label);
    const note = make(doc, 'span', 'rpg-file-note');
    note.setAttribute('role', 'status');
    root.append(button, note);
    el.append(root);
    let busy = false;

    const say = (text, tone = '') => {
        note.textContent = text;
        if (tone) note.setAttribute('data-tone', tone);
        else note.removeAttribute('data-tone');
    };

    button.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        button.disabled = true;
        say('');
        try {
            const run = typeof api.preview === 'function' ? api.preview : typeof api.command === 'function' ? api.command : null;
            if (!run) return say('Saving a character file is not available here.', 'bad');
            const result = await run('party.export', {});
            const data = result?.receipt?.data;
            if (!result?.ok || !isRecord(data?.character)) return say(result?.message ?? 'The character file could not be made.', 'bad');
            const fileName = safeName(data.fileName);
            const text = JSON.stringify(data.character, null, 2);
            const saved = typeof api.saveFile === 'function' ? api.saveFile(fileName, text) !== false : saveTextFile(doc, fileName, text);
            say(saved ? `Saved as ${fileName}.` : 'This browser cannot save files here.', saved ? '' : 'bad');
        } catch (error) {
            say(error?.message ?? 'The character file could not be made.', 'bad');
        } finally {
            busy = false;
            button.disabled = false;
        }
    });

    return {
        update(next = {}) { label.textContent = str(next.label, 60) || 'Save character file'; },
        destroy() { root.remove(); },
    };
}

export const characterFileWidget = Object.freeze({
    props: Object.freeze({ label: Object.freeze({ type: 'string', required: false, default: '' }) }),
    validate(props = {}) {
        return props.label !== undefined && typeof props.label !== 'string' ? ['label must be text.'] : [];
    },
    render: renderCharacterFile,
});

/** The screens part's widgets, by name (MODULES §F9). */
export const screenWidgets = Object.freeze({
    [ITEM_DETAIL_WIDGET]: itemDetailWidget,
    [CHARACTER_FILE_WIDGET]: characterFileWidget,
});
