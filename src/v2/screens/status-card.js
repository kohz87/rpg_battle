// RPG Battle v2, screen `rpg-battle/status-card` (SPEC §13.4 `card`: inline under each reply, showing
// **that reply's** state): the party's HP and MP, their conditions, and what this reply changed,
// marked with `changed()` (true only on the reply whose changes touched that part of the state, so
// an older reply's card keeps its own marks). With the reader's "only what changed" setting (this
// part's `cardOnlyChanged`: `screens.cardOnlyChanged` in the module's settings, src/v2/module.js),
// members this reply left alone are not listed.
//
// It reads the state, not a query: changed() knows where a value came from only for `state.…`
// paths (query results are copies, TEMPLATES.md §1.3).

import { THEME, sheet } from './style.js';

const actor = 'state.party.actors[id]';
// The reader's "only what changed" setting, namespaced by the module (or bare, as a part reads it).
const only = "(settings['screens.cardOnlyChanged'] == true || settings.cardOnlyChanged == true)";
const all = "(settings['screens.cardOnlyChanged'] != true && settings.cardOnlyChanged != true)";

const template = `
<div class="rb rb-status" data-class="quiet: ${only}">
  <p class="none" data-if="len(state.party.order) == 0">No character yet.</p>
  <div class="member" data-each="state.party.order as id"
       data-if="${all} || changed(${actor})"
       data-class="moved: changed(${actor}); you: id == state.party.pc; down: ${actor}.hp.cur == 0">
    <span class="nm">{{ ${actor}.name }}</span>
    <ss-widget class="pool hp" data-class="hit: changed(${actor}.hp)" name="ss.meter" data-props='{"bind":"${actor}.hp","label":"HP","icon":"fa-heart"}'></ss-widget>
    <ss-widget class="pool mp" data-class="hit: changed(${actor}.mp)" name="ss.meter" data-props='{"bind":"${actor}.mp","label":"MP","icon":"fa-droplet"}'></ss-widget>
    <span class="tags">
      <span class="chg up" data-if="changed(${actor}.level)"><i class="fa-solid fa-arrow-up"></i>Lv {{ ${actor}.level }}</span>
      <span class="chg" data-if="changed(${actor}.xp) && !changed(${actor}.level)"><i class="fa-solid fa-star"></i>EXP</span>
      <span class="chg" data-if="changed(${actor}.skills)"><i class="fa-solid fa-diagram-project"></i>Skills</span>
      <span class="cond" data-each="${actor}.conditions as c" data-class="new: changed(c)">{{ c.kind }}<b data-if="c.stacks > 1">{{ c.stacks }}</b></span>
    </span>
  </div>
  <div class="changes" data-if="changed('state.inventory') || changed('state.checks.pending') || changed('state.party.offers')">
    <span class="chg" data-if="changed('state.inventory.stacks')"><i class="fa-solid fa-box-open"></i>Items</span>
    <span class="chg" data-if="changed('state.inventory.wallets')"><i class="fa-solid fa-coins"></i>Coin</span>
    <span class="chg" data-if="changed('state.checks.pending')"><i class="fa-solid fa-dice-d20"></i>Check</span>
    <span class="chg" data-if="changed('state.party.offers')"><i class="fa-solid fa-user-plus"></i>Offer</span>
  </div>
  <p class="none calm" data-if="len(state.party.order) > 0 && !changed('state.party') && !changed('state.inventory') && !changed('state.checks')">Nothing changed for the party in this reply.</p>
</div>
`;

const css = sheet(`
.rb-status {
  gap: 4px; padding: 8px 10px; border-radius: 12px; font-size: 0.85em;
  background: color-mix(in srgb, var(--rb-fg) 5%, transparent); border: 1px solid var(--rb-line);
  border-left: 3px solid var(--rb-accent);
}
.member { display: grid; grid-template-columns: minmax(4.5em, auto) minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 4px 10px; min-width: 0; }
.member .nm { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member.you .nm { color: var(--rb-accent); }
.member.down { opacity: 0.65; }
.member .tags { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; }
.member .tags:empty { display: none; }
.rb .ss-w-meter { --ss-w-meter-height: 6px; gap: 1px; }
.rb .ss-w-meter-head { font-size: 0.75em; }
.pool.hit .ss-w-meter-value { color: var(--rb-accent); font-weight: 700; opacity: 1; }
.pool.hit .ss-w-meter-track { box-shadow: 0 0 0 1px color-mix(in srgb, var(--rb-accent) 60%, transparent); }
.chg, .cond { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 0.85em; font-weight: 600; }
.chg { background: color-mix(in srgb, var(--rb-accent) 18%, transparent); color: var(--rb-fg); }
.chg i { color: var(--rb-accent); }
.chg.up { background: color-mix(in srgb, var(--rb-good) 22%, transparent); }
.chg.up i { color: var(--rb-good); }
.cond { background: var(--rb-raised); text-transform: capitalize; }
.cond b { font-variant-numeric: tabular-nums; color: var(--rb-muted); }
.cond.new { box-shadow: 0 0 0 1px color-mix(in srgb, var(--rb-bad) 60%, transparent); }
.changes { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; border-top: 1px dashed var(--rb-line); }
.calm { font-size: 0.85em; }
@container rb-screen (max-width: 360px) {
  .member { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .member .nm { grid-column: 1 / -1; }
}
`);

export const statusCardScreen = Object.freeze({
    id: 'rpg-battle/status-card',
    title: 'Party status',
    icon: 'fa-heart-pulse',
    mounts: Object.freeze(['card']),
    theme: THEME,
    template,
    css,
});
