// Story Director v2, part **checks**: its queries (contract §2 `director.contract`, §3 P09 `checks.policy`). Pure.

import { projection } from './domain.js';

const settingsOf = tools => {
    try {
        const values = typeof tools?.settings === 'function' ? tools.settings() : null;
        return values && typeof values === 'object' ? values : {};
    } catch {
        return {};
    }
};

/** Whether `name` can be asked on this host (a missing query throws; a null answer is still an answer). */
function answers(tools, name, args) {
    if (typeof tools?.query !== 'function') return false;
    try {
        tools.query(name, args);
        return true;
    } catch {
        return false;
    }
}

export const queries = {
    /** The checks policy and its hash (the read-only projection every writer compares `expectedHash` with). */
    'checks.policy': (state, _args, tools) => projection(state?.domains?.checks, settingsOf(tools)),
    /**
     * `director.contract({}) -> { api: 2, enabled, clock, tiers, threads, journal, checks }`: what Story Director offers a rules module,
     * as booleans RPG Battle probes before it goes ready. `clock`: the story clock answers; `tiers`: places and their danger resolve;
     * `threads`: the thread store and its hash answer; `journal`: day recaps answer without the digest on screen; `checks`: the policy answers.
     */
    'director.contract': (state, _args, tools) => ({
        api: 2,
        enabled: true,
        clock: answers(tools, 'director.time', {}),
        tiers: answers(tools, 'atlas.canonical', { id: 'pl_00000000' }) && answers(tools, 'world.areaTier', { place: 'pl_00000000' }),
        threads: answers(tools, 'director.threads', {}) && answers(tools, 'threads.hash', { thread: 'th_00000000' }),
        journal: answers(tools, 'journal.day', { day: 0 }),
        checks: Boolean(state?.domains?.checks) && answers(tools, 'checks.policy', {}),
    }),
};
