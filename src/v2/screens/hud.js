// RPG Battle v2, screen `rpg-battle/hud` (SPEC §13.4 `hud`: a thin strip above the message box, head
// state): your character's portrait, name and level, HP and MP as Story Block's bars (ss.bar), the conditions
// as status badges with the turns left (ss.status, up to four), a "points to spend" pill when anyone in the
// party has stat points waiting (MODULES §F91, the party part's `party.toSpend`), active effects as pills
// (feature `rpg-battle.effects`, the party part's `party.effects`; left out without it), and a weight pill while
// you carry too much (`party.encumbered`). Before a character exists it says so in one line, with a Create
// button (widget `rpg-battle.create-character`, which opens the creation wizard; creation is mandatory,
// MODULES §F12). Checks are rolled in the reply that writes them (MODULES §F80): nothing waits here.
//
// The strip item is at most 48px high (Story Block's HUD strip), so the pieces are one row of a portrait, two
// stacked lines (name and level; the two bars) and the pills, not Story Block's compact hero (which needs a
// wider box than a phone's strip gives it, and its bars wrap out of the 48px). The strip lays its items out
// side by side, each as wide as what it holds, so this screen's root is not a size container (an inline-size
// container takes no width from its content and would shrink to nothing there); the narrow layout follows the
// viewport instead.

import { sheet } from './style.js';

const template = `
<div class="rb rb-hud" data-if="q.hud.ready" data-class="low: q.hud.pc.low; down: q.hud.pc.down">
  <ss-widget class="face" name="ss.portrait" data-props='{"src":"{{ q.hud.pc.portrait }}","name":"{{ q.hud.pc.name }}","frame":"circle","size":"sm","tone":"accent"}'></ss-widget>
  <div class="id">
    <span class="top"><b class="nm">{{ q.hud.pc.name }}</b><small class="lv">Lv {{ q.hud.pc.level }}</small></span>
    <div class="bars">
      <ss-widget class="pool hp" name="ss.bar" data-props='{"label":"HP","kind":"hp","value":"{{ q.hud.pc.hp.cur }}","max":"{{ q.hud.pc.hp.max }}"}'></ss-widget>
      <ss-widget class="pool mp" name="ss.bar" data-props='{"label":"MP","kind":"mp","value":"{{ q.hud.pc.mp.cur }}","max":"{{ q.hud.pc.mp.max }}"}'></ss-widget>
    </div>
  </div>
  <span class="ss-pill ss-pill-soft spend" data-if="q.hud.toSpend.on" title="{{ q.hud.toSpend.title }}" aria-label="{{ q.hud.toSpend.title }}"><i class="fa-solid fa-circle-up"></i><b>{{ q.hud.toSpend.total }}</b><span class="spend-word"> to spend</span></span>
  <span class="ss-pill ss-pill-outline burden" data-if="q.hud.pc.encumbered" title="{{ q.hud.pc.encumbered.text }}" aria-label="{{ q.hud.pc.encumbered.text }}"><i class="fa-solid fa-weight-hanging"></i></span>
  <span class="statuses" data-if="len(q.hud.pc.statuses) > 0"><ss-widget data-each="q.hud.pc.statuses as s" name="ss.status" data-props='{"bind":"s"}'></ss-widget></span>
  <span class="effects" data-if="len(q.hud.pc.effects) > 0" role="group" aria-label="Active effects"><span class="ss-pill ss-pill-outline effect" data-each="q.hud.pc.effects as e" title="{{ e.label }}">{{ e.text }}</span></span>
</div>
<div class="rb rb-hud none-yet" data-if="!q.hud.ready"><span class="msg"><i class="fa-solid fa-user-plus"></i>Create your character to begin the story.</span><ss-widget class="create" name="rpg-battle.create-character" data-props='{"label":"Create","compact":true}'></ss-widget></div>
`;

const css = sheet(`
.rb-hud { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--ss-space-2); min-width: 0; font-size: 12px; }
.rb-hud.down .face { filter: grayscale(0.7); }
.face { flex: 0 0 auto; }
.id { display: grid; gap: 3px; min-width: 0; }
.top { display: flex; align-items: baseline; gap: 6px; min-width: 0; line-height: 1.15; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 8em; font-weight: 700; font-size: 13px; }
.lv { flex: none; white-space: nowrap; color: var(--ss-muted); }
.bars { display: grid; grid-template-columns: repeat(2, minmax(6em, 1fr)); gap: 8px; min-width: 14em; }
.bars .ss-bar-head { font-size: 11px; }
.spend, .burden { flex: 0 0 auto; white-space: nowrap; }
.spend i { color: var(--ss-good); margin-right: 4px; }
.spend b { font-variant-numeric: tabular-nums; }
.burden { color: var(--ss-warn); }
.statuses { display: flex; flex: 0 0 auto; gap: 2px; }
.statuses .ss-status { width: 30px; height: 30px; margin: 0; font-size: 14px; border-radius: 9px; }
.statuses .ss-status-left { font-size: 10px; }
.effects { display: flex; flex-wrap: nowrap; gap: var(--ss-space-1); min-width: 0; overflow: hidden; }
.effect { max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.none-yet { justify-content: center; color: var(--ss-muted); }
.none-yet .msg { font-style: italic; min-width: 0; }
.none-yet .msg i { margin-right: 6px; color: var(--ss-accent); font-style: normal; }
.none-yet .create { flex: 0 0 auto; }
@media (max-width: 480px) {
  .rb-hud { gap: 6px; }
  .spend-word { display: none; }
  .effects .effect:nth-child(n+2) { display: none; }
  .statuses .ss-status:nth-child(n+4) { display: none; }
}
`, { container: false });

export const hudScreen = Object.freeze({
    id: 'rpg-battle/hud',
    title: 'Hero',
    icon: 'fa-heart',
    mounts: Object.freeze(['hud']),
    data: Object.freeze({ hud: Object.freeze({ query: 'rpg-battle.hud' }) }),
    template,
    css,
});
