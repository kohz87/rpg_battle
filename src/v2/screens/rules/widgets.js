// RPG Battle v2, screens for the rules-v2 views (track C): three small widgets (WIDGETS.md: render(el, props, api) →
// { update, destroy }), built with createElement and textContent only, so nothing from data is ever read as markup.
//
//   rpg-battle.permanent-choice  a choice that cannot be undone (a promotion, a path step): options as pressable
//                                buttons, NONE chosen at the start, a warning, and a Confirm button that stays disabled
//                                until the reader has chosen. Confirm sends `command` with { ...base, [field]: chosen }.
//                                The widget never picks for the reader; when the options change under it, a choice that
//                                is no longer offered is dropped, never replaced.
//   rpg-battle.class-pick        a single choice written to the creation draft (the basic class; the check actor), the
//                                way the wizard's own cards do (api.draft.set), pressable again to clear it.
//   rpg-battle.command-button    one button that sends `command` with the exact `payload` the view built (so a name with a
//                                quote in it is never mangled by a template hole), and says plainly when it was refused.
//   rpg-battle.command-input     one line of text (or a number) and a button that sends `command` with the value put
//                                at `valueAt` in `payload` (a region's name, a danger tier).
//   rpg-battle.trainer-binding   "Make this a trainer" (RB open trainers §10.2): a person who is present, a trainer template, one box for each
//                                of the template's skills (all ticked; unticking narrows, nothing can be added) and what they teach, sent
//                                as `trainer.open` through the refusal-reporting command button.
//
// props.value is each widget's spec (the template binds it with data-props='{"bind":"…"}').

import { failureLine } from './format.js';

export const PERMANENT_CHOICE_WIDGET = 'rpg-battle.permanent-choice';
export const CLASS_PICK_WIDGET = 'rpg-battle.class-pick';
export const COMMAND_INPUT_WIDGET = 'rpg-battle.command-input';
export const COMMAND_BUTTON_WIDGET = 'rpg-battle.command-button';
export const SHOW_MORE_WIDGET = 'rpg-battle.show-more';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 240) => (typeof value === 'string' ? Array.from(value).slice(0, max).join('') : '');

function make(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

const specOf = props => (isRecord(props?.value) ? props.value : isRecord(props) ? props : {});
const optionsOf = spec => (Array.isArray(spec.options) ? spec.options : [])
    .filter(option => isRecord(option) && typeof option.id === 'string' && option.id)
    .map(option => ({ id: str(option.id, 200), label: str(option.label, 80) || str(option.id, 80), sub: str(option.sub, 120) }));

/** What a finished choice says: from the command's own receipt result when it carries one, else a plain line. */
export function choiceOutcomeText(command, label, result) {
    const done = result?.receipt?.data?.v2?.result ?? result?.data ?? null;
    if (command === 'class.choose') {
        const skills = Array.isArray(done?.skills) ? done.skills.length : 3;
        return `Promoted to ${label}. ${skills === 3 ? 'All three skills were swapped' : 'Your skills were swapped'}; each starts at 0 / 5.`;
    }
    if (command === 'path.choose') return `Path chosen: ${label}.`;
    return `Done: ${label}.`;
}

// ---- rpg-battle.permanent-choice -------------------------------------------------------------------------------------

export function renderPermanentChoice(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'rpg-pc');
    root.setAttribute('role', 'group');
    const title = make(doc, 'p', 'rpg-pc-title');
    const list = make(doc, 'div', 'rpg-pc-options');
    const warning = make(doc, 'p', 'rpg-pc-warning');
    const confirm = make(doc, 'button', 'ss-button ss-button-primary rpg-pc-confirm');
    confirm.setAttribute('type', 'button');
    const status = make(doc, 'p', 'rpg-pc-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const problem = make(doc, 'p', 'rpg-pc-problem');
    problem.setAttribute('role', 'alert');
    root.append(title, list, warning, confirm, status, problem);
    el.append(root);

    let spec = specOf(props);
    let options = optionsOf(spec);
    let signature = '';
    let picked = '';
    let busy = false;
    const nodes = new Map();

    function refresh() {
        for (const [id, node] of nodes) {
            const on = id === picked;
            node.setAttribute('aria-pressed', on ? 'true' : 'false');
            node.className = `rpg-pc-option${on ? ' picked' : ''}`;
            node.disabled = busy;
        }
        confirm.disabled = busy || !picked || !str(spec.command);
        confirm.setAttribute('aria-disabled', confirm.disabled ? 'true' : 'false');
    }

    function build() {
        const next = JSON.stringify([spec.command, spec.field, spec.label, spec.heading, spec.confirm, spec.warning, options]);
        if (next === signature) return;
        signature = next;
        if (picked && !options.some(option => option.id === picked)) picked = '';
        // The page already names the step; a heading shows only when the spec gives one (the label is for assistive tech).
        title.textContent = str(spec.heading, 120);
        title.hidden = !title.textContent;
        warning.textContent = str(spec.warning, 240);
        confirm.textContent = str(spec.confirm, 40) || 'Confirm';
        nodes.clear();
        list.replaceChildren(...options.map(option => {
            const node = make(doc, 'button', 'rpg-pc-option');
            node.setAttribute('type', 'button');
            node.setAttribute('data-choice', option.id);
            node.append(make(doc, 'span', 'rpg-pc-label', option.label));
            if (option.sub) node.append(make(doc, 'span', 'rpg-pc-sub', option.sub));
            node.addEventListener('click', () => {
                if (busy) return;
                picked = picked === option.id ? '' : option.id;
                status.textContent = '';
                problem.textContent = '';
                refresh();
            });
            nodes.set(option.id, node);
            return node;
        }));
        root.setAttribute('aria-label', str(spec.label, 120) || 'Choice');
    }

    async function send() {
        if (busy || !picked || typeof api?.command !== 'function') return;
        const chosen = options.find(option => option.id === picked);
        const payload = { ...(isRecord(spec.base) ? spec.base : {}), [str(spec.field, 40) || 'choice']: picked };
        busy = true;
        status.textContent = '';
        problem.textContent = '';
        refresh();
        let result;
        try { result = await api.command(str(spec.command, 80), payload); } catch { result = { ok: false, code: 'FAILED', message: '' }; }
        busy = false;
        if (result?.ok === false) problem.textContent = failureLine(result);
        else {
            status.textContent = choiceOutcomeText(spec.command, chosen?.label ?? picked, result);
            picked = '';
        }
        refresh();
    }
    confirm.addEventListener('click', send);

    build();
    refresh();
    return {
        update(next = {}) {
            spec = specOf(next);
            options = optionsOf(spec);
            build();
            refresh();
        },
        destroy() { root.remove(); },
    };
}

// ---- rpg-battle.class-pick -------------------------------------------------------------------------------------------

function draftApi(api) {
    if (isRecord(api?.draft) && typeof api.draft.set === 'function') return api.draft;
    if (typeof api?.onDraft === 'function') return { set: (path, value) => api.onDraft(path, value), get: () => undefined };
    return null;
}

export function renderClassPick(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'rpg-cp');
    root.setAttribute('role', 'group');
    el.append(root);
    let spec = specOf(props);
    // The draft's value comes beside the spec (data-props '{"bind":"…","picked":"{{ draft.class }}"}'), or inside it.
    const pickedIn = (given, own) => (typeof given?.picked === 'string' ? given.picked : typeof own.picked === 'string' ? own.picked : '');
    let picked = pickedIn(props, spec);

    function write(id) {
        const draft = draftApi(api);
        if (!draft) return;
        picked = picked === id ? '' : id;
        try { draft.set(str(spec.field, 40) || 'class', spec.field === 'checkActor' && !picked ? null : picked); } catch { /* the dialog reports its own problems */ }
        draw();
    }

    function draw() {
        const options = optionsOf(spec);
        // The rows are built again at each pick: the one that had the keyboard focus gets it back (Enter or Space, then Tab on).
        const held = root.contains?.(doc.activeElement) ? doc.activeElement?.getAttribute?.('data-choice') ?? null : null;
        root.setAttribute('aria-label', str(spec.label, 80) || 'Choose one');
        root.replaceChildren(...options.map(option => {
            const on = option.id === picked;
            // A card like the wizard's race and talent cards (`cc-card`, styled where the wizard's css is): the name with the "Chosen"
            // pill on its right, the sub (a class's three skills) under it. The rpg-cp-* classes style it elsewhere.
            const card = make(doc, 'button', `rpg-cp-card cc-card cc-row${on ? ' picked' : ''}`);
            card.setAttribute('type', 'button');
            card.setAttribute('aria-pressed', on ? 'true' : 'false');
            card.setAttribute('data-choice', option.id);
            const head = make(doc, 'span', 'cc-card-head');
            head.append(make(doc, 'span', 'rpg-cp-name cc-card-name', option.label));
            if (on) head.append(make(doc, 'span', 'rpg-cp-tick cc-card-tick', 'Chosen'));
            card.append(head);
            if (option.sub) card.append(make(doc, 'span', 'rpg-cp-sub cc-card-note', option.sub));
            card.addEventListener('click', () => write(option.id));
            return card;
        }));
        if (!options.length) root.replaceChildren(make(doc, 'p', 'rpg-cp-none cc-none', str(spec.empty, 160) || 'Nothing to choose from.'));
        if (held !== null) Array.from(root.children).find(card => card.getAttribute?.('data-choice') === held)?.focus?.();
    }
    draw();
    return {
        update(next = {}) {
            spec = specOf(next);
            picked = pickedIn(next, spec);
            draw();
        },
        destroy() { root.remove(); },
    };
}

// ---- rpg-battle.command-input ----------------------------------------------------------------------------------------

/** A copy of `payload` with `value` put at the dotted `path` (`name`, or `policy.tier`). */
export function putAt(payload, path, value) {
    const copy = JSON.parse(JSON.stringify(isRecord(payload) ? payload : {}));
    const keys = String(path).split('.').filter(Boolean);
    if (!keys.length || keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) return copy;
    let at = copy;
    for (const key of keys.slice(0, -1)) {
        if (!isRecord(at[key])) at[key] = {};
        at = at[key];
    }
    at[keys[keys.length - 1]] = value;
    return copy;
}

export function renderCommandInput(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'form', 'rpg-ci');
    const label = make(doc, 'label', 'rpg-ci-label');
    const input = make(doc, 'input', 'rpg-ci-input');
    const go = make(doc, 'button', 'ss-button rpg-ci-go');
    go.setAttribute('type', 'submit');
    const status = make(doc, 'p', 'rpg-ci-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(label, input, go, status);
    el.append(root);
    let spec = specOf(props);
    let busy = false;

    function paint() {
        label.textContent = str(spec.label, 80);
        go.textContent = str(spec.submit, 30) || 'Save';
        input.setAttribute('type', spec.numeric ? 'number' : 'text');
        input.setAttribute('maxlength', String(Number.isInteger(spec.max) ? spec.max : 80));
        input.setAttribute('placeholder', str(spec.placeholder, 80));
        input.setAttribute('aria-label', str(spec.label, 80) || 'Value');
        go.disabled = busy;
    }

    async function send(event) {
        event?.preventDefault?.();
        if (busy || typeof api?.command !== 'function') return;
        const raw = String(input.value ?? '').trim();
        if (!raw) { status.textContent = 'Type something first.'; return; }
        const value = spec.numeric ? Number(raw) : Array.from(raw).slice(0, Number.isInteger(spec.max) ? spec.max : 80).join('');
        if (spec.numeric && !Number.isFinite(value)) { status.textContent = 'That is not a number.'; return; }
        busy = true;
        status.textContent = '';
        paint();
        let result;
        try { result = await api.command(str(spec.command, 80), putAt(spec.payload, str(spec.valueAt, 80) || 'name', value)); } catch { result = { ok: false, code: 'FAILED', message: '' }; }
        busy = false;
        status.textContent = result?.ok === false ? failureLine(result) : 'Saved.';
        if (result?.ok !== false) input.value = '';
        paint();
    }
    root.addEventListener('submit', send);
    go.addEventListener('click', send);
    paint();
    return {
        update(next = {}) { spec = specOf(next); paint(); },
        destroy() { root.remove(); },
    };
}

// ---- rpg-battle.command-button ---------------------------------------------------------------------------------------

export function renderCommandButton(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'span', 'rpg-cb');
    const button = make(doc, 'button', 'ss-button rpg-cb-go');
    button.setAttribute('type', 'button');
    const problem = make(doc, 'span', 'rpg-cb-problem');
    problem.setAttribute('role', 'alert');
    root.append(button, problem);
    el.append(root);
    let spec = specOf(props);
    let busy = false;

    function paint() {
        button.textContent = str(spec.label, 80) || 'Go';
        button.className = `ss-button rpg-cb-go${spec.tone === 'primary' ? ' ss-button-primary' : spec.tone === 'quiet' ? ' ss-button-quiet' : ''}`;
        button.disabled = busy || spec.disabled === true;
        button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
        if (str(spec.title)) button.setAttribute('title', str(spec.title));
        else button.removeAttribute('title');
    }

    button.addEventListener('click', async () => {
        if (busy || spec.disabled === true || typeof api?.command !== 'function' || !str(spec.command)) return;
        busy = true;
        problem.textContent = '';
        paint();
        let result;
        try { result = await api.command(str(spec.command, 80), isRecord(spec.payload) ? JSON.parse(JSON.stringify(spec.payload)) : {}); } catch { result = { ok: false, code: 'FAILED', message: '' }; }
        busy = false;
        if (result?.ok === false) problem.textContent = failureLine(result);
        paint();
    });
    paint();
    return {
        update(next = {}) { spec = specOf(next); paint(); },
        destroy() { root.remove(); },
    };
}

/** An explicit template selection and targets, sent through the standard refusal-reporting button. */
export function renderQuestBinding(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'rpg-qb');
    el.append(root);
    let spec = specOf(props);
    const select = make(doc, 'select', 'rpg-ci-input');
    select.setAttribute('aria-label', 'Quest template');
    const controls = {};
    root.append(select);
    for (const [key, label] of [['text', 'Objective text'], ['foe', 'Foe or canonical variant ref'], ['place', 'Place'], ['item', 'Item']]) {
        const wrap = make(doc, 'label', 'rpg-ci-label', label);
        const input = make(doc, 'input', 'rpg-ci-input');
        input.setAttribute('type', 'text'); input.setAttribute('maxlength', key === 'text' ? '240' : '200');
        input.setAttribute('aria-label', label);
        wrap.append(input); root.append(wrap); controls[key] = input;
    }
    const action = make(doc, 'span'); root.append(action);
    const button = renderCommandButton(action, {}, api);
    function refresh() {
        const template = (spec.templates ?? []).find(t => t.id === select.value);
        const kinds = template?.kinds ?? [];
        const payload = { id: spec.id, template: select.value, text: controls.text.value.trim() };
        for (const [key, kind] of [['foe', 'kill'], ['place', 'visit'], ['item', 'collect']]) {
            controls[key].parentNode.hidden = !kinds.includes(kind);
            if (kinds.includes(kind) && controls[key].value.trim()) payload[key] = controls[key].value.trim();
        }
        button.update({ command: 'quest.open', payload, label: 'Make this a quest', disabled: !template, tone: 'primary' });
    }
    function options() {
        const chosen = select.value;
        select.replaceChildren();
        const empty = make(doc, 'option', '', 'Choose an open template'); empty.value = ''; select.append(empty);
        for (const row of spec.templates ?? []) { const option = make(doc, 'option', '', str(row.name, 80)); option.value = row.id; select.append(option); }
        select.value = (spec.templates ?? []).some(row => row.id === chosen) ? chosen : '';
    }
    options(); controls.text.value = str(spec.text, 240);
    select.addEventListener('change', refresh);
    for (const input of Object.values(controls)) input.addEventListener('input', refresh);
    refresh();
    return { update(next = {}) { spec = specOf(next); options(); refresh(); }, destroy() { button.destroy(); root.remove(); } };
}

/**
 * Make this a trainer: props { people: [name], templates: [{ id, name, skills: [{ id, name }] }] } (RB open trainers §10.2). The person and
 * the template are chosen by the reader; the skills are the template's own, all ticked, and only unticking changes them, so a skill the
 * template does not list cannot be sent. The payload is { name, template, text?, skills? } (`skills` only when some were unticked).
 */
export function renderTrainerBinding(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', 'rpg-tb');
    el.append(root);
    let spec = specOf(props);
    const who = make(doc, 'select', 'rpg-ci-input');
    who.setAttribute('aria-label', 'Person');
    const kind = make(doc, 'select', 'rpg-ci-input');
    kind.setAttribute('aria-label', 'Trainer template');
    const skills = make(doc, 'div', 'rpg-tb-skills');
    skills.setAttribute('role', 'group');
    skills.setAttribute('aria-label', 'Skills they can teach');
    const wrap = make(doc, 'label', 'rpg-ci-label', 'What they teach');
    const text = make(doc, 'input', 'rpg-ci-input rpg-tb-text');
    text.setAttribute('type', 'text');
    text.setAttribute('maxlength', '240');
    text.setAttribute('aria-label', 'What they teach');
    wrap.append(text);
    const action = make(doc, 'span');
    root.append(who, kind, skills, wrap, action);
    const button = renderCommandButton(action, {}, api);
    const templates = () => (Array.isArray(spec.templates) ? spec.templates : []).filter(row => isRecord(row) && typeof row.id === 'string' && row.id);
    const people = () => (Array.isArray(spec.people) ? spec.people : []).filter(name => typeof name === 'string' && name);
    const templateOf = id => templates().find(row => row.id === id) ?? null;
    const skillsOf = template => (Array.isArray(template?.skills) ? template.skills : []).filter(row => isRecord(row) && typeof row.id === 'string' && row.id);
    const boxes = () => [...skills.querySelectorAll('input')];

    function refresh() {
        const template = templateOf(kind.value);
        const chosen = boxes().filter(box => box.checked).map(box => box.value);
        const all = skillsOf(template).map(row => row.id);
        const narrowed = template !== null && chosen.length < all.length;
        const payload = { name: who.value, template: kind.value };
        if (text.value.trim()) payload.text = text.value.trim();
        if (narrowed) payload.skills = all.filter(id => chosen.includes(id));
        button.update({ command: 'trainer.open', payload, label: 'Make this a trainer', disabled: !who.value || !template || !chosen.length, tone: 'primary' });
    }
    function fillSkills() {
        skills.replaceChildren();
        for (const row of skillsOf(templateOf(kind.value))) {
            const label = make(doc, 'label', 'rpg-tb-skill');
            const box = make(doc, 'input');
            box.setAttribute('type', 'checkbox');
            box.value = str(row.id, 200);
            box.checked = true;
            box.addEventListener('change', refresh);
            label.append(box, doc.createTextNode(` ${str(row.name, 80) || str(row.id, 80)}`));
            skills.append(label);
        }
        skills.hidden = !skills.childNodes.length;
    }
    function options() {
        const person = who.value;
        const template = kind.value;
        who.replaceChildren();
        const none = make(doc, 'option', '', 'Choose someone who is here');
        none.value = '';
        who.append(none);
        for (const name of people()) { const option = make(doc, 'option', '', str(name, 80)); option.value = name; who.append(option); }
        who.value = people().includes(person) ? person : '';
        kind.replaceChildren();
        const empty = make(doc, 'option', '', 'Choose a trainer template');
        empty.value = '';
        kind.append(empty);
        for (const row of templates()) { const option = make(doc, 'option', '', str(row.name, 80) || str(row.id, 80)); option.value = row.id; kind.append(option); }
        kind.value = templateOf(template) ? template : '';
    }
    options();
    fillSkills();
    who.addEventListener('change', refresh);
    kind.addEventListener('change', () => { fillSkills(); refresh(); });
    text.addEventListener('input', refresh);
    refresh();
    return {
        update(next = {}) {
            spec = specOf(next);
            const before = kind.value;
            const ticked = new Set(boxes().filter(box => box.checked).map(box => box.value));
            options();
            if (kind.value !== before || !boxes().length) fillSkills();
            else for (const box of boxes()) box.checked = ticked.has(box.value);
            refresh();
        },
        destroy() { button.destroy(); root.remove(); },
    };
}

// ---- rpg-battle.show-more ---------------------------------------------------------------------------------------------

// Whether the viewer asked for the rest of a list: Story Block draws a screen again when the state changes, so the answer is kept here for this page.
let moreShown = false;

/** The "Show older" button of the Adjustments log: it opens and closes the older rows of the section it is in (`data-older` on the section; the sheet shows them). */
export function renderShowMore(el, props = {}) {
    const doc = el.ownerDocument;
    const button = make(doc, 'button', 'ss-button rpg-sm');
    button.setAttribute('type', 'button');
    el.append(button);
    let label = str(specOf(props).label, 40) || 'Show more';
    const section = el.closest?.('[data-more]') ?? null;
    const paint = () => {
        button.textContent = moreShown ? 'Show fewer' : label;
        button.setAttribute('aria-expanded', moreShown ? 'true' : 'false');
        if (section) section.setAttribute('data-more', moreShown ? 'open' : 'closed');
    };
    button.addEventListener('click', () => { moreShown = !moreShown; paint(); });
    paint();
    return {
        update(next = {}) { label = str(specOf(next).label, 40) || label; paint(); },
        destroy() { button.remove(); },
    };
}


const widget = render => Object.freeze({
    props: Object.freeze({ value: Object.freeze({ type: 'object', required: false, default: null }) }),
    validate(props = {}) { return props.value !== undefined && props.value !== null && !isRecord(props.value) ? ['value must be an object.'] : []; },
    render,
});

export const permanentChoice = widget(renderPermanentChoice);
export const classPick = widget(renderClassPick);
export const commandInput = widget(renderCommandInput);
export const commandButton = widget(renderCommandButton);

export const rulesWidgets = Object.freeze({
    [PERMANENT_CHOICE_WIDGET]: permanentChoice,
    [CLASS_PICK_WIDGET]: classPick,
    [COMMAND_INPUT_WIDGET]: commandInput,
    [COMMAND_BUTTON_WIDGET]: commandButton,
    [SHOW_MORE_WIDGET]: widget(renderShowMore),
    'rpg-battle.quest-binding': widget(renderQuestBinding),
    'rpg-battle.trainer-binding': widget(renderTrainerBinding),
});

export const RULES_WIDGET_CSS = `
.rpg-sm { min-height: 44px; min-width: 44px; }
.rpg-pc, .rpg-cp { display: grid; gap: var(--ss-space-2); min-width: 0; }
.rpg-pc-title { margin: 0; font-weight: 700; }
.rpg-pc-options, .rpg-cp { display: grid; gap: var(--ss-space-2); grid-template-columns: repeat(auto-fill, minmax(min(100%, 11em), 1fr)); }
.rpg-pc-option, .rpg-cp-card { display: grid; gap: 2px; align-content: start; justify-items: start; min-height: 44px; padding: var(--ss-space-2) var(--ss-space-3); text-align: left;
  border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); background: var(--ss-tile); color: var(--ss-text); font: inherit; cursor: pointer; }
.rpg-pc-option:hover:not(:disabled), .rpg-cp-card:hover { border-color: var(--ss-accent); }
.rpg-pc-option:focus-visible, .rpg-cp-card:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.rpg-pc-option.picked, .rpg-cp-card.picked { border-color: var(--ss-accent); background: linear-gradient(var(--ss-accent-soft), var(--ss-accent-soft)), var(--ss-tile); }
.rpg-cp-card .cc-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 8px; min-width: 0; }
.rpg-pc-label, .rpg-cp-name { font-weight: 700; overflow-wrap: anywhere; }
.rpg-pc-sub, .rpg-cp-sub { font-size: 13px; color: var(--ss-muted); overflow-wrap: anywhere; }
.rpg-cp-tick { font-size: 12px; color: var(--ss-accent); font-weight: 700; }
.rpg-pc-warning { margin: 0; font-size: 13px; color: var(--ss-warn); }
.rpg-pc-confirm { justify-self: start; min-height: 44px; }
.rpg-pc-confirm:disabled { opacity: 0.55; cursor: not-allowed; }
.rpg-pc-status { margin: 0; color: var(--ss-good); font-size: 13px; }
.rpg-pc-problem, .rpg-ci-status { margin: 0; color: var(--ss-bad); font-size: 13px; }
.rpg-pc-status:empty, .rpg-pc-problem:empty, .rpg-ci-status:empty { display: none; }
.rpg-cp-none { margin: 0; color: var(--ss-muted); font-style: italic; }
.rpg-cb { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); min-width: 0; }
.rpg-cb-go { min-height: 44px; }
.rpg-cb-go:disabled { opacity: 0.55; cursor: not-allowed; }
.rpg-cb-problem { color: var(--ss-bad); font-size: 13px; }
.rpg-cb-problem:empty { display: none; }
.rpg-ci { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); min-width: 0; }
.rpg-ci-label { font-size: 13px; color: var(--ss-muted); }
.rpg-ci-input { flex: 1 1 8em; min-width: 0; min-height: 44px; padding: 0 var(--ss-space-2); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); background: var(--ss-tile); color: var(--ss-text); font: inherit; }
.rpg-ci-go { min-height: 44px; }
.rpg-tb { display: grid; gap: var(--ss-space-2); min-width: 0; }
.rpg-tb-skills { display: grid; gap: 2px var(--ss-space-3); grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr)); }
.rpg-tb-skill { display: flex; align-items: center; gap: var(--ss-space-2); min-height: 44px; overflow-wrap: anywhere; }
.rpg-tb-skill input { width: 22px; height: 22px; flex: none; }
`;
