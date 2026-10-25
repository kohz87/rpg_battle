// Story Director v2, part screens: `story-director/status-card` (SPEC §13.1), the inline card under
// each reply (mount `card`). Rows with no box of their own (they sit in the card's fold), labels on the
// left: the story time, the place, its map coordinates when the atlas knows them, the weather (Story
// Block's `scene.weather`, when the story set one) and the current goal (the active quest touched last:
// its goal and step, with that quest's progress). A row with no value is left out. Only what {{user}} knows (world/known.js): the next thing coming
// due is not here (a planned beat or clock would spoil the story); the Director screen shows it, behind
// Reveal. A card shows **that reply's** state: Story Block's card mount runs
// these bindings on `stateAt(index)`, so an older reply keeps the time, place and goal it had, and a
// line that reply changed is marked (`changed(…)` reads that reply's own changes).
// On under every reply by default, collapsed to its header (MODULES §F24): `defaultOn: true` is the field
// Story Block's screen registry reads (`cardsOn(id)`: the reader's own on/off wins, else `defaultOn`).

import { BASE_CSS } from './style.js';

export const STATUS_CARD_ID = 'story-director/status-card';

// The rows sit directly in the card's fold (Story Block's card mount draws the fold): no box of their own. A row with
// no value is left out. Labels are the muted small-caps column; values are body text.
const TEMPLATE = `
<dl class="sd-status">
  <div class="sd-row sd-time" data-if="q.time.text" data-class="sd-new: changed('state.director.time')">
    <dt><i class="fa-solid fa-clock" aria-hidden="true"></i> Time</dt>
    <dd>{{ q.time.text }}</dd>
  </div>
  <div class="sd-row sd-weather" data-if="q.status.weather">
    <dt><i class="fa-solid fa-cloud-sun" aria-hidden="true"></i> Weather</dt>
    <dd>{{ q.status.weather }}</dd>
  </div>
  <div class="sd-row sd-place" data-if="state.scene.place.name" data-class="sd-new: changed('state.scene.place')">
    <dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Place</dt>
    <dd>{{ state.scene.place.name }}<small data-if="state.scene.place.region"> · {{ state.scene.place.region }}</small></dd>
  </div>
  <div class="sd-row sd-coords" data-if="q.status.coords">
    <dt><i class="fa-solid fa-crosshairs" aria-hidden="true"></i> Coordinates</dt>
    <dd>{{ q.status.coords }}</dd>
  </div>
  <div class="sd-row sd-goal" data-if="q.goal" data-class="sd-new: changed(state.director.threads[q.goal.id])">
    <dt><i class="fa-solid fa-flag" aria-hidden="true"></i> Goal</dt>
    <dd><b>{{ q.goal.key }}</b><span data-if="q.goal.goal"> — {{ q.goal.goal }}</span>
      <small class="sd-step" data-if="q.goal.step">Now: {{ q.goal.step }}</small>
    </dd>
  </div>
</dl>
`;

const CSS = `${BASE_CSS}
.sd-status { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; align-items: baseline;
  margin: 0; padding: 0; min-width: 0; font-size: 0.9em; line-height: 1.45; background: none; border: 0; box-shadow: none; }
.sd-row { display: contents; }
.sd-row > dt { margin: 0; font-variant: small-caps; letter-spacing: 0.04em; color: color-mix(in srgb, var(--sd-text) 80%, transparent); white-space: nowrap; align-self: baseline; }
.sd-row > dt i { width: 1.1em; text-align: center; color: var(--sd-accent); }
.sd-row > dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--sd-text); }
.sd-row > dd small { color: var(--sd-muted); }
.sd-step { display: block; }
.sd-new > dd { color: var(--sd-accent-text); }
.sd-new > dt::after { content: " •"; color: var(--sd-accent); }
.sd-progress { display: block; margin-top: 4px; }
.sd-progress .ss-bar-label { font-variant-numeric: tabular-nums; }
.sd-met .ss-bar { --ss-bar-color: var(--sd-good); }
`;

export const statusCardScreen = Object.freeze({
    id: STATUS_CARD_ID,
    title: 'Status',
    icon: 'fa-compass',
    mounts: ['card'],
    defaultOn: true,
    data: {
        time: { query: 'director.time' },
        // The place's map coordinates and the weather (screens/queries.js statusExtras).
        status: { query: 'director.status' },
        goal: { query: 'director.goal' },
    },
    template: TEMPLATE,
    css: CSS,
});
