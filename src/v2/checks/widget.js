// The check card widget `rpg-battle.check-card` (MODULES §F9, §F16; WIDGETS.md contract): one
// waiting check, its modifiers (the reader's own with a Remove button), an "Add modifier" picker
// filled from checks.suggest plus a custom ±n with a reason, and Roll / Cancel. Every button is a
// command through `api.command`; a rejection's message is shown on the card. Built with
// createElement and textContent only: nothing from data is read as markup or picks a class.

import { attemptText, dcText, modifierList, short, signed, sumOf } from './shared.js';

const SOURCE_WORDS = { skill: 'skill', ability: 'ability', item: 'item' };

/** A value, or the value a promise resolves to, handed to `fn` (sync when the api is sync). */
function after(value, fn) {
    return value && typeof value.then === 'function' ? value.then(fn) : fn(value);
}

function make(doc, tag, { text = '', className = '', attrs = {} } = {}) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    return node;
}

function ask(api, name, args) {
    if (typeof api?.query !== 'function') return null;
    try {
        return api.query(name, args);
    } catch {
        return null;
    }
}

/** render(el, props, api) → { update(nextProps), destroy() }. props: { id } (a pending check's id). */
export function renderCheckCard(el, props = {}, api = {}) {
    const doc = el.ownerDocument;
    const root = make(doc, 'div', { className: 'ss-w rpg-check-card' });
    el.append(root);
    let current = { ...props };
    let alive = true;

    function status(text) {
        const node = root.querySelector('.rpg-check-status');
        if (node) node.textContent = text;
    }

    async function send(type, payload) {
        if (typeof api?.command !== 'function') return null;
        const result = await api.command(type, payload, { cause: 'ui' });
        if (result && result.ok === false) {
            status(String(result.message ?? 'That did not work.'));
            return result;
        }
        if (alive) draw();
        return result;
    }

    function drawGone(id) {
        root.textContent = '';
        root.setAttribute('data-check', String(id ?? ''));
        after(ask(api, 'checks.log'), log => {
            const done = Array.isArray(log) ? log.find(entry => entry.id === id) : null;
            const text = done
                ? `Rolled: d20 ${done.die} ${signed(done.mod)} = ${done.total} against ${dcText(done)}.`
                : 'This check is no longer waiting.';
            root.append(make(doc, 'div', { className: 'rpg-check-gone', text }));
        });
    }

    function drawCheck(check, name, suggestions) {
        root.textContent = '';
        root.setAttribute('data-check', check.id);
        root.append(make(doc, 'div', { className: 'rpg-check-title', text: `${name ?? 'Someone'} — ${attemptText(check)}` }));
        root.append(make(doc, 'div', { className: 'rpg-check-dc', text: `DC ${dcText(check)} · d20 ${signed(sumOf(check.modifiers))}` }));

        const list = make(doc, 'ul', { className: 'rpg-check-mods' });
        check.modifiers.forEach((modifier, index) => {
            const row = make(doc, 'li', { className: 'rpg-check-mod', attrs: { 'data-source': SOURCE_WORDS[modifier.source] ?? (modifier.source === 'stat' ? 'stat' : 'custom') } });
            row.append(make(doc, 'span', { className: 'rpg-check-mod-text', text: `${modifier.reason} ${short(modifier.amount)}` }));
            if (modifier.source !== 'stat') {
                const remove = make(doc, 'button', { className: 'rpg-check-remove', text: 'Remove', attrs: { type: 'button' } });
                remove.addEventListener('click', () => send('check.removeModifier', { id: check.id, index }));
                row.append(remove);
            }
            list.append(row);
        });
        root.append(list);

        const add = make(doc, 'div', { className: 'rpg-check-add' });
        const pick = make(doc, 'select', { className: 'rpg-check-pick' });
        const options = (Array.isArray(suggestions) ? suggestions : []).map((entry, index) => ({ value: `s${index}`, entry }));
        for (const { value, entry } of options) {
            pick.append(make(doc, 'option', { text: `${SOURCE_WORDS[entry.source] ?? entry.source}: ${entry.name}`, attrs: { value } }));
        }
        pick.append(make(doc, 'option', { text: 'custom reason', attrs: { value: 'custom' } }));
        pick.value = options[0]?.value ?? 'custom';
        const amount = make(doc, 'input', { className: 'rpg-check-amount', attrs: { type: 'number', min: -10, max: 10, step: 1 } });
        amount.value = '2';
        const reason = make(doc, 'input', { className: 'rpg-check-reason', attrs: { type: 'text', maxlength: 60, placeholder: 'Reason (custom)' } });
        const go = make(doc, 'button', { className: 'rpg-check-add-go', text: '+ Add modifier', attrs: { type: 'button' } });
        go.addEventListener('click', () => {
            const value = Number.parseInt(String(amount.value ?? ''), 10);
            const chosen = options.find(option => option.value === pick.value)?.entry ?? null;
            if (chosen) {
                send('check.addModifier', { id: check.id, source: chosen.source, amount: value, reason: chosen.name, ...(chosen.stack ? { stack: chosen.stack } : {}) });
                return;
            }
            const text = String(reason.value ?? '').trim();
            if (!text) return status('Give the custom modifier a reason.');
            send('check.addModifier', { id: check.id, source: 'custom', amount: value, reason: text });
        });
        add.append(pick, amount, reason, go);
        root.append(add);

        const actions = make(doc, 'div', { className: 'rpg-check-actions' });
        const roll = make(doc, 'button', { className: 'rpg-check-roll', text: 'Roll', attrs: { type: 'button' } });
        roll.addEventListener('click', () => send('check.roll', { id: check.id }));
        const cancel = make(doc, 'button', { className: 'rpg-check-cancel', text: 'Cancel', attrs: { type: 'button' } });
        cancel.addEventListener('click', () => send('check.cancel', { id: check.id }));
        actions.append(roll, cancel);
        root.append(actions);
        root.append(make(doc, 'div', { className: 'rpg-check-status' }));
        root.setAttribute('title', `${attemptText(check)}: ${modifierList(check.modifiers)}`);
    }

    function draw() {
        const id = current.id ?? current.value?.id ?? current.check?.id ?? null;
        return after(ask(api, 'checks.pending'), list => {
            const given = current.check ?? (current.value && typeof current.value === 'object' ? current.value : null);
            const check = (Array.isArray(list) ? list.find(entry => entry.id === id) : null) ?? (Array.isArray(list) ? null : given);
            if (!alive) return;
            if (!check) return drawGone(id);
            return after(ask(api, 'party.actor', { id: check.actor }), actor => after(ask(api, 'checks.suggest', { id: check.id }), suggestions => {
                if (alive) drawCheck(check, actor?.name ?? null, suggestions);
            }));
        });
    }

    draw();
    return {
        update(next = {}) {
            current = { ...next };
            draw();
        },
        destroy() {
            alive = false;
            if (typeof root.remove === 'function') root.remove();
            else root.parentNode?.removeChild?.(root);
        },
    };
}

export const checkCard = {
    props: { id: { type: 'string', required: true } },
    primary: 'id',
    validate(props) {
        return props && props.id !== undefined && typeof props.id !== 'string' ? ['id must be text (a check id).'] : [];
    },
    render: renderCheckCard,
};
