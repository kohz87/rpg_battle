// The widget `rpg-battle.choice-pick` (MODULES §F9, §F12; WIDGETS.md contract): the creation wizard's
// race and talent cards as real buttons with aria-pressed. Clicking a card picks it; clicking the picked
// card again un-picks it (a race goes back to none, a talent is taken off). It writes the dialog's draft
// only (`race` or `talents`), never the state: creation.finish checks every rule.
//
// Why not radios and checkboxes in the template: SillyTavern's DOMPurify drops an <input>'s `type`, so
// they came out as text boxes showing the draft's raw race id (pack.ersveil-bluewatch/human) on every
// card. Buttons have no such attribute to lose.
//
// A card shows a picture only when the record has an `image` that is an https: or data:image address
// and it loads; otherwise there is no picture box at all (never an id or alt text in its place). Built
// with createElement and textContent only: nothing from data is read as markup.
//
// props: { value (bound list of choices), field: 'race' | 'talents', many (talents), picked (the draft's
//          value, so the widget redraws when it changes), left (points left, talents), max (talents),
//          label }

export const CHOICE_WIDGET = 'rpg-battle.choice-pick';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 500) => (typeof value === 'string' ? Array.from(value).slice(0, max).join('') : '');
const FIELDS = ['race', 'talents'];

/** An image address a card may show: https: or a PNG/JPEG/GIF/WebP data URL; '' for anything else (a pack id, a relative path). */
export function cardImage(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    if (!url || url.length > 4096) return '';
    const flat = url.replace(/[\u0000- \u007f]+/g, '').toLowerCase();
    if (flat.startsWith('https:')) return url;
    if (/^data:image\/(?:png|jpe?g|gif|webp)[;,]/.test(flat)) return url;
    return '';
}

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function draftApi(api) {
    if (isRecord(api?.draft) && typeof api.draft.set === 'function') return api.draft;
    if (typeof api?.onDraft === 'function') return { set: (path, value) => api.onDraft(path, value), get: () => undefined };
    return null;
}

/** The ids picked now: props.picked when given (the template passes the draft's value), else the draft. */
function pickedIds(props, api, many) {
    let value = props.picked;
    if (value === undefined) {
        try { value = draftApi(api)?.get?.(props.field); } catch { value = undefined; }
    }
    if (many) return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
    return typeof value === 'string' && value ? [value] : [];
}

/**
 * What a click on choice `id` makes the draft field: one → the id, or '' when it was the picked one;
 * many → the list with the id added, or taken off when it was in it. Pure.
 */
export function toggled(current, id, many) {
    if (!many) return current === id ? '' : id;
    const list = Array.isArray(current) ? current.filter(entry => typeof entry === 'string') : [];
    return list.includes(id) ? list.filter(entry => entry !== id) : [...list, id];
}

const asNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** render(el, props, api) → { update(nextProps), destroy() }. */
export function renderChoicePick(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'ss-w rpg-choices');
    root.setAttribute('role', 'group');
    el.append(root);
    let current = { ...props };

    function write(id) {
        const field = FIELDS.includes(current.field) ? current.field : 'race';
        const many = Boolean(current.many);
        const draft = draftApi(api);
        if (!draft) return;
        const now = many ? pickedIds(current, api, true) : (pickedIds(current, api, false)[0] ?? '');
        const next = toggled(now, id, many);
        // Picked at once, before the dialog redraws, so a quick second click reads the new value.
        current = { ...current, picked: next };
        try { draft.set(field, next); } catch { /* the dialog reports its own problems */ }
        draw();
    }

    function draw() {
        // The cards are built again at each pick: the one that had the keyboard focus gets it back (Enter or Space, then Tab on).
        const held = root.contains?.(doc.activeElement) ? doc.activeElement?.getAttribute?.('data-choice') ?? null : null;
        root.textContent = '';
        const many = Boolean(current.many);
        root.setAttribute('aria-label', str(current.label, 80) || (many ? 'Talents' : 'Race'));
        // Races and talents are the same grid of cards (the screen's css lays it out).
        root.classList.toggle('rpg-choices-rows', many);
        const list = (Array.isArray(current.value) ? current.value : []).filter(record => isRecord(record) && typeof record.id === 'string' && !record.rolled);
        const picked = new Set(pickedIds(current, api, many));
        const left = asNumber(current.left);
        const max = asNumber(current.max);
        const full = many && max !== null && picked.size >= max;
        for (const choice of list) {
            const on = picked.has(choice.id);
            const card = make(doc, 'button', `cc-card ${many ? 'cc-row' : 'cc-tile'}${on ? ' cc-picked' : ''}`);
            card.type = 'button';
            card.setAttribute('aria-pressed', on ? 'true' : 'false');
            card.setAttribute('data-choice', str(choice.id, 120));
            const cost = Number.isInteger(choice.cost) ? choice.cost : null;
            // A talent that would go past the budget or the most talents cannot be added; one picked can always come off.
            const blocked = many && !on && (full || (left !== null && cost !== null && cost > left));
            if (blocked) {
                card.disabled = true;
                card.title = full ? `You have the most talents a new character can take (${max}).` : `Not enough points left (${cost} needed).`;
            }
            // The card: the name with the "Taken"/"Chosen" pill on its right, the stat line (accent), the note (muted), and the cost
            // at the bottom right. On a phone the cost moves into the stat line ("+1 INT · 1 pt"): the screen's css shows one of the two.
            const head = make(doc, 'span', 'cc-card-head');
            head.append(make(doc, 'span', 'cc-card-name', str(choice.name, 80)));
            if (on) head.append(make(doc, 'span', 'cc-card-tick', many ? 'Taken' : 'Chosen'));
            card.append(head);
            // A picture only when the record has a real one, and only while it loads: no empty box.
            const image = cardImage(choice.image);
            if (image) {
                const img = make(doc, 'img', 'cc-card-img');
                img.setAttribute('alt', '');
                img.setAttribute('loading', 'lazy');
                img.setAttribute('referrerpolicy', 'no-referrer');
                img.addEventListener('error', () => img.remove());
                img.setAttribute('src', image);
                card.append(img);
            }
            const bonus = str(choice.bonus, 120);
            if (bonus || cost !== null) {
                const line = make(doc, 'span', 'cc-card-bonus', bonus);
                if (cost !== null) line.append(make(doc, 'span', 'cc-card-cost-inline', `${bonus ? ' · ' : ''}${cost} pt`));
                card.append(line);
            }
            if (str(choice.note)) card.append(make(doc, 'span', 'cc-card-note', str(choice.note)));
            if (cost !== null) card.append(make(doc, 'span', 'cc-card-cost', `${cost} pt`));
            card.addEventListener('click', () => write(choice.id));
            root.append(card);
        }
        if (held !== null) Array.from(root.children).find(card => card.getAttribute?.('data-choice') === held)?.focus?.();
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

export const choicePick = Object.freeze({
    props: Object.freeze({
        value: Object.freeze({ type: 'array', required: false, default: [] }),
        field: Object.freeze({ type: 'string', required: false, default: 'race' }),
        many: Object.freeze({ type: 'boolean', required: false, default: false }),
        label: Object.freeze({ type: 'string', required: false, default: '' }),
    }),
    validate(props = {}) {
        const problems = [];
        if (props.value !== undefined && !Array.isArray(props.value)) problems.push('value must be a list of choices.');
        if (props.field !== undefined && !FIELDS.includes(props.field)) problems.push(`field must be ${FIELDS.join(' or ')}.`);
        return problems;
    },
    render: renderChoicePick,
});
