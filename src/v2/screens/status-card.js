// RPG Battle v2, screen `rpg-battle/status-card` (SPEC §13.4 `card`: inline under each reply, showing
// **that reply's** state): the party's HP and MP, their conditions, and what this reply changed, marked with
// `changed()` (true only on the reply whose changes touched that part of the state, so an older reply's card
// keeps its own marks). With the reader's "only what changed" setting (this part's `cardOnlyChanged`:
// `screens.cardOnlyChanged` in the module's settings, src/v2/module.js), members this reply left alone are not
// listed.
//
// Each member is Story Block's compact hero (`ss.hero`, the one-row strip for under a reply), drawn from
// `rpg-battle.heroes` (view.js: the party's pools at this reply, the conditions worn off left out). A reply
// whose state has no party at all (made before RPG Battle was added to the chat) shows the same "No character
// yet" and "Create your character" as one made before creation (B-a3-4).
//
// The checks this reply wrote (MODULES §F80; the log entries its ops added, B-b1r2-13) show as `checks.view`
// tells them (checks/card.js): the die, the modifiers, the total against the DC and code's outcome, with a
// flag when the reply wrote another result ("Story said success; dice said fail"). The level and XP words are
// the chat's terms (`party.terms`, MODULES §F25: the reader's, else a pack's, else Lv and EXP).
//
// It reads the state, not a query, for everything it marks: changed() knows where a value came from only for
// `state.…` paths (query results are copies, TEMPLATES.md §1.3).

import { sheet } from './style.js';

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
  <div class="ss-glass member" data-each="state.party.order as id"
       data-if="${all} || changed(${actor})"
       data-class="moved: changed(${actor}); you: id == state.party.pc; down: q.pools[id].down">
    <ss-widget class="hero" data-class="hit: changed(${actor}.hp); hit-mp: changed(${actor}.mp)" name="ss.hero" data-props='{"bind":"q.heroes[id]","compact":true}'></ss-widget>
    <span class="tags">
      <span class="ss-pill ss-pill-soft chg up" data-if="changed(${actor}.level)"><i class="fa-solid fa-arrow-up"></i>${levelWord} {{ ${actor}.level }}</span>
      <span class="ss-pill ss-pill-soft chg" data-if="changed(${actor}.xp) && !changed(${actor}.level)"><i class="fa-solid fa-star"></i>${xpWord}</span>
      <span class="ss-pill ss-pill-soft chg" data-if="changed(${actor}.skills)"><i class="fa-solid fa-diagram-project"></i>Skills</span>
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
    <span class="ss-pill ss-pill-soft chg" data-if="changed('state.inventory.stacks')"><i class="fa-solid fa-box-open"></i>Items</span>
    <span class="ss-pill ss-pill-soft chg" data-if="changed('state.inventory.wallets')"><i class="fa-solid fa-coins"></i>Coin</span>
    <span class="ss-pill ss-pill-soft chg" data-if="changed('state.party.offers')"><i class="fa-solid fa-user-plus"></i>Offer</span>
  </div>
  <p class="none calm" data-if="len(state.party.order) > 0 && !changed('state.party') && !changed('state.inventory') && !changed('state.checks.log')">Nothing changed for the party in this reply.</p>
</div>
`;

const css = sheet(`
.none.start { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.none.start .create { flex: 0 0 auto; }
.rb-status { gap: var(--ss-space-2); font-size: 13px; }
.member { display: grid; gap: 6px; padding: var(--ss-space-2) var(--ss-space-3); min-width: 0; }
.member.moved { border-color: var(--ss-accent); }
.member.down { opacity: 0.65; }
.member .hero.hit, .member .hero.hit-mp { box-shadow: inset 0 0 0 1px var(--ss-accent); border-radius: var(--ss-radius-m); }
.member .tags { display: flex; flex-wrap: wrap; gap: 4px; }
.member .tags:empty { display: none; }
.member .hero { min-width: 0; }
.chg { font-size: 12px; }
.chg i { color: var(--ss-accent); margin-right: 4px; }
.chg.up i { color: var(--ss-good); }
.checks { display: grid; gap: 3px; padding-top: 4px; border-top: 1px dashed var(--ss-border); }
.check { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
.check > i { color: var(--ss-accent); }
.check .flag { flex-basis: 100%; color: var(--ss-warn); font-weight: 600; }
.check .flag i { margin-right: 4px; }
.check .note { flex-basis: 100%; color: var(--ss-muted); }
.changes { display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; border-top: 1px dashed var(--ss-border); }
.calm { font-size: 13px; color: var(--ss-muted); }
@container rb-screen (max-width: 360px) { .member { padding: var(--ss-space-1) var(--ss-space-2); } .chg { font-size: 11px; } }
`);

export const statusCardScreen = Object.freeze({
    id: 'rpg-battle/status-card',
    title: 'Party status',
    icon: 'fa-heart-pulse',
    mounts: Object.freeze(['card']),
    // The pools as they stand at this reply (party.pools: fitted from the record's counts, party/pools.js), and
    // the members' heroes built on them (rpg-battle.heroes).
    data: Object.freeze({
        terms: Object.freeze({ query: 'party.terms' }),
        pools: Object.freeze({ query: 'party.pools' }),
        heroes: Object.freeze({ query: 'rpg-battle.heroes' }),
        checks: Object.freeze({ query: 'checks.view' }),
    }),
    template,
    css,
});
