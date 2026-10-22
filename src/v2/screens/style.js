// RPG Battle v2, part **screens**: the look every default screen shares (SPEC §13.3, MODULES §F18).
//
// Colours come from the SillyTavern theme (--SmartThemeBodyColor for text, --SmartThemeBlurTintColor
// for the glass, --SmartThemeBorderColor, --SmartThemeShadowColor, --SmartThemeQuoteColor as the
// accent), and every surface is that text colour or tint mixed with transparency, so a light theme
// and a dark one both read. The pools' colours are custom properties set by each screen's `theme`
// (`--rb-hp`, `--rb-mp`, `--rb-sp`, `--rb-xp`), which a pack or card restyles without touching CSS.
//
// This text is put in front of each screen's own CSS; Story Block scopes the whole sheet to that
// screen's root (`[data-ss-screen="<id>"]`), so `:root` here is the screen root and nothing reaches
// the rest of the page. The standard widgets' base rules have no specificity (WIDGETS.md, Styling),
// so the `.ss-w…` rules below restyle them.

/** The pool and tone colours; each screen's `theme` (screens may override any). */
export const THEME = Object.freeze({
    '--rb-hp': '#e5534b',
    '--rb-mp': '#3f8cff',
    '--rb-sp': '#e2a336',
    '--rb-xp': '#a47cf3',
    '--rb-good': '#3fb27f',
    '--rb-warn': '#e2a336',
    '--rb-bad': '#e5534b',
    '--rb-radius': '14px',
});

export const BASE_CSS = `
:root {
  --rb-fg: var(--SmartThemeBodyColor, #e8e8ee);
  --rb-muted: color-mix(in srgb, var(--rb-fg) 62%, transparent);
  --rb-faint: color-mix(in srgb, var(--rb-fg) 40%, transparent);
  --rb-line: color-mix(in srgb, var(--rb-fg) 14%, transparent);
  --rb-raised: color-mix(in srgb, var(--rb-fg) 7%, transparent);
  --rb-track: color-mix(in srgb, var(--rb-fg) 12%, transparent);
  --rb-glass: color-mix(in srgb, var(--SmartThemeBlurTintColor, #1b1d26) 76%, transparent);
  --rb-shadow: var(--SmartThemeShadowColor, rgba(0, 0, 0, 0.28));
  --rb-accent: var(--ss-accent, var(--SmartThemeQuoteColor, #8b7cf6));
  --rb-gap: 10px;
  color: var(--rb-fg);
}
.rb { display: grid; gap: var(--rb-gap); min-width: 0; font-size: 0.95em; line-height: 1.35; }
.rb *, .rb *::before, .rb *::after { box-sizing: border-box; }
.rb ss-widget { display: block; min-width: 0; }
.rb h3, .rb h4, .rb p { margin: 0; }
.rb small { color: var(--rb-muted); font-weight: normal; }

/* glass card */
.card {
  position: relative; min-width: 0; padding: 12px; border-radius: var(--rb-radius);
  background: var(--rb-glass); border: 1px solid var(--rb-line);
  box-shadow: 0 6px 22px var(--rb-shadow);
  backdrop-filter: blur(var(--SmartThemeBlurStrength, 10px)) saturate(1.15);
  -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength, 10px)) saturate(1.15);
}
.card::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(155deg, color-mix(in srgb, var(--rb-fg) 9%, transparent), transparent 42%);
}
.card > * { position: relative; }

/* section heads */
.group { display: grid; gap: 6px; min-width: 0; }
.group > h4, .block > h4 {
  display: flex; align-items: baseline; gap: 8px; font-size: 0.78em; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--rb-muted);
}
.group > h4 i, .block > h4 i { color: var(--rb-accent); }
.group > h4 small, .block > h4 small { margin-left: auto; letter-spacing: 0; text-transform: none; }
.none, .empty { color: var(--rb-muted); font-style: italic; font-size: 0.9em; }
.empty { padding: 14px; text-align: center; border: 1px dashed var(--rb-line); border-radius: var(--rb-radius); }
.empty i { color: var(--rb-accent); margin-right: 4px; }
/* "Create your character" (widget rpg-battle.create-character) */
.rpg-create { display: inline-grid; gap: 4px; justify-items: center; min-width: 0; font-style: normal; }
.rpg-create[hidden] { display: none; }
.rpg-create-go { font-weight: 600; }
.rpg-create-go i { margin-right: 6px; color: inherit; }
.rpg-create.compact .rpg-create-go i { margin-right: 4px; }
.rpg-create-note { margin: 0; color: var(--rb-bad); font-size: 0.85em; overflow-wrap: anywhere; }

/* one-line rows */
.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0;
  padding: 7px 10px; border-radius: 10px; background: var(--rb-raised); border: 1px solid transparent;
}
.row:hover { border-color: var(--rb-line); }
.row .main { display: grid; flex: 1 1 12em; min-width: 0; }
.row .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.row .sub, .row .note { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82em; color: var(--rb-muted); }
.row .qty { margin-left: 4px; font-weight: 600; color: var(--rb-muted); font-variant-numeric: tabular-nums; }
.row .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-left: auto; }
.row .lbl { font-size: 0.78em; color: var(--rb-muted); }

/* buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px;
  padding: 4px 12px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--rb-accent) 55%, transparent);
  background: color-mix(in srgb, var(--rb-accent) 18%, transparent); color: var(--rb-fg);
  font: inherit; font-size: 0.86em; font-weight: 600; line-height: 1.1; cursor: pointer; white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.btn:hover { background: color-mix(in srgb, var(--rb-accent) 30%, transparent); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--rb-accent); outline-offset: 2px; }
.btn:disabled, .btn.ss-busy { opacity: 0.55; cursor: progress; }
.btn.primary { background: color-mix(in srgb, var(--rb-accent) 34%, transparent); border-color: var(--rb-accent); box-shadow: 0 0 12px color-mix(in srgb, var(--rb-accent) 30%, transparent); }
.btn.primary:hover { background: color-mix(in srgb, var(--rb-accent) 48%, transparent); }
.btn.ghost { background: transparent; border-color: var(--rb-line); }
.btn.ghost:hover { background: var(--rb-raised); }
.btn.chip { min-height: 26px; padding: 2px 10px; font-size: 0.82em; }
.btn.idle { opacity: 0.55; border-style: dashed; }
.btn.price { min-width: 4.6em; font-variant-numeric: tabular-nums; }

/* a "Give" menu that opens in place */
details.give { display: inline-block; }
details.give > summary { list-style: none; }
details.give > summary::-webkit-details-marker { display: none; }
details.give[open] > summary { background: var(--rb-raised); }
details.give .pop { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; }

/* meters */
.rb .ss-w { --ss-w-fg: var(--rb-fg); --ss-w-raised: var(--rb-track); --ss-w-border: var(--rb-line); --ss-w-accent: var(--rb-accent); }
.rb .ss-w-meter { --ss-w-meter-height: 8px; gap: 3px; }
.rb .ss-w-meter-head { font-size: 0.8em; font-weight: 600; }
.rb .ss-w-meter-head i { color: var(--ss-w-tone); }
.rb .ss-w-meter-value { color: var(--rb-fg); opacity: 0.85; }
.rb .ss-w-meter-fill {
  background: linear-gradient(90deg, color-mix(in srgb, var(--ss-w-tone) 70%, transparent), var(--ss-w-tone));
  box-shadow: 0 0 10px color-mix(in srgb, var(--ss-w-tone) 45%, transparent);
}
.pool.hp .ss-w-meter { --ss-w-tone: var(--rb-hp); }
.pool.mp .ss-w-meter { --ss-w-tone: var(--rb-mp); }
.pool.sp .ss-w-meter { --ss-w-tone: var(--rb-sp); }
.pool.xp .ss-w-meter { --ss-w-tone: var(--rb-xp); --ss-w-meter-height: 5px; }

/* badges */
.badges { display: flex; flex-wrap: wrap; gap: 4px; }
.badges ss-widget { display: inline-block; max-width: 100%; min-width: 0; }
.rb .ss-w-badge { max-width: 100%; border-radius: 999px; padding: 2px 8px; font-size: 0.8em; font-weight: 600; }
.rb .ss-w-badge-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rb .ss-w-tone-good { --ss-w-tone: var(--rb-good); }
.rb .ss-w-tone-warn { --ss-w-tone: var(--rb-warn); }
.rb .ss-w-tone-bad { --ss-w-tone: var(--rb-bad); }

/* rarity accents */
.r-uncommon { --rb-rarity: #3fb27f; }
.r-rare { --rb-rarity: #3f8cff; }
.r-epic { --rb-rarity: #a47cf3; }
.r-legendary { --rb-rarity: #e2a336; }
.r-uncommon, .r-rare, .r-epic, .r-legendary { box-shadow: inset 3px 0 0 var(--rb-rarity); }
.r-uncommon .nm, .r-rare .nm, .r-epic .nm, .r-legendary .nm { color: color-mix(in srgb, var(--rb-rarity) 65%, var(--rb-fg)); }

@media (prefers-reduced-motion: reduce) {
  .rb *, .rb *::before, .rb *::after { transition: none !important; animation: none !important; }
}
`;

/**
 * The screen root as a size container (`@container rb-screen (…)`), for screens drawn in a block that
 * has its own width: a tab, the game view, a card under a reply. Never for the HUD: an inline-size
 * container takes no width from what it holds, so a HUD item sized by its content (the strip lays its
 * items out side by side) shrinks to nothing. The HUD uses media queries instead.
 */
export const CONTAINER_CSS = ':root { container: rb-screen / inline-size; }';

/**
 * A screen's whole sheet: the shared base, then its own rules. `container` (default true) makes the
 * screen root the `rb-screen` size container its `@container` rules read.
 */
export const sheet = (own, { container = true } = {}) => `${BASE_CSS}${container ? `${CONTAINER_CSS}\n` : ''}\n${own.trim()}\n`;
