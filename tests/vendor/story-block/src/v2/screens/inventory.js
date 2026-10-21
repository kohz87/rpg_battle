// `story-block/inventory` (SPEC §13.1): the party's things from the head state, grouped by kind, with
// rarity colours, quantities, an equipped marker, the wallet in the chat's one currency (MODULES §F1),
// Equip / Unequip and Drop buttons, and a filter box that fills the view's draft (§13.2, §13.6): what
// kind, what rarity, equipped only. Nothing here writes state; the buttons run the core commands with
// the payloads of MODULES §F5 (`inventory.equip { stack }`, `inventory.unequip { stack }`,
// `inventory.drop { stack, qty }`), and Drop asks first (a folded "Drop" that opens to the choices).

import { KIND_ORDER, RARITIES } from '../domains/inventory.js';
import { BASE_CSS, RARITY_THEME } from './style.js';

export const INVENTORY_SCREEN_ID = 'story-block/inventory';

export const KIND_TITLES = Object.freeze({
    quest: 'Quest items', equipment: 'Equipment', consumable: 'Consumables',
    material: 'Materials', goods: 'Goods', money: 'Valuables',
});

const KIND_ICONS = Object.freeze({
    quest: 'fa-scroll', equipment: 'fa-shield-halved', consumable: 'fa-flask',
    material: 'fa-cubes', goods: 'fa-box', money: 'fa-gem',
});

const capital = word => word[0].toUpperCase() + word.slice(1);

// The draft fields start unset, so every test also accepts "never chosen" (null) as "everything".
const anyKind = kind => `(draft.kind == null || draft.kind == '' || draft.kind == '${kind}')`;
const ITEM_FILTER = "(draft.rarity == null || draft.rarity == '' || draft.rarity == it.rarity)"
    + ' && (draft.equippedOnly != true || it.equipped != null)';
const RARITY_CLASSES = RARITIES.filter(rarity => rarity !== 'common').map(rarity => `r-${rarity}: it.rarity == '${rarity}'`).join('; ');

function group(kind) {
    return `
  <section class="group" data-kind="${kind}" data-if="${anyKind(kind)}">
    <h4><i class="fa-solid ${KIND_ICONS[kind]}" aria-hidden="true"></i> ${KIND_TITLES[kind]}</h4>
    <ul>
      <li class="item" data-each="q.items as it" data-if="it.kind == '${kind}' && ${ITEM_FILTER}"
          data-class="${RARITY_CLASSES}; equipped: it.equipped != null">
        <div class="line">
          <span class="name">{{ it.name }}</span>
          <span class="qty" data-if="it.qty != 1">×{{ it.qty }}</span>
          <span class="chip eq" data-if="it.equipped" title="Equipped"><i class="fa-solid fa-check" aria-hidden="true"></i> {{ it.equipped }}</span>
          <span class="rarity">{{ it.rarity }}</span>
          <span class="owner muted" data-if="it.owner != 'party'">{{ state.party.actors[it.owner].name }}</span>
        </div>
        <p class="note muted" data-if="it.note">{{ it.note }}</p>
        <div class="actions">
          <button class="btn" data-if="it.kind == 'equipment' && it.equipped == null" data-command="inventory.equip"
                  data-payload='{"stack":"{{ it.stack }}"}' title="Equip {{ it.name }}"><i class="fa-solid fa-hand-fist" aria-hidden="true"></i> Equip</button>
          <button class="btn" data-if="it.equipped" data-command="inventory.unequip"
                  data-payload='{"stack":"{{ it.stack }}"}' title="Take off {{ it.name }}">Unequip</button>
          <details class="drop">
            <summary class="btn danger" title="Drop {{ it.name }}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Drop</summary>
            <span class="confirm">
              <button class="btn danger" data-if="it.qty != 1" data-command="inventory.drop"
                      data-payload='{"stack":"{{ it.stack }}","qty":1}'>Drop 1</button>
              <button class="btn danger" data-command="inventory.drop"
                      data-payload='{"stack":"{{ it.stack }}","qty":{{ it.qty }}}'><span data-if="it.qty != 1">Drop all {{ it.qty }}</span><span data-if="it.qty == 1">Yes, drop it</span></button>
            </span>
          </details>
        </div>
      </li>
    </ul>
  </section>`;
}

const TEMPLATE = `
<div class="inv">
  <header class="top">
    <div class="wallet" title="The party's money">
      <i class="fa-solid fa-coins" aria-hidden="true"></i>
      <b data-if="q.wallet.coin">{{ q.wallet.coin }}</b><b data-if="!q.wallet.coin">0</b>
      <span>{{ q.currency.name }}</span>
    </div>
    <div class="filter" role="search" aria-label="Filter the inventory" data-if="len(q.items) > 0">
      <label>Show
        <select data-draft="kind">
          <option value="">Everything</option>
${KIND_ORDER.map(kind => `          <option value="${kind}">${KIND_TITLES[kind]}</option>`).join('\n')}
        </select>
      </label>
      <label>Rarity
        <select data-draft="rarity">
          <option value="">Any</option>
${RARITIES.map(rarity => `          <option value="${rarity}">${capital(rarity)}</option>`).join('\n')}
        </select>
      </label>
      <label class="check"><input type="checkbox" data-draft="equippedOnly"> Equipped only</label>
    </div>
  </header>
  <p class="empty muted" data-if="len(q.items) == 0">Nothing carried yet.</p>
  <div class="groups">${KIND_ORDER.map(group).join('')}
  </div>
  <p class="nomatch muted" data-if="len(q.items) > 0">Nothing matches the filter.</p>
</div>`;

const CSS = `${BASE_CSS}
.inv { display: grid; gap: var(--sb-gap); }
.top { display: flex; flex-wrap: wrap; gap: var(--sb-gap); align-items: center; justify-content: space-between; }
.wallet { display: inline-flex; gap: 6px; align-items: baseline; font-size: 1.05em; }
.wallet i { color: var(--sb-accent); }
.filter { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.85em; }
.filter label { display: inline-flex; gap: 4px; align-items: center; }
.filter select { font: inherit; color: var(--sb-fg); background: var(--sb-surface); border: 1px solid var(--sb-border);
                 border-radius: 6px; padding: 1px 4px; }
.groups { display: grid; gap: var(--sb-gap); }
.group:not(:has(.item)) { display: none; }
.nomatch { display: none; }
.groups:not(:has(.item)) + .nomatch { display: block; }
.item { --rarity: var(--sb-common); padding: 6px 8px; margin: 0 0 4px; border-radius: 6px;
        border-left: 3px solid var(--rarity); background: var(--sb-raised); }
.item.r-uncommon { --rarity: var(--sb-uncommon); }
.item.r-rare { --rarity: var(--sb-rare); }
.item.r-epic { --rarity: var(--sb-epic); }
.item.r-legendary { --rarity: var(--sb-legendary); }
.item.equipped { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sb-accent) 45%, transparent); }
.line { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.name { font-weight: 600; color: var(--rarity); }
.qty { font-variant-numeric: tabular-nums; }
.rarity { font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rarity); opacity: 0.85; }
.eq { color: var(--sb-accent); }
.owner { font-size: 0.85em; }
.note { margin: 2px 0 0; font-size: 0.85em; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.drop { display: inline-flex; gap: 6px; align-items: center; }
.drop > summary { list-style: none; }
.drop > summary::-webkit-details-marker { display: none; }
.drop .confirm { display: inline-flex; gap: 6px; margin-left: 6px; }
@media (max-width: 480px) { .filter { width: 100%; } }
`;

export const inventoryScreen = Object.freeze({
    id: INVENTORY_SCREEN_ID,
    title: 'Inventory',
    icon: 'fa-box-open',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({
        items: Object.freeze({ query: 'inventory.items' }),
        wallet: Object.freeze({ query: 'inventory.wallet', args: Object.freeze({ owner: 'party' }) }),
        currency: Object.freeze({ query: 'inventory.currency' }),
    }),
    theme: RARITY_THEME,
    template: TEMPLATE,
    css: CSS,
});
