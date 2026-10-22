// RPG Battle v2, screen `rpg-battle/crafting` (MODULES §F102, feature `rpg-battle.crafting`): read-only.
// Crafting is story-driven (`! craft X | with: …`, rolled with the reply's own d20 and a code-built
// modifier table), so there are no buttons here: the screen shows, per character (companions craft
// too, with their own stats), the recipes they know, the materials each needs with what the party has
// and what is missing, the station it needs and whether one is here, and the code's chances of each
// outcome (fail, normal, fine, masterwork) as one stacked bar. The rows come from the craft part's
// `craft.view` through `rpg-battle.crafting` (view.js); without the craft part, or with the feature
// off, the screen says crafting is not set up.

import { THEME, sheet } from './style.js';

const template = `
<div class="rb rb-craft">
  <p class="empty" data-if="!q.craft.on"><i class="fa-solid fa-hammer"></i>Crafting is not set up in this chat.</p>
  <p class="empty" data-if="q.craft.on && q.craft.empty"><i class="fa-solid fa-scroll"></i>Nobody knows a recipe yet. The story can teach one.</p>
  <p class="lead" data-if="q.craft.on && !q.craft.empty">Crafting happens in the story: say who makes what, and with which materials. The chances below are the code's, from the crafter's stats, the station and the materials.</p>
  <section class="card crafter" data-each="q.craft.people as p" data-if="p.count > 0">
    <h4><i class="fa-solid fa-user"></i>{{ p.name }} <small><span data-if="p.skills != ''">{{ p.skills }} · </span>{{ p.count }} known</small></h4>
    <ul class="rows">
      <li class="row recipe" data-each="p.recipes as r" data-class="ready: r.ready; blocked: !r.ready">
        <div class="main">
          <span class="nm"><i class="fa-solid fa-circle-check ok" data-if="r.ready"></i>{{ r.name }}</span>
          <small class="sub"><span data-if="r.craft != ''">{{ r.craft }}</span><span data-if="r.station != ''" data-class="away: !r.stationOk"> · {{ r.station }}</span><span data-if="r.dc != null"> · DC {{ r.dc }}</span></small>
          <small class="why" data-if="!r.ready && r.why != ''">{{ r.why }}</small>
        </div>
        <ul class="mats" data-if="len(r.materials) > 0" aria-label="Materials">
          <li class="mat" data-each="r.materials as m" data-class="have: m.ok; lack: !m.ok" title="{{ m.name }}: {{ m.text }}"><span class="mat-nm">{{ m.name }}</span> <b>{{ m.text }}</b></li>
        </ul>
        <div class="odds" data-if="len(r.chances) > 0">
          <div class="odds-bar" role="img" aria-label="Chances for {{ r.name }}">
            <span data-each="r.chances as c" data-class="t-bad: c.tone == 'bad'; t-good: c.tone == 'good'; t-accent: c.tone == 'accent'" data-bind-var="--rb-share: ratio(c.pct, 100)" title="{{ c.label }} {{ c.pct }}%"></span>
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
.rb-craft { gap: 12px; }
.lead { font-size: 0.86em; color: var(--rb-muted); }
.crafter { display: grid; gap: 8px; }
.crafter > h4 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.crafter > h4 i { color: var(--rb-accent); }
.recipe { align-items: flex-start; }
.recipe .main { flex: 1 1 14em; }
.recipe .ok { margin-right: 5px; color: var(--rb-good); font-size: 0.85em; }
.recipe.blocked .nm { color: var(--rb-muted); }
.recipe .why { font-size: 0.8em; color: var(--rb-warn); white-space: normal; }
.away { color: var(--rb-warn); }
.mats { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; flex: 1 1 100%; min-width: 0; }
.mat { display: inline-flex; align-items: baseline; gap: 4px; max-width: 100%; padding: 1px 8px; border-radius: 999px; font-size: 0.8em; border: 1px solid var(--rb-line); }
.mat-nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mat b { font-variant-numeric: tabular-nums; }
.mat.have b { color: var(--rb-good); }
.mat.lack { border-color: color-mix(in srgb, var(--rb-bad) 50%, transparent); }
.mat.lack b { color: var(--rb-bad); }
.odds { display: grid; gap: 3px; flex: 1 1 100%; min-width: 0; }
.odds-bar { display: flex; height: 7px; border-radius: 4px; overflow: hidden; background: var(--rb-track); }
.odds-bar > span { flex: 0 0 calc(var(--rb-share, 0) * 100%); background: var(--rb-faint); }
.odds-key { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 0.76em; color: var(--rb-muted); }
.odds-key i { display: inline-block; width: 8px; height: 8px; margin-right: 4px; border-radius: 2px; background: var(--rb-faint); }
.t-bad, .odds-bar > .t-bad, .odds-key .t-bad i { --rb-tone: var(--rb-bad); }
.t-good { --rb-tone: var(--rb-good); }
.t-accent { --rb-tone: var(--rb-accent); }
.odds-bar > .t-bad, .odds-bar > .t-good, .odds-bar > .t-accent, .odds-key .t-bad i, .odds-key .t-good i, .odds-key .t-accent i { background: var(--rb-tone); }
`);

export const craftingScreen = Object.freeze({
    id: 'rpg-battle/crafting',
    title: 'Crafting',
    icon: 'fa-hammer',
    feature: 'rpg-battle.crafting',
    mounts: Object.freeze(['tab', 'screen']),
    data: Object.freeze({ craft: Object.freeze({ query: 'rpg-battle.crafting' }) }),
    theme: THEME,
    template,
    css,
});
