// RPG Battle v2, screen `rpg-battle/status-card` (SPEC §13.4 `card`: inline under each reply, showing
// **that reply's** state): the party's HP and MP, their conditions, and what this reply changed,
// marked with `changed()` (true only on the reply whose changes touched that part of the state, so
// an older reply's card keeps its own marks). With the reader's "only what changed" setting (this
// part's `cardOnlyChanged`: `screens.cardOnlyChanged` in the module's settings, src/v2/module.js),
// members this reply left alone are not listed.
//
// A reply whose state has no party at all (made before RPG Battle was added to the chat) shows the
// same "No character yet" and "Create your character" as one made before creation (B-a3-4).
//
// The checks this reply wrote (MODULES §F80; the log entries its ops added, B-b1r2-13) show as `checks.view`
// tells them (checks/card.js): the die, the modifiers, the total against the DC and code's outcome, with a
// flag when the reply wrote another result ("Story said success; dice said fail"). The level and XP words are the
// chat's terms (`party.terms`, MODULES §F25: the reader's, else a pack's, else Lv and EXP).
//
// It reads the state, not a query, for everything it marks: changed() knows where a value came
// from only for `state.…` paths (query results are copies, TEMPLATES.md §1.3). The meters show
// `party.pools`, run on this reply's state: a record's pool is kept as counts (party/pools.js) and
// read fitted.

import { THEME, sheet } from './style.js';

const actor = 'state.party.actors[id]';
// The reader's "only what changed" setting, namespaced by the module (or bare, as a part reads it).
const only = "(settings['screens.cardOnlyChanged'] == true || settings.cardOnlyChanged == true)";
const all = "(settings['screens.cardOnlyChanged'] != true && settings.cardOnlyChanged != true)";

// The terms' words, with v1's short forms when the chat keeps the plain ones.
const levelWord = `<span data-if="q.terms == null || q.terms.levelName == 'Level'">Lv</span><span data-if="q.terms != null && q.terms.levelName != 'Level'">{{ q.terms.levelName }}</span>`;
const xpWord = `<span data-if="q.terms == null || q.terms.xpName == 'XP'">EXP</span><span data-if="q.terms != null && q.terms.xpName != 'XP'">{{ q.terms.xpName }}</span>`;

const template = `
<div class="rb rb-status" data-class="quiet: ${only}">
  <div class="none start" data-if="state.party == null || len(state.party.order) == 0"><span>No character yet.</span><ss-widget class="create" name="rpg-battle.create-character" data-props='{"compact":true}'></ss-widget></div>
  <div class="member" data-each="state.party.order as id"
       data-if="${all} || changed(${actor})"
       data-class="moved: changed(${actor}); you: id == state.party.pc; down: q.pools[id].down">
    <span class="nm">{{ ${actor}.name }}</span>
    <ss-widget class="pool hp" data-class="hit: changed(${actor}.hp)" name="ss.meter" data-props='{"bind":"q.pools[id].hp","label":"HP","icon":"fa-heart"}'></ss-widget>
    <ss-widget class="pool mp" data-class="hit: changed(${actor}.mp)" name="ss.meter" data-props='{"bind":"q.pools[id].mp","label":"MP","icon":"fa-droplet"}'></ss-widget>
    <span class="tags">
      <span class="chg up" data-if="changed(${actor}.level)"><i class="fa-solid fa-arrow-up"></i>${levelWord} {{ ${actor}.level }}</span>
      <span class="chg" data-if="changed(${actor}.xp) && !changed(${actor}.level)"><i class="fa-solid fa-star"></i>${xpWord}</span>
      <span class="chg" data-if="changed(${actor}.skills)"><i class="fa-solid fa-diagram-project"></i>Skills</span>
      <span class="cond" data-each="${actor}.conditions as c" data-if="!contains(q.pools[id].lapsed, c.kind)" data-class="new: changed(c)">{{ c.kind }}<b data-if="q.pools[id].turns[c.kind] > 1">{{ q.pools[id].turns[c.kind] }}</b></span>
    </span>
  </div>
  <div class="checks" data-if="changed('state.checks.log')">
    <div class="check" data-each="state.checks.log as c" data-if="changed(c) && q.checks[c.id] != null" data-class="pass: q.checks[c.id].pass; off: q.checks[c.id].flag != ''">
      <i class="fa-solid fa-dice-d20"></i><span class="txt">{{ q.checks[c.id].text }}</span>
      <small class="flag" data-if="q.checks[c.id].flag != ''"><i class="fa-solid fa-triangle-exclamation"></i>{{ q.checks[c.id].flag }}</small>
      <small class="note" data-if="q.checks[c.id].note != ''">{{ q.checks[c.id].note }}</small>
    </div>
  </div>
  <div class="changes" data-if="changed('state.inventory') || changed('state.party.offers')">
    <span class="chg" data-if="changed('state.inventory.stacks')"><i class="fa-solid fa-box-open"></i>Items</span>
    <span class="chg" data-if="changed('state.inventory.wallets')"><i class="fa-solid fa-coins"></i>Coin</span>
    <span class="chg" data-if="changed('state.party.offers')"><i class="fa-solid fa-user-plus"></i>Offer</span>
  </div>
  <p class="none calm" data-if="len(state.party.order) > 0 && !changed('state.party') && !changed('state.inventory') && !changed('state.checks.log')">Nothing changed for the party in this reply.</p>
</div>
`;

const css = sheet(`
.none.start { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.none.start .create { flex: 0 0 auto; }
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
.checks { display: grid; gap: 3px; padding-top: 4px; border-top: 1px dashed var(--rb-line); }
.check { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
.check > i { color: var(--rb-accent); }
.check .flag { flex-basis: 100%; color: var(--rb-warn); font-weight: 600; }
.check .flag i { margin-right: 4px; }
.check .note { flex-basis: 100%; }
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
    // The pools as they stand at this reply (party.pools: fitted from the record's counts, party/pools.js).
    data: Object.freeze({ terms: Object.freeze({ query: 'party.terms' }), pools: Object.freeze({ query: 'party.pools' }), checks: Object.freeze({ query: 'checks.view' }) }),
    theme: THEME,
    template,
    css,
});
