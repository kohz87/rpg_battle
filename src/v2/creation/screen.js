// The character creation wizard (SPEC §13.1, §13.2, §13.6; MODULES §F12): screen
// `rpg-battle/create`, shown as a dialog. Its steps share one draft:
//
//   { name, background, race, talents: [ids], points: { STR: n, … }, portrait }
//
// `name` and `background` are the SillyTavern persona's (MODULES §F22), put there by the opener and
// shown read-only; the reader picks the rest. The last step sends it as one `creation.finish` command; that command checks every rule.
// The screen's data query `creation.content` gives the lists. The numbers that follow the draft
// (points left, the final stats, the radar) come from the `creation.build` query called in the
// template's expressions with the draft and the module's settings, since the template language
// has no arithmetic (TEMPLATES.md §1.2). Where the host does not give templates `query`, those
// show empty and the steppers run without a budget; creation.finish still enforces it. Everything
// else is plain paths, `!path` and helper calls, which the renderer reads without the language.
//
// Data, not code: a pack or card may restyle or replace this screen by its id (SPEC §13.7).

export const CREATE_SCREEN_ID = 'rpg-battle/create';
//
// Random is the Talents step's own button (widget rpg-battle.talent-roll), not the dialog's footer, so
// no other step shows it; "Import character" (widget rpg-battle.import-pick) sits on the Start step.
// "Points left" is said once per step, in its lead line; the stat steppers' own notes are hidden.

// The live preview of the draft (creation.build), as a template expression.
const LIVE = 'query("creation.build", { draft: draft, settings: settings })';

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
  <p class="cc-none" data-if="!q.c.hasRaces">This story has no races to choose from. Go on to the next step.</p>
  <div data-if="q.c.hasRaces">
    <p class="cc-lead">Choose your people. A race moves a few stats a little; it costs no points.</p>
    <div class="cc-cards" role="radiogroup" aria-label="Race">
      <label class="cc-card" data-each="q.c.races as r">
        <input type="radio" name="cc-race" data-draft="race" data-bind-attr="value: r.id">
        <span class="cc-card-name">{{ r.name }}</span>
        <span class="cc-card-bonus" data-if="r.bonus">{{ r.bonus }}</span>
        <span class="cc-card-note">{{ r.note }}</span>
      </label>
    </div>
  </div>
</section>`;

const TALENTS = `
<section class="cc-step cc-talents">
  <p class="cc-none" data-if="!q.c.hasTalents">This story has no talents to choose from. Go on to the next step.</p>
  <div data-if="q.c.hasTalents">
    <p class="cc-lead">Take up to {{ q.c.rules.maxTalents }} talents. Each costs points from the same budget as your stats.
      <span class="cc-left">Points left: <b>{{ ${LIVE}.left }}</b></span></p>
    <ul class="cc-rolled" data-if="len(q.c.rolled)" aria-label="Rolled talents">
      <li data-each="q.c.rolled as t"><b>{{ t.name }}</b> <small>{{ t.cost }} pt<span data-if="t.bonus"> · {{ t.bonus }}</span></small> <em>rolled, kept</em></li>
    </ul>
    <div class="cc-talent-list">
      <label class="cc-talent" data-each="q.c.talents as t" data-if="!t.rolled">
        <input type="checkbox" data-draft="talents" data-bind-attr="value: t.id">
        <span class="cc-talent-head"><b>{{ t.name }}</b> <small>{{ t.cost }} pt<span data-if="t.bonus"> · {{ t.bonus }}</span></small></span>
        <span class="cc-talent-note">{{ t.note }}</span>
      </label>
    </div>
    <div class="cc-random">
      <ss-widget name="rpg-battle.talent-roll" data-props='{}'></ss-widget>
      <p class="cc-hint">Random talent rolls one your points can still pay for. Keep it, and the talent it showed is the one you get.</p>
    </div>
  </div>
</section>`;

const STATS = `
<section class="cc-step cc-stats">
  <p class="cc-lead">Every stat starts at {{ q.c.rules.startStat }}. Spend all your points; your race and talents are added after.
    <span class="cc-left">Points left: <b>{{ ${LIVE}.left }}</b></span></p>
  <div class="cc-stat-grid">
    <div class="cc-stat" data-each="q.c.stats as s">
      <ss-widget name="ss.stepper" data-props='{"name":"points.{{ s.id }}","label":"{{ s.label }}","value":{{ draft.points[s.id] }},"min":0,"max":{{ q.c.rules.pointMax }},"budget":{{ ${LIVE}.left }}}'></ss-widget>
    </div>
  </div>
  <div class="cc-preview">
    <ss-widget name="ss.radar" data-props='{"axes":{{ ${LIVE}.axes }},"label":"Your stats","levels":4}'></ss-widget>
  </div>
</section>`;

const YOU = `
<form class="cc-step cc-you" data-submit="creation.finish">
  <div class="cc-you-row">
    <ss-widget name="ss.portrait" data-props='{"src":"{{ draft.portrait }}","name":"{{ draft.name }}","frame":"circle","size":"lg"}'></ss-widget>
    <div class="cc-you-fields">
      <p class="cc-name"><b>{{ draft.name }}</b> <small class="cc-from">Name and background are set in Persona Management.</small></p>
      <p class="cc-none" data-if="!draft.name">Your persona has no name yet: set one in SillyTavern's Persona Management, then open this again.</p>
      <label class="cc-field">Portrait <small>(your persona's picture unless you give another)</small>
        <input data-draft="portrait" maxlength="2048" placeholder="An https: image address" autocomplete="off">
      </label>
    </div>
  </div>
  <div class="cc-background" data-if="draft.background">
    <span class="cc-label">Background</span>
    <p class="cc-background-text" data-bind="draft.background"></p>
  </div>
  <p class="cc-summary"><span data-if="draft.race">{{ ${LIVE}.raceName }}</span> <span>{{ ${LIVE}.talentNames }}</span></p>
  <p class="cc-problem" role="status">{{ ${LIVE}.message }}</p>
  <button type="submit" class="menu_button cc-go">Create {{ draft.name }}</button>
</form>`;

const CSS = `
:root { --cc-gap: 8px; }
.cc-step { display: grid; gap: var(--cc-gap); }
.cc-lead, .cc-none, .cc-hint { margin: 0; }
.cc-none, .cc-hint { opacity: .75; font-size: .9em; }
.cc-left { float: right; white-space: nowrap; }
.cc-left b { color: var(--ss-accent, var(--SmartThemeQuoteColor)); }
.cc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(11em, 1fr)); gap: var(--cc-gap); }
.cc-card, .cc-talent { display: grid; gap: 2px; padding: 6px 8px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--SmartThemeBorderColor, rgba(127, 127, 127, .4));
  background: var(--SmartThemeBlurTintColor, rgba(127, 127, 127, .08)); }
.cc-card input, .cc-talent input { justify-self: start; margin: 0; }
.cc-card:has(input:checked) { border-color: var(--ss-accent, var(--SmartThemeQuoteColor)); }
.cc-card-name { font-weight: bold; }
.cc-card-bonus, .cc-talent small { color: var(--ss-accent, var(--SmartThemeQuoteColor)); font-size: .85em; }
.cc-card-note, .cc-talent-note { font-size: .85em; opacity: .8; }
.cc-talent-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(14em, 1fr)); gap: var(--cc-gap); }
.cc-rolled { margin: 0; padding-left: 1.2em; }
.cc-rolled em { opacity: .7; font-size: .85em; }
.cc-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(12em, 1fr)); gap: var(--cc-gap); }
.cc-preview { display: flex; justify-content: center; }
.cc-you-row { display: flex; gap: 12px; align-items: center; }
.cc-you-fields { flex: 1; display: grid; gap: var(--cc-gap); }
.cc-name { margin: 0; }
.cc-from, .cc-field small { opacity: .7; font-size: .8em; }
.cc-background { padding: 6px 8px; border-radius: 8px; background: var(--SmartThemeBlurTintColor, rgba(127, 127, 127, .08)); }
.cc-label { font-size: .8em; opacity: .7; text-transform: uppercase; }
.cc-background-text { margin: 2px 0 0; white-space: pre-wrap; max-height: 10em; overflow: auto; font-size: .9em; }
.cc-field { display: grid; gap: 2px; font-size: .9em; }
.cc-summary { margin: 0; opacity: .85; }
.cc-problem { margin: 0; min-height: 1.2em; color: var(--ss-w-warn, #d9a441); font-size: .9em; }
.cc-go { justify-self: end; }
/* One "Points left" per step (in the lead): the steppers' own budget notes are hidden. */
.cc-stat .ss-w-stepper-budget { display: none; }
.cc-random, .cc-import { display: grid; gap: 4px; justify-items: start; }
.cc-import { margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--SmartThemeBorderColor, rgba(127, 127, 127, .4)); }
.rpg-roll { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rpg-roll-result, .rpg-import-note { margin: 0; flex: 1 1 100%; font-size: .9em; }
.rpg-roll-result:empty, .rpg-import-note:empty { display: none; }
.rpg-roll-result[data-problem], .rpg-import-note[data-problem] { color: var(--ss-w-warn, #d9a441); }
.rpg-import { display: grid; gap: 4px; justify-items: start; }
.rpg-import-go { position: relative; cursor: pointer; }
.rpg-import-go:focus-within { outline: 2px solid var(--ss-accent, var(--SmartThemeQuoteColor)); outline-offset: 2px; }
.rpg-import-file { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip-path: inset(50%); }
.rpg-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--cc-gap); }
.rpg-preset { display: grid; gap: 3px; padding: 6px 8px; border-radius: 8px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(127, 127, 127, .4));
  background: var(--SmartThemeBlurTintColor, rgba(127, 127, 127, .08)); }
.rpg-preset-chosen { border-color: var(--ss-accent, var(--SmartThemeQuoteColor)); }
.rpg-preset-name { font-weight: bold; }
.rpg-preset-origin, .rpg-preset-skills { font-size: .85em; color: var(--ss-accent, var(--SmartThemeQuoteColor)); }
.rpg-preset-note { font-size: .85em; opacity: .8; }
.rpg-preset-go, .rpg-preset-own { justify-self: start; }
@media (max-width: 600px) { .cc-left { float: none; display: block; } .cc-you-row { flex-direction: column; } }
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
