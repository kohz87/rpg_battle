// RPG Battle v2, screen `rpg-battle/trade` (MODULES §B4 "Tab page: Trade", one-line rows as v1
// 0.5.46): the market line (where, its prices, the purse), then Sell, Buy (one fold per trader, the
// general store open), Commission and On order, every price short ("12 g") with the long words in
// the button's title. Buttons: `trade.sell { stack, qty }`, `trade.buy { shop, def, qty }`,
// `craft.commission { piece, materials: [{ stack, qty }], crafter }`, `craft.collect { order }`.
// The trade commands check the market, the purse and the stock again and refuse with a sentence.
//
// The commission form fills the screen's draft (`commission.piece`, `.crafter`, `.material`); its
// button turns the draft into the command's payload. One material per commission from this form.

import { THEME, sheet } from './style.js';

const template = `
<div class="rb rb-trade">
  <header class="card market" data-class="closed: !q.trade.open">
    <i class="fa-solid fa-store mark"></i>
    <div class="main">
      <b class="place">{{ q.trade.place }}</b>
      <small class="line">{{ q.trade.line }}</small>
    </div>
    <span class="purse" data-bind-attr="title: q.trade.purseTitle"><i class="fa-solid fa-coins"></i>{{ q.trade.purse }}</span>
  </header>

  <section class="group" data-if="q.trade.open">
    <h4><i class="fa-solid fa-hand-holding-dollar"></i>Sell <small>to the general store</small></h4>
    <ul class="rows">
      <li class="row tline" data-each="q.trade.sell as r">
        <span class="nm">{{ r.name }}<b class="qty" data-if="r.qty > 1">×{{ r.qty }}</b></span>
        <small class="note" data-if="r.note != ''">{{ r.note }}</small>
        <span class="acts">
          <button class="btn price" data-bind-attr="title: r.title" data-command="trade.sell" data-payload='{"stack":"{{ r.stack }}","qty":1}'>{{ r.price }}</button>
          <button class="btn ghost" data-if="r.qty > 1" title="Sell all {{ r.qty }}" data-command="trade.sell" data-payload='{"stack":"{{ r.stack }}","qty":{{ r.qty }}}'>All</button>
        </span>
      </li>
    </ul>
    <p class="none" data-if="len(q.trade.sell) == 0">Nothing to sell: what is worn stays.</p>
  </section>

  <section class="group" data-if="q.trade.open">
    <h4><i class="fa-solid fa-basket-shopping"></i>Buy</h4>
    <details class="trader" data-each="q.trade.traders as t" data-bind-attr="open: t.first">
      <summary><span class="who">{{ t.label }}</span><small>{{ len(t.items) }} for sale</small></summary>
      <ul class="rows">
        <li class="row tline" data-each="t.items as r" data-class="r-uncommon: r.rarity == 'uncommon'; r-rare: r.rarity == 'rare'; r-epic: r.rarity == 'epic'; r-legendary: r.rarity == 'legendary'">
          <span class="nm">{{ r.name }}</span>
          <small class="note" data-if="r.note != ''">{{ r.note }}</small>
          <span class="acts">
            <button class="btn price" data-bind-attr="title: r.title" data-command="trade.buy" data-payload='{"shop":"{{ t.shop }}","def":"{{ r.def }}","qty":1}'>{{ r.price }}</button>
          </span>
        </li>
      </ul>
      <p class="none" data-if="len(t.items) == 0">Nothing left to sell today.</p>
    </details>
  </section>

  <section class="group commission" data-if="q.trade.open">
    <h4><i class="fa-solid fa-hammer"></i>Commission</h4>
    <p class="none" data-if="len(q.trade.materials) == 0">No materials in the inventory to have something made from.</p>
    <div class="form" data-if="len(q.trade.materials) > 0">
      <input class="field piece" type="text" maxlength="60" placeholder="What to have made, e.g. Skull Ring" aria-label="What to have made" data-draft="commission.piece">
      <select class="field" aria-label="Who makes it" data-draft="commission.crafter">
        <option value="">Who makes it…</option>
        <option data-each="q.trade.crafters as c" data-bind-attr="value: c.kind">{{ c.label }}</option>
      </select>
      <select class="field" aria-label="Made from" data-draft="commission.material">
        <option value="">Made from…</option>
        <option data-each="q.trade.materials as m" data-bind-attr="value: m.stack">{{ m.name }}</option>
      </select>
      <button class="btn primary" data-if="draft.commission.material == null || draft.commission.material == ''" data-command="craft.commission" data-payload='{"piece":"{{ draft.commission.piece }}","materials":[],"crafter":"{{ draft.commission.crafter }}"}'>Commission</button>
      <button class="btn primary" data-if="draft.commission.material != null && draft.commission.material != ''" data-command="craft.commission" data-payload='{"piece":"{{ draft.commission.piece }}","materials":[{"stack":"{{ draft.commission.material }}","qty":1}],"crafter":"{{ draft.commission.crafter }}"}'>Commission</button>
    </div>
  </section>

  <section class="group" data-if="len(q.trade.orders) > 0">
    <h4><i class="fa-solid fa-clock-rotate-left"></i>On order</h4>
    <ul class="rows">
      <li class="row tline" data-each="q.trade.orders as o" data-class="due: o.due">
        <span class="nm">{{ o.name }}</span>
        <small class="note">{{ o.crafter }} · {{ o.status }}</small>
        <span class="acts">
          <button class="btn primary" data-if="o.collect" data-command="craft.collect" data-payload='{"order":"{{ o.id }}"}'>Collect</button>
        </span>
      </li>
    </ul>
  </section>
</div>
`;

const css = sheet(`
.rb-trade { gap: 14px; }
.market { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.market .mark { font-size: 1.3em; color: var(--rb-accent); }
.market.closed .mark { color: var(--rb-muted); }
.market .main { display: grid; flex: 1 1 auto; min-width: 0; }
.market .place, .market .line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.market .line { font-size: 0.84em; }
.purse { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--rb-warn) 18%, transparent); border: 1px solid color-mix(in srgb, var(--rb-warn) 50%, transparent); white-space: nowrap; }
.purse i { color: var(--rb-warn); }

.tline { flex-wrap: nowrap; }
.tline .nm { flex: 0 1 auto; }
.tline .note { flex: 1 1 0; }
.tline .acts { flex: 0 0 auto; }
.tline.due { box-shadow: inset 3px 0 0 var(--rb-good); }

.trader { border-radius: 12px; border: 1px solid var(--rb-line); background: color-mix(in srgb, var(--rb-fg) 3%, transparent); }
.trader + .trader { margin-top: 2px; }
.trader > summary { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; cursor: pointer; font-weight: 600; }
.trader > summary small { margin-left: auto; }
.trader[open] > summary { border-bottom: 1px solid var(--rb-line); }
.trader > .rows, .trader > .none { padding: 6px; }

.form { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
@container rb-screen (min-width: 640px) { .form { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto; } }
.field { min-height: 32px; padding: 4px 10px; border-radius: 10px; border: 1px solid var(--rb-line); background: var(--rb-raised); color: var(--rb-fg); font: inherit; font-size: 0.9em; min-width: 0; }
.field:focus-visible { outline: 2px solid var(--rb-accent); outline-offset: 1px; }
.form .btn { justify-self: end; }
`);

export const tradeScreen = Object.freeze({
    id: 'rpg-battle/trade',
    title: 'Trade',
    icon: 'fa-scale-balanced',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({ trade: Object.freeze({ query: 'rpg-battle.trade' }) }),
    theme: THEME,
    template,
    css,
});
