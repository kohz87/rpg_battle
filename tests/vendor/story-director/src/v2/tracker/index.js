// Story Director v2, part **tracker** (MODULES §C1): the `director` domain, its change-line
// kinds, the story clock (set from a pack's start date when the story has not set it), its queries
// and what the model is told. Its screen is the screens part's `story-director/director`.
// The coordinator's src/v2/module.js merges this part with the others into module
// `story-director`. Quest taking, finishing, targets and progress are part `quests` (§C2):
// this part keeps `taken`, `target` and `reward` as they are, and sets `ended` when a line
// closes a thread. Its quest lines also carry `met:` (a thread's `ready`), `progress:` (the step
// note), the no-goal Problem and the story's own turn-in (quest-lines.js).

import { applyThreadLine, applyTimeLine } from './capture.js';
import { THREAD_KINDS } from './convert.js';
import { initialDirector, queries, validateDirector } from './domain.js';
import { GRAMMAR, GRAMMAR_ALONE, TAIL_BUDGET, directorTail, grammarOf, staticText } from './note.js';
import { threadCommands, threadReplayGuard } from './writers.js';
import { intentCommand } from './acceptance.js';
import { SEED, seedCommand, seedHook } from './seed.js';
import { DEFAULT_COOLDOWN, FEATURE as INITIATIVE_FEATURE, INITIATIVE, INITIATIVE_STATIC, MAX_COOLDOWN, initiativeCommand, initiativeHook } from './initiative.js';
import { DEFAULT_ELSEWHERE, MAX_ELSEWHERE } from './scene.js';
import { PRESET_CHOICES, settingsDefaults } from './time.js';

// A kind Story Director alone words otherwise (GRAMMAR_ALONE) gets its grammar from the module set.
const kinds = Object.fromEntries(THREAD_KINDS.filter(kind => kind !== 'quest').map(kind => [kind, {
    grammar: Object.hasOwn(GRAMMAR_ALONE, kind) ? env => grammarOf(kind, env) : GRAMMAR[kind],
    apply: applyThreadLine,
}]));
kinds.time = { grammar: GRAMMAR.time, apply: applyTimeLine };

function beforeGenerate(view) {
    const outs = [seedHook(view), initiativeHook(view)].filter(Boolean);
    if (!outs.length) return undefined;
    return { lines: [], commands: outs.flatMap(out => out.commands ?? []) };
}

export const part = {
    domains: {
        // The story clock is a count (SPEC §2.2 "Counts move"): every move keeps the minutes it replaced
        // (`was`), so a reply deleted in the middle takes its own move back and later moves add theirs.
        director: { initial: initialDirector, validate: validateDirector, counters: ['time/minutes'] },
    },
    // NPC initiative (initiative.js): a seeded pick by code before each reply, its line in the tail and,
    // while the feature is on, one static line (a context part under the feature, MODULES §F100).
    features: [{
        id: INITIATIVE_FEATURE,
        label: 'NPC initiative',
        describe: 'Before each reply, code picks at most one person present or nearby with an open thread to take the first step (approach, interrupt or ask); the Director note names them in one line.',
        default: true,
    }],
    commands: { [SEED]: seedCommand, ...threadCommands, 'threads.intent': intentCommand, [INITIATIVE]: Object.assign((ctx, payload) => initiativeCommand(ctx, payload), { feature: INITIATIVE_FEATURE }) },
    queries,
    kinds,
    context: {
        static: env => staticText(env),
        tail: view => directorTail(view),
        budget: TAIL_BUDGET,
        parts: [{ feature: INITIATIVE_FEATURE, static: () => INITIATIVE_STATIC }],
    },
    // Right after a reply's last story line (Story Block's afterCapture, MODULES §F121): the turn-ins the
    // reply left waiting, settled on the scene it ended up in, in that reply. Before each reply: the clock
    // from a pack's start, and (on an older Story Block, which never calls afterCapture) the same turn-ins,
    // which the step before the next reply then settles (quest-lines.js). A Continue's afterCapture also
    // pays a turn-in the place refused at the end of the reply's first part, once the party is there.
    hooks: { beforeGenerate, replayGuard: threadReplayGuard },
    settings: {
        section: 'Calendar',
        defaults: settingsDefaults(),
        schema: {
            calendar: {
                type: 'group',
                label: 'Calendar',
                fields: {
                    // `pack`: the enabled pack's calendar when one has it, else Gregorian.
                    preset: { type: 'choice', label: 'Calendar', options: [...PRESET_CHOICES] },
                    era: { type: 'text', label: 'Era (written before the year)' },
                    // `form: 'lines'`: Story Block shows the months as text, one "Name: Days" a line (any number
                    // of months); an older Story Block ignores it and shows rows.
                    months: { type: 'list', label: 'Months', form: 'lines', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 400 } } },
                    leapYears: { type: 'bool', label: 'Leap years' },
                    week: { type: 'text', label: 'Weekdays (comma separated; empty for none)' },
                },
            },
            dormantReplies: { type: 'int', label: 'Quiet after replies', min: 1, max: 500 },
            dormantDays: { type: 'int', label: 'Quiet after story days', min: 1, max: 3650 },
            dueSoonDays: { type: 'int', label: 'Due soon within days', min: 0, max: 365 },
            // One time line moves the clock forward at most this far; a longer jump is held to it, with a Problem.
            maxJump: { type: 'int', label: 'Longest time jump (story days)', min: 1, max: 3650 },
            // The Director note: threads that do not fit the scene, named by one line at most this many (0: none).
            elsewhere: { type: 'int', label: 'Threads elsewhere named in the note', min: 0, max: MAX_ELSEWHERE },
            // NPC initiative: replies before the same person may take the initiative again (2: never two running).
            initiativeCooldown: { type: 'int', label: 'NPC initiative: replies before the same person again', min: DEFAULT_COOLDOWN, max: MAX_COOLDOWN, feature: INITIATIVE_FEATURE },
        },
    },
    tabs: [],
};
