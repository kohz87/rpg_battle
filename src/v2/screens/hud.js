// RPG Battle v2, screen `rpg-battle/hud` (SPEC §13.4 `hud`: a thin strip above the message box, head
// state): your character's portrait, name and level, HP and MP meters, a "points to spend" badge when
// anyone in the party has stat points waiting (MODULES §F91, the party part's `party.toSpend`),
// condition badges (icons with the turns left) and active effects (feature `rpg-battle.effects`, the
// party part's `party.effects`; left out without it), and a weight icon while you carry too much
// (`party.encumbered`). Before a character exists it says so in one line
// (creation is mandatory, MODULES §F12). Checks are rolled in the reply that writes them (MODULES
// §F80): nothing waits here.
//
// The strip lays its items out side by side, each as wide as what it holds, so this screen's root is
// not a size container (an inline-size container takes no width from its content and would shrink to
// nothing there); the narrow layout follows the viewport instead.

import { THEME, sheet } from './style.js';

const template = `
<div class="rb rb-hud" data-if="q.hud.ready" data-class="low: q.hud.pc.low; down: q.hud.pc.down">
  <ss-widget class="face" name="ss.portrait" data-props='{"src":"{{ q.hud.pc.portrait }}","name":"{{ q.hud.pc.name }}","frame":"circle","size":"sm","tone":"accent"}'></ss-widget>
  <div class="id">
    <b class="nm">{{ q.hud.pc.name }}</b>
    <small class="lv">Lv {{ q.hud.pc.level }}</small>
  </div>
  <div class="bars">
    <ss-widget class="pool hp" name="ss.meter" data-props='{"bind":"q.hud.pc.hp","label":"HP","icon":"fa-heart"}'></ss-widget>
    <ss-widget class="pool mp" name="ss.meter" data-props='{"bind":"q.hud.pc.mp","label":"MP","icon":"fa-droplet"}'></ss-widget>
  </div>
  <span class="burden" data-if="q.hud.pc.encumbered" title="{{ q.hud.pc.encumbered.text }}" aria-label="{{ q.hud.pc.encumbered.text }}"><i class="fa-solid fa-weight-hanging"></i></span>
  <span class="spend" data-if="q.hud.toSpend.on" title="{{ q.hud.toSpend.title }}" aria-label="{{ q.hud.toSpend.title }}"><i class="fa-solid fa-circle-up"></i><b>{{ q.hud.toSpend.total }}</b><span class="spend-word"> to spend</span></span>
  <div class="badges" data-if="len(q.hud.pc.badges) > 0 || len(q.hud.pc.effects) > 0">
    <ss-widget data-each="q.hud.pc.badges as b" name="ss.badge" data-props='{"bind":"b"}'></ss-widget>
    <ss-widget class="effect" data-each="q.hud.pc.effects as e" name="ss.badge" data-props='{"bind":"e","showLabel":false}'></ss-widget>
  </div>
</div>
<div class="rb rb-hud none-yet" data-if="!q.hud.ready"><i class="fa-solid fa-user-plus"></i>Create your character to begin the story.</div>
`;

const css = sheet(`
.rb-hud {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 10px; border-radius: 12px;
  background: var(--rb-glass); border: 1px solid var(--rb-line); box-shadow: 0 3px 12px var(--rb-shadow);
  backdrop-filter: blur(var(--SmartThemeBlurStrength, 10px)); -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength, 10px));
  font-size: 0.88em;
}
.rb-hud.down { filter: grayscale(0.7); }
.rb-hud.low .pool.hp .ss-w-meter-fill { animation: rb-pulse 1.2s ease-in-out infinite; }
@keyframes rb-pulse { 50% { opacity: 0.55; } }
.face { flex: 0 0 auto; }
.id { display: grid; flex: 0 1 auto; min-width: 0; line-height: 1.15; }
.id .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 9em; }
.id .lv { font-size: 0.82em; white-space: nowrap; }
.bars { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; flex: 1 1 10em; min-width: 7em; }
.rb .ss-w-meter { --ss-w-meter-height: 6px; gap: 1px; }
.rb .ss-w-meter-head { font-size: 0.75em; }
.spend {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
  font-size: 0.85em; font-weight: 700; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--rb-good) 22%, transparent); border: 1px solid color-mix(in srgb, var(--rb-good) 55%, transparent);
}
.spend i { color: var(--rb-good); }
.burden { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 1.9em; height: 1.9em; border-radius: 999px; color: var(--rb-warn);
  background: color-mix(in srgb, var(--rb-warn) 18%, transparent); border: 1px solid color-mix(in srgb, var(--rb-warn) 50%, transparent); }
.spend-word { font-weight: 600; }
.badges { flex: 0 1 auto; flex-wrap: nowrap; overflow: hidden; min-width: 0; }
.none-yet { justify-content: center; color: var(--rb-muted); font-style: italic; }
.none-yet i { margin-right: 6px; color: var(--rb-accent); font-style: normal; }
@media (max-width: 480px) {
  .rb-hud { gap: 6px; padding: 4px 8px; }
  .id .nm { max-width: 6em; }
  .bars { grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 5em; }
  .rb .ss-w-meter-head { display: none; }
  .spend-word { display: none; }
  .badges ss-widget:nth-child(n+3) { display: none; }
}
`, { container: false });

export const hudScreen = Object.freeze({
    id: 'rpg-battle/hud',
    title: 'Hero',
    icon: 'fa-heart',
    mounts: Object.freeze(['hud']),
    data: Object.freeze({ hud: Object.freeze({ query: 'rpg-battle.hud' }) }),
    theme: THEME,
    template,
    css,
});
