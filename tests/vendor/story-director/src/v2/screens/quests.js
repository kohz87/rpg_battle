// Neutral goals and old quest history, read through SD threads without an RPG dependency.

import { BASE_CSS } from './style.js';

export const QUESTS_ID = 'story-director/quests';

// SD's neutral/read-only view uses only its own retained projection, including old quests.
const TEMPLATE = `
<div class="sd-quests">
  <section class="ss-listcard ss-glass" aria-label="Goals and quest history">
    <h4>Goals and quest history</h4>
    <ul class="sd-cards">
      <li class="sd-card" data-each="q.threads as t" data-if="t.kind == 'quest' || t.rpg != null || t.fields.goal != null">
        <b>{{ t.key }}</b><p>{{ t.summary }}</p>
        <p>{{ t.fields.goal }}</p><p>{{ t.fields.progress }}</p><p>{{ t.fields.step }}</p>
        <p>{{ t.status }}</p><p data-if="t.offer">Offered</p>
        <p data-if="t.kind == 'quest' && t.rpg == null">From an earlier version (read only)</p>
        <p data-if="t.owed != null && t.rpg == null">Reward from an earlier version: {{ t.owed.text }}</p>
      </li>
    </ul>
  </section>
</div>`;

// Every quest is one card: the header (title, then the pills: status and reward; the pills move under the title when the
// screen is narrow, 420px or less), the summary, "From" in small text, the progress bar, "Now:" and the Details fold.
// The same markup in the Story panel and the game view; the game view lays the cards out in columns (320px or more each).
const CSS = `${BASE_CSS}
.sd-quests { display: grid; gap: 14px; padding: 4px 0; min-width: 0; container-type: inline-size; }
.sd-active, .sd-finished { min-width: 0; }
.sd-finished { padding: 8px 12px; }
.sd-finished > summary { cursor: pointer; list-style-position: inside; min-height: 28px; padding: 4px 0; }
.sd-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; min-width: 0; }
.sd-quest, .sd-done { display: grid; gap: 8px; margin: 0; padding: 12px 14px; min-width: 0; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); }
.sd-quest.sd-ready { border-color: var(--sd-good); }
.sd-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; }
.sd-title { flex: 1 1 12em; min-width: 0; font-weight: 800; overflow-wrap: anywhere; word-break: break-word; }
.sd-pills { display: flex; flex-wrap: wrap; gap: 6px; flex: 0 1 auto; justify-content: flex-end; min-width: 0; max-width: 100%; }
.sd-pills .ss-pill { white-space: nowrap; flex-shrink: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; margin: 0; }
.sd-st { font-weight: 700; }
.sd-st[data-state="ready"] { --ss-ring: var(--sd-good); }
.sd-st[data-state="notyet"] { --ss-ring: var(--sd-warn); }
.sd-sum, .sd-now, .sd-from, .sd-status { margin: 0; overflow-wrap: anywhere; }
.sd-status { font-size: 0.85em; color: var(--sd-muted); }
.sd-from { font-size: 0.85em; color: var(--sd-muted); }
.sd-bar { margin: 0; }
.sd-met .sd-bar .ss-bar { --ss-bar-color: var(--sd-good); }
.sd-more { margin: 0; }
.sd-more > summary { cursor: pointer; min-height: 28px; padding: 4px 0; font-size: 0.85em; color: var(--sd-muted); }
.sd-more[open] { padding: 8px 10px; border: 1px solid var(--sd-border); border-radius: var(--sd-radius); background: var(--sd-surface); }
.sd-facts { display: grid; gap: 4px; margin: 4px 0; }
.sd-facts > div { display: grid; grid-template-columns: 6.5em minmax(0, 1fr); gap: 6px; }
.sd-facts dt { color: var(--sd-muted); }
.sd-facts dd { margin: 0; overflow-wrap: anywhere; }
.sd-history { margin: 4px 0 0; padding-left: 1.2em; font-size: 0.85em; color: var(--sd-muted); }
.sd-history li { overflow-wrap: anywhere; }
.sd-done .sd-outcome { --ss-ring: var(--sd-muted); }
.sd-done[data-outcome="done"] .sd-outcome { --ss-ring: var(--sd-good); }
.sd-done[data-outcome="failed"] .sd-outcome, .sd-done[data-outcome="abandoned"] .sd-outcome { --ss-ring: var(--sd-warn); }
/* A narrow screen (the Story panel, a phone): the pills take a row of their own under the title. */
@container (max-width: 420px) {
  .sd-pills { flex-basis: 100%; justify-content: flex-start; }
}
/* The game view's wide screen: at most about three columns, not rows across the whole window. */
@media (min-width: 900px) {
  .sd-active .sd-cards, .sd-finished .sd-cards { max-width: 1000px; }
}
`;

export const questsScreen = Object.freeze({
    id: QUESTS_ID,
    title: 'Quests',
    icon: 'fa-scroll',
    mounts: ['tab', 'screen'],
    data: { threads: { query: 'director.threads' } },
    template: TEMPLATE,
    css: CSS,
});
