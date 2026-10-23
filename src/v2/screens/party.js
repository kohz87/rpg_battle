// RPG Battle v2, screen `rpg-battle/party` (SPEC §13.1, MODULES §B1 "Tab: Party"): a glass card per party
// member, your character first, under the carry line (MODULES §F39) and the offers waiting for the reader (a
// join, a skill, a companion leaving: party.offers' sentence) with Accept and Dismiss. Before a character
// exists, the empty state has "Create your character" (widget `rpg-battle.create-character`, which opens the
// creation wizard). Each card is Story Block's hero (`ss.hero`: portrait, name, the level and class pill, HP /
// MP / SP bars and the EXP bar under the Terms' word, the conditions as status badges), then the effects as
// pills, what they wear as the EQUIPMENT paper-doll (the portrait and name, then a tile per slot the rules define with each piece's
// condition and refinement; features `rpg-battle.wear`, `rpg-battle.refine`), a line when they carry too much (`party.encumbered`), the skills as tiles (`ss.tiers`)
// with Use / Set aside in a fold, the stats as a radar with their check modifiers, and, while the member has
// points to spend, a stepper per stat and Spend (`party.spend { actor, points }`). A companion's card has two
// switches (`party.edit`, MODULES §F29, §F49): who gives orders in fights (on their own / you lead) and who
// spends their stat points (by build / by hand). Your own card has "Save character file" (widget
// rpg-battle.character-file, `party.export`, MODULES §F66). Equip, Take off, Give and Drop are on the EQUIPMENT
// card (UI 8h, `paperdoll.js`: the items part's `item.equip`, `item.unequip`, `item.give` and Story Block's `inventory.drop`). While your character is dead (a fight to the death lost), the return card (widget
// `rpg-battle.return-card`, the return part: what happened and Return) leads the screen; it draws nothing
// while they live.
//
// The steppers fill the screen's draft under `spend.<spendKey>.<STAT>`; `spendKey` changes when the level or
// the points do, so a finished spend never leaves old numbers in the steppers. The template cannot add the
// steppers up, so each one only stops at the member's points (and the stat cap): party.spend is the rule and
// refuses a total above the points with a plain sentence.

import { sheet } from './style.js';
import { SKILL_TREE_CSS } from './skill-tree.js';

const TILE_RARITY = "r-uncommon: t.rarity == 'uncommon'; r-rare: t.rarity == 'rare'; r-epic: t.rarity == 'epic'; r-legendary: t.rarity == 'legendary'";

// One switch of two choices: the chosen one is a plain pill, the other a glass button that sends it.
const choice = (field, value, label) => `
          <button class="ss-button ss-button-quiet" data-if="a.${field} != '${value}'" data-command="party.edit" data-payload='{"actor":"{{ a.id }}","${field}":"${value}"}'>${label}</button>
          <span class="ss-pill ss-pill-soft" data-if="a.${field} == '${value}'" aria-current="true">${label}</span>`;

const template = `
<div class="rb rb-party">
  <ss-widget class="return" name="rpg-battle.return-card" data-props='{"bind":"q.ret"}'></ss-widget>
  <p class="carry" data-if="q.carry.on" data-class="over: q.carry.over"><i class="fa-solid fa-weight-hanging"></i>{{ q.carry.text }}</p>
  <div class="ss-glass empty start" data-if="len(q.cards) == 0">
    <p><i class="fa-solid fa-user-plus"></i>No character yet. Create yours to begin the story.</p>
    <ss-widget class="create" name="rpg-battle.create-character"></ss-widget>
  </div>
  <section class="ss-glass offers" data-if="len(q.offers) > 0">
    <p class="ss-label"><i class="fa-solid fa-user-plus"></i>Waiting for you</p>
    <ul class="ss-listcard-rows">
      <li class="ss-listcard-row offer" data-each="q.offers as o" data-class="leave: o.kind == 'leave'">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main"><span class="ss-listcard-title">{{ o.text }}</span></span>
          <span class="acts">
            <button class="ss-button ss-button-primary" data-command="party.acceptOffer" data-payload='{"offer":"{{ o.id }}"}'>Accept</button>
            <button class="ss-button ss-button-quiet" data-command="party.dismissOffer" data-payload='{"offer":"{{ o.id }}"}'>Dismiss</button>
          </span>
        </div>
      </li>
    </ul>
  </section>
  <div class="cards">
    <article class="ss-glass actor" data-each="q.cards as a" data-class="you: a.you; low: a.low; down: a.down; can-spend: a.spend">
      <p class="card-head" data-if="a.spend"><span class="ss-pill ss-pill-soft points-head" title="Stat points to spend">{{ a.points }} to spend</span></p>
      <ss-widget class="hero" name="ss.hero" data-props='{"bind":"a.hero"}'></ss-widget>

      <div class="effects" data-if="len(a.effects) > 0" role="group" aria-label="Active effects">
        <span class="ss-pill ss-pill-outline effect" data-each="a.effects as e" data-class="ss-tone-good: e.tone == 'good'; ss-tone-bad: e.tone == 'bad'" title="{{ e.label }}">{{ e.text }}</span>
      </div>
      <p class="burden" data-if="a.encumbered"><i class="fa-solid fa-weight-hanging"></i>{{ a.encumbered.text }}</p>

      <section class="block doll-block">
        <h4 class="ss-section-label"><i class="fa-solid fa-shield-halved"></i>Equipment</h4>
        <div class="doll">
          <figure class="figure">
            <ss-widget class="portrait" name="ss.portrait" data-props='{"src":"{{ a.portrait }}","name":"{{ a.name }}","frame":"rounded","size":"md","tone":"accent"}'></ss-widget>
            <figcaption class="doll-name">{{ a.name }}</figcaption>
          </figure>
          <ul class="slots">
            <li class="slot" data-each="a.paperdoll.tiles as t" data-class="${TILE_RARITY}">
              <details class="tile filled" data-if="t.filled" data-class="extra: t.extra">
                <summary class="tile-face" data-bind-attr="title: t.stats">
                  <span class="slot-name">{{ t.label }}</span>
                  <span class="item-name"><b class="refine" data-if="t.refine != ''">{{ t.refine }}</b>{{ t.name }}</span>
                  <span class="cond" data-if="t.cond != ''" data-class="ss-tone-good: t.condTone == 'good'; ss-tone-warn: t.condTone == 'warn'; ss-tone-bad: t.condTone == 'bad'" title="{{ t.condTitle }}"><i class="fa-solid fa-heart-crack" data-if="t.condBroken"></i>{{ t.cond }}<span class="bar" data-if="t.meter" data-bind-var="--ss-fill: ratio(t.cur, t.max)"><span class="bar-fill"></span></span></span>
                  <span class="why" data-if="t.why != ''">{{ t.why }}</span>
                </summary>
                <div class="acts">
                  <button class="ss-button" data-command="item.unequip" data-payload='{"stack":"{{ t.stack }}"}'><i class="fa-solid fa-hand" aria-hidden="true"></i> Take off</button>
                  <details class="pick give" data-if="len(t.givers) > 0">
                    <summary class="ss-button"><i class="fa-solid fa-hand-holding" aria-hidden="true"></i> Give…</summary>
                    <span class="choices"><button class="ss-button" data-each="t.givers as to" data-command="item.give" data-payload='{"stack":"{{ t.stack }}","to":"{{ to.id }}"}'>{{ to.name }}</button></span>
                  </details>
                  <details class="pick drop">
                    <summary class="ss-button ss-button-danger"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> Drop</summary>
                    <span class="choices"><button class="ss-button ss-button-danger" data-command="inventory.drop" data-payload='{"stack":"{{ t.stack }}","qty":{{ t.qty }}}'>Drop it</button></span>
                  </details>
                </div>
              </details>
              <div class="tile empty" data-if="t.empty">
                <span class="slot-name">{{ t.label }}</span>
                <span class="item-name" data-if="t.note == ''">Empty</span>
                <span class="item-name" data-if="t.note != ''">{{ t.note }}</span>
                <details class="pick equip" data-if="len(t.equip) > 0">
                  <summary class="ss-button"><i class="fa-solid fa-hand-fist" aria-hidden="true"></i> Equip…</summary>
                  <span class="choices"><button class="ss-button" data-each="t.equip as e" data-command="item.equip" data-payload='{"stack":"{{ e.id }}"}'>{{ e.name }}</button></span>
                </details>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section class="block switches" data-if="a.companion">
        <div class="switch" role="group" aria-label="Who gives {{ a.name }} orders in fights">
          <span class="lbl">In fights</span>${choice('control', 'auto', 'On their own')}${choice('control', 'player', 'You lead')}
        </div>
        <div class="switch" role="group" aria-label="Who spends the stat points of {{ a.name }}">
          <span class="lbl">Stat points</span>${choice('growth', 'auto', 'By build')}${choice('growth', 'manual', 'By hand')}
        </div>
      </section>

      <section class="block skills">
        <p class="ss-label"><i class="fa-solid fa-diagram-project"></i>Skills <small>{{ a.activeCount }} / {{ a.activeCap }} in use</small></p>
        <ss-widget data-if="len(a.skills) > 0" name="rpg-battle.skill-tree" data-props='{"bind":"a.skillNodes","label":"Skills of {{ a.name }}","columns":3,"actor":"{{ a.id }}","setCommand":"party.setSkillActive"}'></ss-widget>
        <p class="none" data-if="len(a.skills) == 0">No skills yet.</p>
        <details class="manage" data-if="len(a.skills) > 0">
          <summary>Use or set aside</summary>
          <ul class="ss-listcard-rows">
            <li class="ss-listcard-row skill" data-each="a.skills as k" data-class="aside: !k.active">
              <div class="ss-listcard-item">
                <span class="ss-listcard-main">
                  <span class="ss-listcard-title">{{ k.name }}</span>
                  <span class="ss-listcard-sub">Lv {{ k.level }}<span data-if="k.progress != ''"> · {{ k.progress }}</span><span data-if="k.cost != ''"> · {{ k.cost }}</span><span data-if="k.tier > 0"> · tier {{ k.tier }}</span></span>
                </span>
                <span class="acts">
                  <button class="ss-button ss-button-quiet" data-if="k.active" data-command="party.setSkillActive" data-payload='{"actor":"{{ a.id }}","name":"{{ k.name }}","active":false}'>Set aside</button>
                  <button class="ss-button" data-if="!k.active" data-command="party.setSkillActive" data-payload='{"actor":"{{ a.id }}","name":"{{ k.name }}","active":true}'>Use</button>
                </span>
              </div>
            </li>
          </ul>
        </details>
      </section>

      <section class="block stats">
        <p class="ss-label"><i class="fa-solid fa-chart-simple"></i>Stats</p>
        <div class="stat-body">
          <ss-widget class="radar" name="ss.radar" data-props='{"bind":"a.statAxes","label":"Stats of {{ a.name }}","levels":4,"showValues":false}'></ss-widget>
          <dl class="stat-list">
            <div class="stat" data-each="a.stats as s" title="{{ s.label }}">
              <dt>{{ s.key }}</dt>
              <dd>{{ s.value }}<small data-if="s.mod != ''">{{ s.mod }}</small></dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="block spend" data-if="a.spend">
        <p class="ss-label"><i class="fa-solid fa-circle-up"></i>Spend points <span class="ss-pill ss-pill-soft points">{{ a.points }} to spend</span></p>
        <div class="steppers">
          <ss-widget data-each="a.stats as s" name="ss.stepper" data-props='{"name":"spend.{{ a.spendKey }}.{{ s.key }}","label":"{{ s.key }} {{ s.value }}","value":{{ draft.spend[a.spendKey][s.key] }},"min":0,"max":{{ s.room }},"tone":"accent"}'></ss-widget>
        </div>
        <button class="ss-button ss-button-primary spend-go" data-command="party.spend" data-payload='{"actor":"{{ a.id }}","points":{{ draft.spend[a.spendKey] }}}'><i class="fa-solid fa-check"></i>Spend points</button>
      </section>

      <footer class="block file" data-if="a.you">
        <ss-widget name="rpg-battle.character-file" data-props='{}'></ss-widget>
      </footer>
    </article>
  </div>
</div>
`;

const css = sheet(`${SKILL_TREE_CSS}
.empty.start { display: grid; gap: 10px; justify-items: center; text-align: center; }
.empty.start p { margin: 0; }
.cards { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@container rb-screen (min-width: 760px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container rb-screen (min-width: 1180px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.actor { container: rb-card / inline-size; display: grid; gap: 10px; align-content: start; padding: var(--ss-space-3); }
.actor.you { border-color: var(--ss-accent); }
.actor.down { filter: grayscale(0.7); }
.rb .hero { display: block; }

.effects { display: flex; flex-wrap: wrap; gap: var(--ss-space-1); }
.effect { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.effect.ss-tone-bad { border-color: var(--ss-bad); }
.effect.ss-tone-good { border-color: var(--ss-good); }
.card-head { display: flex; justify-content: flex-end; margin: 0; }
.burden { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ss-warn); }

.block { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--ss-border); min-width: 0; }
.block > .ss-label { margin: 0; }
.manage > summary { cursor: pointer; font-size: 13px; color: var(--ss-muted); padding: 2px 0; }
.manage[open] > summary { margin-bottom: 4px; }
.rb .ss-tiers { margin: 0; }

.stat-body { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); align-items: center; }
@container rb-card (min-width: 400px) { .stat-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.radar { justify-self: center; width: 100%; max-width: 15em; }
.rb .ss-w-radar { --ss-w-radar-size: 15em; }
.stat-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 0; }
@container rb-card (min-width: 400px) { .stat-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.stat { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; padding: 4px 8px; border-radius: var(--ss-radius-s); background: var(--ss-tile); }
.stat dt { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--ss-muted); }
.stat dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat dd small { margin-left: 3px; font-size: 0.75em; color: var(--ss-good); }

.spend { border-top-color: var(--ss-accent); }
.points { margin-left: auto; }
.steppers { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@container rb-card (min-width: 400px) { .steppers { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.spend-go { justify-self: end; }
.offers { display: grid; gap: 6px; margin-bottom: 12px; }
.offer.leave .ss-listcard-title { color: var(--ss-muted); }
.carry { margin: 0; font-size: 13px; color: var(--ss-muted); }
.carry i { margin-right: 6px; }
.carry.over { color: var(--ss-bad); }


/* EQUIPMENT (UI 8h): the portrait and name on the left (taller than wide from 420px), the slots in two columns on the
   right; a phone stacks them. Each slot is a glass tile; a filled one is a disclosure whose face is the tile (44px) and
   whose actions are Story Block's buttons. */
.doll-block { container: rb-doll / inline-size; }
.doll { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); align-items: start; min-width: 0; }
.figure { margin: 0; display: grid; gap: 6px; justify-items: center; align-content: start; min-width: 0; }
.figure .doll-name { font-weight: 600; text-align: center; overflow-wrap: anywhere; }
.slots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; min-width: 0; }
@container rb-doll (min-width: 420px) {
    .doll { grid-template-columns: minmax(0, 3fr) minmax(0, 7fr); }
    .figure { aspect-ratio: 3 / 4; align-content: center; }
}
.slot { min-width: 0; }
.tile { display: block; min-width: 0; border-radius: var(--ss-radius-s); background: var(--ss-tile); border: 1px solid var(--ss-border); }
.tile.extra { border-style: dashed; }
.slot.r-uncommon .tile, .slot.r-rare .tile, .slot.r-epic .tile, .slot.r-legendary .tile { box-shadow: inset 3px 0 0 var(--ss-ring); }
.tile-face { display: grid; gap: 2px; min-height: 44px; padding: 6px 8px; list-style: none; cursor: pointer; border-radius: var(--ss-radius-s); }
.tile-face::-webkit-details-marker { display: none; }
.tile-face:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: -2px; }
.tile.empty { display: grid; gap: 2px; min-height: 44px; padding: 6px 8px; border: 1px dashed var(--ss-border); border-radius: var(--ss-radius-s); background: none; }
.slot-name { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ss-text); }
.item-name { font-weight: 600; font-size: 13px; line-height: 1.25; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.tile.empty .item-name { font-weight: 500; color: var(--ss-muted); }
.tile .refine { margin-right: 4px; padding: 0 6px; border-radius: var(--ss-radius-pill); font-size: 12px; color: var(--ss-accent); background: var(--ss-accent-soft); }
.cond { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
.cond.ss-tone-warn { color: var(--ss-warn); }
.cond.ss-tone-bad { color: var(--ss-bad); }
.cond .bar { display: block; width: 3.2em; height: 4px; }
.cond .bar-fill { display: block; height: 100%; width: calc(var(--ss-fill, 0) * 100%); border-radius: 2px; background: currentColor; }
.why { font-size: 11px; color: var(--ss-text); }
.doll .acts { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px 8px; }
.doll .acts > .ss-button, .doll .pick > summary { min-height: 44px; }
.doll .pick > summary { list-style: none; }
.doll .pick > summary::-webkit-details-marker { display: none; }
.doll .pick .choices { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin-top: 6px; }
.doll .pick .choices .ss-button { min-height: 44px; white-space: normal; text-align: left; overflow-wrap: anywhere; }
.doll .drop .choices { display: flex; }
.switches { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.switch { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.switch .lbl { font-size: 12px; color: var(--ss-muted); margin-right: 2px; }
.file { justify-items: start; }
`);

export const partyScreen = Object.freeze({
    id: 'rpg-battle/party',
    title: 'Party',
    icon: 'fa-users',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({
        cards: Object.freeze({ query: 'rpg-battle.cards' }),
        offers: Object.freeze({ query: 'party.offers' }),
        carry: Object.freeze({ query: 'rpg-battle.carry' }),
        // The return card's own answer (return part): drawn again when your character dies or comes back.
        ret: Object.freeze({ query: 'return.status' }),
    }),
    template,
    css,
});
