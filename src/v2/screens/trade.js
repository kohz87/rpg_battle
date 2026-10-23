// RPG Battle v2, screen `rpg-battle/trade` (MODULES §B4 "Tab page: Trade", one-line rows as v1 0.5.46): the
// market line (where, its prices, a shortage the story marked, the purse), then Sell, Buy (one fold per trader,
// the general store open), Commission and On order. Each section has Story Block's section label (.ss-section-label).
// Every row is a listcard row (Story Block's ss.listcard look): the name with its price pill beside it (left-aligned),
// the note under the name, and the buttons in a fixed right-hand column (Sell, then All), so the same button sits in
// the same place on every row. Buttons:
// `trade.sell { stack, qty }`, `trade.buy { shop, def, qty }`, `craft.commission { piece, materials: [{ stack,
// qty }], crafter }`, `craft.collect { order }`. The trade commands check the market, the purse and the stock
// again and refuse with a sentence.
//
// The commission form fills the screen's draft (`commission.piece`, `.crafter`, `.material`); its button turns
// the draft into the command's payload. One material per commission from this form.

import { sheet } from './style.js';

const RARITY = "r-uncommon: r.rarity == 'uncommon'; r-rare: r.rarity == 'rare'; r-epic: r.rarity == 'epic'; r-legendary: r.rarity == 'legendary'";

const template = `
<div class="rb rb-trade">
  <header class="ss-glass market" data-class="closed: !q.trade.open">
    <i class="fa-solid fa-store mark"></i>
    <div class="main">
      <b class="place">{{ q.trade.place }}</b>
      <small class="line">{{ q.trade.line }}</small>
      <small class="line short" data-if="q.trade.shortage != ''"><i class="fa-solid fa-triangle-exclamation"></i>{{ q.trade.shortage }}</small>
    </div>
    <span class="ss-pill ss-pill-soft purse" data-bind-attr="title: q.trade.purseTitle"><i class="fa-solid fa-coins"></i>{{ q.trade.purse }}</span>
  </header>

  <section class="block" data-if="q.trade.open">
    <h4 class="ss-section-label"><i class="fa-solid fa-hand-holding-dollar"></i>Sell <small class="sec-note">to the general store</small></h4>
    <div class="ss-glass list">
      <ul class="ss-listcard-rows">
        <li class="ss-listcard-row" data-each="q.trade.sell as r">
          <div class="ss-listcard-item">
            <span class="ss-listcard-main">
              <span class="namerow">
                <span class="ss-listcard-title">{{ r.name }}<b class="qty" data-if="r.qty > 1">×{{ r.qty }}</b></span>
                <span class="ss-pill price" data-bind-attr="title: r.title">{{ r.price }}</span>
              </span>
              <span class="ss-listcard-sub" data-if="r.note != ''">{{ r.note }}</span>
            </span>
            <span class="acts">
              <button class="ss-button act sell" data-bind-attr="title: r.title" data-command="trade.sell" data-payload='{"stack":"{{ r.stack }}","qty":1}'>Sell</button>
              <button class="ss-button ss-button-quiet act all" data-if="r.qty > 1" title="Sell all {{ r.qty }}" data-command="trade.sell" data-payload='{"stack":"{{ r.stack }}","qty":{{ r.qty }}}'>All</button>
            </span>
          </div>
        </li>
      </ul>
    </div>
    <p class="none" data-if="len(q.trade.sell) == 0">Nothing to sell: what is worn stays.</p>
  </section>

  <section class="block" data-if="q.trade.open">
    <h4 class="ss-section-label"><i class="fa-solid fa-basket-shopping"></i>Buy</h4>
    <details class="ss-glass trader" data-each="q.trade.traders as t" data-bind-attr="open: t.first">
      <summary><span class="who">{{ t.label }}</span><small>{{ len(t.items) }} for sale</small></summary>
      <ul class="ss-listcard-rows">
        <li class="ss-listcard-row" data-each="t.items as r" data-class="${RARITY}">
          <div class="ss-listcard-item">
            <span class="ss-listcard-main">
              <span class="namerow">
                <span class="ss-listcard-title">{{ r.name }}</span>
                <span class="ss-pill price" data-bind-attr="title: r.title">{{ r.price }}</span>
              </span>
              <span class="ss-listcard-sub" data-if="r.note != ''">{{ r.note }}</span>
            </span>
            <span class="acts">
              <button class="ss-button act buy" data-bind-attr="title: r.title" data-command="trade.buy" data-payload='{"shop":"{{ t.shop }}","def":"{{ r.def }}","qty":1}'>Buy</button>
            </span>
          </div>
        </li>
      </ul>
      <p class="none" data-if="len(t.items) == 0">Nothing left to sell today.</p>
    </details>
  </section>

  <section class="block commission" data-if="q.trade.open">
    <h4 class="ss-section-label"><i class="fa-solid fa-hammer"></i>Commission</h4>
    <p class="none" data-if="len(q.trade.materials) == 0">No materials in the inventory to have something made from.</p>
    <div class="ss-glass list form" data-if="len(q.trade.materials) > 0">
      <input class="ss-input piece" type="text" maxlength="60" placeholder="What to have made, e.g. Skull Ring" aria-label="What to have made" data-draft="commission.piece">
      <select class="ss-input ss-select" aria-label="Who makes it" data-draft="commission.crafter">
        <option value="">Who makes it…</option>
        <option data-each="q.trade.crafters as c" data-bind-attr="value: c.kind">{{ c.label }}</option>
      </select>
      <select class="ss-input ss-select" aria-label="Made from" data-draft="commission.material">
        <option value="">Made from…</option>
        <option data-each="q.trade.materials as m" data-bind-attr="value: m.stack">{{ m.name }}</option>
      </select>
      <button class="ss-button ss-button-primary" data-if="draft.commission.material == null || draft.commission.material == ''" data-command="craft.commission" data-payload='{"piece":"{{ draft.commission.piece }}","materials":[],"crafter":"{{ draft.commission.crafter }}"}'>Commission</button>
      <button class="ss-button ss-button-primary" data-if="draft.commission.material != null && draft.commission.material != ''" data-command="craft.commission" data-payload='{"piece":"{{ draft.commission.piece }}","materials":[{"stack":"{{ draft.commission.material }}","qty":1}],"crafter":"{{ draft.commission.crafter }}"}'>Commission</button>
    </div>
  </section>

  <section class="block" data-if="len(q.trade.orders) > 0">
    <h4 class="ss-section-label"><i class="fa-solid fa-clock-rotate-left"></i>On order</h4>
    <div class="ss-glass list">
      <ul class="ss-listcard-rows">
        <li class="ss-listcard-row" data-each="q.trade.orders as o" data-class="due: o.due">
          <div class="ss-listcard-item">
            <span class="ss-listcard-main">
              <span class="namerow">
                <span class="ss-listcard-title">{{ o.name }}</span>
              </span>
              <span class="ss-listcard-sub">{{ o.crafter }} · {{ o.status }}</span>
            </span>
            <span class="acts">
              <button class="ss-button ss-button-primary act collect" data-if="o.collect" data-command="craft.collect" data-payload='{"order":"{{ o.id }}"}'>Collect</button>
            </span>
          </div>
        </li>
      </ul>
    </div>
  </section>
</div>
`;

const css = sheet(`
/* One inset for every trade line: a row's text sits at the card's padding (--ss-space-2) plus the row's own 6px, and the
   section labels, the traders' summaries and the commission form use the same, so they share one left edge. On a wide
   screen each section is capped at 720px, so a name, its price and its buttons stay close together. */
.rb-trade { gap: var(--ss-space-4); --trade-inset: calc(var(--ss-space-2) + 6px); }
.rb-trade > header, .rb-trade > section { max-width: 720px; }
.market { display: flex; flex-direction: row; align-items: center; gap: 10px; padding: var(--ss-space-3); }
.market .mark { font-size: 1.3em; color: var(--ss-accent); }
.market.closed .mark { color: var(--ss-muted); }
.market .main { display: grid; flex: 1 1 auto; min-width: 0; }
.market .place, .market .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market .line { font-size: 13px; color: var(--ss-muted); }
.market .short { color: var(--ss-warn); }
.market .short i { margin-right: 4px; }
.purse i { color: var(--ss-warn); margin-right: 4px; }
.purse { white-space: nowrap; font-variant-numeric: tabular-nums; }

.block { display: grid; gap: 8px; min-width: 0; }
/* the section label: its text on the rows' text line; the note is pushed to the right edge, after the label's rule */
.block > .ss-section-label { padding: 0 var(--trade-inset); }
.sec-note { order: 1; font-size: 13px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.block > .none { padding: 0 var(--trade-inset); }
.list { padding: var(--ss-space-1) var(--ss-space-2); }
/* the name line: the name, then its price pill beside it (left-aligned); a long name wraps and the pill follows it */
.namerow { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; }
.namerow > .ss-listcard-title { flex: 0 1 auto; min-width: 0; }
.price { flex: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
.qty { font-variant-numeric: tabular-nums; color: var(--ss-muted); }
/* the buttons: two fixed columns (Sell, then All), so the same button is in the same place in every row; a row with no All
   keeps its empty second column */
.ss-listcard-item .acts { flex: none; display: grid; grid-template-columns: repeat(2, 72px); gap: 6px; align-items: center; }
.acts .act { width: 100%; min-width: 0; min-height: 44px; padding-inline: 0; justify-content: center; }
.ss-listcard-row.r-uncommon .ss-listcard-title { color: var(--ss-uncommon); }
.ss-listcard-row.r-rare .ss-listcard-title { color: var(--ss-rare); }
.ss-listcard-row.r-epic .ss-listcard-title { color: var(--ss-epic); }
.ss-listcard-row.r-legendary .ss-listcard-title { color: var(--ss-legendary); }
.ss-listcard-row.due { box-shadow: inset 3px 0 0 var(--ss-good); }

.trader { padding: 0; }
.trader > summary { display: flex; align-items: baseline; gap: 8px; padding: 10px var(--trade-inset); cursor: pointer; font-weight: 600; }
.trader > summary small { margin-left: auto; font-weight: normal; }
.trader[open] > summary { border-bottom: 1px solid var(--ss-border); }
.trader > .ss-listcard-rows { padding: 4px var(--ss-space-2); }
.trader > .none { padding: 6px var(--trade-inset); }

.form { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); padding: var(--ss-space-1) var(--trade-inset); }
@container rb-screen (min-width: 640px) { .form { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto; } }
.form .ss-input { min-width: 0; width: 100%; }
.form .ss-button { justify-self: end; }
`);

export const tradeScreen = Object.freeze({
    id: 'rpg-battle/trade',
    title: 'Trade',
    icon: 'fa-scale-balanced',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({ trade: Object.freeze({ query: 'rpg-battle.trade' }) }),
    template,
    css,
});
