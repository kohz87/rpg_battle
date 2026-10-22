// RPG Battle v2, screen `rpg-battle/party` (SPEC §13.1, MODULES §B1 "Tab: Party"): a character card
// per party member, your character first, under the carry line (MODULES §F39) and the offers waiting
// for the reader (a join, a skill, a companion leaving: party.offers' sentence) with Accept and
// Dismiss. Each card: portrait, name, the level and class line, HP / MP / SP meters, the EXP meter,
// condition badges with the turns left, active effects (feature `rpg-battle.effects`), what they wear
// with each piece's condition band and refinement (features `rpg-battle.wear`, `rpg-battle.refine`),
// a line when they carry too much (`party.encumbered`),
// the skills as a tree by tier (those in use checked) with Use / Set aside, the stats as a radar with
// their check modifiers, and, while the member has points to spend, a stepper per stat and Spend
// (`party.spend { actor, points }`). A companion's card has two switches (`party.edit`, MODULES §F29,
// §F49): who gives orders in fights (on their own / you lead) and who spends their stat points (by
// build / by hand). Your own card has "Save character file" (widget rpg-battle.character-file,
// `party.export`, MODULES §F66). Equip, Take off and Give are in Story Block's Inventory (§F99).
//
// The steppers fill the screen's draft under `spend.<spendKey>.<STAT>`; `spendKey` changes when the
// level or the points do, so a finished spend never leaves old numbers in the steppers. The template
// cannot add the steppers up, so each one only stops at the member's points (and the stat cap):
// party.spend is the rule and refuses a total above the points with a plain sentence.

import { THEME, sheet } from './style.js';

const RARITY = "r-uncommon: g.rarity == 'uncommon'; r-rare: g.rarity == 'rare'; r-epic: g.rarity == 'epic'; r-legendary: g.rarity == 'legendary'";
const BAND = "b-good: g.condition.band == 'good'; b-worn: g.condition.band == 'worn'; b-tattered: g.condition.band == 'tattered'; b-broken: g.condition.band == 'broken'";

// One switch of two choices: the chosen one is a plain label, the other a button that sends it.
const choice = (field, value, label) => `
          <button class="btn chip" data-if="a.${field} != '${value}'" data-command="party.edit" data-payload='{"actor":"{{ a.id }}","${field}":"${value}"}'>${label}</button>
          <span class="btn chip on" data-if="a.${field} == '${value}'" aria-current="true">${label}</span>`;

const template = `
<div class="rb rb-party">
  <p class="carry" data-if="q.carry.on" data-class="over: q.carry.over"><i class="fa-solid fa-weight-hanging"></i>{{ q.carry.text }}</p>
  <p class="empty" data-if="len(q.cards) == 0"><i class="fa-solid fa-user-plus"></i>No character yet. Create yours to begin the story.</p>
  <section class="card offers" data-if="len(q.offers) > 0">
    <h4><i class="fa-solid fa-user-plus"></i>Waiting for you</h4>
    <ul class="rows">
      <li class="row offer" data-each="q.offers as o" data-class="leave: o.kind == 'leave'">
        <div class="main"><span class="nm">{{ o.text }}</span></div>
        <div class="acts">
          <button class="btn primary" data-command="party.acceptOffer" data-payload='{"offer":"{{ o.id }}"}'>Accept</button>
          <button class="btn ghost" data-command="party.dismissOffer" data-payload='{"offer":"{{ o.id }}"}'>Dismiss</button>
        </div>
      </li>
    </ul>
  </section>
  <div class="cards">
    <article class="card actor" data-each="q.cards as a" data-class="you: a.you; low: a.low; down: a.down; can-spend: a.spend">
      <header class="head">
        <ss-widget class="face" name="ss.portrait" data-props='{"src":"{{ a.portrait }}","name":"{{ a.name }}","frame":"circle","size":"md","tone":"accent"}'></ss-widget>
        <div class="who">
          <h3 class="name">{{ a.name }}<span class="tag" data-if="a.you">You</span></h3>
          <p class="line">{{ a.line }}</p>
        </div>
        <span class="points" data-if="a.spend" title="Stat points to spend"><i class="fa-solid fa-circle-up"></i>{{ a.points }}</span>
      </header>

      <div class="pools">
        <ss-widget class="pool hp" name="ss.meter" data-props='{"bind":"a.hp","label":"HP","icon":"fa-heart"}'></ss-widget>
        <ss-widget class="pool mp" name="ss.meter" data-props='{"bind":"a.mp","label":"MP","icon":"fa-droplet"}'></ss-widget>
        <ss-widget class="pool sp" name="ss.meter" data-props='{"bind":"a.sp","label":"SP","icon":"fa-bolt"}'></ss-widget>
      </div>
      <ss-widget class="pool xp" name="ss.meter" data-props='{"bind":"a.xp","label":"{{ a.xpName }}","icon":"fa-star","text":"{{ a.xpText }}"}'></ss-widget>

      <div class="badges" data-if="len(a.badges) > 0">
        <ss-widget data-each="a.badges as b" name="ss.badge" data-props='{"bind":"b"}'></ss-widget>
      </div>
      <p class="burden" data-if="a.encumbered"><i class="fa-solid fa-weight-hanging"></i>{{ a.encumbered.text }}</p>
      <div class="badges effects" data-if="len(a.effects) > 0" role="group" aria-label="Active effects">
        <ss-widget data-each="a.effects as e" name="ss.badge" data-props='{"bind":"e"}'></ss-widget>
      </div>

      <section class="block gear" data-if="len(a.gear) > 0">
        <h4><i class="fa-solid fa-shield-halved"></i>Wearing</h4>
        <ul class="rows">
          <li class="row piece" data-each="a.gear as g" data-class="aside: !g.counted; ${RARITY}">
            <div class="main">
              <span class="nm"><b class="refine" data-if="g.refine" title="{{ g.refine.text }}">{{ g.refine.label }}</b>{{ g.name }}</span>
              <small class="sub">{{ g.slotLabel }}<span data-if="g.stats != ''"> · {{ g.stats }}</span><span data-if="!g.counted"> · {{ g.why }}</span></small>
            </div>
            <span class="band" data-if="g.condition" data-class="${BAND}" title="Condition: {{ g.condition.text }}">
              <i class="fa-solid fa-heart-crack" data-if="g.condition.band == 'broken'"></i><i class="fa-solid fa-shield-halved" data-if="g.condition.band != 'broken'"></i>{{ g.condition.label }}<span class="bar" data-if="g.condition.meter" data-bind-var="--rb-ratio: ratio(g.condition.cur, g.condition.max)"><span></span></span>
            </span>
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
        <h4><i class="fa-solid fa-diagram-project"></i>Skills <small>{{ a.activeCount }} / {{ a.activeCap }} in use</small></h4>
        <ss-widget data-if="len(a.skills) > 0" name="ss.skill-tree" data-props='{"bind":"a.tree","label":"Skills of {{ a.name }}"}'></ss-widget>
        <p class="none" data-if="len(a.skills) == 0">No skills yet.</p>
        <details class="manage" data-if="len(a.skills) > 0">
          <summary>Use or set aside</summary>
          <ul class="rows">
            <li class="row skill" data-each="a.skills as k" data-class="aside: !k.active">
              <div class="main">
                <span class="nm">{{ k.name }}</span>
                <small class="sub">Lv {{ k.level }}<span data-if="k.cost != ''"> · {{ k.cost }}</span><span data-if="k.tier > 0"> · tier {{ k.tier }}</span></small>
              </div>
              <div class="acts">
                <button class="btn ghost" data-if="k.active" data-command="party.setSkillActive" data-payload='{"actor":"{{ a.id }}","name":"{{ k.name }}","active":false}'>Set aside</button>
                <button class="btn" data-if="!k.active" data-command="party.setSkillActive" data-payload='{"actor":"{{ a.id }}","name":"{{ k.name }}","active":true}'>Use</button>
              </div>
            </li>
          </ul>
        </details>
      </section>

      <section class="block stats">
        <h4><i class="fa-solid fa-chart-simple"></i>Stats</h4>
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
        <h4><i class="fa-solid fa-circle-up"></i>Spend points <small>{{ a.points }} to spend</small></h4>
        <div class="steppers">
          <ss-widget data-each="a.stats as s" name="ss.stepper" data-props='{"name":"spend.{{ a.spendKey }}.{{ s.key }}","label":"{{ s.key }} {{ s.value }}","value":{{ draft.spend[a.spendKey][s.key] }},"min":0,"max":{{ s.room }},"tone":"accent"}'></ss-widget>
        </div>
        <button class="btn primary" data-command="party.spend" data-payload='{"actor":"{{ a.id }}","points":{{ draft.spend[a.spendKey] }}}'><i class="fa-solid fa-check"></i>Spend points</button>
      </section>

      <footer class="block file" data-if="a.you">
        <ss-widget name="rpg-battle.character-file" data-props='{}'></ss-widget>
      </footer>
    </article>
  </div>
</div>
`;

const css = sheet(`
.cards { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@container rb-screen (min-width: 760px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container rb-screen (min-width: 1180px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.actor { container: rb-card / inline-size; display: grid; gap: 10px; align-content: start; }
.actor.you { border-color: color-mix(in srgb, var(--rb-accent) 45%, transparent); }
.actor.down { filter: grayscale(0.7); }
.actor.low .pool.hp .ss-w-meter-fill { animation: rb-pulse 1.2s ease-in-out infinite; }
@keyframes rb-pulse { 50% { opacity: 0.55; } }

.head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.head .face { flex: 0 0 auto; }
.head .ss-w-portrait-frame { box-shadow: 0 0 0 3px color-mix(in srgb, var(--rb-accent) 20%, transparent); }
.who { flex: 1 1 auto; min-width: 0; }
.name { display: flex; align-items: center; gap: 6px; font-size: 1.12em; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { padding: 1px 7px; border-radius: 999px; font-size: 0.62em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: color-mix(in srgb, var(--rb-accent) 22%, transparent); color: var(--rb-accent); }
.line { font-size: 0.84em; color: var(--rb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.points { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-weight: 700; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--rb-good) 22%, transparent); color: var(--rb-fg); border: 1px solid color-mix(in srgb, var(--rb-good) 55%, transparent); }
.points i { color: var(--rb-good); }

.pools { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
@container rb-card (min-width: 400px) { .pools { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.block { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid var(--rb-line); min-width: 0; }
.manage > summary { cursor: pointer; font-size: 0.82em; color: var(--rb-muted); padding: 2px 0; }
.manage[open] > summary { margin-bottom: 4px; }
.skill.aside .nm { color: var(--rb-muted); font-weight: 500; }
.rb .ss-w-tree-skill { border-radius: 10px; background: var(--rb-raised); }
.rb .ss-w-tree-skill[data-state="active"] { background: color-mix(in srgb, var(--rb-accent) 14%, transparent); }
.rb .ss-w-tree-icon { color: var(--rb-accent); font-size: 1.2em; }

.stat-body { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); align-items: center; }
@container rb-card (min-width: 400px) { .stat-body { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.radar { justify-self: center; width: 100%; max-width: 15em; }
.rb .ss-w-radar { --ss-w-radar-size: 15em; }
.stat-list { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 0; }
@container rb-card (min-width: 400px) { .stat-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.stat { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; padding: 4px 8px; border-radius: 8px; background: var(--rb-raised); }
.stat dt { font-size: 0.74em; font-weight: 700; letter-spacing: 0.05em; color: var(--rb-muted); }
.stat dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat dd small { margin-left: 3px; font-size: 0.75em; color: var(--rb-good); }

.spend { border-top-color: color-mix(in srgb, var(--rb-good) 45%, transparent); }
.steppers { display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@container rb-card (min-width: 400px) { .steppers { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.spend .btn.primary { justify-self: end; }
.offers { display: grid; gap: 6px; margin-bottom: 12px; }
.offer.leave .nm { color: var(--rb-muted); }
.carry { margin: 0; font-size: 0.85em; color: var(--rb-muted); }
.carry i { margin-right: 6px; }
.carry.over { color: var(--rb-bad); }
.burden { display: flex; align-items: center; gap: 6px; font-size: 0.84em; font-weight: 600; color: var(--rb-warn); }

.piece.aside .nm { color: var(--rb-muted); font-weight: 500; }
.piece .refine { margin-right: 5px; padding: 0 6px; border-radius: 999px; font-size: 0.8em; color: var(--rb-accent); background: color-mix(in srgb, var(--rb-accent) 18%, transparent); }
.band {
  --rb-tone: var(--rb-good); display: inline-flex; align-items: center; gap: 5px; margin-left: auto; padding: 1px 8px;
  border-radius: 999px; font-size: 0.78em; font-weight: 700; white-space: nowrap;
  background: color-mix(in srgb, var(--rb-tone) 16%, transparent); border: 1px solid color-mix(in srgb, var(--rb-tone) 45%, transparent);
}
.band i { color: var(--rb-tone); }
.band.b-worn { --rb-tone: var(--rb-warn); }
.band.b-tattered, .band.b-broken { --rb-tone: var(--rb-bad); }
.band .bar { display: inline-block; width: 3em; height: 4px; border-radius: 2px; overflow: hidden; background: var(--rb-track); }
.band .bar > span { display: block; height: 100%; width: calc(var(--rb-ratio, 0) * 100%); background: var(--rb-tone); }

.switches { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.switch { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.switch .lbl { font-size: 0.78em; color: var(--rb-muted); margin-right: 2px; }
.switch .btn.on { cursor: default; background: color-mix(in srgb, var(--rb-accent) 38%, transparent); border-color: var(--rb-accent); }
.switch .btn:not(.on) { background: transparent; border-color: var(--rb-line); }
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
    }),
    theme: THEME,
    template,
    css,
});
