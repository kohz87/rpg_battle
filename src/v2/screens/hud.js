// RPG Battle v2, screen `rpg-battle/hud` (SPEC §13.4 `hud`: a thin strip above the message box, head
// state): your character's portrait, name and level, HP and MP meters, condition badges (icons with
// the turns left), and how many checks wait for a roll (MODULES §F16). Before a character exists it
// says so in one line (creation is mandatory, MODULES §F12).

import { THEME, sheet } from './style.js';

const template = `
<div class="rb rb-hud" data-if="q.hud.ready" data-class="low: q.hud.pc.low; down: q.hud.pc.down">
  <ss-widget class="face" name="ss.portrait" data-props='{"src":"{{ q.hud.pc.portrait }}","name":"{{ q.hud.pc.name }}","frame":"circle","size":"sm","tone":"accent"}'></ss-widget>
  <div class="id">
    <b class="nm">{{ q.hud.pc.name }}</b>
    <small class="lv">Lv {{ q.hud.pc.level }}<span class="pts" data-if="q.hud.pc.spend"> · {{ q.hud.pc.points }} pts</span></small>
  </div>
  <div class="bars">
    <ss-widget class="pool hp" name="ss.meter" data-props='{"bind":"q.hud.pc.hp","label":"HP","icon":"fa-heart"}'></ss-widget>
    <ss-widget class="pool mp" name="ss.meter" data-props='{"bind":"q.hud.pc.mp","label":"MP","icon":"fa-droplet"}'></ss-widget>
  </div>
  <div class="badges" data-if="len(q.hud.pc.badges) > 0">
    <ss-widget data-each="q.hud.pc.badges as b" name="ss.badge" data-props='{"bind":"b"}'></ss-widget>
  </div>
  <span class="checks" data-if="q.hud.pending > 0" data-bind-attr="title: q.hud.pendingText; aria-label: q.hud.pendingText"><i class="fa-solid fa-dice-d20"></i>{{ q.hud.pending }}</span>
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
.id .pts { color: var(--rb-good); font-weight: 700; }
.bars { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; flex: 1 1 10em; min-width: 7em; }
.rb .ss-w-meter { --ss-w-meter-height: 6px; gap: 1px; }
.rb .ss-w-meter-head { font-size: 0.75em; }
.badges { flex: 0 1 auto; flex-wrap: nowrap; overflow: hidden; }
.checks {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 2px 8px; border-radius: 999px;
  font-weight: 700; font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--rb-accent) 22%, transparent); border: 1px solid color-mix(in srgb, var(--rb-accent) 55%, transparent);
}
.checks i { color: var(--rb-accent); }
.none-yet { justify-content: center; color: var(--rb-muted); font-style: italic; }
.none-yet i { margin-right: 6px; color: var(--rb-accent); font-style: normal; }
@container rb-screen (max-width: 420px) {
  .id .nm { max-width: 6em; }
  .bars { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .rb .ss-w-meter-head { display: none; }
  .badges ss-widget:nth-child(n+3) { display: none; }
}
`);

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
