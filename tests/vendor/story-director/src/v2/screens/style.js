// Story Director v2, part screens: the look every Director screen shares (SPEC §13.3, MODULES §F18).
//
// The colours and shapes are Story Block's tokens (`--ss-*`, view/theme.js): the screens sit on the same glass as
// the rest of Story Suite and follow the reader's Look (Glass, Solid or Follow SillyTavern) and light or dark. A
// card or pack restyles them with `theme: { '--ss-accent': … }` or its own css. The blocks come from Story Block's
// classes (view/glass.css: `ss-glass`, `ss-label`, `ss-pill`, `ss-bar`, `ss-listcard`, `ss-button`); this sheet
// only adds the layout and the few states the blocks leave to the screen (a button's hover and press, and the
// rows' wrapping). Story Block scopes the sheet to the screen's root, where `:root` is that root.

export const BASE_CSS = `
:root {
  --sd-gap: var(--ss-space-2);
  --sd-radius: var(--ss-radius-m);
  --sd-text: var(--ss-text);
  --sd-muted: var(--ss-text);
  --sd-accent: var(--ss-accent);
  --sd-accent-text: var(--ss-accent-text, var(--ss-accent));
  --sd-border: var(--ss-border);
  --sd-surface: var(--ss-tile);
  --sd-good: var(--ss-good);
  --sd-warn: var(--ss-warn);
  --sd-bad: var(--ss-bad);
  color: var(--sd-text);
  font-family: var(--ss-font);
}
.ss-label { color: var(--sd-text); }
.sd-h { display: flex; align-items: baseline; gap: 6px; margin: 0 0 6px; }
.sd-h small { font-weight: normal; color: var(--sd-text); }
.sd-list { display: grid; gap: var(--sd-gap); margin: 0; padding: 0; list-style: none; }
.sd-card { display: grid; gap: 4px; padding: 10px 12px; min-width: 0; }
.sd-key { font-weight: 800; color: var(--sd-text); overflow-wrap: anywhere; }
.sd-line { margin: 0; overflow-wrap: anywhere; }
.sd-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; font-size: 0.85em; color: var(--sd-muted); overflow-wrap: anywhere; }
.sd-meta > * { overflow-wrap: anywhere; }
.sd-meta:not(:has(*)) { display: none; }
.sd-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sd-btn { min-height: 44px; min-width: 44px; margin: 0; padding: 6px 16px; flex: 1 1 auto; cursor: pointer; }
.sd-btn.ss-busy { opacity: 0.7; cursor: progress; }
.sd-reason { margin: 0; font-size: 0.85em; color: var(--sd-text); border-left: 3px solid var(--sd-warn); padding-left: 6px; }
.sd-empty { margin: 0; color: var(--sd-muted); font-style: italic; }
@media (min-width: 600px) {
  .sd-btn { flex: 0 0 auto; min-height: 40px; }
}
`;
