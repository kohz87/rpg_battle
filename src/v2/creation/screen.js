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
// Layout (concept: Create.dc.html, CreateLight.dc.html): every step is a main column (its choices) and a registration
// card (name, portrait, race, talents; on the Stats step the steppers, the points left as a pill and the radar). Phones
// stack them, one step at a time, with the dialog's own step list as the indicator. A dialog 560 px or wider (a container
// query on the step's root) puts the card beside the choices. Back, Next and the step list are the dialog's (Story Block's
// glass footer); Create is the YOU step's own glass button.
//
// Data, not code: a pack or card may restyle or replace this screen by its id (SPEC §13.7).

export const CREATE_SCREEN_ID = 'rpg-battle/create';
/** The longest portrait address the wizard takes (the same limit the Portrait field's own maxlength shows). */
export const PORTRAIT_URL_MAX = 2048;
/** The most talents the Talents step lists at once (the rest scroll inside the step). */
export const TALENT_LIST_MAX = 60;

// The live preview of the draft (creation.build), as a template expression.
const LIVE = 'query("creation.build", { draft: draft, settings: settings })';

// The registration card: the same on every step; the stats steppers and the radar only where the stats are chosen.
const REGISTER = (body, { optional = false } = {}) => `
  <aside class="cc-register${optional ? ' cc-register-optional' : ''}" aria-label="Your character">
    <div class="cc-register-head">
      <ss-widget name="ss.portrait" data-props='{"src":"{{ draft.portrait }}","name":"{{ draft.name }}","frame":"circle","size":"md"}'></ss-widget>
      <div class="cc-register-who">
        <p class="cc-register-name">{{ draft.name }}</p>
        <p class="cc-register-sub"><span data-if="draft.race">{{ ${LIVE}.raceName }}</span><span data-if="!draft.race">No race yet</span> · <span data-if="len(draft.talents) == 0">No talents</span><span data-if="len(draft.talents) == 1">1 talent</span><span data-if="len(draft.talents) > 1">{{ len(draft.talents) }} talents</span></p>
      </div>
    </div>
    ${body}
  </aside>`;

const START = `
<section class="cc-step cc-start">
  <p class="cc-none" data-if="!q.c.hasPresets">This story has no ready-made characters. Go on to make your own.</p>
  <div data-if="q.c.hasPresets">
    <p class="cc-lead">Start from a ready-made character, or make your own. A ready-made one fills in race, talents and points (you can still change them) and brings its skills; your name and background stay your persona's.</p>
    <ss-widget name="rpg-battle.preset-pick" data-props='{"bind":"q.c.presets"}'></ss-widget>
  </div>
  <div class="cc-import">
    <p class="cc-hint">Bringing a character from another story? Import their character file (saved from the Party tab). They keep their level, stats, skills and things, held to this story's rules; the name and background are your persona's.</p>
    <ss-widget name="rpg-battle.import-pick" data-props='{}'></ss-widget>
  </div>
</section>`;

const RACE = `
<section class="cc-step cc-race">
  <div class="cc-layout">
    <div class="cc-main">
      <p class="cc-none" data-if="!q.c.hasRaces">This story has no races to choose from. Go on to the next step.</p>
      <div data-if="q.c.hasRaces">
        <p class="cc-lead">Choose your people. A race moves a few stats a little; it costs no points.</p>
        <p class="cc-hint">Choose a tile to pick it; choose it again to clear it.</p>
        <ss-widget class="cc-cards" name="rpg-battle.choice-pick" data-props='{"bind":"q.c.races","field":"race","picked":"{{ draft.race }}","label":"Race"}'></ss-widget>
      </div>
    </div>
    ${REGISTER('', { optional: true })}
  </div>
</section>`;

const TALENTS = `
<section class="cc-step cc-talents">
  <div class="cc-layout">
    <div class="cc-main">
      <p class="cc-none" data-if="!q.c.hasTalents">This story has no talents to choose from. Go on to the next step.</p>
      <div data-if="q.c.hasTalents">
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
      </div>
    </div>
    ${REGISTER('', { optional: true })}
  </div>
</section>`;

const STATS = `
<section class="cc-step cc-stats">
  <div class="cc-layout">
    ${REGISTER(`
    <div class="cc-points">
      <span class="cc-left ss-pill ss-pill-soft">Points left: <b>{{ ${LIVE}.left }}</b></span>
      <p class="cc-hint">Every stat starts at {{ q.c.rules.startStat }}. Spend all your points; your race and talents are added after.</p>
    </div>
    <div class="cc-stat-grid">
      <div class="cc-stat" data-each="q.c.stats as s">
        <ss-widget name="ss.stepper" data-props='{"name":"points.{{ s.id }}","label":"{{ s.label }}","value":{{ draft.points[s.id] }},"min":0,"max":{{ q.c.rules.pointMax }},"budget":{{ ${LIVE}.left }}}'></ss-widget>
      </div>
    </div>`)}
    <div class="cc-main">
      <div class="cc-preview">
        <ss-widget name="rpg-battle.stat-radar" data-props='{"axes":{{ ${LIVE}.axes }},"label":"Your stats","levels":4}'></ss-widget>
      </div>
    </div>
  </div>
</section>`;

const YOU = `
<form class="cc-step cc-you" data-submit="creation.finish">
  <div class="cc-layout">
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
        <span class="cc-label">Background</span>
        <p class="cc-background-text" data-bind="draft.background"></p>
      </div>
      <p class="cc-problem" role="status">{{ ${LIVE}.message }}</p>
      <div class="cc-actions">
        <button type="submit" class="ss-button ss-button-primary cc-go">Create {{ draft.name }}</button>
      </div>
    </div>
    <section class="cc-register cc-review" aria-label="Your character">
      <span class="cc-label">Your character</span>
      <dl class="cc-review-list">
        <dt>Name</dt><dd class="cc-review-name">{{ draft.name }}</dd>
        <dt>Race</dt><dd class="cc-review-race"><span data-if="draft.race">{{ ${LIVE}.raceName }}</span><span data-if="!draft.race">None</span></dd>
        <dt>Talents</dt><dd class="cc-review-talents"><span data-if="len(draft.talents) > 0 || len(q.c.rolled) > 0">{{ ${LIVE}.talentNames }}</span><span data-if="len(draft.talents) == 0 && len(q.c.rolled) == 0">None</span></dd>
        <dt>Stats</dt><dd><ul class="cc-review-stats"><li data-each='${LIVE}.rows as s'><b>{{ s.id }}</b> {{ s.final }}</li></ul></dd>
      </dl>
    </section>
  </div>
</form>`;

const CSS = `
.cc-one { container: cc / inline-size; font-family: var(--ss-font); color: var(--ss-text); }
.cc-step { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-layout { display: grid; gap: var(--ss-space-3); min-width: 0; }
.cc-main, .cc-register { display: grid; gap: var(--ss-space-2); align-content: start; min-width: 0; }
.cc-lead, .cc-none, .cc-hint { margin: 0; }
.cc-none, .cc-hint { color: var(--ss-muted); font-size: 0.9em; }
.cc-left { justify-self: start; white-space: nowrap; font-variant-numeric: tabular-nums; }
.cc-left b { color: var(--ss-accent); font-weight: 800; }
.cc-register { padding: var(--ss-space-3); border-radius: var(--ss-radius-l); background: var(--ss-glass); border: 1px solid var(--ss-border); box-shadow: var(--ss-shadow); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); }
.cc-register-optional { display: none; }
.cc-register-head { display: flex; gap: var(--ss-space-2); align-items: center; min-width: 0; }
.cc-register-who { display: grid; gap: 2px; min-width: 0; }
.cc-register-name { margin: 0; font-weight: 800; font-size: 16px; overflow-wrap: anywhere; color: var(--ss-text); }
.cc-register-sub { margin: 0; font-size: 13px; color: var(--ss-text); overflow-wrap: anywhere; }
.cc-points { display: grid; gap: var(--ss-space-1); }
.cc-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 11em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.cc-stat { min-width: 0; }
.cc-stat .ss-w-stepper-budget { display: none; }
.cc-preview { display: flex; justify-content: center; min-width: 0; }
.cc-label { font-size: 13px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ss-text); }
/* the choices: race tiles and talent rows (widget rpg-battle.choice-pick, buttons with aria-pressed) */
.rpg-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 7.5em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.rpg-choices-rows { display: grid; gap: var(--ss-space-2); grid-template-columns: minmax(0, 1fr); }
.cc-card { appearance: none; margin: 0; min-width: 0; font: inherit; color: var(--ss-text); text-align: center; cursor: pointer; display: grid; justify-items: center; gap: 4px; padding: 8px 6px; border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); }
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
.cc-card-bonus { font-size: 13px; color: var(--ss-accent); overflow-wrap: anywhere; }
.cc-card-note { font-size: 13px; color: var(--ss-text); overflow-wrap: anywhere; }
.cc-row { text-align: start; grid-template-columns: minmax(0, 1fr) auto; justify-items: start; align-items: center; column-gap: var(--ss-space-2); }
.cc-row-main { display: grid; gap: 2px; min-width: 0; }
.cc-row .cc-card-tick { grid-column: 2; grid-row: 1; }
.cc-row .cc-card-cost { grid-column: 2; grid-row: 2; justify-self: end; }
/* the review and the summary lists */
.cc-review-list { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; }
.cc-review-list dt { color: var(--ss-muted); font-size: 13px; }
.cc-review-list dd { margin: 0; overflow-wrap: anywhere; color: var(--ss-text); }
.cc-review-stats { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; padding: 0; list-style: none; }
.cc-rolled { margin: 0; padding-left: 1.2em; color: var(--ss-text); }
.cc-rolled em { color: var(--ss-muted); font-size: 0.85em; }
.cc-random, .cc-import { display: grid; gap: 4px; justify-items: start; }
.cc-import { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--ss-border); }
.cc-you-row { display: flex; gap: var(--ss-space-2); align-items: center; min-width: 0; }
.cc-you-fields { flex: 1; display: grid; gap: var(--ss-space-2); min-width: 0; }
.cc-name { margin: 0; overflow-wrap: anywhere; }
.cc-from, .cc-field small { color: var(--ss-muted); font-size: 0.8em; }
.cc-field { display: grid; gap: 2px; font-size: 0.9em; }
.cc-field input { min-width: 0; width: 100%; font: inherit; color: var(--ss-text); background: var(--ss-field); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); padding: 6px 10px; }
.cc-field input:focus-visible { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.cc-background { display: grid; gap: 4px; padding: var(--ss-space-2); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); }
.cc-background-text { margin: 0; white-space: pre-wrap; max-height: 10em; overflow: auto; overflow-wrap: anywhere; font-size: 0.9em; color: var(--ss-text); }
.cc-problem { margin: 0; min-height: 1.2em; color: var(--ss-warn); font-size: 0.9em; overflow-wrap: anywhere; }
.cc-actions { display: flex; justify-content: flex-end; }
/* the widgets' own buttons and cards, in the glass look */
.rpg-roll { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-1); }
.rpg-roll-result, .rpg-import-note { margin: 0; flex: 1 1 100%; font-size: 0.9em; color: var(--ss-text); overflow-wrap: anywhere; }
.rpg-roll-result:empty, .rpg-import-note:empty { display: none; }
.rpg-roll-result[data-problem], .rpg-import-note[data-problem] { color: var(--ss-warn); }
.rpg-import { display: grid; gap: 4px; justify-items: start; }
.rpg-import-go { position: relative; cursor: pointer; }
.rpg-import-go:focus-within { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
.rpg-import-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip-path: inset(50%); }
.rpg-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--ss-space-2); min-width: 0; }
.rpg-preset { display: grid; gap: 4px; padding: var(--ss-space-2); border-radius: var(--ss-radius-m); background: var(--ss-tile); border: 1px solid var(--ss-border); min-width: 0; overflow-wrap: anywhere; color: var(--ss-text); }
.rpg-preset-chosen { border-color: var(--ss-accent); box-shadow: inset 0 0 0 2px var(--ss-accent); }
.rpg-preset-name { font-weight: 800; }
.rpg-preset-img { width: 100%; max-height: 6em; object-fit: cover; border-radius: var(--ss-radius-s); }
.rpg-preset-origin, .rpg-preset-skills { font-size: 13px; color: var(--ss-accent); }
.rpg-preset-note { font-size: 13px; color: var(--ss-text); }
.rpg-preset-go, .rpg-preset-own { justify-self: start; }
/* the stat radar (widget rpg-battle.stat-radar, creation/radar.js): SVG drawn with DOM calls, coloured from the tokens */
.rpg-radar { position: relative; width: min(100%, 15em); }
.rpg-radar svg { display: block; width: 100%; height: auto; overflow: visible; }
.rpg-radar-ring { fill: none; stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-spoke { stroke: var(--ss-border); stroke-width: 1; }
.rpg-radar-shape { fill: color-mix(in srgb, var(--ss-accent) 28%, transparent); stroke: var(--ss-accent); stroke-width: 2; stroke-linejoin: round; }
.rpg-radar-label { fill: var(--ss-text); font-size: 11px; font-weight: 700; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
.rpg-radar-value { fill: var(--ss-muted); font-size: 10px; font-family: var(--ss-font); text-anchor: middle; dominant-baseline: middle; }
.cc-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
/* the dialog's own step list is the phone indicator; on a wide dialog the card sits beside the choices */
@container cc (min-width: 560px) {
  .cc-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 15em); align-items: start; }
  .cc-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cc-register-optional { display: grid; }
  .cc-you .cc-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 14em); }
}
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
    data: Object.freeze({ c: Object.freeze({ query: 'creation.content' }) }),
    template: `<div class="cc-one">${CREATE_STEPS.map(step => step.template).join('\n')}</div>`,
    css: CSS.trim(),
    steps: CREATE_STEPS,
});
