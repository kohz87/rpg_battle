// Story Director v2, part **world**: the people in the scene, widget `story-director.people` (MODULES §F9,
// §F119), on the World screen's Here. Bound to `director.world.here` (props.value).
//
// * With NPC State Delta installed and on, its own present-cast cards (the portraits, now lines, chatter
//   bubbles and meters its Cast tab drew, in its markup and classes), drawn by Delta through the page API it
//   offers (`globalThis.NPCStateDeltaCast.render(el, { slot })`); nothing of its markup is copied here. A
//   card opens its dossier (Delta's own click handling). Anyone Story Block lists as here who has no card yet
//   (no dossier, or Delta has not scanned them) is a chip below the cards, so no one is left out.
// * Without it (or while it is off or still loading), one chip per person: with NPC State Delta's queries
//   only, the stance and, when they have a dossier, a link opening it (`openDossier`, a page call it offers).
// * Under each person, their thought from the newest reply's Inner chatter (`thought` / `chatter`, matched
//   by name as the chatter strip links a dossier; known.js hereView). Text goes in as text only.
//
// Fresh without a tab switch: Story Block draws the screen again on `head` and `committed` (a new reply, a
// swipe, a delete, a chat change), and NPC State Delta's changes that come later (a scan that ends after the
// reply, a dossier added or edited) reach the widget through the page API's `onChange`: it asks
// `director.world.here` again and redraws, at most once per task. A redraw is one query and the few cards
// and chips here: nothing walks the chat.

import { maker } from '../screens/dom.js';
import { FEATURE } from './known.js';
import { lineKey } from '../../changes.js';

export const PEOPLE_WIDGET = 'story-director.people';
export const HERE_QUERY = 'director.world.here';

/** NPC State Delta's `openDossier(name)` on this page, or null. */
export function dossierOpener() {
    try {
        const api = globalThis.NPCStateDelta;
        return typeof api?.openDossier === 'function' ? name => api.openDossier(name) : null;
    } catch {
        return null;
    }
}

/** NPC State Delta's page API for its present-cast cards (`globalThis.NPCStateDeltaCast`), or null. */
export function castApi() {
    try {
        const api = globalThis.NPCStateDeltaCast;
        return typeof api?.render === 'function' && typeof api?.onChange === 'function' ? api : null;
    } catch {
        return null;
    }
}

const later = typeof queueMicrotask === 'function' ? queueMicrotask : fn => Promise.resolve().then(fn);

function render(el, props, api, { open = dossierOpener, cast = castApi } = {}) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const box = make('div', 'wv-cast');
    const root = make('ul', 'wv-people', undefined, { 'aria-label': 'People here' });
    el.replaceChildren(box, root);
    let value = props?.value ?? null;
    let off = null;
    let watched = null;
    let pending = false;
    let gone = false;

    const thoughtNode = (thought, tag = 'span') => {
        const node = make(tag, 'wv-thought');
        node.append(make('i', 'fa-solid fa-comment-dots', undefined, { 'aria-hidden': 'true' }), ' ', make('span', 'wv-thought-text', thought));
        node.setAttribute?.('title', 'Inner chatter: only they know it');
        return node;
    };
    const chip = (person, opener, link) => {
        const item = make('li', 'wv-person');
        const face = link
            ? make('button', 'wv-chip wv-link', undefined, { type: 'button', title: `Open ${person.name}'s dossier` })
            : make('span', 'wv-chip');
        if (link) {
            face.append(make('i', 'fa-solid fa-address-card', undefined, { 'aria-hidden': 'true' }), ' ');
            face.addEventListener('click', event => {
                event?.stopPropagation?.();
                try { opener(person.name); } catch { /* the dossier could not open; nothing else to do */ }
            });
        }
        face.append(make('span', 'wv-name', person.name));
        if (typeof person.stance === 'string' && person.stance) face.append(' ', make('span', 'wv-stance', person.stance));
        item.append(face);
        if (typeof person.thought === 'string' && person.thought) item.append(thoughtNode(person.thought, 'p'));
        return item;
    };

    // Subscribes to NPC State Delta's changes once its page API is there (it may come after the first draw).
    const watch = page => {
        if (!page || watched === page) return;
        try { off?.(); } catch { /* gone */ }
        watched = page;
        try { off = page.onChange(refresh) ?? null; } catch { off = null; }
    };

    const draw = () => {
        const people = (Array.isArray(value?.people) ? value.people : []).filter(person => person && typeof person.name === 'string' && person.name);
        const page = value?.nsd === true ? cast?.() ?? null : null;
        watch(cast?.() ?? null);
        const covered = new Set();
        let cards = 0;
        if (page && page.available?.() === true) {
            const thoughts = new Map((Array.isArray(value?.chatter) ? value.chatter : []).filter(item => item?.key && item?.text).map(item => [item.key, item.text]));
            try {
                cards = Number(page.render(box, {
                    slot: (name, aliases = []) => {
                        const keys = [name, ...(Array.isArray(aliases) ? aliases : [])].map(lineKey).filter(Boolean);
                        keys.forEach(key => covered.add(key));
                        const key = keys.find(item => thoughts.has(item));
                        return key ? thoughtNode(thoughts.get(key)) : null;
                    },
                })) || 0;
            } catch { cards = 0; }
        }
        if (cards > 0) box.hidden = false;
        else {
            box.replaceChildren();
            box.hidden = true;
        }
        const opener = open?.() ?? null;
        root.replaceChildren(...people
            .filter(person => !(cards > 0 && covered.has(person.key || lineKey(person.name))))
            .map(person => chip(person, opener, value?.nsd === true && person.dossier === true && opener)));
        root.hidden = root.children?.length === 0 && cards > 0;
    };

    // NPC State Delta changed: ask for the here view again (the dossier flags, the stances) and redraw, once.
    function refresh() {
        if (pending || gone) return;
        pending = true;
        later(() => {
            pending = false;
            if (gone) return;
            if (typeof api?.query === 'function') {
                try {
                    const next = api.query(HERE_QUERY);
                    if (next && typeof next === 'object') value = next;
                } catch { /* keep the last answer */ }
            }
            draw();
        });
    }

    draw();
    return {
        update(next) { value = next?.value ?? null; draw(); },
        destroy() {
            gone = true;
            try { off?.(); } catch { /* gone */ }
            off = null;
            box.remove();
            root.remove();
        },
    };
}

/**
 * The widget; `open` (tests): () → a function opening one dossier by name, or null; `cast` (tests): () →
 * NPC State Delta's page API, or null.
 */
export function createPeopleWidget({ open = dossierOpener, cast = castApi } = {}) {
    return Object.freeze({
        props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
        primary: 'value',
        feature: FEATURE,
        validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.world.here data.'] : []),
        render: (el, props, api) => render(el, props, api, { open, cast }),
    });
}

export const peopleWidget = createPeopleWidget();
