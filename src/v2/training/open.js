// RPG Battle v2, `trainer.open { name, template, text?, skills? }` (RB open trainers §4.3): the reader's "Make this a trainer", the twin of
// `quest.open`. A click, never the story's and never a nested call; the name is someone the scene lists as present; the offer is the one
// the `+ trainer` line makes (checks 5 to 13 of §4.2), with `by: 'reader'` and a guard that is not reply-bound.

import { indexOfCtx } from '../rules/graph.js';
import { isObject, isDefId } from '../rules/ids.js';
import { ask } from '../quests/seams.js';
import { TEXT_MAX } from './domain.js';
import { nameKey } from './trainers.js';
import { commitTrainer, liveTrainer } from './opening.js';
import { evidenceOf, npcReader } from './capture.js';

const FIELDS = ['name', 'template', 'text', 'skills'];

function trainerOpen(ctx, payload) {
    if (ctx.cause !== 'ui' || ctx.caller) ctx.fail('REFUSED', 'Make this a trainer is a reader action.');
    if (!isObject(payload)) ctx.fail('INVALID', 'trainer.open needs { name, template, text?, skills? }.');
    const extra = Object.keys(payload).find(key => !FIELDS.includes(key));
    if (extra) ctx.fail('INVALID', `trainer.open does not take "${extra}".`);
    if (typeof payload.name !== 'string' || !payload.name.trim() || typeof payload.template !== 'string' || !payload.template.trim()) ctx.fail('INVALID', 'trainer.open needs the name of someone present and a template.');
    if (payload.text !== undefined && (typeof payload.text !== 'string' || [...payload.text].length > TEXT_MAX)) ctx.fail('INVALID', `What they teach is text of at most ${TEXT_MAX} characters.`);
    if (payload.skills !== undefined && (!Array.isArray(payload.skills) || payload.skills.length < 1 || payload.skills.length > 30 || !payload.skills.every(isDefId))) ctx.fail('INVALID', 'The skills to teach are 1 to 30 skill refs, or left out.');
    const ix = indexOfCtx(ctx);
    if (!ix) ctx.fail('REFUSED', 'This chat does not run a rules pack.');
    const wanted = nameKey(payload.name);
    const present = ask(ctx.query, 'scene.present', {});
    const picked = Array.isArray(present) ? present.find(person => typeof person === 'string' && nameKey(person) === wanted) : undefined;
    if (picked === undefined) ctx.fail('NOT_FOUND', `${payload.name.trim()} is not here.`);
    const binding = { template: payload.template.trim(), name: picked, text: (payload.text ?? '').trim(), skills: payload.skills ?? null };
    const plan = liveTrainer(ctx, ix, binding, 'reader', evidenceOf(ctx, true), npcReader(ctx, picked));
    if (!plan.ok) ctx.fail(plan.code, plan.message);
    if (plan.noop) ctx.fail('REFUSED', plan.message);
    return commitTrainer(ctx, plan, binding, 'reader');
}

export const commands = { 'trainer.open': trainerOpen };
