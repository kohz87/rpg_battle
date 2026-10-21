// `story-block/changes-card` (SPEC §13.1, §13.4): the inline card under a reply, "Changed this reply".
// The card mount gives it **that reply's** state and the JSON Pointers that reply's ops touched, so the
// template lists only what `changed()` says moved: the stacks touched (with what is held now), the
// wallet, the place and who is present.
//
// The card's collapsed header is one line from the mount's `summary` hook. `changesSummary` (below)
// writes it from the reply's state and the state before it, so it can say what was gained and lost:
// "+1 Moonveil Trout, −1 Rope · +30 gold · to Bluewatch Village · Fenna arrived". A stack used up
// completely is gone from the reply's state, so only the header (which sees the state before) names it.
// Pure: no DOM.

import { BASE_CSS } from './style.js';

export const CHANGES_CARD_SCREEN_ID = 'story-block/changes-card';

const TEMPLATE = `
<div class="chg">
  <ul class="lines">
    <li class="line item" data-each="state.inventory.stacks as s" data-if="changed(s)"
        data-class="eq: s.equipped != null">
      <i class="fa-solid fa-box-open" aria-hidden="true"></i>
      <span class="name">{{ state.inventory.defs[s.def].name }}</span>
      <span class="now muted">now ×{{ s.qty }}</span>
      <span class="chip" data-if="s.equipped">equipped: {{ s.equipped }}</span>
    </li>
    <li class="line coin" data-if="changed('state.inventory.wallets.party')">
      <i class="fa-solid fa-coins" aria-hidden="true"></i>
      <span>Wallet: now <b>{{ state.inventory.wallets.party.coin }}</b> {{ q.currency.name }}</span>
    </li>
    <li class="line place" data-if="changed('state.scene.place')">
      <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
      <span data-if="state.scene.place.name">Now at <b>{{ state.scene.place.name }}</b></span>
      <span data-if="!state.scene.place.name">The place was cleared</span>
    </li>
    <li class="line present" data-if="changed('state.scene.present')">
      <i class="fa-solid fa-users" aria-hidden="true"></i>
      <span data-if="len(state.scene.present) > 0">Here now: {{ state.scene.present }}</span>
      <span data-if="len(state.scene.present) == 0">No one else is here now</span>
    </li>
  </ul>
  <p class="none muted" data-if="!changed('state.inventory') && !changed('state.scene')">Nothing changed in the inventory or the scene.</p>
</div>`;

const CSS = `${BASE_CSS}
.chg { font-size: 0.9em; padding: 4px 8px; border-left: 3px solid var(--sb-accent); border-radius: 6px; background: var(--sb-raised); }
.lines { display: grid; gap: 2px; }
.line { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.line > i { width: 1.1em; text-align: center; color: var(--sb-accent); }
.name { font-weight: 600; }
.none { margin: 0; }
`;

export const changesCardScreen = Object.freeze({
    id: CHANGES_CARD_SCREEN_ID,
    title: 'Changed this reply',
    icon: 'fa-list-check',
    mounts: Object.freeze(['card']),
    // Shown under every reply until the reader turns it off (MODULES §F24).
    defaultOn: true,
    data: Object.freeze({ currency: Object.freeze({ query: 'inventory.currency' }) }),
    template: TEMPLATE,
    css: CSS,
});

// ---------------------------------------------------------------------------------------------------
// The one-line summary

const INVENTORY = /^\/domains\/inventory(\/|$)/;
const STACK = /^\/domains\/inventory\/stacks\/([^/]+)/;
const WALLETS = /^\/domains\/inventory\/wallets(\/|$)/;
const PLACE = /^\/domains\/scene\/place(\/|$)|^\/domains\/scene$/;
const PRESENT = /^\/domains\/scene\/present(\/|$)|^\/domains\/scene$/;
const MAX_ITEMS = 3;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inventoryOf = state => (isRecord(state?.domains?.inventory) ? state.domains.inventory : {});
const sceneOf = state => (isRecord(state?.domains?.scene) ? state.domains.scene : {});
const coinOf = state => {
    const coin = inventoryOf(state).wallets?.party?.coin;
    return Number.isSafeInteger(coin) ? coin : 0;
};
const placeName = state => (typeof sceneOf(state).place?.name === 'string' ? sceneOf(state).place.name : '');
const presentOf = state => (Array.isArray(sceneOf(state).present) ? sceneOf(state).present.filter(name => typeof name === 'string') : []);
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || (a.def < b.def ? -1 : a.def > b.def ? 1 : 0);

// Quantity held per item definition, every owner together (a hand-over between members is no change).
function heldByDef(state) {
    const held = new Map();
    for (const stack of Object.values(inventoryOf(state).stacks ?? {})) {
        if (!isRecord(stack) || typeof stack.def !== 'string' || !Number.isSafeInteger(stack.qty)) continue;
        held.set(stack.def, (held.get(stack.def) ?? 0) + stack.qty);
    }
    return held;
}

function defName(def, ...states) {
    for (const state of states) {
        const name = inventoryOf(state).defs?.[def]?.name;
        if (typeof name === 'string' && name) return name;
    }
    return def;
}

/**
 * What a reply changed, from its state, the state before it (the previous carrier's; null for the
 * greeting or when unknown) and the JSON Pointers its ops touched (the card mount's `changes`).
 * → { gained: [{ def, name, qty }], lost: [{ def, name, qty }], held: [{ def, name, qty }],
 *     coin: number | null, coinNow: number | null, place: string | null, arrived: [], left: [],
 *     presentNow: string[] | null, other: bool }
 * With `before`, gained / lost / coin / arrived / left are differences. Without it, `held` lists the
 * touched items with what is held now, `coinNow` the wallet and `presentNow` who is here, since nothing
 * says what they were before. `other` is true when the reply changed something else (another module's).
 */
export function changesDigest({ state = null, before = null, changes = [] } = {}) {
    const paths = (Array.isArray(changes) ? changes : [...(changes ?? [])]).filter(path => typeof path === 'string');
    const digest = { gained: [], lost: [], held: [], coin: null, coinNow: null, place: null, arrived: [], left: [], presentNow: null, other: false };
    const touched = test => paths.some(path => test.test(path));
    const known = isRecord(before);

    if (touched(INVENTORY)) {
        if (known) {
            const now = heldByDef(state);
            const then = heldByDef(before);
            for (const def of new Set([...then.keys(), ...now.keys()])) {
                const delta = (now.get(def) ?? 0) - (then.get(def) ?? 0);
                if (delta > 0) digest.gained.push({ def, name: defName(def, state, before), qty: delta });
                else if (delta < 0) digest.lost.push({ def, name: defName(def, state, before), qty: -delta });
            }
            digest.gained.sort(byName);
            digest.lost.sort(byName);
            const coin = coinOf(state) - coinOf(before);
            if (coin !== 0) digest.coin = coin;
        } else {
            const stacks = inventoryOf(state).stacks ?? {};
            const ids = new Set(paths.map(path => STACK.exec(path)?.[1]).filter(id => id && isRecord(stacks[id])));
            const held = new Map();
            for (const id of ids) held.set(stacks[id].def, (held.get(stacks[id].def) ?? 0) + stacks[id].qty);
            digest.held = [...held].map(([def, qty]) => ({ def, name: defName(def, state), qty })).sort(byName);
            if (touched(WALLETS)) digest.coinNow = coinOf(state);
        }
    }
    if (touched(PLACE)) {
        const name = placeName(state);
        if (!known || name !== placeName(before)) digest.place = name;
    }
    if (touched(PRESENT)) {
        const now = presentOf(state);
        const then = known ? presentOf(before) : [];
        const lower = list => new Set(list.map(name => name.toLowerCase()));
        const nowKeys = lower(now);
        const thenKeys = lower(then);
        digest.arrived = known ? now.filter(name => !thenKeys.has(name.toLowerCase())) : [];
        digest.left = then.filter(name => !nowKeys.has(name.toLowerCase()));
        if (!known) digest.presentNow = now;
    }
    digest.other = paths.some(path => !INVENTORY.test(path) && !/^\/domains\/scene(\/|$)/.test(path) && !/^\/meta(\/|$)/.test(path));
    return digest;
}

function itemList(entries, sign) {
    const shown = entries.slice(0, MAX_ITEMS).map(entry => `${sign}${entry.qty} ${entry.name}`);
    return entries.length > MAX_ITEMS ? [...shown, `${entries.length - MAX_ITEMS} more`] : shown;
}

const people = names => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

/**
 * The card's collapsed one-line summary, in plain words: "+1 Moonveil Trout, −1 Rope · +30 gold ·
 * to Bluewatch Village · Fenna arrived", or "No changes" ("No item, coin or place changes" when only
 * another module's state moved). `currency` is `inventory.currency`'s
 * `{ name }` (default gold). Takes the same fields as changesDigest, or a digest as `digest`.
 */
export function changesSummary({ state = null, before = null, changes = [], currency = null, digest = null } = {}) {
    const d = digest ?? changesDigest({ state, before, changes });
    const money = typeof currency?.name === 'string' && currency.name ? currency.name : 'gold';
    const parts = [];
    const items = [...itemList(d.gained, '+'), ...itemList(d.lost, '−')];
    if (items.length) parts.push(items.join(', '));
    if (d.held.length) parts.push(d.held.slice(0, MAX_ITEMS).map(entry => `${entry.name} ×${entry.qty}`).join(', ')
        + (d.held.length > MAX_ITEMS ? `, ${d.held.length - MAX_ITEMS} more` : ''));
    if (d.coin !== null) parts.push(`${d.coin > 0 ? '+' : '−'}${Math.abs(d.coin)} ${money}`);
    else if (d.coinNow !== null) parts.push(`${d.coinNow} ${money} now`);
    if (d.place !== null) parts.push(d.place ? `to ${d.place}` : 'place cleared');
    if (d.arrived.length) parts.push(`${people(d.arrived)} arrived`);
    if (d.left.length) parts.push(`${people(d.left)} left`);
    if (d.presentNow) parts.push(d.presentNow.length ? `here: ${people(d.presentNow)}` : 'no one else here');
    if (parts.length) return parts.join(' · ');
    return d.other ? 'No item, coin or place changes' : 'No changes';
}
