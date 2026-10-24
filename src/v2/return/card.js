// The widget `rpg-battle.return-card` (MODULES §F17, WIDGETS.md contract): while your character
// is dead, what happened, where Return goes and a Return button; nothing while they live. Built
// with createElement and textContent only; nothing from the state is read as markup.
//
// render(el, props, api) adds one root and returns { update, destroy }. `props.point` may carry a
// return.point answer; otherwise it is asked of `api.query`. A screen that places it binds
// `return.status` (`{"bind":"q.ret"}` → `props.value`: { dead, point }), so the host draws it again
// when your character dies or comes back (a widget whose props stay the same is not drawn again). The Return button rewinds through
// `api.rewind` when the host gives widgets one, else through the sdk the part was given.

import { cleanPlace, isFightId } from './point.js';

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function make(doc, tag, { text = '', className = '', attrs = {} } = {}) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
}

function ask(api, name) {
    if (typeof api?.query !== 'function') return null;
    try { return api.query(name) ?? null; } catch { return null; }
}

/** A return.point answer as the card trusts it, or null. */
function pointOf(value) {
    if (!isObject(value) || !Number.isInteger(value.index) || value.index < 0 || !Number.isInteger(value.beforeRev) || !isFightId(value.fight)) return null;
    return { index: value.index, beforeRev: value.beforeRev, place: cleanPlace(value.place), fight: value.fight };
}

/** The props' problems in plain words ([] when fine). */
export function validateCardProps(props) {
    if (!isObject(props) || props.point === undefined || props.point === null) return [];
    return pointOf(props.point) ? [] : ['point is not a return point ({ index, beforeRev, place, fight }).'];
}

/** The sdk-like object Return runs through: the widget api when it can rewind, else the part's sdk. */
function hostFor(api, host) {
    if (typeof api?.rewind === 'function') return api;
    const sdk = typeof host === 'function' ? host() : null;
    if (!sdk) return api;
    return {
        query: typeof sdk.query === 'function' ? (...args) => sdk.query(...args) : api?.query,
        command: typeof sdk.command === 'function' ? (...args) => sdk.command(...args) : api?.command,
        rewind: typeof sdk.rewind === 'function' ? (...args) => sdk.rewind(...args) : undefined,
    };
}

// The card's look (Story Block's glass design): the glass card is `ss-glass`, its button `ss-button`; the rest is
// layout and type in the tokens. Added once per document, under :where() like the other widgets' sheets.
const RETURN_CSS = `
:where(.rpg-return-card) { display: grid; gap: 8px; min-width: 0; font-family: var(--ss-font); color: var(--ss-text); }
:where(.rpg-return-card[hidden]) { display: none !important; }
:where(.rpg-return-title) { font-size: 16px; font-weight: 800; color: var(--ss-bad); }
:where(.rpg-return-what) { font-size: 14px; overflow-wrap: anywhere; }
:where(.rpg-return-where), :where(.rpg-return-status) { font-size: 13px; color: var(--ss-muted); overflow-wrap: anywhere; }
:where(.rpg-return-go) { justify-self: start; }
`;

function ensureReturnCss(doc) {
    const head = doc?.head ?? doc?.body;
    if (!head || head.querySelector?.('style[data-rpg-return]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-rpg-return', '');
    style.textContent = RETURN_CSS;
    head.appendChild(style);
}

export function renderReturnCard(el, props, api, { host = null, returnInTime } = {}) {
    const doc = el.ownerDocument;
    ensureReturnCss(doc);
    const root = make(doc, 'div', { className: 'rpg-return-card ss-glass' });
    el.append(root);
    let busy = false;

    function draw(current) {
        root.textContent = '';
        const pc = ask(api, 'party.pc');
        const given = isObject(current) && isObject(current.value) && typeof current.value.dead === 'boolean' ? current.value : null;
        const dead = given ? given.dead : isObject(pc) && Array.isArray(pc.conditions) && pc.conditions.some(entry => entry?.kind === 'dead');
        root.hidden = !dead;
        if (!dead) return;
        const point = pointOf(given ? given.point : isObject(current) && current.point !== undefined ? current.point : ask(api, 'return.point'));
        const name = typeof pc.name === 'string' && pc.name.trim() ? pc.name.trim() : 'Your character';
        root.append(make(doc, 'div', { className: 'rpg-return-title', text: 'You died' }));
        root.append(make(doc, 'div', {
            className: 'rpg-return-what',
            text: `${name} fell in a fight to the death${point?.place ? ` at ${point.place}` : ''}. The story cannot go on from here.`,
        }));
        const status = make(doc, 'div', { className: 'rpg-return-status' });
        if (!point) {
            root.append(make(doc, 'div', { className: 'rpg-return-where', text: 'No moment before the fight was found. Swipe or delete back instead.' }));
            root.append(status);
            return;
        }
        root.append(make(doc, 'div', {
            className: 'rpg-return-where',
            text: `Return goes back to message #${point.index}, the moment before the fight began, as a new branch. The old timeline is kept.`,
        }));
        const go = make(doc, 'button', { className: 'rpg-return-go ss-button ss-button-primary', text: 'Return', attrs: { type: 'button' } });
        go.addEventListener('click', async () => {
            if (busy || typeof returnInTime !== 'function') return;
            busy = true;
            go.disabled = true;
            status.textContent = 'Returning…';
            let result;
            try {
                result = await returnInTime(hostFor(api, host));
            } catch (error) {
                result = { ok: false, message: error?.message || 'The return did not work.' };
            }
            busy = false;
            status.textContent = result?.ok ? '' : String(result?.message ?? 'The return did not work.');
            go.disabled = !!result?.ok;
        });
        root.append(go, status);
    }

    draw(props);
    return {
        update(next) { draw(next); },
        destroy() { root.remove(); },
    };
}
