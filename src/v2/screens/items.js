// RPG Battle v2, screen `rpg-battle/items` (MODULES §B2 "Tab page: Items"): what the party carries,
// one line each. Consumables show what they do and who would gain from a dose now; using one is
// the story's (MODULES §F96: `! use <item> | on: Name`), so there is no Use button. Equipment has
// Equip or Take off (`item.equip` / `item.unequip { stack }`); anything can be given to another
// member (`item.give { stack, to }`): bag management, told to the next reply. With the carry limit on (MODULES §F39), a line says what the party carries.

import { THEME, sheet } from './style.js';

const give = `
          <details class="give" data-if="len(r.give) > 0">
            <summary class="btn ghost"><i class="fa-solid fa-hand-holding"></i>Give</summary>
            <div class="pop">
              <button class="btn chip" data-each="r.give as g" data-command="item.give" data-payload='{"stack":"{{ r.stack }}","to":"{{ g.id }}"}' title="Give to {{ g.name }}">{{ g.name }}</button>
            </div>
          </details>`;

const rarity = "r-uncommon: r.rarity == 'uncommon'; r-rare: r.rarity == 'rare'; r-epic: r.rarity == 'epic'; r-legendary: r.rarity == 'legendary'";

const template = `
<div class="rb rb-items">
  <p class="carry" data-if="q.items.carry.on" data-class="over: q.items.carry.over"><i class="fa-solid fa-weight-hanging"></i>{{ q.items.carry.text }}</p>
  <p class="empty" data-if="q.items.empty"><i class="fa-solid fa-box-open"></i>The party carries nothing to use, wear or give.</p>

  <section class="group" data-if="len(q.items.consumables) > 0">
    <h4><i class="fa-solid fa-flask"></i>Consumables</h4>
    <ul class="rows">
      <li class="row item use" data-each="q.items.consumables as r" data-class="${rarity}">
        <div class="main">
          <span class="nm">{{ r.name }}<b class="qty" data-if="r.qty > 1">×{{ r.qty }}</b></span>
          <small class="sub">{{ r.effect }} · {{ r.holder }}</small>
        </div>
        <div class="acts">
          <span class="lbl">Would help</span>
          <span class="chip who" data-each="r.targets as t" data-if="t.helps != false">{{ t.name }}</span>${give}
        </div>
      </li>
    </ul>
  </section>

  <section class="group" data-if="len(q.items.equipment) > 0">
    <h4><i class="fa-solid fa-shield-halved"></i>Equipment</h4>
    <ul class="rows">
      <li class="row item gear" data-each="q.items.equipment as r" data-class="worn: r.equipped; ${rarity}">
        <div class="main">
          <span class="nm"><i class="fa-solid fa-check on" data-if="r.equipped"></i>{{ r.name }}</span>
          <small class="sub">{{ r.slotLabel }}<span data-if="r.stats != ''"> · {{ r.stats }}</span> · {{ r.wearerLine }}</small>
        </div>
        <div class="acts">
          <button class="btn" data-if="!r.equipped" data-command="item.equip" data-payload='{"stack":"{{ r.stack }}"}'>Equip</button>
          <button class="btn ghost" data-if="r.equipped" data-command="item.unequip" data-payload='{"stack":"{{ r.stack }}"}'>Take off</button>${give}
        </div>
      </li>
    </ul>
  </section>

  <section class="group" data-if="len(q.items.other) > 0">
    <h4><i class="fa-solid fa-sack-xmark"></i>Other things</h4>
    <ul class="rows">
      <li class="row item" data-each="q.items.other as r" data-class="${rarity}">
        <div class="main">
          <span class="nm">{{ r.name }}<b class="qty" data-if="r.qty > 1">×{{ r.qty }}</b></span>
          <small class="sub"><span data-if="r.note != ''">{{ r.note }} · </span>{{ r.holder }}</small>
        </div>
        <div class="acts">${give}
        </div>
      </li>
    </ul>
  </section>
</div>
`;

const css = sheet(`
.rb-items { gap: 14px; }
.chip.who { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 0.82em; background: var(--rb-raised); }
.carry { margin: 0; font-size: 0.85em; color: var(--rb-muted); }
.carry i { margin-right: 6px; }
.carry.over { color: var(--rb-bad); }
.gear.worn { background: color-mix(in srgb, var(--rb-accent) 10%, transparent); border-color: color-mix(in srgb, var(--rb-accent) 30%, transparent); }
.gear .on { margin-right: 5px; font-size: 0.85em; color: var(--rb-good); }
@container rb-screen (max-width: 480px) {
  .row .acts { width: 100%; margin-left: 0; }
}
`);

export const itemsScreen = Object.freeze({
    id: 'rpg-battle/items',
    title: 'Items',
    icon: 'fa-flask',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({ items: Object.freeze({ query: 'rpg-battle.items' }) }),
    theme: THEME,
    template,
    css,
});
