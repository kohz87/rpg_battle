// RPG Battle v2, screens for the rules-v2 views (track C): five default screens as data (SPEC §13.1), on Story Block's
// glass blocks and tokens like the rest (../style.js). Each reads one view query (`rpg-battle.*View`, this folder) that
// reads the contract's public queries; each button runs a command RPG Battle, Story Director or Story Block owns.
//
//   rpg-battle/progress  Progress  the party checklist; per member exactly three skills at x / 5, promotions and path steps
//                                  in the order given (waiting ones say why), permanent choices behind a Confirm, training
//   rpg-battle/quests    Quests    deadlines, repeat and chain, hand-in; without RPG Battle, the story's goals as they are
//   rpg-battle/roster    Roster    PC plus two active, reserve, summons; eight lean slot tiles (tap to arm, tap again to
//                                  unequip), what the bag could do, collapsible companions
//   rpg-battle/links     Links     check actors and their links, regions and danger tiers, the rules' flags and generated
//                                  items (read only), companions' dossiers
//   rpg-battle/setup     Setup     what RPG Battle depends on, in distinct states, and the save points
//
// The rules pages are shown while RPG Battle's rules queries answer (`active`, SPEC §13.1). Setup also offers packs before creation. On a legacy chat or a save
// without a pinned ruleset nothing new appears and the existing tabs and Party screen draw as before. A required module that is missing makes
// the page say so (the banner), not disappear.

import { sheet } from '../style.js';
import { EQUIPMENT_CSS } from '../equipment.js';
import { RULES_WIDGET_CSS } from './widgets.js';
import { hostModules, ownStatus } from './deps.js';
import { ASK, ask, isRecord } from './ask.js';

/**
 * The new pages are offered only on a valid rules answer: `rules.party` answers for a chat that has a pinned ruleset, and answers null
 * (or has no such query) for a legacy chat, an old host or an unpinned save, where nothing new appears and the existing tabs and
 * navigation stay exactly as they were. Any record counts as the answer: one in a shape this version does not know still turns the
 * pages on, because they say "mismatch" themselves; null, a missing query and a thrown error keep them off.
 */
export function rulesActive(state, ctx) {
    return { on: ask(ctx, 'rules.party', {}, isRecord).status === ASK.OK };
}

/**
 * The Setup page is offered on the same condition, and also while Story Block's module status says RPG Battle is dormant or
 * restoring: then its own queries may not answer, and this page, which asks the host for the status, is where the reason is.
 */
export function setupActive(state, ctx) {
    if (rulesActive(state, ctx).on) return { on: true };
    if (ask(ctx, 'rules.selection', {}, isRecord).value?.state === 'offered') return { on: true };
    const status = ownStatus(hostModules());
    return { on: status === 'dormant' || status === 'restore-pending' };
}
const ACTIVE_NOTE = 'Shown once RPG Battle\'s new rules are present.';

const BANNER = `
  <section class="ss-glass banner" data-if="q.deps.show" role="status" data-class="dormant: !q.deps.ready">
    <p class="banner-head"><i class="fa-solid fa-circle-info"></i>{{ q.deps.headline }}</p>
    <ul class="banner-lines" data-if="len(q.deps.lines) > 0">
      <li data-each="q.deps.lines as l" data-class="bad: l.tone == 'bad'; warn: l.tone == 'warn'"><b>{{ l.label }}</b> {{ l.text }}</li>
    </ul>
    <ul class="banner-held" data-if="len(q.deps.held) > 0"><li data-each="q.deps.held as h">{{ h }}</li></ul>
  </section>`;

const STATE_NOTES = `
  <div class="ss-glass state" data-if="q.p.state == 'unavailable' || q.p.state == 'mismatch'" role="status" data-class="mismatch: q.p.state == 'mismatch'">
    <p><i class="fa-solid fa-hourglass-half"></i>{{ q.p.reason }}</p>
  </div>`;

const SHARED_CSS = `
.rb .banner { display: grid; gap: 6px; padding: var(--ss-space-3); border-color: var(--ss-warn); }
.rb .banner.dormant { border-color: var(--ss-bad); }
.rb .banner p, .rb .banner ul { margin: 0; }
.rb .banner-head i { margin-right: 6px; color: var(--ss-accent); }
.rb .banner ul { padding-left: 1.2em; font-size: 13px; }
.rb .banner li.bad b { color: var(--ss-bad); }
.rb .banner li.warn b { color: var(--ss-warn); }
.rb .state { padding: var(--ss-space-3); }
.rb .state i { margin-right: 6px; color: var(--ss-accent); }
.rb .state.mismatch { border-color: var(--ss-bad); }
.rb .block { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--ss-border); min-width: 0; }
.rb .block > .ss-label { margin: 0; }
.rb .cards { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@container rb-screen (min-width: 760px) { .rb .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.rb .member-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; min-width: 0; }
.rb .member-head .who { min-width: 0; }
.rb .member-head .nm { overflow-wrap: anywhere; }
.rb .sub, .rb .xp { margin: 0; font-size: 13px; color: var(--ss-muted); }
.rb .member { display: grid; gap: 10px; align-content: start; padding: var(--ss-space-3); min-width: 0; }
.rb .member.you { border-color: var(--ss-accent); }
.rb .member[data-open="false"] > .rest { display: none; }
.rb .rest { display: grid; gap: 10px; min-width: 0; }
.rb ul { margin: 0; padding: 0; list-style: none; }
.rb .why { display: grid; gap: 2px; font-size: 13px; color: var(--ss-muted); }
.rb .hint { margin: 0; font-size: 13px; color: var(--ss-muted); }
.rb .good { color: var(--ss-good); }
`;

// ---- Progress ----------------------------------------------------------------------------------------------------------

const progressTemplate = `
<div class="rb rb-progress">
  ${BANNER}
  ${STATE_NOTES}
  <div class="ss-glass empty start" data-if="q.p.state == 'no-character'">
    <p><i class="fa-solid fa-user-plus"></i>No character yet. Create yours and pick a basic class to begin.</p>
    <ss-widget class="create" name="rpg-battle.create-character"></ss-widget>
    <div class="classes" data-if="q.p.picker.state == 'ready'">
      <p class="ss-label"><i class="fa-solid fa-book-open"></i>Basic classes in this story</p>
      <ul class="class-list">
        <li class="class-tile" data-each="q.p.picker.classes as c"><b>{{ c.label }}</b><small>{{ c.sub }}</small></li>
      </ul>
    </div>
    <p class="hint" data-if="q.p.picker.state == 'unavailable'">The classes are not available to list yet.</p>
  </div>
  <section class="ss-glass party-check" data-if="q.p.state == 'ready'">
    <p class="ss-label"><i class="fa-solid fa-list-check"></i>Party checklist <small>forms at 5 / 5</small></p>
    <ul class="party-list" aria-label="Party checklist">
      <li class="party-row" data-each="q.p.party as c" data-class="complete: c.complete">
        <i class="fa-solid" data-class="fa-circle-check: c.complete; fa-circle: !c.complete"></i>
        <span class="who">{{ c.name }}</span><small>{{ c.text }}</small>
      </li>
    </ul>
  </section>
  <div class="cards" data-if="q.p.state == 'ready'">
    <article class="ss-glass member" data-each="q.p.members as m" data-class="you: m.you">
      <header class="member-head">
        <div class="who">
          <h3 class="nm">{{ m.name }}</h3>
          <p class="sub"><span class="ss-pill ss-pill-soft">{{ m.tierLabel }}</span> {{ m.className }} · {{ m.levelText }}</p>
          <p class="xp">{{ m.xpText }}</p>
        </div>
        <ss-widget class="toggle" name="rpg-battle.member-toggle" data-props='{"actor":"{{ m.id }}","name":"{{ m.name }}","open":{{ m.you }}}'></ss-widget>
      </header>
      <div class="rest">
        <section class="block skills">
          <p class="ss-label"><i class="fa-solid fa-diagram-project"></i>Skills <small>{{ m.checklistText }}</small></p>
          <ul class="skill-list" aria-label="Skills of {{ m.name }}">
            <li class="skill" data-each="m.skills as s" data-class="mastered: s.mastered; done: s.done">
              <span class="skill-name">{{ s.name }}</span>
              <ss-widget name="ss.bar" data-props='{"label":"Mastery","kind":"exp","value":"{{ s.mastery }}","max":"{{ s.needed }}","text":"{{ s.text }}"}'></ss-widget>
              <small class="skill-note">{{ s.usesText }} · {{ s.nextText }}<span data-if="s.stepText != ''"> · {{ s.stepText }}</span></small>
            </li>
          </ul>
          <p class="mastered-note good" data-if="m.allMastered">{{ m.masteredNote }}</p>
        </section>
        <section class="block promotions" data-if="len(m.promotions) > 0">
          <p class="ss-label"><i class="fa-solid fa-arrow-up-right-dots"></i>Promotions</p>
          <div class="step" data-each="m.promotions as pr" data-class="waiting: pr.waiting; ready: pr.eligible">
            <p class="step-head"><b>{{ pr.title }}</b><span class="ss-pill ss-pill-outline" data-if="pr.waiting">Waiting</span><span class="ss-pill ss-pill-soft" data-if="pr.eligible">Ready</span></p>
            <ul class="why" data-if="len(pr.why) > 0"><li data-each="pr.why as w">{{ w }}</li></ul>
            <p class="hint" data-if="pr.note != ''">{{ pr.note }}</p>
            <ss-widget data-if="pr.open" class="pick" name="rpg-battle.permanent-choice" data-props='{"bind":"pr.pick"}'></ss-widget>
          </div>
        </section>
        <section class="block pathways" data-if="len(m.pathways) > 0">
          <p class="ss-label"><i class="fa-solid fa-route"></i>Path steps</p>
          <div class="step" data-each="m.pathways as pw" data-class="waiting: pw.waiting; ready: pw.eligible">
            <p class="step-head"><b>{{ pw.title }}</b><span class="ss-pill ss-pill-outline" data-if="pw.waiting">Waiting</span><span class="ss-pill ss-pill-soft" data-if="pw.eligible">Ready</span></p>
            <ul class="why" data-if="len(pw.why) > 0"><li data-each="pw.why as w">{{ w }}</li></ul>
            <div class="path-skill" data-each="pw.skills as ps">
              <p class="path-head"><b>{{ ps.name }}</b> <small>{{ ps.stepText }}</small></p>
              <ss-widget data-if="ps.open" class="pick" name="rpg-battle.permanent-choice" data-props='{"bind":"ps.pick"}'></ss-widget>
            </div>
          </div>
        </section>
        <section class="block training" data-if="m.training.state != 'unavailable'">
          <p class="ss-label"><i class="fa-solid fa-dumbbell"></i>Training</p>
          <p class="train-head" data-if="m.training.headline != ''"><b>{{ m.training.headline }}</b></p>
          <ul class="train-lines" data-if="len(m.training.lines) > 0"><li data-each="m.training.lines as t">{{ t }}</li></ul>
          <p class="hint caps" data-if="m.training.caps != ''">{{ m.training.caps }}</p>
          <p class="hint hold" data-if="m.training.held">The story clock is not set, so training waits.</p>
          <ul class="offers" data-if="len(m.training.offers) > 0" aria-label="Training on offer">
            <li class="offer" data-each="m.training.offers as o">
              <span class="offer-text">{{ o.text }}<small data-if="o.detail != ''"> · {{ o.detail }}</small></span>
              <ul class="why" data-if="len(o.blocked) > 0"><li data-each="o.blocked as b">{{ b }}</li></ul>
              <ss-widget class="ask" data-if="o.canAsk" name="rpg-battle.command-button" data-props='{"bind":"o.button"}'></ss-widget>
            </li>
          </ul>
          <div class="story-trainers" data-if="len(m.training.stories) > 0">
            <p class="ss-label">Story trainers</p>
            <ul class="stories" aria-label="Story trainers"><li class="story" data-each="m.training.stories as st">{{ st.text }}</li></ul>
          </div>
          <div class="make-trainer" data-if="m.training.canMake || m.training.makeNote != ''">
            <p class="ss-label">Make this a trainer</p>
            <p class="hint" data-if="m.training.makeNote != ''">{{ m.training.makeNote }}</p>
            <ss-widget data-if="m.training.canMake" name="rpg-battle.trainer-binding" data-props='{"bind":"m.training.binding"}'></ss-widget>
          </div>
        </section>
      </div>
    </article>
  </div>
</div>
`;

const progressCss = sheet(`${SHARED_CSS}${EQUIPMENT_CSS}${RULES_WIDGET_CSS}
.empty.start { display: grid; gap: 10px; justify-items: center; text-align: center; padding: var(--ss-space-3); }
.empty.start p { margin: 0; }
.classes { display: grid; gap: 6px; justify-items: stretch; width: 100%; text-align: left; }
.class-list { display: grid; gap: var(--ss-space-2); grid-template-columns: repeat(auto-fill, minmax(min(100%, 12em), 1fr)); }
.class-tile { display: grid; gap: 2px; padding: var(--ss-space-2) var(--ss-space-3); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); background: var(--ss-tile); }
.party-check { display: grid; gap: 6px; padding: var(--ss-space-3); }
.party-list { display: grid; gap: 4px; }
.party-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.party-row .who { font-weight: 700; overflow-wrap: anywhere; }
.party-row i { color: var(--ss-muted); }
.party-row.complete i { color: var(--ss-good); }
.skill-list { display: grid; gap: 8px; }
.skill { display: grid; gap: 2px; padding: var(--ss-space-2) var(--ss-space-3); border: 1px solid var(--ss-border); border-radius: var(--ss-radius-s); background: var(--ss-tile); min-width: 0; }
.skill.done { border-color: var(--ss-good); }
.skill-name { font-weight: 700; overflow-wrap: anywhere; }
.skill-note { font-size: 12px; }
.step { display: grid; gap: 6px; padding: var(--ss-space-2) 0; min-width: 0; }
.step.waiting { opacity: 0.85; }
.step-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; }
.path-skill { display: grid; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--ss-border); min-width: 0; }
.path-head { margin: 0; }
.train-lines { display: grid; gap: 2px; font-size: 13px; }
.offers { display: grid; gap: 8px; }
.offer { display: grid; gap: 4px; justify-items: start; }
.story-trainers, .make-trainer { display: grid; gap: 6px; padding-top: var(--ss-space-2); border-top: 1px dashed var(--ss-border); min-width: 0; }
.stories { display: grid; gap: 4px; font-size: 13px; }
.story { overflow-wrap: anywhere; }
`);

export const progressScreen = Object.freeze({
    id: 'rpg-battle/progress',
    title: 'Progress',
    icon: 'fa-arrow-up-right-dots',
    mounts: Object.freeze(['tab', 'screen']),
    active: rulesActive,
    activeNote: ACTIVE_NOTE,
    data: Object.freeze({
        p: Object.freeze({ query: 'rpg-battle.progressView' }),
        deps: Object.freeze({ query: 'rpg-battle.rulesDeps' }),
    }),
    template: progressTemplate,
    css: progressCss,
});

// ---- Quests ------------------------------------------------------------------------------------------------------------

const questsTemplate = `
<div class="rb rb-quests">
  ${BANNER}
  <div class="ss-glass state" data-if="q.v.state == 'unavailable'" role="status"><p><i class="fa-solid fa-hourglass-half"></i>{{ q.v.note }}</p></div>
  <p class="hint" data-if="q.v.state == 'rpg' && q.v.note != ''">{{ q.v.note }}</p>
  <p class="hint now" data-if="q.v.clock.set">Now: {{ q.v.clock.text }}</p>
  <section class="group" data-each="q.v.groups as g" data-if="q.v.state == 'rpg'">
    <p class="ss-label"><i class="fa-solid fa-scroll"></i>{{ g.title }} <small>{{ g.count }}</small></p>
    <p class="none" data-if="g.empty">Nothing here.</p>
    <article class="ss-glass quest" data-each="g.quests as r" data-class="expired: r.expired; done: r.state == 'done'">
      <header class="quest-head">
        <h3 class="nm">{{ r.title }}</h3>
        <span class="ss-pill ss-pill-soft" data-if="r.categoryLabel != ''">{{ r.categoryLabel }}</span>
        <span class="ss-pill ss-pill-outline state-pill" data-class="ss-tone-good: r.tone == 'good'; ss-tone-bad: r.tone == 'bad'">{{ r.stateLabel }}</span>
      </header>
      <ul class="objectives" data-if="len(r.objectives) > 0" aria-label="Objectives"><li data-each="r.objectives as o">{{ o.text }}</li></ul>
      <p class="line reward" data-if="r.reward != ''">Reward: {{ r.reward }}</p>
      <p class="line due" data-if="r.deadlineText != ''">{{ r.deadlineText }}<span data-if="r.remainingText != ''"> · {{ r.remainingText }}</span></p>
      <p class="line repeat" data-if="r.repeat != null">{{ r.repeat.text }}</p>
      <p class="line chain" data-if="r.chain != null">{{ r.chain.text }}</p>
      <p class="line settled" data-if="r.settled != ''">{{ r.settled }}</p>
      <ul class="why" data-if="len(r.blocked) > 0"><li data-each="r.blocked as b">{{ b }}</li></ul>
      <div class="acts">
        <ss-widget data-if="r.canTake" name="rpg-battle.command-button" data-props='{"bind":"r.takeButton"}'></ss-widget>
        <ss-widget data-if="r.canFinish" name="rpg-battle.command-button" data-props='{"bind":"r.finishButton"}'></ss-widget>
        <ss-widget data-if="r.canAbandon" name="rpg-battle.command-button" data-props='{"bind":"r.abandonButton"}'></ss-widget>
      </div>
    </article>
  </section>
  <section class="group goals" data-if="len(q.v.goals) > 0">
    <p class="ss-label"><i class="fa-solid fa-flag"></i>Goals <small>{{ len(q.v.goals) }}</small></p>
    <p class="hint" data-if="q.v.state == 'neutral'">{{ q.v.note }}</p>
    <article class="ss-glass goal" data-each="q.v.goals as g">
      <header class="quest-head"><h3 class="nm">{{ g.title }}</h3><span class="ss-pill ss-pill-outline state-pill">{{ g.stateLabel }}</span></header>
      <p class="line" data-if="g.summary != ''">{{ g.summary }}</p>
      <ss-widget data-if="g.canMakeQuest" name="rpg-battle.quest-binding" data-props='{"bind":"g.binding"}'></ss-widget>
      <p class="line hold" data-if="g.needsRpg">This goal carries rewards that RPG Battle settles; it waits for RPG Battle.</p>
    </article>
  </section>
</div>
`;

const questsCss = sheet(`${SHARED_CSS}
.group { display: grid; gap: 8px; }
.quest, .goal { display: grid; gap: 6px; padding: var(--ss-space-3); min-width: 0; }
.quest.expired { border-color: var(--ss-bad); }
.quest.done { border-color: var(--ss-good); }
.quest-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.quest-head .nm { flex: 1 1 8em; min-width: 0; overflow-wrap: anywhere; }
.objectives { display: grid; gap: 2px; padding-left: 1.1em; list-style: disc; }
.line { margin: 0; font-size: 13px; }
.line.hold { color: var(--ss-warn); }
.acts { display: flex; flex-wrap: wrap; gap: var(--ss-space-2); }
`);

export const questsScreen = Object.freeze({
    id: 'rpg-battle/quests',
    title: 'Quests',
    icon: 'fa-scroll',
    mounts: Object.freeze(['tab', 'screen']),
    active: rulesActive,
    activeNote: ACTIVE_NOTE,
    data: Object.freeze({
        v: Object.freeze({ query: 'rpg-battle.questsView' }),
        deps: Object.freeze({ query: 'rpg-battle.rulesDeps' }),
    }),
    template: questsTemplate,
    css: questsCss,
});

// ---- Roster ------------------------------------------------------------------------------------------------------------

const MEMBER = (listName, alias) => `
    <article class="ss-glass member" data-each="${listName} as ${alias}" data-class="you: ${alias}.you; down: ${alias}.down">
      <header class="member-head">
        <ss-widget class="hero" name="ss.hero" data-props='{"bind":"${alias}.hero"}'></ss-widget>
        <ss-widget class="toggle" name="rpg-battle.member-toggle" data-props='{"actor":"{{ ${alias}.id }}","name":"{{ ${alias}.name }}","open":{{ ${alias}.open }}}'></ss-widget>
      </header>
      <div class="rest">
        <p class="hint life" data-if="${alias}.lifeText != ''">{{ ${alias}.lifeText }}</p>
        <p class="hint npc" data-if="${alias}.npc.show" data-class="unresolved: ${alias}.npc.state == 'unresolved'">{{ ${alias}.npc.text }}</p>
        <div class="acts">
          <ss-widget data-if="${alias}.canActivate" name="rpg-battle.command-button" data-props='{"bind":"${alias}.activateButton"}'></ss-widget>
          <ss-widget data-if="${alias}.canRest" name="rpg-battle.command-button" data-props='{"bind":"${alias}.restButton"}'></ss-widget>
        </div>
        <section class="block gear">
          <p class="ss-label"><i class="fa-solid fa-shield-halved"></i>Equipment</p>
          <ss-widget class="equipment" name="rpg-battle.equipment" data-props='{"bind":"${alias}.tiles","actor":"{{ ${alias}.id }}","label":"Equipment of {{ ${alias}.name }}","help":"Tap a piece once to mark it, tap again to take it off."}'></ss-widget>
          <details class="bag" data-if="len(${alias}.bag) > 0">
            <summary>Put something on</summary>
            <ul class="bag-list">
              <li class="bag-row" data-each="${alias}.bag as b">
                <span class="bag-name">{{ b.name }}</span>
                <p class="hint refused" data-if="b.blocked != ''">{{ b.blocked }}</p>
                <div class="acts" data-if="b.default != null">
                  <ss-widget name="rpg-battle.command-button" data-props='{"bind":"b.default.button"}'></ss-widget>
                  <small data-if="b.default.swapsText != ''">{{ b.default.swapsText }}</small>
                </div>
                <div class="acts alt" data-each="b.options as o">
                  <ss-widget name="rpg-battle.command-button" data-props='{"bind":"o.button"}'></ss-widget>
                  <small data-if="o.swapsText != ''">{{ o.swapsText }}</small>
                </div>
              </li>
            </ul>
          </details>
        </section>
      </div>
    </article>`;

const rosterTemplate = `
<div class="rb rb-roster">
  ${BANNER}
  <div class="ss-glass state" data-if="q.r.state == 'unavailable' || q.r.state == 'mismatch'" role="status" data-class="mismatch: q.r.state == 'mismatch'"><p><i class="fa-solid fa-hourglass-half"></i>{{ q.r.reason }}</p></div>
  <div class="ss-glass state" data-if="q.r.state == 'no-character'"><p><i class="fa-solid fa-user-plus"></i>No character yet. Create yours from the Progress page.</p></div>
  <section class="group active" data-if="q.r.state == 'ready'">
    <p class="ss-label"><i class="fa-solid fa-users"></i>Active party <small>{{ q.r.activeText }}</small></p>
    <div class="cards">${MEMBER('q.r.active', 'm')}
    </div>
  </section>
  <section class="group reserve" data-if="q.r.state == 'ready' && len(q.r.reserve) > 0">
    <p class="ss-label"><i class="fa-solid fa-bed"></i>Reserve <small>{{ len(q.r.reserve) }}</small></p>
    <div class="cards">${MEMBER('q.r.reserve', 'm')}
    </div>
  </section>
  <section class="group temporary" data-if="q.r.state == 'ready' && len(q.r.temporary) > 0">
    <p class="ss-label"><i class="fa-solid fa-paw"></i>Summons and pets <small>{{ len(q.r.temporary) }}</small></p>
    <p class="hint">{{ q.r.temporaryNote }}</p>
    <ul class="units">
      <li class="ss-glass unit" data-each="q.r.temporary as u"><span class="unit-name"><b>{{ u.name }}</b><small data-if="u.detail != ''"> {{ u.detail }}</small></span>
        <ss-widget name="rpg-battle.command-button" data-props='{"bind":"u.dismissButton"}'></ss-widget></li>
    </ul>
  </section>
</div>
`;

const rosterCss = sheet(`${SHARED_CSS}${EQUIPMENT_CSS}${RULES_WIDGET_CSS}
.group { display: grid; gap: 8px; }
.rb .member.down { filter: grayscale(0.7); }
.rb .member-head .hero { flex: 1 1 auto; min-width: 0; }
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); }
.bag > summary { cursor: pointer; font-size: 13px; color: var(--ss-muted); padding: 2px 0; min-height: 44px; display: flex; align-items: center; }
.bag-list { display: grid; gap: 10px; }
.bag-row { display: grid; gap: 4px; padding-top: 6px; border-top: 1px dashed var(--ss-border); }
.bag-name { font-weight: 700; overflow-wrap: anywhere; }
.refused { color: var(--ss-warn); }
.npc.unresolved { color: var(--ss-bad); }
.units { display: grid; gap: var(--ss-space-2); }
.unit { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ss-space-2); padding: var(--ss-space-2) var(--ss-space-3); }
`);

export const rosterScreen = Object.freeze({
    id: 'rpg-battle/roster',
    title: 'Roster',
    icon: 'fa-users',
    mounts: Object.freeze(['tab', 'screen']),
    active: rulesActive,
    activeNote: ACTIVE_NOTE,
    data: Object.freeze({
        r: Object.freeze({ query: 'rpg-battle.rosterView' }),
        deps: Object.freeze({ query: 'rpg-battle.rulesDeps' }),
    }),
    template: rosterTemplate,
    css: rosterCss,
});

// ---- Links -------------------------------------------------------------------------------------------------------------

const TIER_FORM = (spec, extra = '') => `<ss-widget ${extra} name="rpg-battle.command-input" data-props='{"bind":"${spec}"}'></ss-widget>`;

const linksTemplate = `
<div class="rb rb-links">
  ${BANNER}
  <section class="ss-glass sect checks">
    <p class="ss-label"><i class="fa-solid fa-dice-d20"></i>Check actors</p>
    <p class="hint" data-if="q.l.checks.state != 'ready'">{{ q.l.checks.note }}</p>
    <p class="hint" data-if="q.l.checks.state == 'ready' && q.l.checks.note != ''">{{ q.l.checks.note }}</p>
    <ul class="rows" data-if="q.l.checks.state == 'ready'">
      <li class="row actor" data-each="q.l.checks.actors as a" data-class="default: a.isDefault">
        <p class="row-head"><b>{{ a.name }}</b><span class="ss-pill ss-pill-soft" data-if="a.isDefault">Default</span><small>{{ a.bonuses }}</small></p>
        <p class="hint link" data-class="stale: a.link.state == 'stale'; fallback: a.link.state == 'fallback'">{{ a.link.text }}</p>
        <div class="acts">
          <ss-widget data-each="a.linkOptions as o" name="rpg-battle.command-button" data-props='{"bind":"o.button"}'></ss-widget>
          <ss-widget data-if="a.canUnlink" name="rpg-battle.command-button" data-props='{"bind":"a.unlinkButton"}'></ss-widget>
          <ss-widget data-if="a.canMakeDefault" name="rpg-battle.command-button" data-props='{"bind":"a.makeDefaultButton"}'></ss-widget>
        </div>
      </li>
    </ul>
    <p class="none" data-if="q.l.checks.state == 'ready' && len(q.l.checks.actors) == 0">No check actors yet.</p>
    ${TIER_FORM('q.l.checks.create', 'data-if="q.l.checks.state == \'ready\'"')}
  </section>

  <section class="ss-glass sect world">
    <p class="ss-label"><i class="fa-solid fa-earth-europe"></i>World</p>
    <p class="hint" data-if="q.l.world.state != 'ready'">{{ q.l.world.note }}</p>
    <div class="world-body" data-if="q.l.world.state == 'ready'">
      <p class="hint">{{ q.l.world.precedence }}</p>
      <div class="row here" data-if="q.l.world.here != null">
        <p class="row-head"><b>Here: {{ q.l.world.here.name }}</b></p>
        <p class="hint">{{ q.l.world.here.idText }}</p>
        <p class="hint">{{ q.l.world.here.regionText }} · {{ q.l.world.here.tierText }}</p>
      </div>
      <div class="row world-tier">
        <p class="row-head"><b>The world</b><small>{{ q.l.world.world.text }}</small></p>
        <div class="acts">${TIER_FORM('q.l.world.world.tier')}<ss-widget data-if="q.l.world.world.hasTier" name="rpg-battle.command-button" data-props='{"bind":"q.l.world.world.clearButton"}'></ss-widget></div>
      </div>
      <ul class="rows regions">
        <li class="row region" data-each="q.l.world.regions as g">
          <p class="row-head"><b>{{ g.name }}</b><small>{{ g.id }}</small><small>{{ g.dangerText }}</small></p>
          <p class="hint" data-if="g.aliasText != ''">{{ g.aliasText }}</p>
          <p class="hint" data-if="len(g.members) > 0">Places: <span data-each="g.members as p">{{ p.name }} </span></p>
          <div class="acts">${TIER_FORM('g.rename')}${TIER_FORM('g.tier')}<ss-widget data-if="g.hasTier" name="rpg-battle.command-button" data-props='{"bind":"g.clearTierButton"}'></ss-widget></div>
        </li>
      </ul>
      ${TIER_FORM('q.l.world.createRegion')}
      <ul class="rows places">
        <li class="row place" data-each="q.l.world.places as p" data-class="held: p.held">
          <p class="row-head"><b>{{ p.name }}</b><small>{{ p.regionText }}</small></p>
          <p class="hint canon">{{ p.idText }}</p>
          <p class="hint tier">{{ p.tierText }}</p>
          <div class="acts">
            <ss-widget data-each="p.bindOptions as o" name="rpg-battle.command-button" data-props='{"bind":"o.button"}'></ss-widget>
            <ss-widget data-each="p.memberOptions as o" name="rpg-battle.command-button" data-props='{"bind":"o.button"}'></ss-widget>
            <ss-widget data-if="p.canLeaveRegion" name="rpg-battle.command-button" data-props='{"bind":"p.leaveButton"}'></ss-widget>
          </div>
          <div class="acts">${TIER_FORM('p.placeTier')}<ss-widget data-if="p.hasPlaceTier" name="rpg-battle.command-button" data-props='{"bind":"p.clearPlaceTierButton"}'></ss-widget></div>
        </li>
      </ul>
    </div>
  </section>

  <section class="ss-glass sect inputs">
    <p class="ss-label"><i class="fa-solid fa-flag"></i>Flags and generated items</p>
    <p class="hint">{{ q.l.inputs.note }}</p>
    <p class="hint" data-if="q.l.inputs.state == 'unavailable'">The rules are not answering, so there is nothing to list.</p>
    <ul class="rows flags" data-if="len(q.l.inputs.flags) > 0" aria-label="Flags">
      <li class="row flag" data-each="q.l.inputs.flags as f" data-class="on: f.on"><b>{{ f.key }}</b><span class="ss-pill ss-pill-outline">{{ f.text }}</span></li>
    </ul>
    <ul class="rows items" data-if="len(q.l.inputs.items) > 0" aria-label="Generated items">
      <li class="row item" data-each="q.l.inputs.items as i" data-class="unruled: !i.ruled"><b>{{ i.name }}</b><small>{{ i.source }} · {{ i.rarity }}</small><span class="ss-pill ss-pill-outline" data-if="i.ruled">Rule recorded</span><span class="ss-pill ss-pill-outline warn" data-if="!i.ruled">No rule recorded</span></li>
    </ul>
  </section>

  <section class="ss-glass sect dossiers" data-if="q.l.dossiers.state == 'ready' && len(q.l.dossiers.rows) > 0">
    <p class="ss-label"><i class="fa-solid fa-address-book"></i>Companion dossiers</p>
    <ul class="rows">
      <li class="row dossier" data-each="q.l.dossiers.rows as d" data-class="unresolved: d.state == 'unresolved'"><b>{{ d.name }}</b><small>{{ d.text }}</small></li>
    </ul>
  </section>
</div>
`;

const linksCss = sheet(`${SHARED_CSS}${RULES_WIDGET_CSS}
.sect { display: grid; gap: 8px; padding: var(--ss-space-3); min-width: 0; }
.rows { display: grid; gap: 10px; }
.row { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--ss-border); min-width: 0; }
.row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 0; }
.row-head b { overflow-wrap: anywhere; }
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); }
.link.stale, .link.fallback, .place.held .canon, .dossier.unresolved small { color: var(--ss-warn); }
.item.unruled b { color: var(--ss-warn); }
.flag { grid-template-columns: 1fr auto; align-items: center; }
.flag.on .ss-pill { border-color: var(--ss-good); }
`);

export const linksScreen = Object.freeze({
    id: 'rpg-battle/links',
    title: 'Links',
    icon: 'fa-link',
    mounts: Object.freeze(['tab', 'screen']),
    active: rulesActive,
    activeNote: ACTIVE_NOTE,
    data: Object.freeze({
        l: Object.freeze({ query: 'rpg-battle.linksView' }),
        deps: Object.freeze({ query: 'rpg-battle.rulesDeps' }),
    }),
    template: linksTemplate,
    css: linksCss,
});

// ---- Setup -------------------------------------------------------------------------------------------------------------

const setupTemplate = `
<div class="rb rb-setup">
  <section class="ss-glass sect rules-pack" data-if="q.s.rules.offered || q.s.rules.pinned">
    <p class="ss-label"><i class="fa-solid fa-book-open"></i>Character rules</p>
    <div data-if="q.s.rules.offered">
      <p class="hint">Choose the rules for this character timeline before creating your character. The pin keeps this exact ruleset even if its installed pack changes. To choose different rules, start a new character timeline.</p>
      <div class="row" data-each="q.s.rules.offers as r">
        <p class="row-head"><b>{{ r.name }}</b><small>{{ r.version }}</small></p>
        <ss-widget name="rpg-battle.command-button" data-props='{"bind":"r.pin"}'></ss-widget>
      </div>
    </div>
    <p class="hint" data-if="q.s.rules.pinned">Pinned: {{ q.s.rules.identity }}. These rules stay with this character timeline.</p>
    <ss-widget name="rpg-battle.create-character" data-if="q.s.rules.create"></ss-widget>
  </section>
  <section class="ss-glass sect status" data-class="dormant: !q.s.deps.ready">
    <p class="ss-label"><i class="fa-solid fa-plug-circle-check"></i>What RPG Battle depends on</p>
    <p class="headline"><b>{{ q.s.deps.headline }}</b></p>
    <ul class="lines" aria-label="Dependencies">
      <li class="dep" data-each="q.s.deps.lines as l" data-class="good: l.tone == 'good'; warn: l.tone == 'warn'; bad: l.tone == 'bad'">
        <span class="dep-head"><b>{{ l.label }}</b><span class="ss-pill ss-pill-outline" data-class="ss-tone-good: l.tone == 'good'; ss-tone-bad: l.tone == 'bad'">{{ l.state }}</span><small data-if="l.required">needed</small></span>
        <span class="dep-text">{{ l.text }}</span>
      </li>
    </ul>
    <ul class="held" data-if="len(q.s.deps.held) > 0" aria-label="On hold"><li data-each="q.s.deps.held as h">{{ h }}</li></ul>
  </section>
  <section class="ss-glass sect saves">
    <p class="ss-label"><i class="fa-solid fa-floppy-disk"></i>Save points</p>
    <p class="hint" data-if="q.s.saves.state != 'ready'">{{ q.s.saves.note }}</p>
    <div data-if="q.s.saves.state == 'ready'">
      <p class="none" data-if="q.s.saves.empty">No save points yet.</p>
      <ul class="rows points" data-if="!q.s.saves.empty">
        <li class="row point" data-each="q.s.saves.points as p" data-class="missing: !p.available">
          <p class="row-head"><b>{{ p.name }}</b><span class="ss-pill ss-pill-soft" data-if="p.kindLabel != ''">{{ p.kindLabel }}</span><small>{{ p.whenText }}</small></p>
          <p class="hint" data-if="p.sceneText != ''">{{ p.sceneText }}</p>
          <ul class="recap" data-if="len(p.recap) > 0"><li data-each="p.recap as r">{{ r }}</li></ul>
          <p class="hint miss" data-if="!p.available">{{ p.availableText }}</p>
        </li>
      </ul>
      <div class="acts">
        <ss-widget name="rpg-battle.command-button" data-props='{"bind":"q.s.saves.saveNow"}'></ss-widget>
        <ss-widget name="rpg-battle.command-input" data-props='{"bind":"q.s.saves.saveNamed"}'></ss-widget>
      </div>
    </div>
  </section>
</div>
`;

const setupCss = sheet(`${SHARED_CSS}${RULES_WIDGET_CSS}
.sect { display: grid; gap: 8px; padding: var(--ss-space-3); min-width: 0; }
.sect.dormant { border-color: var(--ss-bad); }
.headline { margin: 0; }
.lines { display: grid; gap: 8px; }
.dep { display: grid; gap: 2px; padding-top: 8px; border-top: 1px solid var(--ss-border); }
.dep-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.dep-text { font-size: 13px; color: var(--ss-muted); }
.dep.bad .dep-text, .dep.warn .dep-text { color: var(--ss-text); }
.held { display: grid; gap: 2px; padding-left: 1.1em; list-style: disc; font-size: 13px; color: var(--ss-warn); }
.rows { display: grid; gap: 10px; }
.row { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--ss-border); }
.row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 0; }
.point.missing { border-top-color: var(--ss-bad); }
.miss { color: var(--ss-bad); }
.recap { display: grid; gap: 2px; padding-left: 1.1em; list-style: disc; font-size: 13px; }
.acts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ss-space-2); padding-top: 8px; }
`);

export const setupScreen = Object.freeze({
    id: 'rpg-battle/setup',
    title: 'Setup',
    icon: 'fa-plug-circle-check',
    mounts: Object.freeze(['tab', 'screen', 'dialog']),
    active: setupActive,
    activeNote: 'Shown when rules can be chosen for a new character, when rules are pinned, or while RPG Battle is dormant.',
    data: Object.freeze({ s: Object.freeze({ query: 'rpg-battle.setupView' }) }),
    template: setupTemplate,
    css: setupCss,
});

export const rulesScreens = Object.freeze([progressScreen, questsScreen, rosterScreen, linksScreen, setupScreen]);
