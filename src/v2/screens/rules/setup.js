// RPG Battle v2, screens for the rules-v2 views (track C): the Setup page's view query, `rpg-battle.setupView`, and the
// one-line banner query the other pages carry, `rpg-battle.rulesDeps`.
//
//   deps    the six dependency lines (deps.js)
//   saves   the save points the host lists (savepoint.list, pending E), with Save now (savepoint.make). A save whose
//           saved copy is missing is shown as missing; it is never swapped for another one, and a save a deleted reply
//           carried is simply not listed.

import { ASK, ask, isList, isRecord, isText } from './ask.js';
import { btn, clip, clockLabel } from './format.js';
import { dependencyView } from './deps.js';

const isSnapshot = value => isRecord(value) && isText(value.id) && isText(value.name) && typeof value.available === 'boolean';
const KIND_WORDS = Object.freeze({ initial: 'Start', manual: 'Manual', 'day-start': 'Start of day' });

function savesModel(tools) {
    const found = ask(tools, 'savepoint.list', {}, value => isList(value, isSnapshot));
    if (found.status !== ASK.OK) {
        return { state: found.status === ASK.MALFORMED ? 'mismatch' : 'unavailable', points: [], note: 'Save points are not available here.' };
    }
    const points = found.value.map(point => ({
        id: point.id, name: clip(point.name, 80), kindLabel: KIND_WORDS[point.kind] ?? '',
        whenText: Number.isSafeInteger(point.minute) ? clockLabel(point.minute) : 'Before the clock was set',
        sceneText: isRecord(point.scene) ? clip(point.scene.text ?? '', 240) : '',
        recap: isRecord(point.journal) && Array.isArray(point.journal.lines) ? point.journal.lines.filter(isText).slice(0, 12).map(line => clip(line, 240)) : [],
        available: point.available,
        availableText: point.available ? '' : 'The saved copy for this point is missing. A return will stop and say so; it will not use a different save.',
    }));
    return {
        state: 'ready', points, empty: points.length === 0, note: '',
        saveNow: btn('savepoint.make', {}, 'Save now', { tone: 'primary' }),
        saveNamed: { command: 'savepoint.make', valueAt: 'name', label: 'Name this save', submit: 'Save', placeholder: 'Save point name', max: 80, payload: {} },
    };
}

/** rpg-battle.setupView({}) → { deps, saves }. */
export function setupView(state, args, tools) {
    return { deps: dependencyView(tools), saves: savesModel(tools) };
}

/** rpg-battle.rulesDeps({}) → the banner: { show, tone, headline, held, lines } (only the lines that are not fine). */
export function depsBanner(state, args, tools) {
    const view = dependencyView(tools);
    const trouble = view.lines.filter(line => line.tone === 'bad' || line.tone === 'warn');
    return {
        show: trouble.length > 0 || !view.ready,
        ready: view.ready, headline: view.headline, held: view.held,
        lines: trouble.map(line => ({ id: line.id, label: line.label, state: line.state, tone: line.tone, text: line.text })),
    };
}
