// RPG Battle v2, screens for the rules-v2 views (track C): what RPG Battle depends on, as one view (RB_PHASE0 §2).
//
// Seven lines, each with its own state so a reader can tell them apart (C13):
//
//   sd       Story Director (required)        ready | missing | disabled | incompatible
//   save     Save points, Story Block (req.)  ready | missing | incompatible | not-ready
//   clock    The story clock                  ready | unset | unknown
//   area     This place's danger tier         ready | unknown-tier | unknown-place | unknown
//   journal  Day recaps (optional)            ready | off | idle | unknown
//   social   Relationships (optional)         ready | off | absent
//   rb       RPG Battle itself (host status)  ready | dormant | restore-pending | unknown
//
// The `rb` line and the Story Director line's "installed but waiting" reading come from Story Block's module status
// (`sdk.modules()`: status and reason, E2), which answers whether or not RPG Battle's own queries do. That is what keeps the
// Setup page useful while RPG Battle is dormant. A host that does not report status gives `unknown`, which holds nothing.
//
// Required lines decide `ready`: when one is not ready RPG Battle is dormant (views say why, actions refuse, the other
// modules carry on). A late or re-enabled module is simply read again: this view is recomputed on every drawing, so it
// comes back on the next view with no reload. An unset clock holds only timed actions; an unknown tier holds only
// content for that place; the optional lines never hold anything.
//
// Everything is read through public queries: director.contract, savepoint.contract, director.time, atlas.canonical,
// world.areaTier, chronicle.day, journal.day, checks.policy, npc.identity.

import { ASK, ask, isAreaTier, isClock, isContract, isRecord } from './ask.js';
import { clip, dayOf } from './format.js';

const CAPABILITIES = Object.freeze(['clock', 'tiers', 'threads', 'journal', 'checks']);
const SAVE_CAPABILITIES = Object.freeze(['snapshots', 'retainedChatRestore', 'participantsReady']);

const SOURCE_WORDS = Object.freeze({ place: 'set for this place', region: 'set for its region', world: 'set for the whole world' });

/** Story Block's module list (`sdk.modules()`: id, status, reason), or null when the host does not give one. */
export function hostModules(sdk = globalThis.StoryBlock?.sdk) {
    try {
        const list = typeof sdk?.modules === 'function' ? sdk.modules() : null;
        return Array.isArray(list) ? list.filter(isRecord) : null;
    } catch {
        return null;
    }
}

/** RPG Battle's own host status: 'ready', 'dormant', 'restore-pending', or '' when the host does not say. */
export function ownStatus(modules = hostModules()) {
    const entry = Array.isArray(modules) ? modules.find(item => item.id === 'rpg-battle') : null;
    return typeof entry?.status === 'string' ? entry.status : '';
}

const line = (id, label, state, tone, text, extra = {}) => ({ id, label, state, tone, text, required: false, ...extra });

function storyDirector(tools, modules) {
    const found = ask(tools, 'director.contract', {}, isContract);
    if (found.status === ASK.MISSING || found.status === ASK.EMPTY) {
        const listed = Array.isArray(modules) ? modules.find(item => item.id === 'story-director') : null;
        if (listed?.status === 'dormant' || listed?.status === 'restore-pending') {
            const why = clip(typeof listed.reason === 'string' ? listed.reason : '', 160);
            return line('sd', 'Story Director', 'dormant', 'bad', `Story Director is installed but waiting${why ? `: ${why}` : ''}. It is checked again each time this page is drawn.`, { required: true });
        }
        if (listed) {
            return line('sd', 'Story Director', 'incompatible', 'bad', 'Story Director is running but does not offer what RPG Battle needs (it may be too old).', { required: true });
        }
        return line('sd', 'Story Director', 'missing', 'bad',
            'Story Director is not answering (not installed, switched off, or still starting). It is checked again each time this page is drawn.', { required: true });
    }
    if (found.status === ASK.MALFORMED) {
        return line('sd', 'Story Director', 'incompatible', 'bad', 'Story Director answered in a form this version of RPG Battle does not understand.', { required: true });
    }
    if (found.value.enabled === false) {
        return line('sd', 'Story Director', 'disabled', 'bad', 'Story Director is installed but switched off.', { required: true });
    }
    const lacking = CAPABILITIES.filter(name => found.value[name] !== true);
    if (lacking.length) {
        return line('sd', 'Story Director', 'incompatible', 'bad', `Story Director is missing what RPG Battle needs: ${lacking.join(', ')}.`, { required: true, lacking });
    }
    return line('sd', 'Story Director', 'ready', 'good', 'Story Director is ready.', { required: true });
}

function ownLine(modules) {
    const status = ownStatus(modules);
    if (status === 'dormant') {
        const entry = modules.find(item => item.id === 'rpg-battle');
        const why = clip(typeof entry?.reason === 'string' ? entry.reason : '', 160);
        return line('rb', 'RPG Battle', 'dormant', 'bad', `RPG Battle is dormant${why ? `: ${why}` : ' while a module it needs is missing or off'}. Nothing of it runs until then; this page says what is wrong.`, { required: true, reason: why });
    }
    if (status === 'restore-pending') return line('rb', 'RPG Battle', 'restore-pending', 'warn', 'A return in time is still finishing. RPG Battle waits until it is done.', { required: true });
    if (status === 'ready') return line('rb', 'RPG Battle', 'ready', 'good', 'RPG Battle is running.');
    return line('rb', 'RPG Battle', 'unknown', 'neutral', 'This host does not say whether RPG Battle is running.');
}

function savePoints(tools) {
    const found = ask(tools, 'savepoint.contract', {}, value => isRecord(value) && value.api === 2);
    if (found.status === ASK.MISSING || found.status === ASK.EMPTY) {
        return line('save', 'Save points', 'missing', 'bad', 'Story Block does not offer save points here, so a return in time cannot be promised.', { required: true });
    }
    if (found.status === ASK.MALFORMED) {
        return line('save', 'Save points', 'incompatible', 'bad', 'Story Block answered about save points in a form this version does not understand.', { required: true });
    }
    const lacking = SAVE_CAPABILITIES.filter(name => found.value[name] !== true);
    if (lacking.length) {
        return line('save', 'Save points', 'not-ready', 'warn', `Save points are not ready yet (${lacking.join(', ')}).`, { required: true, lacking });
    }
    return line('save', 'Save points', 'ready', 'good', 'Save points are ready.', { required: true });
}

function clockLine(tools, sdReady) {
    if (!sdReady) return { row: line('clock', 'Story clock', 'unknown', 'neutral', 'Not known while Story Director is not answering.'), minutes: null };
    const found = ask(tools, 'director.time', {}, isClock);
    if (found.status !== ASK.OK) return { row: line('clock', 'Story clock', 'unknown', 'neutral', 'The story clock could not be read.'), minutes: null };
    if (found.value.minutes === null) {
        return {
            row: line('clock', 'Story clock', 'unset', 'warn', 'The story clock is not set. You can make characters and read these pages; training and quest deadlines wait until it is set.'),
            minutes: null,
        };
    }
    return { row: line('clock', 'Story clock', 'ready', 'good', found.value.text ? `Clock: ${clip(found.value.text, 80)}.` : 'The clock is set.'), minutes: found.value.minutes };
}

function areaLine(tools, sdReady) {
    if (!sdReady) return line('area', 'Danger here', 'unknown', 'neutral', 'Not known while Story Director is not answering.');
    const here = ask(tools, 'atlas.canonical', {});
    if (here.status !== ASK.OK || typeof here.value?.id !== 'string') {
        return line('area', 'Danger here', 'unknown-place', 'warn', 'This place is not one the world map can name yet, so foes, loot and shops for it wait.', { held: 'place content' });
    }
    const tier = ask(tools, 'world.areaTier', { place: here.value.id }, isAreaTier);
    if (tier.status !== ASK.OK) return line('area', 'Danger here', 'unknown', 'neutral', 'The danger of this place could not be read.');
    if (tier.value.tier === null || tier.value.source === 'unknown') {
        return line('area', 'Danger here', 'unknown-tier', 'warn', 'No danger tier is set for this place, its region or the world, so foes, loot and shops for it wait. Nothing else is held.', { held: 'place content' });
    }
    const where = SOURCE_WORDS[tier.value.source] ?? '';
    return line('area', 'Danger here', 'ready', 'good', `Danger tier ${tier.value.tier}${where ? `, ${where}` : ''}.`, { tier: tier.value.tier, source: tier.value.source });
}

function journalLine(tools, sdReady, minutes) {
    if (!sdReady) return line('journal', 'Day recaps', 'unknown', 'neutral', 'Not known while Story Director is not answering.');
    if (minutes === null) return line('journal', 'Day recaps', 'idle', 'neutral', 'Recaps start once the story clock has a day.');
    const day = dayOf(minutes);
    const ui = ask(tools, 'chronicle.day', { day });
    const data = ask(tools, 'journal.day', { day });
    if (data.status === ASK.MISSING) return line('journal', 'Day recaps', 'unknown', 'neutral', 'The recap for this day could not be read.');
    if (ui.status === ASK.MISSING || ui.status === ASK.EMPTY) {
        return line('journal', 'Day recaps', 'off', 'neutral', 'The day journal is switched off in Story Director. Save points still keep their own recap, and nothing else is held.');
    }
    return line('journal', 'Day recaps', 'ready', 'good', 'The day journal is on.');
}

function socialLine(tools) {
    const policy = ask(tools, 'checks.policy', {});
    const identity = ask(tools, 'npc.identity', { name: ' ' });
    if (policy.status === ASK.OK && policy.value.social === false) {
        return line('social', 'Relationships', 'off', 'neutral', 'Relationship modifiers on checks are switched off. Checks use the rules alone.');
    }
    if (identity.status === ASK.MISSING) {
        return line('social', 'Relationships', 'absent', 'neutral', 'NPC State Delta is not installed, so companions have no relationship dossier and checks add no social modifier.');
    }
    return line('social', 'Relationships', 'ready', 'good', 'Relationships are on.');
}

/**
 * dependencyView(tools) → { ready, mode, headline, lines, held, minutes }. `lines` are the six rows in the order above;
 * `held` is what an unset clock or an unknown tier holds, in plain sentences.
 */
export function dependencyView(tools, modules = hostModules()) {
    const sd = storyDirector(tools, modules);
    const save = savePoints(tools);
    const sdReady = sd.state === 'ready';
    const { row: clock, minutes } = clockLine(tools, sdReady);
    const area = areaLine(tools, sdReady);
    const journal = journalLine(tools, sdReady, minutes);
    const social = socialLine(tools);
    const lines = [sd, save, clock, area, journal, social, ownLine(modules)];
    const blocking = lines.filter(row => row.required && row.state !== 'ready');
    const ready = blocking.length === 0;
    const held = [];
    if (ready && clock.state === 'unset') held.push('Timed actions (training, quest deadlines) wait for the story clock.');
    if (ready && (area.state === 'unknown-tier' || area.state === 'unknown-place')) held.push('Content for this place waits for a danger tier.');
    const own = lines[lines.length - 1];
    const headline = ready
        ? (held.length ? 'RPG Battle is ready, with a few things on hold.' : 'RPG Battle is ready.')
        : `RPG Battle is waiting${own.state === 'dormant' && own.reason ? ` (${own.reason})` : ''}. Your story and the other modules keep working.`;
    return { ready, mode: ready ? 'ready' : 'dormant', headline, lines, blocking: blocking.map(row => row.id), held, minutes };
}
