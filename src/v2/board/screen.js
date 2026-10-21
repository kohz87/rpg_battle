// The Fight screen (SPEC §13.1): the battle board while a fight is on, the fights on offer with Fight
// and Not now, and the last fight's summary once it is settled. A §13.2 template, so a card or a pack
// can restyle or replace it by its id; the code it needs comes in through the board widget only.

export const FIGHT_SCREEN_ID = 'rpg-battle/fight';

const template = `<div class="rb-fight">
  <ss-widget class="rb-fight-board" name="rpg-battle.battle-board" data-if="q.fight != null"
             data-props='{"bind":"q.fight","logLines":8,"label":"Fight"}'></ss-widget>
  <section class="rb-fight-offers" data-if="len(q.offers) > 0">
    <h3 class="rb-fight-heading">On offer</h3>
    <ul class="rb-fight-offer-list">
      <li class="rb-fight-offer" data-each="q.offers as o" data-class="deadly: o.stakes == 'death'">
        <div class="rb-fight-offer-text">{{ o.text }}</div>
        <div class="rb-fight-offer-meta">
          <span class="rb-fight-stakes" data-if="o.stakes == 'death'">To the death</span>
          <span class="rb-fight-place" data-if="o.place != ''">{{ o.place }}</span>
        </div>
        <p class="rb-fight-note" data-if="o.note != null">{{ o.note }}</p>
        <div class="rb-fight-offer-actions">
          <button class="menu_button rb-fight-go" data-if="q.fight == null"
                  data-command="combat.start" data-payload='{"offer":"{{ o.id }}"}'>Fight</button>
          <button class="menu_button rb-fight-not-now"
                  data-command="combat.dismiss" data-payload='{"offer":"{{ o.id }}"}'>Not now</button>
        </div>
      </li>
    </ul>
  </section>
  <section class="rb-fight-last" data-if="q.fight == null && q.last != null">
    <h3 class="rb-fight-heading">Last fight</h3>
    <p class="rb-fight-summary">{{ q.last.summary }}</p>
  </section>
  <p class="rb-fight-empty" data-if="q.fight == null && len(q.offers) == 0 && q.last == null">No fight on offer. When the story starts one, it shows here.</p>
</div>`;

const css = `.rb-fight { display: flex; flex-direction: column; gap: 0.8em; }
.rb-fight-heading { margin: 0 0 0.4em; font-size: 0.95em; }
.rb-fight-offer-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16em), 1fr)); gap: 0.5em; margin: 0; padding: 0; list-style: none; }
.rb-fight-offer { display: flex; flex-direction: column; gap: 0.35em; padding: 0.6em; border-radius: 6px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.2));
  background: color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 85%, transparent); }
.rb-fight-offer.deadly { border-color: var(--rb-fight-deadly, #d0504a); }
.rb-fight-offer-text { font-weight: 600; }
.rb-fight-offer-meta { display: flex; flex-wrap: wrap; gap: 0.5em; font-size: 0.85em; opacity: 0.8; }
.rb-fight-stakes { color: var(--rb-fight-deadly, #d0504a); }
.rb-fight-note, .rb-fight-empty { margin: 0; font-style: italic; opacity: 0.8; }
.rb-fight-offer-actions { display: flex; flex-wrap: wrap; gap: 0.4em; }
.rb-fight-summary { margin: 0; }`;

/** The screen definition (SPEC §13.1) the module registers as its default for `rpg-battle/fight`. */
export const fightScreen = Object.freeze({
    id: FIGHT_SCREEN_ID,
    title: 'Fight',
    icon: 'fa-khanda',
    mounts: Object.freeze(['tab', 'screen']),
    template,
    css,
    data: Object.freeze({
        fight: Object.freeze({ query: 'combat.board' }),
        offers: Object.freeze({ query: 'combat.offers' }),
        last: Object.freeze({ query: 'combat.last' }),
    }),
});
