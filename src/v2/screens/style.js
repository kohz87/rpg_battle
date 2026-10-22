// RPG Battle v2, part **screens**: the look every default screen shares (SPEC §13.3, MODULES §F18), on
// Story Block's glass design (docs/dev/ui-and-screens.md "The look"). Colours, radii, spacing and type come
// from Story Block's tokens (`--ss-*`, set on every Story Suite root and on the screen's own root), and the
// surfaces, labels, bars, tiles, pills, statuses, lists, tiers and the hero card are Story Block's blocks.
// This file adds only layout, the screen's own rules (the rows of a card, the grids), the button states the
// glass button leaves out, and the standard widgets' colours, read from the same tokens. No colour of its own.
//
// Story Block scopes the whole sheet to that screen's root (`[data-ss-screen="<id>"]`), so `:root` here is
// the screen root and nothing reaches the rest of the page. A Story Block class (`.ss-glass`, `.ss-button`,
// …) is one class of weight, so a rule here with `.rb` in front of it wins over the block's own.

/** The base rules every screen of this part shares. */
export const BASE_CSS = `
.rb { display: grid; gap: var(--ss-space-3); min-width: 0; font-family: var(--ss-font); font-size: 14px; line-height: 1.35; color: var(--ss-text); }
.rb *, .rb *::before, .rb *::after { box-sizing: border-box; }
.rb ss-widget { display: block; min-width: 0; }
.rb h3, .rb h4, .rb p { margin: 0; }
.rb small { color: var(--ss-muted); font-weight: normal; }
.rb .ss-label { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ss-space-2); }
.rb .ss-label > i { color: var(--ss-accent); }
.rb .ss-label > small { margin-left: auto; letter-spacing: 0; text-transform: none; }
.none, .empty { color: var(--ss-muted); font-style: italic; }

/* the standard widgets (WIDGETS.md "Styling") take the glass tokens */
.rb .ss-w {
  --ss-w-fg: var(--ss-text); --ss-w-muted: var(--ss-muted); --ss-w-bg: var(--ss-tile); --ss-w-raised: var(--ss-track);
  --ss-w-border: var(--ss-border); --ss-w-accent: var(--ss-accent); --ss-w-good: var(--ss-good); --ss-w-warn: var(--ss-warn);
  --ss-w-bad: var(--ss-bad); --ss-w-info: var(--ss-info);
}

/* glass buttons: Story Block's ss-button draws the rest and the focus ring; these are its hover and press, and
   the danger and primary tones, each from the tokens. A button is never a colour of its own. */
.rb .ss-button { transition: background-color var(--ss-motion) ease, border-color var(--ss-motion) ease, transform var(--ss-motion) ease; }
.rb .ss-button:not(:disabled) { cursor: pointer; }
.rb .ss-button:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-text) 16%, transparent); }
.rb .ss-button:active:not(:disabled) { transform: translateY(1px); }
.rb .ss-button.ss-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-accent) 34%, transparent); }
.rb .ss-button.ss-button-quiet:hover:not(:disabled) { background: var(--ss-tile); }
.rb .ss-button.ss-button-quiet:not(:disabled) { border-color: var(--ss-border); }
.rb .ss-button.ss-button-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--ss-bad) 30%, transparent); }
.rb .ss-button:disabled { cursor: default; opacity: 0.45; }

/* Create your character (creation's button, widget rpg-battle.create-character; creation's own markup) */
.rpg-create { display: inline-grid; gap: 4px; justify-items: center; min-width: 0; font-style: normal; }
.rpg-create[hidden] { display: none; }
.rpg-create-go { font-weight: 600; }
.rpg-create-go i { margin-right: 6px; color: inherit; }
.rpg-create.compact .rpg-create-go i { margin-right: 4px; }
.rpg-create-note { margin: 0; color: var(--ss-bad); font-size: 0.85em; overflow-wrap: anywhere; }

/* one-line rows: the listcard's rows, with the buttons and pills that go in them */
.rb .ss-listcard { gap: 0; }
.rb .ss-listcard-item { flex-wrap: wrap; }
.rb .ss-listcard-main { flex: 1 1 12em; }
.rb .ss-listcard-item .acts { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--ss-space-1); margin-left: auto; }
.rb .ss-listcard-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.rb .ss-listcard-title .qty { font-variant-numeric: tabular-nums; color: var(--ss-muted); }
.rb .ss-listcard-sub { display: block; font-size: 13px; }
.rb .ss-listcard-value, .rb .ss-listcard-tag { font-variant-numeric: tabular-nums; }
.rb .ss-listcard-icon i { color: var(--ss-accent); }
.rb .ss-listcard-row.aside .ss-listcard-title { color: var(--ss-muted); font-weight: 500; }

/* prices are pills; the button beside one is the action */
.rb .price { font-variant-numeric: tabular-nums; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .rb *, .rb *::before, .rb *::after { transition: none !important; animation: none !important; }
}
`;

/**
 * The screen root as a size container (`@container rb-screen (…)`), for screens drawn in a block that
 * has its own width: a tab, the game view, a card under a reply. Never for the HUD: an inline-size
 * container takes no width from what it holds, so a HUD item sized by its content shrinks to nothing.
 */
export const CONTAINER_CSS = ':root { container: rb-screen / inline-size; }';

/**
 * A screen's whole sheet: the shared base, then its own rules. `container` (default true) makes the
 * screen root the `rb-screen` size container its `@container` rules read.
 */
export const sheet = (own, { container = true } = {}) => `${BASE_CSS}${container ? `${CONTAINER_CSS}\n` : ''}\n${own.trim()}\n`;
