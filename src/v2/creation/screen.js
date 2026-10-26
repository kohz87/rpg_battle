// The character creation wizard (SPEC §13.1, §13.2, §13.6; MODULES §F12): screen `rpg-battle/create`, shown as a
// dialog. Its steps share one draft:
//
//   { name, background, race, talents: [ids], points: { STR: n, … }, portrait }
//
// `name` and `background` are the SillyTavern persona's (MODULES §F22), put there by the opener and shown read-only;
// the reader picks the rest. The last step sends it as one `creation.finish` command; that command checks every rule.
// The screen's data query `creation.content` gives the lists. The numbers that follow the draft (points left, the final
// stats, the radar) come from the `creation.build` query called in the template's expressions with the draft and the
// module's settings, since the template language has no arithmetic (TEMPLATES.md §1.2). Where the host does not give
// templates `query`, those show empty and the steppers run without a budget; creation.finish still enforces it.
//
// Layout: every step is the summary strip "Your character" (portrait, name, race, talents and the final stats, one wrapping row
// across the dialog, drawn again from the draft at each change) and, below it, the step's choices across the dialog's full width.
// Races, talents and classes are one grid of cards (auto-fill columns: two or three to a row on the wide dialog, one on a phone).
// The dialog asks Story Block for a wide window (`width: 'wide'`). Back, Next and the step list are the dialog's (Story Block's
// glass footer); Create is the YOU step's own glass button.
//
// While a rules pack is offered and none is pinned, each step shows the rules choice (GATE) in place of its content, and the
// You step has no Create: the pin is made with the same `rules.pin` button Setup draws (widget rpg-battle.rules-pin), then the
// steps draw as they always did. With no pack offered (a legacy chat) or a pin made, nothing of this shows.
//
// Data, not code: a pack or card may restyle or replace this screen by its id (SPEC §13.7).

import { CLASS_STEP_TEMPLATE } from '../screens/rules/class-step.js';

export const CREATE_SCREEN_ID = 'rpg-battle/create';
/** The longest portrait address the wizard takes (the same limit the Portrait field's own maxlength shows). */
export const PORTRAIT_URL_MAX = 2048;
/** The most talents the Talents step lists at once (the rest scroll inside the step). */
export const TALENT_LIST_MAX = 60;

// The live preview of the draft (creation.build), as a template expression.
const LIVE = 'query("creation.build", { draft: draft, settings: settings })';

// The summary row "Your character": one full-width card under the dialog's step list, on every step, drawn again from the draft at
// each change: the portrait and name with "Race · Class" under it, the Rules pinned (the Start step), the talents (the rolled
// ones too), the final stats the build gives now as one inline list, and the points left as a pill on the right. It wraps; on a
// phone it stacks (name and points, then talents, then stats). The step's choices get the dialog's full width below it.
const SUMMARY = ({ rules = false } = {}) => `
  <aside class="cc-register cc-summary cc-review" aria-label="Your character">
    <div class="cc-summary-who">
      <ss-widget name="ss.portrait" data-props='{"src":"{{ draft.portrait }}","name":"{{ draft.name }}","frame":"circle","size":"md"}'></ss-widget>
      <div class="cc-summary-id">
        <p class="cc-register-name cc-review-name">{{ draft.name }}</p>
        <p class="cc-summary-sub"><span class="cc-review-race"><span data-if="draft.race">{{ ${LIVE}.raceName }}</span><span data-if="!draft.race">race not chosen</span></span><span data-if="q.k.classes.state == 'ready'"> · <span class="cc-review-class"><span data-if="draft.class">{{ q.k.classes.names[draft.class] }}</span><span data-if="!draft.class">class not chosen</span></span></span></p>
      </div>
    </div>${rules ? `
    <div class="cc-summary-group cc-summary-rules" data-if="q.g.pinned">
      <span class="cc-summary-label">Rules</span>
      <span class="cc-review-rules">{{ q.g.label }} (pinned)</span>
    </div>
    <div class="cc-summary-group cc-summary-rules" data-if="q.g.offered">
      <span class="cc-summary-label">Rules</span>
      <span class="cc-review-rules">not chosen yet</span>
    </div>` : ''}
    <div class="cc-summary-group cc-summary-talents">
      <span class="cc-summary-label">Talents</span>
      <span class="cc-review-talents"><span data-if="len(draft.talents) > 0 || len(q.c.rolled) > 0">{{ ${LIVE}.talentNames }}</span><span data-if="len(draft.talents) == 0 && len(q.c.rolled) == 0">None</span></span>
    </div>
    <div class="cc-summary-group cc-summary-stats">
      <span class="cc-summary-label">Stats</span>
      <ul class="cc-review-stats"><li data-each='${LIVE}.rows as s'><b>{{ s.id }}</b> {{ s.final }}</li></ul>
    </div>
    <span class="cc-summary-pts cc-left ss-pill ss-pill-soft"><span class="cc-pts-long">Points left: <b>{{ ${LIVE}.left }}</b></span><span class="cc-pts-short"><b>{{ ${LIVE}.left }}</b> pts</span></span>
  </aside>`;

// The rules choice, where a step's choices go while a rules pack is offered and none is pinned (query rpg-battle.rulesGate;
// the same `rules.pin` button Setup draws, through widget rpg-battle.rules-pin), under the same summary row. Nothing past it can
// be reached: a step shows this in place of its choices, and the You step has no Create until the pin is made.
const GATE = `
  <section class="cc-gate" data-if="q.g.offered" aria-label="Choose your rules">
    <h4 class="ss-section-label">Choose your rules</h4>
    <p class="cc-lead">Choose the rules this character plays by before you make them: race, talents and class come from them. The choice stays with this character timeline.</p>
    <ul class="cc-gate-list">
      <li class="cc-gate-row" data-each="q.g.offers as r">
        <span class="cc-gate-name"><b>{{ r.name }}</b> <small>{{ r.version }}</small></span>
        <ss-widget name="rpg-battle.rules-pin" data-props='{"bind":"r.pin"}'></ss-widget>
      </li>
    </ul>
  </section>`;

// A step: the summary strip, then its choices across the dialog's full width.
const LAYOUT = (main, summary = {}) => `
  <div class="cc-layout">
    ${SUMMARY(summary)}${GATE}
    <div class="cc-main" data-if="!q.g.offered">${main}
    </div>
  </div>`;

const START = `
<section class="cc-step cc-start">${LAYOUT(`
      <div data-if="q.k.classes.state == 'ready'">${CLASS_STEP_TEMPLATE.replaceAll('q.c.', 'q.k.')}</div>
      <ss-widget class="cc-draft-start" name="rpg-battle.draft-start" data-props='{}'></ss-widget>
      <div class="cc-kit-section">
        <p class="cc-none" data-if="!q.c.hasPresets">This story has no ready-made characters. Go on to make your own.</p>
        <p class="cc-lead" data-if="q.c.hasPresets">Start from a ready-made character, or make your own.</p>
        <div class="cc-kit">
          <ss-widget data-if="q.c.hasPresets" name="rpg-battle.preset-pick" data-props='{"bind":"q.c.presets"}'></ss-widget>
          <ss-widget name="rpg-battle.import-pick" data-props='{}'></ss-widget>
        </div>
        <p class="cc-hint"><span data-if="q.c.hasPresets">A ready-made one fills in race, talents and points (you can still change them) and brings its skills. </span>Bringing a character from another story? Import their character file (saved from the Party tab). They keep their level, stats, skills and things, held to this story's rules. Your name and background stay your persona's.</p>
      </div>`, { rules: true })}
</section>`;

const RACE = `
<section class="cc-step cc-race">${LAYOUT(`
      <p class="cc-none" data-if="!q.c.hasRaces">This story has no races to choose from. Go on to the next step.</p>
      <div class="cc-choices" data-if="q.c.hasRaces">
        <p class="cc-lead">Choose your people. A race moves a few stats a little; it costs no points.</p>
        <p class="cc-hint">Choose a tile to pick it; choose it again to clear it.</p>
        <ss-widget class="cc-cards" name="rpg-battle.choice-pick" data-props='{"bind":"q.c.races","field":"race","picked":"{{ draft.race }}","label":"Race"}'></ss-widget>
      </div>`)}
</section>`;

const TALENTS = `
<section class="cc-step cc-talents">${LAYOUT(`
      <p class="cc-none" data-if="!q.c.hasTalents">This story has no talents to choose from. Go on to the next step.</p>
      <div class="cc-choices" data-if="q.c.hasTalents">
        <p class="cc-lead">Take up to {{ q.c.rules.maxTalents }} talents. Each costs points from the same budget as your stats.</p>
        <ul class="cc-rolled" data-if="len(q.c.rolled)" aria-label="Rolled talents">
          <li data-each="q.c.rolled as t"><b>{{ t.name }}</b> <small>{{ t.cost }} pt<span data-if="t.bonus"> · {{ t.bonus }}</span></small> <em>rolled, kept</em></li>
        </ul>
        <ss-widget class="cc-talent-list" name="rpg-battle.choice-pick" data-props='{"bind":"q.c.talents","field":"talents","many":true,"picked":{{ draft.talents }},"left":"{{ ${LIVE}.left }}","max":"{{ q.c.rules.maxTalents }}","label":"Talents"}'></ss-widget>
        <div class="cc-random">
          <ss-widget name="rpg-battle.talent-roll" data-props='{}'></ss-widget>
          <p class="cc-hint">Random talent rolls one your points can still pay for. Keep it, and the talent it showed is the one you get.</p>
        </div>
      </div>`)}
</section>`;

const STATS = `
<section class="cc-step cc-stats">${LAYOUT(`
      <p class="cc-lead">Every stat starts at {{ q.c.rules.startStat }}. Spend all your points; your race and talents are added after. The points left are in the row above.</p>
      <div class="cc-stat-grid">
        <div class="cc-stat" data-each="q.c.stats as s">
          <ss-widget name="ss.stepper" data-props='{"name":"points.{{ s.id }}","label":"{{ s.label }}","value":{{ draft.points[s.id] }},"min":0,"max":{{ q.c.rules.pointMax }},"budget":{{ ${LIVE}.left }}}'></ss-widget>
        </div>
      </div>
      <div class="cc-preview">
        <ss-widget name="rpg-battle.stat-radar" data-props='{"axes":{{ ${LIVE}.axes }},"label":"Your stats","levels":4}'></ss-widget>
      </div>`)}
</section>`;

const YOU = `
<section class="cc-step cc-you-step">
  <div class="cc-layout" data-if="q.g.offered">${SUMMARY()}${GATE}
  </div>
  <form class="cc-you" data-if="!q.g.offered" data-submit="creation.finish">
    <div class="cc-layout">
      ${SUMMARY()}
      <div class="cc-main">
        <div class="cc-you-row">
          <ss-widget name="ss.portrait" data-props='{"src":"{{ draft.portrait }}","name":"{{ draft.name }}","frame":"circle","size":"lg"}'></ss-widget>
          <div class="cc-you-fields">
            <p class="cc-name"><b>{{ draft.name }}</b> <small class="cc-from">Name and background are set in Persona Management.</small></p>
            <p class="cc-none" data-if="!draft.name">Your persona has no name yet: set one in SillyTavern's Persona Management, then open this again.</p>
            <label class="cc-field">Portrait <small>(your persona's picture unless you give another)</small>
              <input data-draft="portrait" maxlength="${PORTRAIT_URL_MAX}" placeholder="An https: image address" autocomplete="off">
            </label>
          </div>
        </div>
        <div class="cc-background" data-if="draft.background">
          <h4 class="ss-section-label">Background</h4>
          <p class="cc-background-text" data-bind="draft.background"></p>
        </div>
        <p class="cc-problem" role="status">{{ ${LIVE}.message }}</p>
        <div class="cc-actions">
          <button type="submit" class="ss-button ss-button-primary cc-go">Create {{ draft.name }}</button>
        </div>
      </div>
    </div>
  </form>
</section>`;

const CSS = `
:root { --cc-muted: color-mix(in srgb, var(--ss-text) 78%, transparent); }
.cc-one { font-family: var(--ss-font); color: var(--ss-text); }
.cc-draft-start { display: none; }
.cc-step { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-layout { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-main { display: grid; gap: var(--ss-space-3); align-content: start; min-width: 0; }
.cc-choices { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-you { display: grid; min-width: 0; }
.cc-lead, .cc-none, .cc-hint { margin: 0; }
/* the section headers are Story Block's ss-section-label (its muted colour is too faint on the glass: the text token instead) */
.ss-section-label { color: var(--ss-text); }
.cc-none, .cc-hint { color: var(--ss-text); font-size: 0.9em; }
.cc-register { padding: var(--ss-space-3) var(--ss-space-4); border-radius: var(--ss-radius-l); background: var(--ss-glass); border: 1px solid var(--ss-border); box-shadow: var(--ss-shadow); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); }
/* the summary row: groups that wrap, the points pill pushed to the right; stacked on a phone */
.cc-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2) 20px; min-width: 0; }
.cc-summary-who { display: flex; align-items: center; gap: var(--ss-space-3); min-width: 0; }
.cc-summary .ss-w-portrait { --ss-w-portrait-size: 44px; }
.cc-summary-id { display: grid; min-width: 0; }
.cc-register-name { margin: 0; font-weight: 800; font-size: 17px; overflow-wrap: anywhere; color: var(--ss-text); }
.cc-summary-sub { margin: 0; font-size: 13px; overflow-wrap: anywhere; color: var(--cc-muted); }
.cc-summary-group { display: grid; gap: 2px; min-width: 0; font-size: 14px; color: var(--ss-text); }
.cc-summary-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cc-muted); }
.cc-review-talents, .cc-review-rules { overflow-wrap: anywhere; }
.cc-review-stats { display: flex; flex-wrap: wrap; gap: 0 6px; margin: 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; }
.cc-review-stats li + li::before { content: "\\00b7"; margin-right: 6px; }
.cc-review-stats b { font-weight: 700; }
.cc-summary-pts { margin-left: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cc-summary-pts b { color: inherit; font-weight: 800; }
.cc-pts-short { display: none; }
/* the rules choice (rpg-battle.rulesGate): one row per pack on offer, the Pin button beside its name */
.cc-gate { display: grid; gap: var(--ss-space-3); padding: var(--ss-space-3); border-radius: var(--ss-radius-l); background: var(--ss-glass); border: 1px solid var(--ss-border); }
.cc-gate-list { display: grid; gap: var(--ss-space-2); margin: 0; padding: 0; list-style: none; }
.cc-gate-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ss-space-2); padding: var(--ss-space-2) var(--ss-space-3); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); min-width: 0; }
.cc-gate-name { overflow-wrap: anywhere; min-width: 0; color: var(--ss-text); }
/* the basic class and check actor cards (widget rpg-battle.class-pick) sit in the same grid; the actor link is the quieter block */
.cc-class .cc-main { gap: var(--ss-space-3); }
.cc-checks { display: grid; gap: 2px; padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-border); }
.cc-checks .cc-hint, .cc-checks .cc-none { font-size: 13px; color: var(--cc-muted); }
.cc-checks .cc-lead { font-size: 12px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cc-muted); }
.cc-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 11em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.cc-stat { min-width: 0; }
.cc-stat .ss-w-stepper-budget { display: none; }
.cc-preview { display: flex; justify-content: center; min-width: 0; }
/* races, talents and classes are one grid of equal cards: three to a row on the wide dialog, one on a phone */
.rpg-choices, .rpg-choices-rows, .rpg-cp { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ss-space-3); align-items: stretch; min-width: 0; }
.cc-card { appearance: none; margin: 0; min-width: 0; font: inherit; color: var(--ss-text); text-align: start; cursor: pointer; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: var(--ss-space-3); min-height: 104px; border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); }
.cc-card:disabled { cursor: not-allowed; opacity: 0.5; }
.cc-card:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-accent) 12%, var(--ss-tile)); }
.cc-card:active:not(:disabled) { background: color-mix(in srgb, var(--ss-accent) 24%, var(--ss-tile)); }
.cc-card:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.cc-card[aria-pressed="true"] { border-color: var(--ss-accent); box-shadow: inset 0 0 0 1px var(--ss-accent); background: color-mix(in srgb, var(--ss-accent) 16%, var(--ss-tile)); }
.cc-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2); min-width: 0; }
.cc-card-img { width: 100%; max-height: 6em; object-fit: cover; border-radius: var(--ss-radius-s); }
.cc-card-name { font-weight: 700; font-size: 15px; overflow-wrap: anywhere; line-height: 1.2; color: var(--ss-text); }
.cc-card-tick { flex: none; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--ss-radius-pill); background: var(--ss-accent); color: var(--ss-on-ring); }
.cc-card-bonus { font-size: 13px; font-weight: 700; color: var(--ss-accent-text); overflow-wrap: anywhere; }
.cc-card-cost-inline { display: none; }
.cc-card-note { font-size: 13px; color: var(--cc-muted); overflow-wrap: anywhere; }
.cc-card-cost { margin-top: auto; align-self: flex-end; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--cc-muted); }
.cc-card-note + .cc-card-cost { margin-top: auto; }
.cc-rolled { margin: 0; padding-left: 1.2em; color: var(--ss-text); }
.cc-rolled em { color: var(--ss-muted); font-size: 0.85em; }
.cc-random { display: grid; gap: 4px; justify-items: start; }
.cc-hint { color: var(--cc-muted); }
/* the ready-made character section: a divider, the intro, then one row of cards (the kit, My own, Import) */
.cc-kit-section { display: grid; gap: var(--ss-space-2); padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-border); }
.cc-kit { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ss-space-3); align-items: stretch; min-width: 0; }
.cc-kit ss-widget, .cc-kit .rpg-presets, .cc-kit .rpg-import { display: contents; }
.cc-kit .rpg-import-note { grid-column: 1 / -1; }
.cc-you-row { display: flex; gap: var(--ss-space-2); align-items: center; min-width: 0; }
.cc-you-fields { flex: 1; display: grid; gap: var(--ss-space-2); min-width: 0; }
.cc-name { margin: 0; overflow-wrap: anywhere; }
.cc-from, .cc-field small { color: var(--ss-text); font-size: 0.8em; }
.cc-field { display: grid; gap: 2px; font-size: 0.9em; }
.cc-field input { min-width: 0; width: 100%; font: inherit; color: var(--ss-text); background: var(--ss-field); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); padding: 6px 10px; }
.cc-field input:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.cc-background { display: grid; gap: 4px; padding: var(--ss-space-2); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); }
.cc-background-text { margin: 0; white-space: pre-wrap; max-height: 10em; overflow: auto; overflow-wrap: anywhere; font-size: 0.9em; color: var(--ss-text); }
/* a rule the draft breaks: the text token (the warn colour is too faint on light glass), marked by a warn rule */
.cc-problem { margin: 0; min-height: 1.2em; padding-left: 8px; border-left: 3px solid var(--ss-warn); color: var(--ss-text); font-size: 0.9em; overflow-wrap: anywhere; }
.cc-actions { display: flex; justify-content: flex-end; }
/* the widgets' own buttons and cards, in the glass look */
.rpg-roll { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-1); }
.rpg-roll-result, .rpg-import-note { margin: 0; flex: 1 1 100%; font-size: 0.9em; color: var(--cc-muted); overflow-wrap: anywhere; }
.rpg-roll-result:empty, .rpg-import-note:empty { display: none; }
.rpg-roll-result[data-problem], .rpg-import-note[data-problem] { color: var(--ss-warn); }
.rpg-import { display: grid; gap: 4px; justify-items: start; }
.rpg-import-go { position: relative; cursor: pointer; }
.cc-kit .rpg-import-go { min-height: 0; justify-content: center; border-style: dashed; border-radius: var(--ss-radius-m); background: var(--ss-tile); color: var(--cc-muted); font-weight: 400; }
.cc-kit .rpg-presets .rpg-preset-own { min-height: 0; justify-self: stretch; justify-content: center; border-radius: var(--ss-radius-m); background: var(--ss-tile); font-weight: 700; }
.cc-kit .rpg-presets .rpg-preset-own[aria-pressed="true"] { border-color: var(--ss-accent); box-shadow: inset 0 0 0 1px var(--ss-accent); }
.rpg-import-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip-path: inset(50%); }
.rpg-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--ss-space-3); min-width: 0; }
.rpg-preset { display: grid; gap: 6px; align-content: start; padding: var(--ss-space-3); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); min-width: 0; overflow-wrap: anywhere; color: var(--ss-text); }
.rpg-preset-chosen { border-color: var(--ss-accent); box-shadow: inset 0 0 0 1px var(--ss-accent); background: color-mix(in srgb, var(--ss-accent) 16%, var(--ss-tile)); }
.rpg-preset-name { font-weight: 800; }
.rpg-preset-img { width: 100%; max-height: 6em; object-fit: cover; border-radius: var(--ss-radius-s); }
.rpg-preset-origin, .rpg-preset-skills { font-size: 13px; font-weight: 700; color: var(--ss-accent-text); }
.rpg-preset-note { font-size: 13px; color: var(--cc-muted); }
.rpg-preset-go, .rpg-preset-own { justify-self: start; }
/* the stat radar (widget rpg-battle.stat-radar, creation/radar.js): SVG drawn with DOM calls, coloured from the tokens */
.rpg-radar { position: relative; width: min(100%, 15em); }
.rpg-radar svg { display: block; width: 100%; height: auto; overflow: visible; }
.rpg-radar-ring { fill: none; stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-spoke { stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-shape { fill: color-mix(in srgb, var(--ss-accent) 28%, transparent); stroke: var(--ss-accent); stroke-width: 2; stroke-linejoin: round; }
.rpg-radar-label { fill: var(--ss-text); font-size: 11px; font-weight: 700; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
.rpg-radar-value { fill: var(--ss-text); font-size: 10px; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
/* a phone (Story Block's dialog is a full-width sheet below 768 px): one column of cards, the summary stacked in three short lines */
@media (max-width: 767.98px) {
  .rpg-choices, .rpg-choices-rows, .rpg-cp, .cc-kit { grid-template-columns: minmax(0, 1fr); gap: var(--ss-space-2); }
  .cc-card { min-height: 0; gap: 4px; padding: 10px var(--ss-space-3); }
  .cc-card-cost { display: none; }
  .cc-card-cost-inline { display: inline; }
  .cc-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--ss-space-2); }
  .cc-summary-who { grid-column: 1; }
  .cc-summary-pts { grid-column: 2; grid-row: 1; margin-left: 0; }
  .cc-summary-group { grid-column: 1 / -1; grid-template-columns: minmax(0, 1fr); }
  .cc-summary-label { display: none; }
  .cc-summary-rules .cc-summary-label { display: block; }
  .cc-summary .ss-w-portrait { --ss-w-portrait-size: 40px; }
  .cc-pts-long { display: none; }
  .cc-pts-short { display: inline; }
}
.cc-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
`;

/** The wizard's steps (SPEC §13.6): Start (a pack's ready-made character), Race, Talents, Stats, You (the persona's name, background and portrait; submits). */
export const CREATE_STEPS = Object.freeze([
    Object.freeze({ id: 'start', title: 'Start', template: START.trim() }),
    Object.freeze({ id: 'race', title: 'Race', template: RACE.trim() }),
    Object.freeze({ id: 'talents', title: 'Talents', template: TALENTS.trim() }),
    Object.freeze({ id: 'stats', title: 'Stats', template: STATS.trim() }),
    Object.freeze({ id: 'you', title: 'You', template: YOU.trim() }),
]);

/** The screen definition (SPEC §13.1). `template` is the whole wizard on one page, for a mount without steps. */
export const createScreen = Object.freeze({
    id: CREATE_SCREEN_ID,
    title: 'New character',
    icon: 'fa-user-plus',
    mounts: Object.freeze(['dialog']),
    width: 'wide',
    data: Object.freeze({ c: Object.freeze({ query: 'creation.content' }), k: Object.freeze({ query: 'rpg-battle.classPicker' }), g: Object.freeze({ query: 'rpg-battle.rulesGate' }) }),
    template: `<div class="cc-one">${CREATE_STEPS.map(step => step.template).join('\n')}</div>`,
    css: CSS.trim(),
    steps: CREATE_STEPS,
});
