// The Fight screen (SPEC §13.1): the battle board while a fight is on, the fights on offer with Fight
// and Not now, and the last fight's summary once it is settled. A §13.2 template, so a card or a pack
// can restyle or replace it by its id; the code it needs comes in through the board widget only. After a
// fight to the death that killed your character, the return card (widget `rpg-battle.return-card`, the
// return part) leads it: what happened and Return; it draws nothing while your character lives.
//
// The last fight shows in full only while it is news (beta.1 live test: "it still shows the last battle
// result after 2 more messages"): on the reply it was settled on and the one that tells it. Once a later
// reply is on its way it is folded (`combat.last` → `folded`, the combat part's combat.fold): "No fight on
// offer", with "Last fight" closed under it for whoever wants to look back.

export const FIGHT_SCREEN_ID = 'rpg-battle/fight';

/**
 * Shown on the bar (and the More sheet) only while there is something to act on: a fight on, or an offer waiting. The red
 * dot (`alert`) marks a move the reader must make now, or an offer. Off, the screen still opens by id (a battle card's Fight).
 */
export function fightActive(state, ctx) {
    let session = null;
    let offers = [];
    try { session = ctx?.query?.('combat.session', {}) ?? null; } catch { session = null; }
    try { offers = ctx?.query?.('combat.offers', {}) ?? []; } catch { offers = []; }
    const fighting = Boolean(session && session.status === 'active');
    const waiting = Array.isArray(offers) && offers.length > 0;
    const alert = (fighting && Boolean(session.actions?.actor)) || waiting;
    return alert ? { on: true, badge: 'alert' } : { on: fighting || waiting };
}

const lastBody = `    <div class="rb-last" data-if="q.last.parts != null" data-class="won: q.last.parts.outcome == 'victory'; lost: q.last.parts.outcome == 'defeat'">
      <p class="rb-last-result">{{ q.last.parts.result }}</p>
      <ul class="rb-last-party" aria-label="The party after the fight">
        <li class="rb-last-member ss-glass" data-each="q.last.parts.party as m" data-class="down: m.down">
          <div class="rb-last-who"><b class="rb-last-name">{{ m.name }}</b> <span class="rb-last-state">{{ m.state }}</span></div>
          <div class="rb-last-pools" data-if="!m.down">
            <ss-widget name="ss.bar" data-props='{"label":"HP","kind":"hp","value":"{{ m.hp.cur }}","max":"{{ m.hp.max }}"}'></ss-widget>
            <ss-widget name="ss.bar" data-if="m.mp.max > 0" data-props='{"label":"MP","kind":"mp","value":"{{ m.mp.cur }}","max":"{{ m.mp.max }}"}'></ss-widget>
            <ss-widget name="ss.bar" data-if="m.sp != null" data-props='{"label":"SP","kind":"sp","value":"{{ m.sp.cur }}","max":"{{ m.sp.max }}"}'></ss-widget>
          </div>
        </li>
      </ul>
      <div class="rb-last-block rb-last-moments" data-if="len(q.last.parts.moments) > 0">
        <h4 class="rb-last-label">Key moments</h4>
        <ul><li data-each="q.last.parts.moments as k">{{ k }}</li></ul>
      </div>
      <p class="rb-last-foes" data-each="q.last.parts.foes as f">{{ f }}</p>
      <div class="rb-last-block rb-last-loot" data-if="q.last.parts.outcome == 'victory'">
        <h4 class="rb-last-label">Loot</h4>
        <ul data-if="len(q.last.parts.loot) > 0"><li data-each="q.last.parts.loot as l">{{ l }}</li></ul>
        <p class="rb-last-none" data-if="len(q.last.parts.loot) == 0">Nothing.</p>
      </div>
      <p class="rb-last-growth" data-if="q.last.parts.growth != ''">{{ q.last.parts.growth }}</p>
      <p class="rb-last-note" data-each="q.last.parts.notes as n">{{ n }}</p>
    </div>
    <p class="rb-fight-summary" data-if="q.last.parts == null">{{ q.last.summary }}</p>`;

const template = `<div class="rb-fight">
  <ss-widget class="rb-fight-return" name="rpg-battle.return-card" data-if="q.fight == null" data-props='{"bind":"q.ret"}'></ss-widget>
  <ss-widget class="rb-fight-board" name="rpg-battle.battle-board" data-if="q.fight != null"
             data-props='{"bind":"q.fight","logLines":8,"label":"Fight"}'></ss-widget>
  <section class="rb-fight-offers" data-if="len(q.offers) > 0">
    <h3 class="rb-fight-heading">On offer</h3>
    <ul class="rb-fight-offer-list">
      <li class="rb-fight-offer ss-glass" data-each="q.offers as o" data-class="deadly: o.stakes == 'death'">
        <div class="rb-fight-offer-text"><span data-if="o.card">{{ o.card }}</span><span data-if="!o.card">{{ o.text }}</span></div>
        <div class="rb-fight-offer-meta">
          <span class="rb-fight-stakes" data-if="o.stakes == 'death'">To the death</span>
          <span class="rb-fight-place" data-if="o.place != ''">{{ o.place }}</span>
        </div>
        <p class="rb-fight-note" data-if="o.note != null">{{ o.note }}</p>
        <div class="rb-fight-offer-actions">
          <button class="ss-button ss-button-primary rb-fight-go" data-if="q.fight == null"
                  data-command="combat.start" data-payload='{"offer":"{{ o.id }}"}'>Fight</button>
          <button class="ss-button ss-button-quiet rb-fight-not-now"
                  data-command="combat.dismiss" data-payload='{"offer":"{{ o.id }}"}'>Not now</button>
        </div>
      </li>
    </ul>
  </section>
  <section class="rb-fight-last ss-glass" data-if="q.fight == null && q.last != null && !q.last.folded">
    <h3 class="rb-fight-heading">Last fight</h3>
${lastBody}
  </section>
  <p class="rb-fight-empty" data-if="q.fight == null && len(q.offers) == 0 && (q.last == null || q.last.folded)">No fight on offer. When the story starts one, it shows here.</p>
  <details class="rb-fight-last rb-fight-old ss-glass" data-if="q.fight == null && q.last != null && q.last.folded">
    <summary class="rb-fight-heading">Last fight</summary>
${lastBody}
  </details>
</div>`;

const css = `.rb-fight { display: flex; flex-direction: column; gap: var(--ss-space-3); }
.rb-fight-heading { margin: 0 0 var(--ss-space-1); font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--ss-muted); }
.rb-fight-old > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: var(--ss-space-2); }
.rb-fight-old > summary::-webkit-details-marker { display: none; }
.rb-fight-old > summary::after { content: ""; margin-left: auto; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); transition: transform var(--ss-motion) ease; }
.rb-fight-old[open] > summary::after { transform: rotate(-135deg); }
.rb-fight-old[open] > summary { margin-bottom: var(--ss-space-2); }
.rb-fight-offer-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16em), 1fr)); gap: var(--ss-space-2); margin: 0; padding: 0; list-style: none; }
.rb-fight-offer { display: flex; flex-direction: column; gap: 6px; padding: var(--ss-space-3); }
.rb-fight-offer.deadly { border-color: var(--ss-bad); }
.rb-fight-offer-text { font-weight: 600; }
.rb-fight-offer-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--ss-muted); }
.rb-fight-stakes { color: var(--ss-bad); font-weight: 700; }
.rb-fight-note, .rb-fight-empty { margin: 0; font-style: italic; color: var(--ss-muted); }
.rb-fight-offer-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.rb-fight-summary { margin: 0; }
.rb-last { display: grid; gap: var(--ss-space-2); }
.rb-last p { margin: 0; }
.rb-last-result { font-weight: 700; }
.rb-last.won .rb-last-result { color: var(--ss-good); }
.rb-last.lost .rb-last-result { color: var(--ss-bad); }
.rb-last-party { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14em), 1fr)); gap: var(--ss-space-2); margin: 0; padding: 0; list-style: none; }
.rb-last-member { display: grid; gap: 6px; padding: var(--ss-space-2) var(--ss-space-3); }
.rb-last-member.down { opacity: 0.75; }
.rb-last-who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.rb-last-state { font-size: 13px; color: var(--ss-muted); }
.rb-last-pools { display: grid; gap: 6px; font-size: 13px; }
.rb-last-label { margin: 0 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--ss-muted); }
.rb-last-block ul { margin: 0; padding-left: 1.2em; }
.rb-last-foes, .rb-last-note, .rb-last-none { font-size: 13px; color: var(--ss-muted); }
.rb-last-growth { font-weight: 700; color: var(--ss-accent); }
/* The Fight buttons (Fight, Not now) take Story Block's glass button states (view/glass.css); the primary's hover is the
   stronger accent tint (Story Block's primary hover is its rest). */
.rb-fight .ss-button.ss-button-primary:hover:not(:disabled) { border-color: var(--ss-accent); background: linear-gradient(color-mix(in srgb, var(--ss-accent) 34%, transparent), color-mix(in srgb, var(--ss-accent) 34%, transparent)), var(--ss-glass-strong); }
`;

/** The screen definition (SPEC §13.1) the module registers as its default for `rpg-battle/fight`. */
export const fightScreen = Object.freeze({
    id: FIGHT_SCREEN_ID,
    title: 'Fight',
    icon: 'fa-khanda',
    mounts: Object.freeze(['tab', 'screen']),
    active: fightActive,
    template,
    css,
    data: Object.freeze({
        fight: Object.freeze({ query: 'combat.board' }),
        offers: Object.freeze({ query: 'combat.offers' }),
        last: Object.freeze({ query: 'combat.last' }),
        // The return card's own answer (return part): drawn again when your character dies or comes back.
        ret: Object.freeze({ query: 'return.status' }),
    }),
});
