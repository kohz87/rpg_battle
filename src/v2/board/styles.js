// The battle board's base stylesheet, added once per document by the first board drawn.
//
// Every rule sits inside :where(), so it has no specificity: a screen's scoped CSS (SPEC §13.3) or a
// pack's theme overrides any of it. Colours and sizes are custom properties (--rpg-bb-*) that default
// to Story Block's widget tokens (--ss-w-*) and, under those, SillyTavern's own theme colours (MODULES
// §F18). Mobile first: the two sides are stacked, and side by side once the board is 600px wide.

export const boardCss = `
:where(.rpg-bb) {
  --rpg-bb-fg: var(--ss-w-fg, var(--SmartThemeBodyColor, #dcdcd2));
  --rpg-bb-muted: var(--ss-w-muted, color-mix(in srgb, var(--rpg-bb-fg) 60%, transparent));
  --rpg-bb-bg: var(--ss-w-bg, color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 85%, transparent));
  --rpg-bb-raised: var(--ss-w-raised, color-mix(in srgb, var(--rpg-bb-fg) 8%, transparent));
  --rpg-bb-border: var(--ss-w-border, var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2)));
  --rpg-bb-accent: var(--ss-w-accent, var(--ss-accent, var(--SmartThemeQuoteColor, #7c5cff)));
  --rpg-bb-good: var(--ss-w-good, #4caf6e);
  --rpg-bb-warn: var(--ss-w-warn, #d9a33a);
  --rpg-bb-bad: var(--ss-w-bad, #d0504a);
  --rpg-bb-info: var(--ss-w-info, #4a90d0);
  --rpg-bb-hp: var(--rpg-bb-good);
  --rpg-bb-hp-low: var(--rpg-bb-bad);
  --rpg-bb-mp: var(--rpg-bb-info);
  --rpg-bb-sp: var(--rpg-bb-warn);
  --rpg-bb-radius: var(--ss-w-radius, 6px);
  --rpg-bb-gap: var(--ss-w-gap, 0.4em);
  --rpg-bb-meter-height: 0.55em;
  --rpg-bb-portrait-size: 2.4em;
  --rpg-bb-log-height: 10em;
  container-type: inline-size;
  display: flex; flex-direction: column; gap: calc(var(--rpg-bb-gap) * 2);
  color: var(--rpg-bb-fg); box-sizing: border-box; max-width: 100%; min-width: 0;
}
:where(.rpg-bb *, .rpg-bb *::before, .rpg-bb *::after) { box-sizing: border-box; }
:where(.rpg-bb [hidden]) { display: none !important; }
:where(.rpg-bb button) { font: inherit; color: inherit; cursor: pointer; }
:where(.rpg-bb button:disabled) { cursor: not-allowed; opacity: 0.5; }
:where(.rpg-bb :focus-visible) { outline: 2px solid var(--rpg-bb-accent); outline-offset: 2px; }
:where(.rpg-bb h3) { margin: 0; font-size: 0.95em; display: flex; align-items: center; gap: var(--rpg-bb-gap); }
:where(.rpg-bb-empty, .rpg-bb-hint) { margin: 0; color: var(--rpg-bb-muted); font-style: italic; }

/* head and turn order */
:where(.rpg-bb-head) { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--rpg-bb-gap); }
:where(.rpg-bb-round) { font-weight: 600; }
:where(.rpg-bb-place) { color: var(--rpg-bb-muted); }
:where(.rpg-bb-tag) { font-size: 0.75em; padding: 0 0.45em; border-radius: 999px; border: 1px solid var(--rpg-bb-border); color: var(--rpg-bb-muted); white-space: nowrap; }
:where(.rpg-bb-tag.rpg-bb-death, .rpg-bb-tag.rpg-bb-boss) { color: var(--rpg-bb-bad); border-color: var(--rpg-bb-bad); }
:where(.rpg-bb-order) { display: flex; gap: 0.3em; margin: 0; padding: 0 0 0.2em; list-style: none; overflow-x: auto; scrollbar-width: thin; }
:where(.rpg-bb-order-item) { flex: none; font-size: 0.8em; padding: 0.15em 0.55em; border-radius: 999px; background: var(--rpg-bb-raised); border: 1px solid transparent; white-space: nowrap; }
:where(.rpg-bb-order-item[data-side="enemy"]) { color: color-mix(in srgb, var(--rpg-bb-bad) 70%, var(--rpg-bb-fg)); }
:where(.rpg-bb-order-item.rpg-bb-current) { border-color: var(--rpg-bb-accent); font-weight: 600; }
:where(.rpg-bb-order-item.rpg-bb-done, .rpg-bb-order-item.rpg-bb-gone) { opacity: 0.5; }
:where(.rpg-bb-order-item.rpg-bb-gone) { text-decoration: line-through; }

/* the two sides */
:where(.rpg-bb-sides) { display: grid; grid-template-columns: 1fr; gap: calc(var(--rpg-bb-gap) * 2); }
@container (min-width: 600px) { :where(.rpg-bb-sides) { grid-template-columns: 1fr 1fr; } }
:where(.rpg-bb-side) { display: flex; flex-direction: column; gap: var(--rpg-bb-gap); min-width: 0; }
:where(.rpg-bb-count) { font-weight: normal; color: var(--rpg-bb-muted); }
:where(.rpg-bb-cards) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13em), 1fr)); gap: var(--rpg-bb-gap); margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-card) { display: flex; flex-direction: column; gap: 0.25em; padding: 0.45em 0.55em; border-radius: var(--rpg-bb-radius); background: var(--rpg-bb-bg); border: 1px solid var(--rpg-bb-border); min-width: 0; }
:where(.rpg-bb-card.rpg-bb-turn) { border-color: var(--rpg-bb-accent); box-shadow: 0 0 0 1px var(--rpg-bb-accent) inset; }
:where(.rpg-bb-card.rpg-bb-gone) { opacity: 0.5; filter: grayscale(0.8); }
:where(.rpg-bb-card.rpg-bb-pickable) { cursor: pointer; border-style: dashed; border-color: var(--rpg-bb-accent); }
:where(.rpg-bb-card.rpg-bb-pickable:hover) { background: color-mix(in srgb, var(--rpg-bb-accent) 14%, var(--rpg-bb-bg)); }
:where(.rpg-bb-card-head) { display: flex; align-items: center; gap: var(--rpg-bb-gap); min-width: 0; }
:where(.rpg-bb-portrait) { flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--rpg-bb-portrait-size); height: var(--rpg-bb-portrait-size); --ss-w-portrait-size: var(--rpg-bb-portrait-size); }
:where(.rpg-bb-initials) { border-radius: 50%; background: var(--rpg-bb-raised); border: 1px solid var(--rpg-bb-border); font-weight: 600; font-size: 0.85em; }
:where(.rpg-bb-card[data-side="enemy"] .rpg-bb-initials) { color: var(--rpg-bb-bad); }
:where(.rpg-bb-card-title) { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3em; min-width: 0; }
:where(.rpg-bb-name) { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

/* meters */
:where(.rpg-bb-meter) { display: grid; grid-template-columns: 2em 1fr auto; align-items: center; gap: var(--rpg-bb-gap); font-size: 0.8em; }
:where(.rpg-bb-meter-name) { color: var(--rpg-bb-muted); }
:where(.rpg-bb-meter-value) { font-variant-numeric: tabular-nums; color: var(--rpg-bb-muted); }
:where(.rpg-bb-meter-track) { position: relative; height: var(--rpg-bb-meter-height); border-radius: 999px; background: var(--rpg-bb-raised); overflow: hidden; }
:where(.rpg-bb-meter-fill) { position: absolute; inset: 0 auto 0 0; width: calc(var(--rpg-bb-ratio, 0) * 100%); border-radius: inherit; background: var(--rpg-bb-hp); transition: width 0.25s ease; }
:where(.rpg-bb-meter[data-pool="mp"] .rpg-bb-meter-fill) { background: var(--rpg-bb-mp); }
:where(.rpg-bb-meter[data-pool="sp"] .rpg-bb-meter-fill) { background: var(--rpg-bb-sp); }
:where(.rpg-bb-meter.rpg-bb-low .rpg-bb-meter-fill) { background: var(--rpg-bb-hp-low); }

/* conditions and the target preview */
:where(.rpg-bb-conditions) { display: flex; flex-wrap: wrap; gap: 0.25em; margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-cond) { display: inline-flex; align-items: baseline; gap: 0.25em; font-size: 0.75em; padding: 0 0.45em; border-radius: 999px; background: color-mix(in srgb, var(--rpg-bb-bad) 22%, transparent); }
:where(.rpg-bb-cond.rpg-bb-helpful) { background: color-mix(in srgb, var(--rpg-bb-good) 22%, transparent); }
:where(.rpg-bb-cond-turns) { font-weight: 600; font-variant-numeric: tabular-nums; }
:where(.rpg-bb-preview) { display: flex; flex-wrap: wrap; gap: 0.5em; font-size: 0.8em; color: var(--rpg-bb-accent); font-variant-numeric: tabular-nums; }

/* actions */
:where(.rpg-bb-actions) { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: var(--rpg-bb-gap); padding: 0.5em; border-radius: var(--rpg-bb-radius); background: var(--rpg-bb-bg); border: 1px solid var(--rpg-bb-border); }
:where(.rpg-bb-actor) { font-weight: 600; }
:where(.rpg-bb-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(6.5em, 1fr)); gap: var(--rpg-bb-gap); }
:where(.rpg-bb-act, .rpg-bb-entry, .rpg-bb-cancel, .rpg-bb-finish) { display: inline-flex; align-items: center; justify-content: center; gap: 0.35em; min-height: 2.4em; padding: 0.3em 0.6em; border-radius: var(--rpg-bb-radius); border: 1px solid var(--rpg-bb-border); background: var(--rpg-bb-raised); }
:where(.rpg-bb-act[aria-expanded="true"]) { border-color: var(--rpg-bb-accent); }
:where(.rpg-bb-menu) { display: flex; flex-direction: column; gap: var(--rpg-bb-gap); }
:where(.rpg-bb-menu-head, .rpg-bb-picking) { display: flex; align-items: center; justify-content: space-between; gap: var(--rpg-bb-gap); }
:where(.rpg-bb-menu-list) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr)); gap: var(--rpg-bb-gap); }
:where(.rpg-bb-entry) { flex-direction: column; align-items: flex-start; text-align: start; }
:where(.rpg-bb-entry-head) { display: flex; align-items: center; gap: 0.35em; }
:where(.rpg-bb-entry-meta) { font-size: 0.8em; color: var(--rpg-bb-muted); }
:where(.rpg-bb-entry-reason) { font-size: 0.8em; color: var(--rpg-bb-warn); }

/* log */
:where(.rpg-bb-log) { margin: 0; padding: 0.3em 0.5em; list-style: none; max-height: var(--rpg-bb-log-height); overflow-y: auto; border-radius: var(--rpg-bb-radius); background: var(--rpg-bb-raised); font-size: 0.85em; }
:where(.rpg-bb-log-line) { display: flex; gap: 0.5em; padding: 0.1em 0; }
:where(.rpg-bb-log-line.rpg-bb-important) { font-weight: 600; }
:where(.rpg-bb-log-round) { flex: none; color: var(--rpg-bb-muted); font-variant-numeric: tabular-nums; }

/* result */
:where(.rpg-bb-result) { display: flex; flex-direction: column; gap: var(--rpg-bb-gap); padding: 0.6em; border-radius: var(--rpg-bb-radius); border: 1px solid var(--rpg-bb-border); background: var(--rpg-bb-bg); }
:where(.rpg-bb-outcome) { font-size: 1.15em; }
:where(.rpg-bb-result[data-outcome="won"] .rpg-bb-outcome) { color: var(--rpg-bb-good); }
:where(.rpg-bb-result[data-outcome="lost"] .rpg-bb-outcome) { color: var(--rpg-bb-bad); }
:where(.rpg-bb-result[data-outcome="fled"] .rpg-bb-outcome) { color: var(--rpg-bb-warn); }
:where(.rpg-bb-gains) { display: grid; grid-template-columns: auto 1fr; gap: 0.15em 0.8em; margin: 0; }
:where(.rpg-bb-gains dd) { margin: 0; font-variant-numeric: tabular-nums; }
:where(.rpg-bb-loot) { display: flex; flex-wrap: wrap; gap: 0.3em; margin: 0; padding: 0; list-style: none; }
:where(.rpg-bb-loot-item) { display: inline-flex; gap: 0.3em; align-items: baseline; padding: 0.1em 0.5em; border-radius: var(--rpg-bb-radius); background: var(--rpg-bb-raised); }
:where(.rpg-bb-finish) { align-self: flex-start; border-color: var(--rpg-bb-accent); font-weight: 600; }
`;
