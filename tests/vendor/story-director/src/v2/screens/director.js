// Story Director v2, part screens: `story-director/director` (SPEC §13.1), the Director tab and
// game-view screen: the story time on the chat's calendar (`director.time`) and the place in its header,
// the arc panel (widget `story-director.arc`, arc/widget.js), then the threads the reader may see
// (quests, hooks, world events) grouped by kind (open ones first, closed ones folded under them), then
// behind the scenes (widget `story-director.behind`: agendas, beats, clocks and secrets, hidden behind
// Reveal per chat, reveal.js), then the problems the last replies' Director lines had about the rest,
// newest first. Secrets show by name only. Read-only: the threads come from `director.threads` (bindings per kind: all, open, closed), the
// problems from `director.problems` (their `{{user}}` written out; one about an offer or a missing goal
// only while that is still so). An older chat's offer, which the Quests tab no longer shows, is tagged
// "offered" here.
//
// Each kind is a list card (Story Block's `ss-listcard`, view/glass.css) drawn from the template: a row
// holds the key, what the story last said of it, its tags (offered, ready, the outcome) as pills, and the
// fields on a meta line.

import { BASE_CSS } from './style.js';
import { BEHIND } from './reveal.js';
import { BEHIND_WIDGET } from './behind.js';
import { ARC_WIDGET } from '../arc/widget.js';

export const DIRECTOR_ID = 'story-director/director';

/** The kinds in the order the screen shows them, with their headings (the tracker tab's order). */
export const KIND_GROUPS = Object.freeze([
    ['quest', 'Quests'], ['hook', 'Hooks'], ['agenda', 'Off-screen'], ['event', 'World'],
    ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets'],
]);

/** The kinds the template itself draws: what the reader may see (the rest is behind the scenes, behind.js). */
export const OPEN_KIND_GROUPS = Object.freeze(KIND_GROUPS.filter(([kind]) => !BEHIND.has(kind)));

// What a thread row shows: its key, then what the story last said of it. Secrets: the name only.
function threadItem(list, kind) {
    if (kind === 'secret') {
        return `<li class="ss-listcard-row sd-thread" data-each="${list} as t" data-thread="{{ t.id }}">
          <div class="ss-listcard-item"><span class="ss-listcard-main"><span class="ss-listcard-title">{{ t.key }}</span></span></div>
        </li>`;
    }
    return `<li class="ss-listcard-row sd-thread" data-each="${list} as t" data-thread="{{ t.id }}">
          <div class="ss-listcard-item">
            <span class="ss-listcard-main">
              <span class="ss-listcard-title">{{ t.key }}</span>
              <span class="ss-listcard-sub" data-if="t.summary">{{ t.summary }}</span>
              <span class="sd-meta">
                <span data-if="t.fields.step">Now: {{ t.fields.step }}</span>
                <span data-if="t.fields.now">At: {{ t.fields.now }}</span>
                <span data-if="t.fields.then">Next: {{ t.fields.then }}</span>
                <span data-if="t.fields.giver">From {{ t.fields.giver }}</span>
                <span data-if="t.fields.due">Due {{ t.fields.due }}</span>
                <span data-if="t.fields.on">On {{ t.fields.on }}</span>
                <span data-if="t.fields.arrive">Arrives {{ t.fields.arrive }}</span>
              </span>
            </span>
            <span class="sd-tags">
              <span class="ss-pill ss-pill-soft" data-if="t.offer">offered</span>
              <span class="ss-pill ss-pill-outline sd-ready" data-if="t.ready">ready</span>
              <span class="ss-pill sd-outcome" data-if="t.ended">{{ t.ended.outcome }}</span>
            </span>
          </div>
        </li>`;
}

function section(kind, title) {
    const every = `q.${kind}`;
    const open = `q.${kind}_open`;
    const closed = `q.${kind}_closed`;
    return `
  <section class="sd-kind ss-listcard ss-glass" data-kind="${kind}" data-if="len(${every})">
    <h4 class="ss-label ss-listcard-head sd-h">${title} <small data-if="len(${open})">{{ len(${open}) }}</small></h4>
    <ul class="ss-listcard-rows sd-threads">
        ${threadItem(open, kind)}
    </ul>
    <details class="sd-closed" data-if="len(${closed})">
      <summary>Closed <small>{{ len(${closed}) }}</small></summary>
      <ul class="ss-listcard-rows sd-threads">
        ${threadItem(closed, kind)}
      </ul>
    </details>
  </section>`;
}

const TEMPLATE = `
<div class="sd-director">
  <header class="sd-clock" data-if="q.time.text" role="status" aria-label="Story time">
    <i class="fa-solid fa-clock" aria-hidden="true"></i> <span class="sd-when">{{ q.time.text }}</span>
    <span class="sd-where" data-if="state.scene.place.name">· {{ state.scene.place.name }}</span>
  </header>
  <ss-widget class="sd-wide" name="${ARC_WIDGET}" data-props='{"bind":"q.arc"}'></ss-widget>
  <p class="sd-empty" data-if="!len(q.all)">Nothing tracked yet.</p>
${OPEN_KIND_GROUPS.map(([kind, title]) => section(kind, title)).join('\n')}
  <ss-widget class="sd-wide" name="${BEHIND_WIDGET}" data-props='{"bind":"q.behind"}' data-if="q.behind.total"></ss-widget>
  <section class="sd-kind ss-listcard ss-glass sd-problems-box" data-kind="problems" data-if="len(q.problems)">
    <h4 class="ss-label ss-listcard-head sd-h">Problems <small>{{ len(q.problems) }}</small></h4>
    <ol class="ss-listcard-rows sd-problems">
      <li class="ss-listcard-row sd-problem" data-each="q.problems as p" data-kind="{{ p.kind }}">
        <div class="ss-listcard-item">
          <span class="ss-listcard-main"><span class="ss-listcard-title">{{ p.text }}</span></span>
          <span class="ss-pill sd-ptag" title="{{ p.kind }}">{{ p.kind }}</span>
        </div>
      </li>
    </ol>
  </section>
</div>
`;

const CSS = `${BASE_CSS}
.sd-director { display: grid; gap: 14px; padding: 4px 0; min-width: 0; }
.sd-clock { margin: 0; font-size: 0.9em; overflow-wrap: anywhere; color: var(--sd-text); }
.sd-clock i { color: var(--sd-accent); margin-right: 2px; }
.sd-kind { min-width: 0; }
.sd-threads { gap: 0; }
.sd-thread .ss-listcard-title, .sd-thread .ss-listcard-sub { overflow-wrap: anywhere; }
.sd-thread .sd-meta { margin-top: 2px; }
.sd-tags { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 42%; min-width: 0; }
.sd-tags .ss-pill { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.sd-outcome { text-transform: lowercase; }
/* Ready: an outline pill with a good-coloured border (offered is the soft pill; .ss-pill does not read --ss-ring). */
.sd-ready { border-color: var(--sd-good); }
.sd-closed { padding: 2px 0; }
.sd-closed > summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; gap: 6px; color: var(--sd-muted); }
/* Problems are stored oldest first; the newest is shown on top. */
.sd-problems { display: flex; flex-direction: column-reverse; max-height: 18em; overflow-y: auto; }
.sd-problem .ss-listcard-title { font-weight: 400; font-size: 0.9em; }
/* The tag sits beside the message when there is room, else on its own line under it. It does not wrap; past about 24
   characters it is cut with an ellipsis (the full tag is in its title). */
.sd-problem > .ss-listcard-item { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 8px; }
.sd-problem .ss-listcard-main { flex: 1 1 12em; min-width: 0; }
.sd-problem .sd-ptag { flex: 0 1 auto; max-width: 24ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sd-arc.ss-listcard { gap: 8px; }
/* The arc panel and behind the scenes (widgets drawn into this screen, so this sheet styles them too). */
.sd-arc { display: grid; gap: 8px; min-width: 0; }
.sd-arc .sd-h { margin: 0; }
.sd-arc-desc, .sd-arc-head, .sd-arc-note, .sd-arc-needs { margin: 0; overflow-wrap: anywhere; }
.sd-arc-note, .sd-arc-needs, .sd-arc-none { font-size: 0.9em; color: var(--sd-muted); }
.sd-arc-text { width: 100%; min-height: 9em; font: inherit; font-size: 0.9em; resize: vertical; box-sizing: border-box; }
.sd-arc-findings { gap: 2px; font-size: 0.85em; color: var(--sd-muted); }
.sd-arc-finding.sd-warn { border-left: 3px solid var(--sd-warn); padding-left: 6px; }
/* Buttons keep their icon and label on one line (the block's button is a flex box with a gap). */
.sd-arc .sd-btn, .sd-behind .sd-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.sd-behind { display: grid; gap: 14px; min-width: 0; }
.sd-lock { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: start; padding: 10px 12px;
  border: 1px dashed var(--sd-border); border-radius: var(--ss-radius-l); min-width: 0; }
.sd-lock-icon { margin-top: 3px; color: var(--sd-accent); }
.sd-lock-text { display: grid; gap: 2px; min-width: 0; }
.sd-lock .sd-actions { grid-column: 1 / -1; }
.sd-unlocked { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 0.9em; color: var(--sd-muted); }
.sd-unlocked .sd-btn { flex: 0 0 auto; }
@media (min-width: 720px) {
  .sd-director { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .sd-empty, .sd-clock, .sd-wide { grid-column: 1 / -1; }
  .sd-behind { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items: start; }
  .sd-unlocked, .sd-lock, .sd-behind .sd-problems-box { grid-column: 1 / -1; }
}
`;

const data = {
    time: { query: 'director.time' },
    all: { query: 'director.threads' },
    // The problems about what the reader may see; those behind the scenes are in `behind`.
    problems: { query: 'director.problems', args: { behind: false } },
    arc: { query: 'director.arc' },
    behind: { query: 'director.behind' },
};
for (const [kind] of OPEN_KIND_GROUPS) {
    data[kind] = { query: 'director.threads', args: { kind } };
    data[`${kind}_open`] = { query: 'director.threads', args: { kind, status: 'active' } };
    data[`${kind}_closed`] = { query: 'director.threads', args: { kind, status: 'resolved' } };
}

export const directorScreen = Object.freeze({
    id: DIRECTOR_ID,
    title: 'Director',
    icon: 'fa-compass',
    mounts: ['tab', 'screen'],
    data,
    template: TEMPLATE,
    css: CSS,
});
