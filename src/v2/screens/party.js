// RPG Battle v2, screen `rpg-battle/party` (SPEC §13.1, MODULES §B1 "Tab: Party"): a glass card per party
// member, your character first, under the carry line (MODULES §F39) and the offers waiting for the reader (a
// join, a skill, a companion leaving: party.offers' sentence) with Accept and Dismiss. Before a character
// exists, the empty state has "Create your character" (widget `rpg-battle.create-character`, which opens the
// creation wizard). Each card is Story Block's hero (`ss.hero`: portrait, name, the level and class pill, HP /
// MP / SP bars and the EXP bar under the Terms' word, the conditions as status badges), then the effects as
// pills, what they wear (listcard rows with each piece's condition and refinement; features `rpg-battle.wear`,
// `rpg-battle.refine`), a line when they carry too much (`party.encumbered`), the skills as tiles (`ss.tiers`)
// with Use / Set aside in a fold, the stats as a radar with their check modifiers, and, while the member has
// points to spend, a stepper per stat and Spend (`party.spend { actor, points }`). A companion's card has two
// switches (`party.edit`, MODULES §F29, §F49): who gives orders in fights (on their own / you lead) and who
// spends their stat points (by build / by hand). Your own card has "Save character file" (widget
// rpg-battle.character-file, `party.export`, MODULES §F66). Equip, Take off and Give are in Story Block's
// Inventory (§F99). While your character is dead (a fight to the death lost), the return card (widget
// `rpg-battle.return-card`, the return part: what happened and Return) leads the screen; it draws nothing
// while they live.
//
// The steppers fill the screen's draft under `spend.<spendKey>.<STAT>`; `spendKey` changes when the level or
// the points do, so a finished spend never leaves old numbers in the steppers. The template cannot add the
// steppers up, so each one only stops at the member's points (and the stat cap): party.spend is the rule and
// refuses a total above the points with a plain sentence.

import { sheet } from './style.js';
import { SKILL_TREE_CSS } from './skill-tree.js';

const RARITY = "r-uncommon: g.rarity == 'uncommon'; r-rare: g.rarity == 'rare'; r-epic: g.rarity == 'epic'; r-legendary: g.rarity == 'legendary'";
// A worn piece's condition band as a listcard tag tone: good is the accent-free ring, worn amber, tattered and broken red.
const BAND = "ss-tone-good: g.condition.band == 'good'; ss-tone-warn: g.condition.band == 'worn'; ss-tone-bad: g.condition.band == 'tattered' || g.condition.band == 'broken'";

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

      <section class="block gear" data-if="len(a.gear) > 0">
        <p class="ss-label"><i class="fa-solid fa-shield-halved"></i>Wearing</p>
        <ul class="ss-listcard-rows">
          <li class="ss-listcard-row piece" data-each="a.gear as g" data-class="aside: !g.counted; ${RARITY}">
            <div class="ss-listcard-item">
              <span class="ss-listcard-icon"><i class="fa-solid fa-shield-halved"></i></span>
              <span class="ss-listcard-main">
                <span class="ss-listcard-title"><b class="refine" data-if="g.refine" title="{{ g.refine.text }}">{{ g.refine.label }}</b>{{ g.name }}</span>
                <span class="ss-listcard-sub">{{ g.slotLabel }}<span data-if="g.stats != ''"> · {{ g.stats }}</span><span data-if="!g.counted"> · {{ g.why }}</span></span>
              </span>
              <span class="ss-listcard-tag" data-if="g.condition" data-class="${BAND}" title="Condition: {{ g.condition.text }}"><i class="fa-solid fa-heart-crack" data-if="g.condition.band == 'broken'"></i><i class="fa-solid fa-shield-halved" data-if="g.condition.band != 'broken'"></i> {{ g.condition.label }}<span class="gear-count" data-if="g.condition.max > 0"> {{ g.condition.cur }}/{{ g.condition.max }}</span><span class="ss-bar-track gear-track" data-if="g.condition.max > 0" data-bind-var="--ss-fill: ratio(g.condition.cur, g.condition.max)"><span class="ss-bar-fill"></span></span></span>
            </div>
          </li>
        </ul>
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

.piece.aside .ss-listcard-title { color: var(--ss-muted); font-weight: 500; }
/* the wear as a thin bar and the number, in the tag (the player sees the durability on a phone) */
.gear-track { display: block; width: 3.2em; height: 4px; margin-top: 3px; }
.gear-count { font-variant-numeric: tabular-nums; }
.piece .refine { margin-right: 4px; padding: 0 6px; border-radius: var(--ss-radius-pill); font-size: 12px; color: var(--ss-accent); background: var(--ss-accent-soft); }
.piece.r-uncommon .ss-listcard-icon, .piece.r-rare .ss-listcard-icon, .piece.r-epic .ss-listcard-icon, .piece.r-legendary .ss-listcard-icon { box-shadow: inset 0 0 0 2px var(--ss-ring); }
.piece.r-uncommon .ss-listcard-title { color: var(--ss-uncommon); }
.piece.r-rare .ss-listcard-title { color: var(--ss-rare); }
.piece.r-epic .ss-listcard-title { color: var(--ss-epic); }
.piece.r-legendary .ss-listcard-title { color: var(--ss-legendary); }

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
