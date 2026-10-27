// RPG Battle v2, the `trainer` change line (RB open trainers §4.1, §4.2):
//
//   + trainer <Name>[ — <what they teach>] | like: <open trainer template>[ | teaches: <skill>, <skill>…]
//
// RB owns the kind. It is enabled only while the chat pins rules whose ruleset has at least one trainer template (`when`), so a chat without
// templates keeps its prompt byte for byte. The narrator proposes a name, a template and at most a narrower list of skills; code checks
// the template, rolls the fee inside its range, binds the trainer to the place the party is in and records all of it (opening.js).

import { indexOfCtx } from '../rules/graph.js';
import { isRecordId } from '../rules/ids.js';
import { ask } from '../quests/seams.js';
import { nameKey } from './trainers.js';
import { commitTrainer, liveTrainer, teachesOf } from './opening.js';

const SHAPE = '+ trainer Name — what they teach | like: <template> [| teaches: <skill>, <skill>]';
const CLOSING = 'Code fixes the fee and the place.';
export const TRAINER_GRAMMAR = `${SHAPE}. ${CLOSING}`;
/** How many template names the line lists before "and N more". */
export const LISTED_TEMPLATES = 8;

/** The line shown to the narrator for a ruleset's templates (slugs in the pack's order). One line, the same on every reply of a chat. */
export function trainerGrammar(templates) {
    const slugs = (templates ?? []).map(entry => String(entry.id).split('/')[1]).filter(Boolean);
    if (!slugs.length) return TRAINER_GRAMMAR;
    const more = slugs.length - LISTED_TEMPLATES;
    return `${SHAPE} (templates: ${slugs.slice(0, LISTED_TEMPLATES).join(', ')}${more > 0 ? ` and ${more} more` : ''}). ${CLOSING}`;
}

/** The kind's `grammarFor(settings, query)`: the templates of the pinned ruleset, through the part's own query. */
export function trainerGrammarFor(_settings, query) {
    return trainerGrammar(typeof query === 'function' ? query('training.openTemplates', {}) : []);
}

/** The kind's `when(query)`: the chat pins rules and the ruleset has a template. A host that cannot answer gives false. */
export function trainerKindOn(query) {
    try {
        const found = query('training.openTemplates', {});
        return Array.isArray(found) && found.length > 0;
    } catch {
        return false;
    }
}

/** What a refused line says: a Problem on the reply, nothing written. */
const refused = (code, message) => ({ summary: `Trainer refused: ${message}`, problem: `Trainer refused: ${message}`, narrate: false, data: { code, message, refused: true } });
const quiet = message => ({ summary: message, narrate: false, data: { trainer: null, held: true } });

/**
 * What is read once while the block is planned and kept with it (a replay never asks Story Director or Delta): where the party is, and
 * (`readNpc`, asked last, only for an offer that is going to be made) the NPC record Delta keeps for the name.
 */
export function evidenceOf(ctx, present) {
    const here = ask(ctx.query, 'atlas.canonical', {});
    return { place: typeof here?.id === 'string' && here.id ? here.id : null, where: typeof here?.name === 'string' ? here.name : '', present };
}
export const npcReader = (ctx, name) => () => {
    const identity = ask(ctx.query, 'npc.identity', { name });
    return isRecordId(identity?.id) && nameKey(identity?.name) === nameKey(name) ? identity.id : null;
};

/** Checks 1 to 14 of RB open trainers §4.2, in that order. */
export function createTrainerCapture() {
    return function capture(ctx, line) {
        if (line.op !== '+') return refused('INVALID', 'Trainer lines only offer one: + trainer Name | like: <template>.');
        const ix = indexOfCtx(ctx);
        if (!ix) return ctx.fail('RULES_MISMATCH', 'This chat does not run a rules pack.');
        const labels = line.labels ?? {};
        const name = String(line.name ?? '').trim();
        if (!Object.hasOwn(labels, 'like')) {
            if (ix.trainers.some(entry => nameKey(entry.name) === nameKey(name))) return quiet(`${name} is a trainer of this world.`);
            return refused('INVALID', 'An open trainer needs | like: <template>.');
        }
        if (Object.keys(labels).some(key => key !== 'like' && key !== 'teaches')) return refused('INVALID', 'An open trainer cannot supply a fee, a place or other fields.');
        const entries = Object.hasOwn(labels, 'teaches') ? teachesOf(labels.teaches) : null;
        const binding = { template: String(labels.like ?? '').trim(), name, text: String(line.text ?? '').trim(), skills: entries };
        const plan = liveTrainer(ctx, ix, binding, 'story', evidenceOf(ctx, null), npcReader(ctx, name));
        if (!plan.ok) return refused(plan.code, plan.message);
        if (plan.noop) return quiet(plan.message);
        return commitTrainer(ctx, plan, binding, 'story');
    };
}
