// The battle board's base stylesheet, added once per document by the first board drawn.
//
// Story Block's glass design (docs/dev/ui-and-screens.md "The look"): the cards, the actions, the result and
// the log are `ss-glass`, the buttons `ss-button`, the conditions, tags and turn-order items `ss-pill`, and a
// combatant's bar is `ss-bar` (its colour from the pool). Every rule sits inside :where(), so it has no
// specificity: the screen's scoped CSS (SPEC §13.3) overrides any of it. Colours, radii and spacing are Story
// Block's tokens (--ss-*), set on the Story Suite root the board sits in; the board has no palette of its own.
// Mobile first: the two sides are stacked, and side by side once the board is 600px wide.

export const boardCss = `
:where(.rpg-bb) {
  color: var(--ss-text);
  font-family: var(--ss-font);
  display: flex; flex-direction: column; gap: var(--ss-space-3);
  box-sizing: border-box; max-width: 100%; min-width: 0;
  container-type: inline-size;
}
:where(.rpg-bb *, .rpg-bb *::before, .rpg-bb *::after) { box-sizing: border-box; }
:where(.rpg-bb [hidden]) { display: none !important; }
:where(.rpg-bb button) { font: inherit; color: inherit; cursor: pointer; }
:where(.rpg-bb :focus-visible) { outline: 2px solid var(--ss-accent); outline-offset: 2px; }
:where(.rpg-bb h3) { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ss-muted); display: flex; align-items: center; gap: var(--ss-space-2); }
:where(.rpg-bb-empty, .rpg-bb-hint) { margin: 0; color: var(--ss-muted); font-style: italic; }


/* head and turn order (the timeline: one pill a unit, the current one ringed) */
:where(.rpg-bb-head) { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--ss-space-2); }
:where(.rpg-bb-round) { font-weight: 700; }
:where(.rpg-bb-place) { color: var(--ss-muted); }
:where(.rpg-bb-tag) { font-size: 12px; }
:where(.rpg-bb-tag.rpg-bb-death, .rpg-bb-tag.rpg-bb-boss) { color: var(--ss-bad); border-color: var(--ss-bad); }
:where(.rpg-bb-order) { display: flex; gap: var(--ss-space-1); margin: 0; padding: 0 0 2px; list-style: none; overflow-x: auto; scrollbar-width: thin; }
:where(.rpg-bb-order-item) { flex: none; font-size: 12px; white-space: nowrap; }
:where(.rpg-bb-order-item[data-side="enemy"]) { color: var(--ss-bad); }
:where(.rpg-bb-order-item.rpg-bb-current) { border-color: var(--ss-accent); background: var(--ss-accent-soft); font-weight: 700; }
:where(.rpg-bb-order-item.rpg-bb-done, .rpg-bb-order-item.rpg-bb-gone) { opacity: 0.5; }
:where(.rpg-bb-order-item.rpg-bb-gone) { text-decoration: line-through; }

/* the two sides */
:where(.rpg-bb-sides) { display: grid; grid-template-columns: 1fr; gap: var(--ss-space-3); }
@container (min-width: 600px) { :where(.rpg-bb-sides) { grid-template-columns: 1fr 1fr; } }
:where(.rpg-bb-side) { display: flex; flex-direction: column; gap: var(--ss-space-2); min-width: 0; }
:where(.rpg-bb-count) { font-weight: normal; color: var(--ss-muted); }
:where(.rpg-bb-cards) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13em), 1fr)); gap: var(--ss-space-2); margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-card) { display: flex; flex-direction: column; gap: 6px; padding: var(--ss-space-2) var(--ss-space-3); min-width: 0; }
:where(.rpg-bb-card.rpg-bb-turn) { border-color: var(--ss-accent); box-shadow: inset 0 0 0 1px var(--ss-accent), var(--ss-shadow); }
:where(.rpg-bb-card.rpg-bb-gone) { opacity: 0.5; filter: grayscale(0.8); }
:where(.rpg-bb-card.rpg-bb-pickable) { cursor: pointer; border-style: dashed; border-color: var(--ss-accent); }
:where(.rpg-bb-card.rpg-bb-pickable:hover) { background: var(--ss-accent-soft); }
:where(.rpg-bb-card-head) { display: flex; align-items: center; gap: var(--ss-space-2); min-width: 0; }
:where(.rpg-bb-portrait) { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 2.6em; height: 2.6em; }
:where(.rpg-bb-initials) { border-radius: 50%; background: var(--ss-tile); border: 1px solid var(--ss-border); font-weight: 700; font-size: 0.85em; }
:where(.rpg-bb-card[data-side="enemy"] .rpg-bb-initials) { color: var(--ss-bad); }
:where(.rpg-bb-card-title) { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; min-width: 0; }
:where(.rpg-bb-name) { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

/* combatant bars: the ss.bar look, the pool's colour, a low HP in the bad colour */
:where(.rpg-bb-meter) { display: grid; gap: 3px; font-size: 12px; }
:where(.rpg-bb-meter .ss-bar-head) { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
:where(.rpg-bb-meter-name) { color: var(--ss-muted); font-weight: 700; letter-spacing: 0.8px; }
:where(.rpg-bb-meter-value) { font-variant-numeric: tabular-nums; color: var(--ss-muted); }
:where(.rpg-bb-meter-track) { position: relative; height: 7px; border-radius: var(--ss-radius-pill); background: var(--ss-track); overflow: hidden; }
:where(.rpg-bb-meter-fill) { position: absolute; inset: 0 auto 0 0; width: calc(var(--ss-fill, 0) * 100%); border-radius: inherit; background: var(--ss-hp); transition: width var(--ss-motion) ease; }
:where(.rpg-bb-meter[data-pool="mp"] .rpg-bb-meter-fill) { background: var(--ss-mp); }
:where(.rpg-bb-meter[data-pool="sp"] .rpg-bb-meter-fill) { background: var(--ss-sp); }
:where(.rpg-bb-meter.rpg-bb-low .rpg-bb-meter-fill) { background: var(--ss-bad); }

/* conditions and the target preview */
:where(.rpg-bb-conditions) { display: flex; flex-wrap: wrap; gap: var(--ss-space-1); margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-cond) { font-size: 12px; color: var(--ss-text); border-color: var(--ss-bad); }
:where(.rpg-bb-cond.rpg-bb-helpful) { border-color: var(--ss-good); }
:where(.rpg-bb-cond-turns) { font-weight: 700; font-variant-numeric: tabular-nums; }
:where(.rpg-bb-preview) { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); font-size: 12px; color: var(--ss-accent); font-variant-numeric: tabular-nums; }

/* actions: the glass panel the player picks from */
:where(.rpg-bb-actions) { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: var(--ss-space-2); padding: var(--ss-space-2) var(--ss-space-3); }
:where(.rpg-bb-actor) { font-weight: 700; }
:where(.rpg-bb-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5em, 1fr)); gap: var(--ss-space-2); }
:where(.rpg-bb-act, .rpg-bb-entry, .rpg-bb-cancel, .rpg-bb-finish) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; }
:where(.rpg-bb-act[aria-expanded="true"]) { border-color: var(--ss-accent); background: var(--ss-accent-soft); }
:where(.rpg-bb-menu) { display: flex; flex-direction: column; gap: var(--ss-space-2); }
:where(.rpg-bb-menu-head, .rpg-bb-picking) { display: flex; align-items: center; justify-content: space-between; gap: var(--ss-space-2); }
:where(.rpg-bb-menu-list) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr)); gap: var(--ss-space-2); }
:where(.rpg-bb-entry) { flex-direction: column; align-items: flex-start; text-align: start; }
:where(.rpg-bb-entry:not(:disabled):hover) { border-color: var(--ss-accent); }
:where(.rpg-bb-entry-head) { display: flex; align-items: center; gap: 6px; }
:where(.rpg-bb-entry-meta) { font-size: 12px; color: var(--ss-muted); }
:where(.rpg-bb-entry-reason) { font-size: 12px; color: var(--ss-warn); }

/* log: a glass box, the lines read in the body text */
:where(.rpg-bb-log) { margin: 0; padding: var(--ss-space-1) var(--ss-space-2); list-style: none; max-height: 10em; overflow-y: auto; font-size: 13px; }
:where(.rpg-bb-log-line) { display: flex; gap: 8px; padding: 2px 0; }
:where(.rpg-bb-log-line.rpg-bb-important) { font-weight: 700; }
:where(.rpg-bb-log-round) { flex: none; color: var(--ss-muted); font-variant-numeric: tabular-nums; }

/* result */
:where(.rpg-bb-result) { display: flex; flex-direction: column; gap: var(--ss-space-2); padding: var(--ss-space-3); }
:where(.rpg-bb-outcome) { font-size: 1.15em; font-weight: 700; }
:where(.rpg-bb-result[data-outcome="won"] .rpg-bb-outcome) { color: var(--ss-good); }
:where(.rpg-bb-result[data-outcome="lost"] .rpg-bb-outcome) { color: var(--ss-bad); }
:where(.rpg-bb-result[data-outcome="fled"] .rpg-bb-outcome) { color: var(--ss-warn); }
:where(.rpg-bb-gains) { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; }
:where(.rpg-bb-gains dd) { margin: 0; font-variant-numeric: tabular-nums; }
:where(.rpg-bb-loot) { display: flex; flex-wrap: wrap; gap: var(--ss-space-1); margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-loot-item) { display: inline-flex; gap: 4px; align-items: baseline; font-size: 13px; }
:where(.rpg-bb-finish) { align-self: flex-start; font-weight: 700; }

/* The state markers, one level above the block classes they sit on (ss-glass, ss-pill, ss-button are 0,1,0; the
   :where() rules above are 0,0,0 and lose to them). Each is a .rpg-bb-prefixed rule: 0,2,0 and up, tokens only. */
.rpg-bb .rpg-bb-card.rpg-bb-turn { border-color: var(--ss-accent); box-shadow: inset 0 0 0 1px var(--ss-accent), var(--ss-shadow); }
.rpg-bb .rpg-bb-card.rpg-bb-gone { opacity: 0.5; filter: grayscale(0.8); }
.rpg-bb .rpg-bb-card.rpg-bb-pickable { cursor: pointer; border-style: dashed; border-color: var(--ss-accent); }
.rpg-bb .rpg-bb-card.rpg-bb-pickable:hover { background: var(--ss-accent-soft); }
.rpg-bb .rpg-bb-order-item.rpg-bb-current { border-color: var(--ss-accent); background: var(--ss-accent-soft); font-weight: 700; }
.rpg-bb .rpg-bb-order-item[data-side="enemy"] { color: var(--ss-bad); }
.rpg-bb .rpg-bb-order-item.rpg-bb-done, .rpg-bb .rpg-bb-order-item.rpg-bb-gone { opacity: 0.5; }
.rpg-bb .rpg-bb-order-item.rpg-bb-gone { text-decoration: line-through; }
.rpg-bb .rpg-bb-cond { color: var(--ss-text); border-color: var(--ss-bad); }
.rpg-bb .rpg-bb-cond.rpg-bb-helpful { border-color: var(--ss-good); }
.rpg-bb .rpg-bb-tag.rpg-bb-death, .rpg-bb .rpg-bb-tag.rpg-bb-boss { color: var(--ss-bad); border-color: var(--ss-bad); }
.rpg-bb .rpg-bb-act[aria-expanded="true"] { border-color: var(--ss-accent); background: var(--ss-accent-soft); }
.rpg-bb .rpg-bb-act:hover:not(:disabled), .rpg-bb .rpg-bb-cancel:hover:not(:disabled), .rpg-bb .rpg-bb-finish:hover:not(:disabled), .rpg-bb .rpg-bb-entry:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-text) 16%, transparent); }
.rpg-bb .rpg-bb-act:active:not(:disabled), .rpg-bb .rpg-bb-entry:active:not(:disabled) { transform: translateY(1px); }
.rpg-bb .rpg-bb-entry { flex-direction: column; align-items: flex-start; text-align: start; }
.rpg-bb .rpg-bb-entry:not(:disabled):hover { border-color: var(--ss-accent); }
.rpg-bb .rpg-bb-entry.rpg-bb-unusable { opacity: 0.5; }
.rpg-bb .rpg-bb-actions { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; align-items: stretch; width: 100%; gap: var(--ss-space-2); padding: var(--ss-space-2) var(--ss-space-3); }
.rpg-bb .rpg-bb-picking, .rpg-bb .rpg-bb-menu { width: 100%; }
.rpg-bb .rpg-bb-result[data-outcome="won"] .rpg-bb-outcome { color: var(--ss-good); }
.rpg-bb .rpg-bb-result[data-outcome="lost"] .rpg-bb-outcome { color: var(--ss-bad); }
.rpg-bb .rpg-bb-result[data-outcome="fled"] .rpg-bb-outcome { color: var(--ss-warn); }
.rpg-bb .rpg-bb-meter.rpg-bb-low .rpg-bb-meter-fill { background: var(--ss-bad); }
.rpg-bb .rpg-bb-meter[data-pool="mp"] .rpg-bb-meter-fill { background: var(--ss-mp); }
.rpg-bb .rpg-bb-meter[data-pool="sp"] .rpg-bb-meter-fill { background: var(--ss-sp); }
`;
