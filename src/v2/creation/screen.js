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

// The summary strip "Your character": one full-width row at the top of every step, under the dialog's step list, drawn again from
// the draft at each change: the portrait and name, the race, the talents (the rolled ones too) and the final stats the build
// gives now, as a compact inline list. It wraps on a narrow screen. The step's choices get the whole dialog width below it.
const DETAILS = `
  <aside class="cc-register cc-summary cc-review" aria-label="Your character">
    <div class="cc-register-head">
      <ss-widget name="ss.portrait" data-props='{"src":"{{ draft.portrait }}","name":"{{ draft.name }}","frame":"circle","size":"sm"}'></ss-widget>
      <p class="cc-register-name cc-review-name">{{ draft.name }}</p>
    </div>
    <dl class="cc-review-list">
      <div class="cc-summary-item"><dt>Race</dt><dd class="cc-review-race"><span data-if="draft.race">{{ ${LIVE}.raceName }}</span><span data-if="!draft.race">None</span></dd></div>
      <div class="cc-summary-item"><dt>Talents</dt><dd class="cc-review-talents"><span data-if="len(draft.talents) > 0 || len(q.c.rolled) > 0">{{ ${LIVE}.talentNames }}</span><span data-if="len(draft.talents) == 0 && len(q.c.rolled) == 0">None</span></dd></div>
      <div class="cc-summary-item"><dt>Stats</dt><dd><ul class="cc-review-stats"><li data-each='${LIVE}.rows as s'><b>{{ s.id }}</b> {{ s.final }}</li></ul></dd></div>
    </dl>
  </aside>`;

// The rules choice, before any step's content while a rules pack is offered and none is pinned (query rpg-battle.rulesGate;
// the same `rules.pin` button Setup draws, through widget rpg-battle.rules-pin). Nothing past it can be reached: a step shows
// this in place of its choices, and the You step has no Create until the pin is made.
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
const LAYOUT = main => `
  <div class="cc-layout" data-if="!q.g.offered">
    ${DETAILS}
    <div class="cc-main">${main}
    </div>
  </div>`;

const START = `
<section class="cc-step cc-start">${GATE}${LAYOUT(`
      <div data-if="q.k.classes.state == 'ready'">${CLASS_STEP_TEMPLATE.replaceAll('q.c.', 'q.k.')}</div>
      <ss-widget class="cc-draft-start" name="rpg-battle.draft-start" data-props='{}'></ss-widget>
      <p class="cc-none" data-if="!q.c.hasPresets">This story has no ready-made characters. Go on to make your own.</p>
      <div data-if="q.c.hasPresets">
        <p class="cc-lead">Start from a ready-made character, or make your own. A ready-made one fills in race, talents and points (you can still change them) and brings its skills; your name and background stay your persona's.</p>
        <ss-widget name="rpg-battle.preset-pick" data-props='{"bind":"q.c.presets"}'></ss-widget>
      </div>
      <div class="cc-import">
        <p class="cc-hint">Bringing a character from another story? Import their character file (saved from the Party tab). They keep their level, stats, skills and things, held to this story's rules; the name and background are your persona's.</p>
        <ss-widget name="rpg-battle.import-pick" data-props='{}'></ss-widget>
      </div>`)}
</section>`;

const RACE = `
<section class="cc-step cc-race">${GATE}${LAYOUT(`
      <p class="cc-none" data-if="!q.c.hasRaces">This story has no races to choose from. Go on to the next step.</p>
      <div class="cc-choices" data-if="q.c.hasRaces">
        <p class="cc-lead">Choose your people. A race moves a few stats a little; it costs no points.</p>
        <p class="cc-hint">Choose a tile to pick it; choose it again to clear it.</p>
        <ss-widget class="cc-cards" name="rpg-battle.choice-pick" data-props='{"bind":"q.c.races","field":"race","picked":"{{ draft.race }}","label":"Race"}'></ss-widget>
      </div>`)}
</section>`;

const TALENTS = `
<section class="cc-step cc-talents">${GATE}${LAYOUT(`
      <p class="cc-none" data-if="!q.c.hasTalents">This story has no talents to choose from. Go on to the next step.</p>
      <div class="cc-choices" data-if="q.c.hasTalents">
        <p class="cc-lead">Take up to {{ q.c.rules.maxTalents }} talents. Each costs points from the same budget as your stats.
          <span class="cc-left ss-pill ss-pill-soft">Points left: <b>{{ ${LIVE}.left }}</b></span></p>
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
<section class="cc-step cc-stats">${GATE}${LAYOUT(`
      <div class="cc-points">
        <span class="cc-left ss-pill ss-pill-soft">Points left: <b>{{ ${LIVE}.left }}</b></span>
        <p class="cc-hint">Every stat starts at {{ q.c.rules.startStat }}. Spend all your points; your race and talents are added after.</p>
      </div>
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
<section class="cc-step cc-you-step">${GATE}
  <form class="cc-you" data-if="!q.g.offered" data-submit="creation.finish">
    <div class="cc-layout">
      ${DETAILS}
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
.cc-one { font-family: var(--ss-font); color: var(--ss-text); }
.cc-draft-start { display: none; }
.cc-step { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-layout { display: grid; gap: var(--ss-space-4); min-width: 0; }
.cc-main { display: grid; gap: var(--ss-space-4); align-content: start; min-width: 0; }
.cc-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-1) var(--ss-space-4); min-width: 0; }
.cc-choices { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-you { display: grid; min-width: 0; }
.cc-lead, .cc-none, .cc-hint { margin: 0; }
/* the section headers are Story Block's ss-section-label (its muted colour is too faint on the glass: the text token instead) */
.ss-section-label { color: var(--ss-text); }
.cc-none, .cc-hint { color: var(--ss-text); font-size: 0.9em; }
.cc-left { justify-self: start; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cc-left b { color: inherit; font-weight: 800; }
.cc-register { padding: var(--ss-space-2) var(--ss-space-3); border-radius: var(--ss-radius-l); background: var(--ss-glass); border: 1px solid var(--ss-border); box-shadow: var(--ss-shadow); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); }
.cc-register-head { display: flex; gap: var(--ss-space-2); align-items: center; min-width: 0; }
.cc-register-who { display: grid; gap: 2px; min-width: 0; }
.cc-register-name { margin: 0; font-weight: 800; font-size: 16px; overflow-wrap: anywhere; color: var(--ss-text); }
.cc-points { display: grid; gap: var(--ss-space-2); }
/* the rules choice (rpg-battle.rulesGate): one row per pack on offer, the Pin button beside its name */
.cc-gate { display: grid; gap: var(--ss-space-3); padding: var(--ss-space-3); border-radius: var(--ss-radius-l); background: var(--ss-glass); border: 1px solid var(--ss-border); }
.cc-gate-list { display: grid; gap: var(--ss-space-2); margin: 0; padding: 0; list-style: none; }
.cc-gate-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ss-space-2); padding: var(--ss-space-2) var(--ss-space-3); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); min-width: 0; }
.cc-gate-name { overflow-wrap: anywhere; min-width: 0; color: var(--ss-text); }
/* the basic class and check actor cards (widget rpg-battle.class-pick) sit in the same grid; the actor link is the quieter block */
.cc-class .cc-main { gap: var(--ss-space-3); }
.cc-checks { display: grid; gap: var(--ss-space-2); padding-top: var(--ss-space-3); border-top: 1px solid var(--ss-border); }
.cc-checks .cc-lead { font-size: 0.9em; font-weight: 700; }
.cc-checks .cc-hint { font-size: 13px; }
.cc-class .cc-lead:first-child { font-weight: 700; }
.cc-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 11em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.cc-stat { min-width: 0; }
.cc-stat .ss-w-stepper-budget { display: none; }
.cc-preview { display: flex; justify-content: center; min-width: 0; }
/* the choices: race tiles and talent rows (widget rpg-battle.choice-pick, buttons with aria-pressed) */
/* races, talents and classes are one grid of cards: two or three to a row on the wide dialog, one on a phone, equal width and height */
.rpg-choices, .rpg-choices-rows, .rpg-cp { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--ss-space-2); align-items: stretch; min-width: 0; }
.cc-card { appearance: none; margin: 0; min-width: 0; font: inherit; color: var(--ss-text); text-align: center; cursor: pointer; display: grid; align-content: start; justify-items: center; gap: 4px; padding: 10px 8px; height: 100%; border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); }
.cc-card:disabled { cursor: not-allowed; opacity: 0.5; }
.cc-card:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-accent) 18%, var(--ss-tile)); }
.cc-card:active:not(:disabled) { background: color-mix(in srgb, var(--ss-accent) 30%, var(--ss-tile)); }
.cc-card:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.cc-card[aria-pressed="true"] { border-color: var(--ss-accent); box-shadow: inset 0 0 0 2px var(--ss-accent); }
.cc-card-box { display: grid; place-items: center; width: 52px; height: 52px; border-radius: var(--ss-radius-m); background: var(--ss-track); font-weight: 800; color: var(--ss-text); }
.cc-card-img { width: 100%; height: 100%; object-fit: cover; border-radius: var(--ss-radius-m); }
.cc-card-name { font-weight: 700; overflow-wrap: anywhere; line-height: 1.2; color: var(--ss-text); }
.cc-card-cost { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--ss-text); }
.cc-card-tick { font-size: 12px; font-weight: 700; padding: 0 8px; border-radius: var(--ss-radius-pill); background: var(--ss-accent); color: var(--ss-on-ring); }
.cc-card-bonus { font-size: 13px; font-weight: 700; color: var(--ss-text); overflow-wrap: anywhere; }
.cc-card-note { font-size: 13px; color: var(--ss-text); overflow-wrap: anywhere; }
.cc-row { padding: 10px 12px; text-align: start; grid-template-columns: minmax(0, 1fr) auto; justify-items: start; align-items: center; column-gap: var(--ss-space-2); }
.cc-row-main { display: grid; gap: 2px; min-width: 0; }
.cc-row .cc-card-tick { grid-column: 2; grid-row: 1; }
.cc-row .cc-card-cost { grid-column: 2; grid-row: 2; justify-self: end; }
/* the review and the summary lists */
.cc-review-list { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--ss-space-1) var(--ss-space-4); margin: 0; min-width: 0; flex: 1 1 18em; }
.cc-summary-item { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.cc-review-list dt { color: var(--ss-text); font-size: 13px; font-weight: 600; }
.cc-review-list dd { margin: 0; overflow-wrap: anywhere; color: var(--ss-text); min-width: 0; }
.cc-review-stats { display: flex; flex-wrap: wrap; gap: 0 6px; margin: 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; }
.cc-review-stats li + li::before { content: "\\00b7"; margin-right: 6px; }
.cc-rolled { margin: 0; padding-left: 1.2em; color: var(--ss-text); }
.cc-rolled em { color: var(--ss-muted); font-size: 0.85em; }
.cc-random, .cc-import { display: grid; gap: 4px; justify-items: start; }
.cc-import { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--ss-border); }
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
.rpg-roll-result, .rpg-import-note { margin: 0; flex: 1 1 100%; font-size: 0.9em; color: var(--ss-text); overflow-wrap: anywhere; }
.rpg-roll-result:empty, .rpg-import-note:empty { display: none; }
.rpg-roll-result[data-problem], .rpg-import-note[data-problem] { color: var(--ss-warn); }
.rpg-import { display: grid; gap: 4px; justify-items: start; }
.rpg-import-go { position: relative; cursor: pointer; }
.rpg-import-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip-path: inset(50%); }
.rpg-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.rpg-preset { display: grid; gap: 4px; padding: var(--ss-space-2); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); min-width: 0; overflow-wrap: anywhere; color: var(--ss-text); }
.rpg-preset-chosen { border-color: var(--ss-accent); box-shadow: inset 0 0 0 2px var(--ss-accent); }
.rpg-preset-name { font-weight: 800; }
.rpg-preset-img { width: 100%; max-height: 6em; object-fit: cover; border-radius: var(--ss-radius-s); }
.rpg-preset-origin, .rpg-preset-skills { font-size: 13px; font-weight: 700; color: var(--ss-text); }
.rpg-preset-note { font-size: 13px; color: var(--ss-text); }
.rpg-preset-go, .rpg-preset-own { justify-self: start; }
/* the stat radar (widget rpg-battle.stat-radar, creation/radar.js): SVG drawn with DOM calls, coloured from the tokens */
.rpg-radar { position: relative; width: min(100%, 15em); }
.rpg-radar svg { display: block; width: 100%; height: auto; overflow: visible; }
.rpg-radar-ring { fill: none; stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-spoke { stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-shape { fill: color-mix(in srgb, var(--ss-accent) 28%, transparent); stroke: var(--ss-accent); stroke-width: 2; stroke-linejoin: round; }
.rpg-radar-label { fill: var(--ss-text); font-size: 11px; font-weight: 700; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
.rpg-radar-value { fill: var(--ss-text); font-size: 10px; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
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
