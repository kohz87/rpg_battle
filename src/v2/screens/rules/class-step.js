// RPG Battle v2, screens for the rules-v2 views (track C): the basic-class step of character creation, as a fragment.
//
// `creation.finish` gains a required `class:Ref` and an optional `checkActor:RecordId` (RB_PHASE0 §3). The wizard
// (src/v2/creation/screen.js) mounts this fragment on its Start step, with the
// query that feeds it (`rpg-battle.classPicker`) and a test that proves what it writes into the draft.
//
//   draft.class        the basic class the reader pressed (nothing is chosen at the start; finish refuses without one)
//   draft.checkActor   the Story Director check actor to link, or null for the default behaviour: the existing default
//                      actor, else a new one made with the character (the query says which)
//
// The query reads rules.classes and checks.policy (SD); either may be missing, and the step says so.

import { ASK, ask, isHash, isRecord, isText } from './ask.js';
import { clip } from './format.js';
import { pickerModel } from './progress.js';

export const CLASS_STEP_ID = 'rpg-battle/create-class';

const isChecksPolicy = value => isRecord(value) && isRecord(value.actors) && isHash(value.hash) && (value.defaultActor === null || isText(value.defaultActor));

/** rpg-battle.classPicker({}) → { classes: { state, pick }, checks: { state, pick, fallback } }. */
export function classPickerView(state, args, tools) {
    const classes = pickerModel(tools);
    const policy = ask(tools, 'checks.policy', {}, isChecksPolicy);
    const actors = policy.status === ASK.OK ? Object.values(policy.value.actors).filter(isRecord).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)) : [];
    const defaultActor = policy.status === ASK.OK && policy.value.defaultActor ? policy.value.actors[policy.value.defaultActor] ?? null : null;
    return {
        classes: {
            state: classes.state,
            pick: { field: 'class', label: 'Basic class', options: classes.classes, empty: 'No basic classes are available yet.' },
            // id → name, for the wizard's summary row ("Human · Barge Drifter")
            names: Object.fromEntries(classes.classes.map(option => [option.id, option.label])),
        },
        checks: {
            state: policy.status === ASK.OK ? 'ready' : 'unavailable',
            pick: { field: 'checkActor', label: 'Check actor', options: actors.map(actor => ({ id: actor.id, label: clip(actor.name, 80), sub: policy.value.defaultActor === actor.id ? 'Current default' : '' })), empty: 'No check actors yet.' },
            fallback: policy.status !== ASK.OK ? 'Check actors are not available. Your character is made without a link.'
                : defaultActor ? `If you choose none, ${clip(defaultActor.name, 80)} (the default) is used.` : 'If you choose none, a new check actor is made for your character.',
        },
    };
}

/** The step's template: `q.c` is rpg-battle.classPicker, `draft` the wizard's draft. */
export const CLASS_STEP_TEMPLATE = `
<section class="cc-step cc-class">
  <div class="cc-main">
    <p class="cc-lead">Choose your basic class. It gives you your three starting skills.</p>
    <p class="cc-none" data-if="q.c.classes.state != 'ready'">The basic classes are not available to choose from yet.</p>
    <ss-widget class="cc-cards" data-if="q.c.classes.state == 'ready'" name="rpg-battle.class-pick" data-props='{"bind":"q.c.classes.pick","picked":"{{ draft.class }}"}'></ss-widget>
    <p class="cc-hint" data-if="draft.class == ''">Nothing is chosen for you. Press a class to pick it; press it again to clear it.</p>
    <div class="cc-checks" data-if="q.c.checks.state == 'ready'">
      <p class="cc-lead">Link a check actor (optional)</p>
      <ss-widget class="cc-cards" name="rpg-battle.class-pick" data-props='{"bind":"q.c.checks.pick","picked":"{{ draft.checkActor }}"}'></ss-widget>
      <p class="cc-hint">{{ q.c.checks.fallback }}</p>
    </div>
    <p class="cc-hint" data-if="q.c.checks.state != 'ready'">{{ q.c.checks.fallback }}</p>
  </div>
</section>
`;
