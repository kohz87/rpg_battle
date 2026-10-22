// Story Suite v2's two hosts for module UI (docs/v2/SPEC.md §6):
//
// - the settings host: one centred column of folds. Story Suite's own (the tail budget and the prompt
//   size: what Story Suite adds to the prompt, per module, against the tail budget, counted with
//   SillyTavern's tokenizer when there is one), the modules' own folds (Story Block's Packs), Features,
//   one fold per module with settings, Versions. Inside a module's fold: its Features, a sub-fold per
//   settings group (a field's `group`, else its label's "Group: …" prefix, else General) and its custom
//   `section`. Fields are rows (bool, int, choice, text, list of {…}; a list one compact line per item);
//   values are read and written through createSettings() (extension_settings.storySuite.modules[id]).
//   Open folds stay open across redraws. `openSettingsOverlay` puts it in a full-screen dialog that
//   scrolls.
//   Features (MODULES §F100): each module's fold opens with a "Features" subsection, a switch per
//   feature with its label and description, and one "Features" fold lists every module's; a feature
//   that changes the static prompt part says so (PROMPT_HINT). A settings field (`{ …, feature }`) or
//   custom panel (a function with `feature`) of a feature that is off is not drawn; a switch redraws. A
//   feature whose `needs` no installed module meets is drawn off and disabled, with its reason. The choices are the reader's
//   (createFeatureStore, extension_settings.storySuite.features), not the chat's.
// - the tab host: a tab bar with every module tab, each rendered from the head state's view.
//
// Every node is built with textContent; module names, labels and values are never markup.
// `doc` is the document to build in (tests pass a fake one).

import { FIELD_TYPES, normalizeField } from './registry.js';
import { HOST_SETTINGS_SCHEMA } from './sdk.js';
import { PROMPT_HINT, featureOf } from './features.js';
import { compatReport, renderCompat } from './compat.js';
import { scrollCue } from './view/scroll-cue.js';
import { DEFAULT_TAIL_BUDGET, estimateTokens } from './prompt.js';
import { fill } from './strings.js';
import { cutAt } from '../text.js';

export const OPEN_CLASS = 'story-suite-open';
export const HOST_FOLD = 'story-suite';
export const FEATURES_FOLD = 'story-suite-features';
export const VERSIONS_FOLD = 'story-suite-versions';
// Story Block's Packs fold (its `settings.folds`), second after Story Suite's; Home's "Import a pack" opens it.
export const PACKS_FOLD = 'story-block/packs';
// A sub-fold's key: its module's id, this, and the part ("rpg-battle::features", "story-director::group:Calendar").
export const SUB_FOLD = '::';
export const SETTINGS_TEXT = Object.freeze({
    hostHint: 'prompt and its size',
    general: 'General',
    more: 'More',
    settings: '{n} settings',
    oneSetting: '1 setting',
    featuresOn: '{on} of {n} on',
    listItem: 'item {n}',
    remove: 'Remove {name}',
    add: 'Add',
    addTitle: 'Add to {field}',
    size: Object.freeze({
        title: 'Prompt size',
        help: 'What Story Suite adds to the prompt of the next reply in this chat, counted now. Nothing is sent.',
        none: 'Open a chat to see what Story Suite adds to its prompt.',
        static: 'Instructions (the same every reply)',
        tail: 'This reply\'s part',
        total: 'In all',
        about: 'about {n} tokens',
        exact: '{n} tokens',
        ofBudget: '{size} of {budget}',
        perModule: 'Per module, in tokens',
        module: 'Module',
        staticShort: 'Instructions',
        tailShort: 'This reply',
        howAbout: 'Estimated at four characters a token. The budget is Notes per reply, above.',
        howExact: 'Counted with SillyTavern\'s tokenizer. The budget is Notes per reply, above.',
    }),
});
export const FEATURE_TEXT = Object.freeze({
    title: 'Features',
    overviewHint: 'every module',
    moduleHint: 'Turn a part of this module on or off. It applies to you, in every chat; what the story keeps for it stays.',
    overviewHelp: 'Every optional part of every module. It applies to you, in every chat; turning one off keeps what the story holds for it, so turning it on again brings it all back.',
});

function el(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== '' && text !== null && text !== undefined) node.textContent = String(text);
    return node;
}

function button(doc, className, text, title = '') {
    const node = el(doc, 'button', className, text);
    node.type = 'button';
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    return node;
}

const humanize = key => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, char => char.toUpperCase());
const optionsOf = field => (field.options ?? []).map(option => (option && typeof option === 'object' ? { value: String(option.value), label: String(option.label ?? option.value) } : { value: String(option), label: String(option) }));

/** The value a field starts from when it has no default. */
export function emptyValue(field) {
    const f = normalizeField(field);
    if (f.type === 'bool') return false;
    if (f.type === 'int') return Number.isInteger(f.min) ? f.min : 0;
    if (f.type === 'choice') return optionsOf(f)[0]?.value ?? '';
    if (f.type === 'list') return [];
    return '';
}

/** A whole number from what was typed, kept inside min/max; null when it is not one. */
export function readInt(text, field) {
    const value = Number(String(text).trim());
    if (!String(text).trim() || !Number.isFinite(value)) return null;
    let out = Math.round(value);
    if (Number.isInteger(field.min)) out = Math.max(field.min, out);
    if (Number.isInteger(field.max)) out = Math.min(field.max, out);
    return out;
}

// One control for one field; `onChange(value)` gets the new value.
function control(doc, field, value, onChange, id) {
    const f = normalizeField(field);
    if (f.type === 'bool') {
        const input = el(doc, 'input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        input.addEventListener('change', () => onChange(Boolean(input.checked)));
        return input;
    }
    if (f.type === 'choice') {
        const select = el(doc, 'select', 'text_pole');
        for (const option of optionsOf(f)) {
            const node = el(doc, 'option', '', option.label);
            node.value = option.value;
            select.appendChild(node);
        }
        select.value = String(value ?? '');
        select.addEventListener('change', () => onChange(select.value));
        return select;
    }
    if (f.type === 'int') {
        const input = el(doc, 'input', 'text_pole');
        input.type = 'number';
        if (Number.isInteger(f.min)) input.min = String(f.min);
        if (Number.isInteger(f.max)) input.max = String(f.max);
        input.step = '1';
        input.inputMode = 'numeric';
        input.value = String(value ?? '');
        input.addEventListener('change', () => {
            const next = readInt(input.value, f);
            // Not a number: the stored value stays, and is shown again.
            if (next === null) { input.value = String(value ?? ''); return; }
            input.value = String(next);
            value = next;
            onChange(next);
        });
        return input;
    }
    if (f.type === 'list') return listControl(doc, f, Array.isArray(value) ? value : [], onChange, id);
    const input = el(doc, f.multiline ? 'textarea' : 'input', 'text_pole');
    if (!f.multiline) input.type = 'text';
    // A text field's `max` holds for typing and pasting alike (settings.set cuts it there too).
    const max = Number.isInteger(f.max) && f.max >= 0 ? f.max : null;
    if (max !== null) input.maxLength = max;
    input.value = String(value ?? '');
    input.addEventListener('change', () => {
        if (max !== null && input.value.length > max) input.value = cutAt(input.value, max);
        onChange(input.value);
    });
    return input;
}

// What an item of a list is called on its Remove button: its first text field ("January"), else its place.
function itemName(item, subs, index) {
    for (const [key, sub] of subs) {
        const value = item?.[key];
        if (sub.type === 'text' && typeof value === 'string' && value.trim()) return cutAt(value.trim().replace(/\s+/g, ' '), 40);
    }
    return fill(SETTINGS_TEXT.listItem, { n: index + 1 });
}

// A list of {…}, compact: one line per item with its fields side by side (`[January ] [31] ×`), each
// input named by its field for screen readers (the column heads above say it for the eye), a small
// × to remove the item, and Add at the end. A sub-field of a type this Story Block does not know is
// not drawn; its value stays in the item.
function listControl(doc, field, items, onChange, id) {
    const root = el(doc, 'div', 'story-suite-list');
    root.setAttribute('role', 'group');
    let list = structuredClone(items);
    const subs = Object.entries(field.of ?? {})
        .map(([key, sub]) => [key, normalizeField(sub)])
        .filter(([, sub]) => FIELD_TYPES.includes(sub?.type) && sub.type !== 'list');
    const labelOf = (key, sub) => sub.label ?? humanize(key);
    const draw = (focusAt = null) => {
        root.replaceChildren();
        if (list.length && subs.length) {
            const head = el(doc, 'div', 'story-suite-list-head');
            head.setAttribute('aria-hidden', 'true');
            for (const [key, sub] of subs) {
                const cell = el(doc, 'span', 'story-suite-list-cell', labelOf(key, sub));
                cell.dataset.type = sub.type;
                head.appendChild(cell);
            }
            head.appendChild(el(doc, 'span', 'story-suite-list-spacer'));
            root.appendChild(head);
        }
        const removes = [];
        list.forEach((item, index) => {
            const row = el(doc, 'div', 'story-suite-list-item');
            row.dataset.index = String(index);
            for (const [key, sub] of subs) {
                const cell = el(doc, 'span', 'story-suite-list-cell');
                cell.dataset.field = key;
                cell.dataset.type = sub.type;
                const value = item && Object.hasOwn(item, key) ? item[key] : emptyValue(sub);
                const inputId = `${id}-${index}-${key}`.replace(/[^\w-]/g, '_');
                const input = control(doc, sub, value, next => {
                    list[index] = { ...list[index], [key]: next };
                    onChange(structuredClone(list));
                }, inputId);
                input.id = inputId;
                input.setAttribute('aria-label', `${labelOf(key, sub)}, ${fill(SETTINGS_TEXT.listItem, { n: index + 1 })}`);
                if (sub.type === 'text' || sub.type === 'int') input.placeholder = labelOf(key, sub);
                cell.appendChild(input);
                row.appendChild(cell);
            }
            const name = fill(SETTINGS_TEXT.remove, { name: itemName(item, subs, index) });
            const remove = button(doc, 'menu_button story-suite-list-remove', '', name);
            remove.appendChild(el(doc, 'span', '', '×')).setAttribute('aria-hidden', 'true');
            remove.addEventListener('click', () => {
                list = list.filter((_, at) => at !== index);
                onChange(structuredClone(list));
                // The focus goes to the next item's ×, else to Add, never to the page behind.
                draw(Math.min(index, list.length - 1));
            });
            removes.push(remove);
            row.appendChild(remove);
            root.appendChild(row);
        });
        const add = button(doc, 'menu_button story-suite-list-add', '', field.label ? fill(SETTINGS_TEXT.addTitle, { field: field.label }) : SETTINGS_TEXT.add);
        add.appendChild(el(doc, 'span', '', SETTINGS_TEXT.add));
        add.addEventListener('click', () => {
            list = [...list, Object.fromEntries(subs.map(([key, sub]) => [key, emptyValue(sub)]))];
            onChange(structuredClone(list));
            draw();
            [...root.querySelectorAll('.story-suite-list-item')].at(-1)?.querySelector('input, select, textarea')?.focus?.();
        });
        root.appendChild(add);
        if (focusAt !== null) (removes[focusAt] ?? add).focus?.();
    };
    draw();
    return root;
}

// `label.story-suite-row`: the label and its help on the left, the control on the right (stacked on a
// phone, host.css). A list's row is a `div` whose list group is named by the label.
function fieldRow(doc, key, field, value, onChange, prefix) {
    const f = normalizeField(field);
    // A type this Story Block does not know (a newer module's): hidden, its value left alone.
    if (!FIELD_TYPES.includes(f?.type)) {
        const hidden = el(doc, 'div', 'story-suite-row');
        hidden.dataset.field = key;
        hidden.hidden = true;
        return hidden;
    }
    const id = `${prefix}-${key}`.replace(/[^\w-]/g, '_');
    const row = el(doc, f.type === 'list' ? 'div' : 'label', 'story-suite-row');
    row.dataset.field = key;
    row.dataset.type = f.type;
    if (f.type !== 'list') row.setAttribute('for', id);
    const text = el(doc, 'span', 'story-suite-row-label');
    const name = el(doc, 'b', '', f.label ?? humanize(key));
    name.id = `${id}-label`;
    text.appendChild(name);
    if (f.help) text.appendChild(el(doc, 'small', '', f.help));
    row.appendChild(text);
    const input = control(doc, f, value, onChange, id);
    input.id = id;
    if (f.type === 'list') input.setAttribute('aria-labelledby', name.id);
    row.appendChild(input);
    return row;
}

// A fold: `details` with its summary (title, then a quiet hint). The chevron is CSS (host.css), so the
// summary's text is only the title and the hint. `className` tells the top folds from the sub-folds.
function fold(doc, key, title, hint = '', className = 'story-suite-fold') {
    const details = el(doc, 'details', className);
    details.dataset.fold = key;
    const summary = el(doc, 'summary');
    summary.appendChild(el(doc, 'b', '', title));
    if (hint) summary.appendChild(el(doc, 'small', '', hint));
    details.appendChild(summary);
    const body = el(doc, 'div', `${className}-body`);
    details.appendChild(body);
    return { details, body };
}

// "Calendar: Era (written before the year)" → group "Calendar", label "Era (…)". The part before the
// first ": " is a group only when it is short and has no brackets ("Money scale (0: the pack's)" has none).
const LABEL_PREFIX = /^([^:()[\]{}]{1,48}?):\s+(\S[\s\S]*)$/;

/**
 * A schema's fields in settings groups, in the order they first appear: [{ name, fields: [{ key, field }] }].
 * A field's group is its `group` (text), else its label's prefix ("Calendar: Era" → "Calendar", the label
 * then "Era"), else General. A label that starts with its own `group` loses that prefix too.
 */
export function groupFields(schema) {
    const groups = new Map();
    for (const [key, raw] of Object.entries(schema ?? {})) {
        const field = normalizeField(raw);
        const label = typeof field?.label === 'string' ? field.label.trim() : null;
        const match = label ? LABEL_PREFIX.exec(label) : null;
        const given = typeof field?.group === 'string' ? field.group.trim() : '';
        let name = SETTINGS_TEXT.general;
        let shown = label;
        if (given) {
            name = given;
            if (match && match[1].trim().toLowerCase() === given.toLowerCase()) shown = match[2];
        } else if (match) {
            name = match[1].trim();
            shown = match[2];
        }
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({ key, field: shown === label ? raw : { ...field, label: shown } });
    }
    return [...groups].map(([name, fields]) => ({ name, fields }));
}

/**
 * What Story Suite adds to the prompt, counted per module: `parts` as prompt.js assemble() gives them
 * ({ module, place, text }), `tokensOf(text)` → a number. → { modules: [{ id, name, static, tail }],
 * static, tail, total, budget }. The totals count the texts as sent (joined), the rows their own parts.
 */
export function promptSize(parts, { tokensOf = estimateTokens, names = id => id, budget = DEFAULT_TAIL_BUDGET } = {}) {
    const list = Array.isArray(parts) ? parts.filter(part => part && typeof part.text === 'string') : [];
    const rows = new Map();
    for (const part of list) {
        const id = String(part.module ?? '');
        if (!rows.has(id)) rows.set(id, { id, name: names(id), static: 0, tail: 0 });
        rows.get(id)[part.place === 'static' ? 'static' : 'tail'] += tokensOf(part.text);
    }
    const staticText = list.filter(part => part.place === 'static').map(part => part.text).join('\n\n');
    const tailText = list.filter(part => part.place !== 'static').map(part => part.text).filter(Boolean).join('\n');
    const stat = staticText ? tokensOf(staticText) : 0;
    const tail = tailText ? tokensOf(tailText) : 0;
    return { modules: [...rows.values()], static: stat, tail, total: stat + tail, budget };
}

// One feature's row: its switch, label, description and (when it changes the static prompt) the hint.
// A feature is drawn twice, so each switch's id is its place (`overview` or `module`) plus the feature id
// encoded whole (encodeURIComponent never makes two ids one, as flattening "a.b_c" and "a.b.c" would);
// its row labels that switch.
export const featureInputId = (place, id) => `story_suite_feature_${place}_${encodeURIComponent(String(id))}`;
function featureRow(doc, feature, onChange, place) {
    const id = featureInputId(place, feature.id);
    const row = el(doc, 'label', 'story-suite-row story-suite-feature');
    row.dataset.feature = feature.id;
    row.dataset.type = 'bool';
    row.setAttribute('for', id);
    const text = el(doc, 'span', 'story-suite-row-label');
    text.appendChild(el(doc, 'b', '', feature.label));
    if (feature.describe) text.appendChild(el(doc, 'small', '', feature.describe));
    if (feature.prompt) text.appendChild(el(doc, 'small', 'story-suite-feature-hint', PROMPT_HINT));
    // A feature whose `needs` no module meets: shown off, not switchable, with the reason.
    const unavailable = feature.available === false;
    if (unavailable) {
        row.classList.add('story-suite-feature-unavailable');
        text.appendChild(el(doc, 'small', 'story-suite-feature-why', feature.why));
    }
    row.appendChild(text);
    const input = el(doc, 'input');
    input.type = 'checkbox';
    input.id = id;
    input.setAttribute('role', 'switch');
    input.checked = feature.on === true && !unavailable;
    input.disabled = unavailable;
    input.setAttribute('aria-checked', String(input.checked));
    if (unavailable) input.setAttribute('aria-disabled', 'true');
    input.addEventListener('change', () => onChange(Boolean(input.checked)));
    row.appendChild(input);
    return row;
}

const FOLD_SELECTOR = 'details.story-suite-fold, details.story-suite-subfold';

/**
 * Renders the settings into `root` (emptied first), as one centred column of folds: Story Suite (the
 * host's own, with the prompt size), the modules' own folds (Story Block's Packs), Features, one fold
 * per module (its Features, then a sub-fold per settings group, then its custom panel) and Versions.
 *
 * `options`: { registry, settings (createSettings), doc?, sdk?, features? (createFeatureStore; without
 * it no Features are shown), promptParts?() (the parts of the prompt the next reply would get, as
 * prompt.js assemble() lists them; without it no prompt size is shown), countTokens?(text) (SillyTavern's
 * tokenizer, a number or a promise of one; without it the size is estimated at four characters a token),
 * openState? (a Map of fold key → open, kept across redraws; a new one by default) }.
 * A module's `section(el, api)` gets api = { get(key), set(key, value), values(), sdk } (a section
 * given as a title plus render(el, api) is the same panel). Returns { refresh(), refreshSize() }.
 */
export function renderSettingsHost(root, { registry, settings, doc = globalThis.document, sdk = null, features = null, promptParts = null, countTokens = null, openState = new Map() }) {
    const featureList = () => (features && typeof features.list === 'function' ? features.list() : []);
    // A settings field or panel under a feature that is off is not drawn (its stored value is kept).
    const hiddenByFeature = item => {
        const id = featureOf(item);
        return id !== null && typeof registry.featureOn === 'function' && !registry.featureOn(id);
    };
    // A fold opens as the reader left it (this redraw or an earlier one), else as `open` says.
    function remember(details, open = false) {
        const key = details.dataset.fold;
        details.open = openState.has(key) ? openState.get(key) === true : open;
        details.addEventListener('toggle', () => openState.set(key, details.open === true));
        return details;
    }
    const panelApi = moduleId => Object.freeze({
        get: key => settings(moduleId)[key],
        set: (key, value) => settings.set(moduleId, key, value),
        values: () => settings(moduleId),
        sdk,
    });
    // A switch changed: stored, then everything is drawn again (the fields of that feature come or go, both
    // rows of it show the choice, the prompt size follows), open folds stay open and the switch keeps the focus.
    function setFeature(id, on, inputId) {
        features.set(id, on);
        refresh();
        const again = [...root.querySelectorAll('.story-suite-feature input')].find(input => input.id === inputId);
        again?.focus?.();
    }
    function featureBlock(list, help) {
        const block = el(doc, 'div', 'story-suite-features');
        if (help) block.appendChild(el(doc, 'p', 'story-suite-muted', help));
        for (const feature of list) block.appendChild(featureRow(doc, feature, on => setFeature(feature.id, on, featureInputId('module', feature.id)), 'module'));
        return block;
    }
    function featuresFold(list) {
        const { details, body } = fold(doc, FEATURES_FOLD, FEATURE_TEXT.title, FEATURE_TEXT.overviewHint);
        body.appendChild(el(doc, 'p', 'story-suite-muted', FEATURE_TEXT.overviewHelp));
        const byModule = new Map();
        for (const feature of list) {
            if (!byModule.has(feature.moduleId)) byModule.set(feature.moduleId, []);
            byModule.get(feature.moduleId).push(feature);
        }
        for (const [moduleId, own] of byModule) {
            const group = el(doc, 'div', 'story-suite-subsection story-suite-feature-group');
            group.dataset.module = moduleId;
            group.appendChild(el(doc, 'h4', '', own[0].moduleName));
            for (const feature of own) group.appendChild(featureRow(doc, feature, on => setFeature(feature.id, on, featureInputId('overview', feature.id)), 'overview'));
            body.appendChild(group);
        }
        return remember(details);
    }
    const settingsCount = n => fill(n === 1 ? SETTINGS_TEXT.oneSetting : SETTINGS_TEXT.settings, { n });
    function moduleFold(def, own = []) {
        const { details, body } = fold(doc, def.moduleId, def.name, def.title !== def.name ? def.title : def.moduleId);
        const values = settings(def.moduleId);
        const subs = [];
        if (own.length) {
            const on = own.filter(feature => feature.on === true && feature.available !== false).length;
            subs.push({ key: 'features', title: FEATURE_TEXT.title, hint: fill(SETTINGS_TEXT.featuresOn, { on, n: own.length }), open: true, draw: into => into.appendChild(featureBlock(own, FEATURE_TEXT.moduleHint)) });
        }
        const shown = Object.fromEntries(Object.entries(def.schema).filter(([, field]) => !hiddenByFeature(field)));
        for (const group of groupFields(shown)) {
            const visible = group.fields.filter(({ field }) => FIELD_TYPES.includes(normalizeField(field)?.type));
            if (!visible.length) continue;
            subs.push({
                key: `group:${group.name}`,
                title: group.name,
                hint: settingsCount(visible.length),
                draw: into => {
                    for (const { key, field } of group.fields) {
                        const value = Object.hasOwn(values, key) ? values[key] : emptyValue(field);
                        into.appendChild(fieldRow(doc, key, field, value, next => settings.set(def.moduleId, key, next), `story_suite_${def.moduleId}`));
                    }
                },
            });
        }
        if (def.section && !hiddenByFeature(def.section)) {
            subs.push({
                key: 'section',
                title: def.title !== def.name ? def.title : SETTINGS_TEXT.more,
                hint: '',
                draw: into => {
                    const section = el(doc, 'div', 'story-suite-section');
                    section.dataset.module = def.moduleId;
                    try { def.section(section, panelApi(def.moduleId)); } catch (error) {
                        section.replaceChildren(el(doc, 'p', 'story-suite-muted', `This part of ${def.name}'s settings could not be shown: ${error?.message ?? error}`));
                    }
                    into.appendChild(section);
                },
            });
        }
        // Each part in a sub-fold of its own; one alone opens with its module.
        for (const sub of subs) {
            const inner = fold(doc, `${def.moduleId}${SUB_FOLD}${sub.key}`, sub.title, sub.hint, 'story-suite-subfold');
            sub.draw(inner.body);
            body.appendChild(remember(inner.details, sub.open === true || subs.length === 1));
        }
        return remember(details);
    }
    // A module's own top-level folds (`settings.folds`: Story Block's Packs), drawn even with nothing in them.
    function ownFolds(def) {
        return def.folds.map(item => {
            const { details, body } = fold(doc, `${def.moduleId}/${item.id}`, item.title, item.hint);
            details.classList.add(`story-suite-fold-${item.id}`);
            try { item.render(body, panelApi(def.moduleId)); } catch (error) {
                body.replaceChildren(el(doc, 'p', 'story-suite-muted', `This part of ${def.name}'s settings could not be shown: ${error?.message ?? error}`));
            }
            return remember(details);
        });
    }

    // ---- the prompt size (Story Suite's fold) ----------------------------------------------------
    let sizeRun = 0;
    const moduleName = id => (id === 'story-suite' ? 'Story Suite' : registry.module?.(id)?.name ?? id);
    const tailBudget = () => {
        const value = settings()?.tailBudget;
        return Number.isInteger(value) && value > 0 ? value : DEFAULT_TAIL_BUDGET;
    };
    function paintSize(block, size, exact) {
        const T = SETTINGS_TEXT.size;
        const amount = n => fill(exact ? T.exact : T.about, { n: n.toLocaleString('en-US') });
        const list = el(doc, 'ul', 'story-suite-size-sum');
        const line = (label, value, className = '') => {
            const item = el(doc, 'li', className);
            item.append(el(doc, 'span', '', label), el(doc, 'b', 'story-suite-size-n', value));
            list.appendChild(item);
            return item;
        };
        line(T.static, amount(size.static));
        const tail = line(T.tail, fill(T.ofBudget, { size: amount(size.tail), budget: size.budget.toLocaleString('en-US') }), 'story-suite-size-tail');
        const meter = el(doc, 'meter', 'story-suite-size-meter');
        meter.min = 0;
        meter.max = size.budget;
        meter.value = Math.min(size.tail, size.budget);
        meter.setAttribute('aria-label', T.tail);
        tail.appendChild(meter);
        if (size.tail > size.budget) tail.classList.add('story-suite-size-over');
        line(T.total, amount(size.total), 'story-suite-size-total');
        const table = el(doc, 'table', 'story-suite-size-table');
        table.appendChild(el(doc, 'caption', '', T.perModule));
        const head = el(doc, 'tr');
        for (const name of [T.module, T.staticShort, T.tailShort]) {
            const cell = el(doc, 'th', '', name);
            cell.setAttribute('scope', 'col');
            head.appendChild(cell);
        }
        const thead = el(doc, 'thead');
        thead.appendChild(head);
        const tbody = el(doc, 'tbody');
        for (const row of size.modules) {
            const tr = el(doc, 'tr');
            tr.dataset.module = row.id;
            const name = el(doc, 'th', '', row.name);
            name.setAttribute('scope', 'row');
            tr.append(name, el(doc, 'td', '', row.static.toLocaleString('en-US')), el(doc, 'td', '', row.tail.toLocaleString('en-US')));
            tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        block.dataset.exact = String(exact);
        block.replaceChildren(
            el(doc, 'h4', '', T.title),
            el(doc, 'p', 'story-suite-muted', T.help),
            list,
            table,
            el(doc, 'p', 'story-suite-muted story-suite-size-how', exact ? T.howExact : T.howAbout),
        );
    }
    function drawSize(block) {
        const run = ++sizeRun;
        let parts = null;
        try { parts = promptParts(); } catch { parts = null; }
        if (!Array.isArray(parts)) {
            block.replaceChildren(el(doc, 'h4', '', SETTINGS_TEXT.size.title), el(doc, 'p', 'story-suite-muted', SETTINGS_TEXT.size.none));
            return;
        }
        const budget = tailBudget();
        const names = moduleName;
        paintSize(block, promptSize(parts, { names, budget }), false);
        if (typeof countTokens !== 'function') return;
        // SillyTavern's tokenizer: every text counted once, then the same sums with its numbers.
        const texts = [...new Set([
            ...parts.map(part => String(part?.text ?? '')),
            parts.filter(part => part?.place === 'static').map(part => part.text).join('\n\n'),
            parts.filter(part => part?.place !== 'static').map(part => part.text).filter(Boolean).join('\n'),
        ])];
        Promise.all(texts.map(text => Promise.resolve().then(() => countTokens(text))))
            .then(counts => {
                if (run !== sizeRun || !counts.every(n => Number.isFinite(n) && n >= 0)) return;
                const known = new Map(texts.map((text, at) => [text, Math.round(counts[at])]));
                paintSize(block, promptSize(parts, { names, budget, tokensOf: text => known.get(text) ?? estimateTokens(text) }), true);
            })
            .catch(() => { /* the estimate stays */ });
    }
    function refreshSize() {
        const block = root.querySelector('.story-suite-size');
        if (block && typeof promptParts === 'function') drawSize(block);
    }

    function hostFold() {
        const { details, body } = fold(doc, HOST_FOLD, 'Story Suite', SETTINGS_TEXT.hostHint);
        const values = settings();
        for (const [key, field] of Object.entries(HOST_SETTINGS_SCHEMA)) {
            body.appendChild(fieldRow(doc, key, field, values[key], next => {
                settings.set(null, key, next);
                if (key === 'tailBudget') refreshSize();
            }, 'story_suite_host'));
        }
        if (typeof promptParts === 'function') {
            const block = el(doc, 'div', 'story-suite-subsection story-suite-size');
            block.setAttribute('aria-live', 'polite');
            body.appendChild(block);
            drawSize(block);
        }
        return remember(details);
    }
    // Versions (compat.js): each module, its version, the Story Block it needs, and what is out of step.
    function versionsFold() {
        const report = compatReport({ hostVersion: registry.hostVersion?.() ?? '', modules: registry.modules(), refusals: registry.refusals?.() ?? [] });
        const { details, body } = fold(doc, VERSIONS_FOLD, 'Versions', report.outOfStep ? `${report.outOfStep} out of step` : 'all in step');
        if (report.outOfStep) details.classList.add('story-suite-fold-warn');
        renderCompat(body, report, { doc });
        return remember(details);
    }
    function refresh() {
        for (const node of root.querySelectorAll(FOLD_SELECTOR)) openState.set(node.dataset.fold, node.open === true);
        root.replaceChildren();
        root.classList.add('story-suite-folds');
        const all = featureList();
        const ownOf = moduleId => all.filter(feature => feature.moduleId === moduleId);
        // A module with features gets its fold even without settings of its own.
        const defs = registry.settingsDefs().map(def => ({ ...def, folds: Array.isArray(def.folds) ? def.folds : [] }));
        const extra = [...new Set(all.map(feature => feature.moduleId))]
            .filter(moduleId => !defs.some(def => def.moduleId === moduleId))
            .map(moduleId => {
                const name = all.find(feature => feature.moduleId === moduleId).moduleName;
                return { moduleId, name, title: name, schema: {}, section: null, folds: [] };
            });
        const byId = (a, b) => (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0);
        const modules = [...defs, ...extra]
            .filter(def => Object.keys(def.schema).length || def.section || ownOf(def.moduleId).length)
            .sort(byId)
            .map(def => moduleFold(def, ownOf(def.moduleId)));
        const own = [...defs].sort(byId).flatMap(def => ownFolds(def));
        for (const node of [hostFold(), ...own, ...(all.length ? [featuresFold(all)] : []), ...modules, versionsFold()]) root.appendChild(node);
    }
    refresh();
    return { refresh, refreshSize };
}

// One overlay's folds stay as the reader left them when it is opened again (this page load).
const overlayOpenState = new Map();
let currentOverlay = null;

/**
 * Opens the settings in a full-screen dialog on `doc.body`: a header with Close, and below it one
 * scrolling area with the settings in a centred column. `<body>` carries `story-suite-open` while it is
 * open; Escape and Close close it and the focus goes back where it was. `fold`: a fold key to open and
 * bring into view (PACKS_FOLD for Home's "Import a pack"). The other options are renderSettingsHost's.
 * Returns { root, close(), refresh(), refreshSize(), isOpen() }.
 */
export function openSettingsOverlay({ registry, settings, doc = globalThis.document, sdk = null, features = null, promptParts = null, countTokens = null, fold: target = null, openState = overlayOpenState, onClose = null }) {
    // One overlay at a time: opening it again closes the one there (its listeners with it).
    if (currentOverlay?.root?.ownerDocument === doc) currentOverlay.close();
    doc.querySelector?.('#story_suite_v2_overlay')?.remove();
    const before = doc.activeElement ?? null;
    const overlay = el(doc, 'div', 'story-suite-overlay');
    overlay.id = 'story_suite_v2_overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'story_suite_v2_overlay_title');
    const header = el(doc, 'div', 'story-suite-overlay-header');
    const title = el(doc, 'b', 'story-suite-overlay-title', 'Story Suite');
    title.id = 'story_suite_v2_overlay_title';
    header.appendChild(title);
    const close = button(doc, 'menu_button story-suite-close', 'Close', 'Close Story Suite');
    header.appendChild(close);
    const scroller = el(doc, 'div', 'story-suite-scroll');
    const body = el(doc, 'div', 'story-suite-panel');
    scroller.appendChild(body);
    overlay.append(header, scroller);
    doc.body.appendChild(overlay);
    doc.body.classList.add(OPEN_CLASS);
    if (typeof target === 'string' && target) {
        openState.set(target, true);
        // A sub-fold opens its module's fold too.
        if (target.includes(SUB_FOLD)) openState.set(target.split(SUB_FOLD)[0], true);
    }
    const host = renderSettingsHost(body, { registry, settings, doc, sdk, features, promptParts, countTokens, openState });
    let open = true;
    // The focus stays in the dialog: a Tab that would leave it, or a click on the page behind, comes back.
    const onFocus = event => {
        if (open && event?.target && !overlay.contains(event.target)) close.focus?.();
    };
    const onKey = event => {
        if (event?.key !== 'Escape') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        api.close();
    };
    overlay.addEventListener('keydown', onKey);
    doc.addEventListener?.('focusin', onFocus, true);
    const api = {
        root: overlay,
        refresh: host.refresh,
        refreshSize: host.refreshSize,
        isOpen: () => open,
        close() {
            if (!open) return;
            open = false;
            if (currentOverlay === api) currentOverlay = null;
            doc.removeEventListener?.('focusin', onFocus, true);
            overlay.remove();
            doc.body.classList.remove(OPEN_CLASS);
            try { onClose?.(); } catch { /* the overlay is closed either way */ }
            if (before && before !== doc.body && before.isConnected !== false) before.focus?.();
        },
    };
    close.addEventListener('click', () => api.close());
    currentOverlay = api;
    const wanted = target ? [...body.querySelectorAll(FOLD_SELECTOR)].find(node => node.dataset.fold === target) : null;
    if (wanted) {
        wanted.scrollIntoView?.({ block: 'start' });
        wanted.querySelector('summary')?.focus?.();
    } else close.focus?.();
    return api;
}

/**
 * The tab bar in `root`: a button per module tab (registry.tabs(), module-id order) and one
 * pane, the chosen tab's, rendered with `tab.render(pane, view, api)`. `options`: { registry,
 * view: () => view, api (the sdk), doc?, active? }. Tabs read the head state's view only, never
 * message text. Returns { refresh(), select(id), active() }.
 */
export function createTabHost(root, { registry, view, api = null, doc = globalThis.document, active = null }) {
    let current = active;
    const bar = el(doc, 'div', 'story-suite-tabs');
    bar.setAttribute('role', 'tablist');
    const pane = el(doc, 'div', 'story-suite-pane');
    pane.setAttribute('role', 'tabpanel');
    root.replaceChildren(bar, pane);
    // Tabs that do not fit scroll sideways; the edge with more of them fades (scroll-cue.js).
    const cue = scrollCue(bar, { win: doc.defaultView ?? globalThis });

    function draw() {
        const tabs = registry.tabs();
        if (!tabs.some(tab => tab.id === current)) current = tabs[0]?.id ?? null;
        bar.replaceChildren();
        for (const tab of tabs) {
            const node = button(doc, `story-suite-tab${tab.id === current ? ' active' : ''}`, '', tab.title);
            node.dataset.tabId = tab.id;
            node.setAttribute('role', 'tab');
            node.setAttribute('aria-selected', String(tab.id === current));
            if (tab.icon) {
                const glyph = el(doc, 'i', `fa-solid ${tab.icon}`);
                glyph.setAttribute('aria-hidden', 'true');
                node.appendChild(glyph);
            }
            node.appendChild(el(doc, 'span', 'story-suite-tab-label', tab.title));
            node.addEventListener('click', () => select(tab.id));
            bar.appendChild(node);
        }
        cue.update();
        pane.replaceChildren();
        const tab = tabs.find(item => item.id === current);
        pane.dataset.tabId = tab?.id ?? '';
        if (!tab) {
            pane.appendChild(el(doc, 'p', 'story-suite-muted', 'No module has a tab yet.'));
            return;
        }
        try { tab.render(pane, view(), api); } catch (error) {
            pane.replaceChildren(el(doc, 'p', 'story-suite-muted', `${tab.title} could not be shown: ${error?.message ?? error}`));
        }
    }
    function select(id) {
        current = id;
        draw();
    }
    draw();
    return { refresh: draw, select, active: () => current };
}
