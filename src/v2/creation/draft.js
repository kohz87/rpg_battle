// RPG Battle v2, the creation wizard's starting draft (MODULES §F22): the persona's name, background and portrait, nothing
// else chosen. Read when the wizard opens (open.js's openCreation), and by the Start step itself when Story Block opened the
// wizard from the start card with an empty draft (wizard-widgets.js, widget rpg-battle.draft-start), so a persona switched
// since the card was drawn is the one used.

import { STATS } from '../../rules.js';
import { personaFor } from './persona.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The wizard's starting draft: the persona's name, background and avatar (MODULES §F22: never
 * typed in the wizard), no ready-made character, race or talents, every stat at 0 points.
 * `prefill` (a pack's ready-made character, or a draft being reopened) sets preset, race,
 * talents, points and portrait only.
 */
export function startDraft(view = null, { prefill = null, persona = null } = {}) {
    const who = persona ?? personaFor(view);
    const given = isRecord(prefill) ? prefill : {};
    const points = Object.fromEntries(STATS.map(stat => [stat, Number.isInteger(given.points?.[stat]) ? given.points[stat] : 0]));
    return {
        name: who.name,
        background: who.background,
        preset: typeof given.preset === 'string' ? given.preset : '',
        race: typeof given.race === 'string' ? given.race : '',
        talents: Array.isArray(given.talents) ? given.talents.filter(id => typeof id === 'string') : [],
        points,
        portrait: typeof given.portrait === 'string' && given.portrait.trim() ? given.portrait.trim() : who.avatar,
    };
}
