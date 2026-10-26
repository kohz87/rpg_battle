// Story Director v2, part **arc** (v1 arc planning, MODULES §C): once per arc a planner model plays
// showrunner and plans what the world does next (beats, agendas, hooks, clocks, secrets); the reader
// reviews the plan and accepts, discards or plans again; accepted, it becomes the Director's own threads.
//
// * The feature `story-director.arc` (on by default; MODULES §F100) owns all of it: the commands, the
//   query, the tail line, the panel and its settings. Off, nothing of it is drawn, sent or asked; arcs
//   already accepted stay in the state, and their threads stay the Director's.
// * Domain `arc` (domain.js): one record per accepted plan and one per ending, each added under its key.
// * Commands (commands.js): `director.arc.accept`, `director.arc.update`, `director.arc.end`, the reader's
//   (cause ui). The planner's call is not a command: the panel makes it (controller.js), through Story
//   Block's `sdk.callModel` on the planner's own connection profile (setting `arc.profile`).
// * Query `director.arc`: the current arc and its beats played. Tail: "Arc: Name — what it is about" while
//   it runs. Nothing is added to the fixed prompt: the beats and agendas are tracker threads, whose lines
//   the static part already has.
// * Planning by itself (`arc.trigger: auto`) runs after a reply (index.js hands Story Block's `turn`
//   event to the page's controller).
// Works in any story (WAVE rule 11): without a module that runs fights the planner is asked for none,
// and a fight it plans anyway stays a beat without foes.

import { commands } from './commands.js';
import { ARC_TAIL_BUDGET, FEATURE, arcQuery, arcTail, initialArc, validateArc } from './domain.js';
import { ARC_NEEDS_STORY_BLOCK, NEEDS_TEXT } from './controller.js';
import { DEFAULTS, SCHEMA, promptSection } from './settings.js';
import { ARC_WIDGET, arcWidget } from './widget.js';

export { FEATURE };
export { ACCEPT, END, UPDATE } from './commands.js';
export { ARC_NEEDS_STORY_BLOCK, NEEDS_TEXT, arcController, createArcController } from './controller.js';
export { ARC_WIDGET, arcWidget, createArcWidget } from './widget.js';

function liveSdk() {
    try {
        return globalThis.StoryBlock?.sdk ?? null;
    } catch {
        return null;
    }
}

// The settings panel's own part: the planner prompt with Reset, and the Story Block it needs when this
// one cannot make the call.
const section = Object.assign((el, api) => promptSection(el, api, {
    needs: typeof (api?.sdk ?? liveSdk())?.callModel === 'function' ? '' : NEEDS_TEXT,
}), { feature: FEATURE });

const tail = Object.assign(view => arcTail(view), { feature: FEATURE });

export const part = {
    features: [{
        id: FEATURE,
        label: 'Arc planning',
        describe: `A planner model plans the next arc (beats, agendas, hooks, clocks, secrets) for you to review and accept. Needs Story Block ${ARC_NEEDS_STORY_BLOCK} or newer.`,
        default: true,
    }],
    domains: {
        arc: { initial: initialArc, validate: validateArc },
    },
    commands,
    queries: { 'director.arc': Object.assign(state => arcQuery(state), { feature: FEATURE }) },
    kinds: {},
    context: { static: () => '', tail, budget: ARC_TAIL_BUDGET },
    hooks: {},
    settings: { defaults: { ...DEFAULTS }, schema: { ...SCHEMA }, section },
    widgets: { [ARC_WIDGET]: arcWidget },
    tabs: [],
};
