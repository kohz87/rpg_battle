// RPG Battle v2, screen `rpg-battle/crafting` (MODULES §F102, feature `rpg-battle.crafting`): read-only.
// Crafting is story-driven (`! craft X | with: …`, rolled with the reply's own d20 and a code-built modifier
// table), so there are no buttons here: the screen shows, per character (companions craft too, with their own
// stats), the recipes they know as listcard rows, the materials each needs as pills (what the party has and what
// is missing), the station it needs and whether one is here, and the code's chances of each outcome (fail,
// normal, fine, masterwork) as one stacked bar. The rows come from the craft part's `craft.view` through
// `rpg-battle.crafting` (view.js); without the craft part, or with the feature off, the screen says crafting is
// not set up.

import { sheet } from './style.js';

const template = `
<div class="rb rb-craft">
  <p class="ss-glass empty" data-if="!q.craft.on"><i class="fa-solid fa-hammer"></i>Crafting is not set up in this chat.</p>
  <p class="ss-glass empty" data-if="q.craft.on && q.craft.empty"><i class="fa-solid fa-scroll"></i>Nobody knows a recipe yet. The story can teach one.</p>
  <p class="lead" data-if="q.craft.on && !q.craft.empty">Crafting happens in the story: say who makes what, and with which materials. The chances below are the code's, from the crafter's stats, the station and the materials.</p>
  <section class="ss-glass crafter" data-each="q.craft.people as p" data-if="p.count > 0">
    <p class="ss-label"><i class="fa-solid fa-user"></i>{{ p.name }} <small><span data-if="p.skills != ''">{{ p.skills }} · </span>{{ p.count }} known</small></p>
    <ul class="ss-listcard-rows">
      <li class="ss-listcard-row recipe" data-each="p.recipes as r" data-class="ready: r.ready; blocked: !r.ready">
        <div class="ss-listcard-item">
          <span class="ss-listcard-icon"><i class="fa-solid fa-circle-check" data-if="r.ready"></i><i class="fa-solid fa-hammer" data-if="!r.ready"></i></span>
          <span class="ss-listcard-main">
            <span class="ss-listcard-title">{{ r.name }}</span>
            <span class="ss-listcard-sub"><span data-if="r.craft != ''">{{ r.craft }}</span><span data-if="r.station != ''" data-class="away: !r.stationOk"> · {{ r.station }}</span><span data-if="r.dc != null"> · DC {{ r.dc }}</span></span>
            <span class="ss-listcard-sub why" data-if="!r.ready && r.why != ''">{{ r.why }}</span>
          </span>
          <span class="ss-listcard-tag" data-if="r.ready">Ready</span>
          <span class="ss-listcard-tag" data-if="!r.ready">Not yet</span>
        </div>
        <ul class="mats" data-if="len(r.materials) > 0" aria-label="Materials">
          <li class="ss-pill ss-pill-outline mat" data-each="r.materials as m" data-class="have: m.ok; lack: !m.ok" title="{{ m.name }}: {{ m.text }}"><span class="mat-nm">{{ m.name }}</span> <b>{{ m.text }}</b></li>
        </ul>
        <div class="odds" data-if="len(r.chances) > 0">
          <div class="odds-bar" role="img" aria-label="Chances for {{ r.name }}">
            <span data-each="r.chances as c" data-class="t-bad: c.tone == 'bad'; t-good: c.tone == 'good'; t-accent: c.tone == 'accent'" data-bind-var="--ss-fill: ratio(c.pct, 100)" title="{{ c.label }} {{ c.pct }}%"></span>
          </div>
          <ul class="odds-key">
            <li data-each="r.chances as c" data-class="t-bad: c.tone == 'bad'; t-good: c.tone == 'good'; t-accent: c.tone == 'accent'"><i></i>{{ c.label }} {{ c.pct }}%</li>
          </ul>
        </div>
      </li>
    </ul>
  </section>
</div>
`;

const css = sheet(`
.rb-craft { gap: var(--ss-space-3); }
.empty { display: flex; align-items: center; gap: 8px; margin: 0; padding: var(--ss-space-3); font-style: italic; color: var(--ss-muted); }
.empty i { color: var(--ss-accent); font-style: normal; }
.lead { font-size: 13px; color: var(--ss-muted); }
.crafter { display: grid; gap: 8px; padding: var(--ss-space-3); }
.crafter > .ss-label { margin: 0; }
.rb .ss-listcard-row.recipe { padding: 2px 0; }
.recipe .ss-listcard-icon i { color: var(--ss-accent); }
.recipe.ready .ss-listcard-icon i { color: var(--ss-good); }
.recipe.ready .ss-listcard-tag { border-color: var(--ss-good); }
.recipe.blocked .ss-listcard-title { color: var(--ss-muted); }
.recipe .why { color: var(--ss-warn); }
.away { color: var(--ss-warn); }
.recipe .ss-listcard-item { padding-bottom: 4px; }
.mats { list-style: none; margin: 0 0 4px; padding: 0 6px; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.mat { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; font-size: 12px; }
.mat-nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mat b { font-variant-numeric: tabular-nums; }
.mat.have { border-color: var(--ss-good); }
.mat.have b { color: var(--ss-good); }
.mat.lack { border-color: var(--ss-bad); }
.mat.lack b { color: var(--ss-bad); }
.odds { display: grid; gap: 3px; padding: 0 6px 4px; min-width: 0; }
.odds-bar { display: flex; height: 7px; border-radius: var(--ss-radius-pill); overflow: hidden; background: var(--ss-track); }
.odds-bar > span { flex: 0 0 calc(var(--ss-fill, 0) * 100%); background: var(--ss-muted); }
.odds-key { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 12px; color: var(--ss-muted); }
.odds-key i { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 2px; background: var(--ss-muted); }
.odds-bar > .t-bad, .odds-key .t-bad i { background: var(--ss-bad); }
.odds-bar > .t-good, .odds-key .t-good i { background: var(--ss-good); }
.odds-bar > .t-accent, .odds-key .t-accent i { background: var(--ss-accent); }
`);

export const craftingScreen = Object.freeze({
    id: 'rpg-battle/crafting',
    title: 'Crafting',
    icon: 'fa-hammer',
    feature: 'rpg-battle.crafting',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({ craft: Object.freeze({ query: 'rpg-battle.crafting' }) }),
    template,
    css,
});
