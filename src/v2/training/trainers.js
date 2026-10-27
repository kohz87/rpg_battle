// RPG Battle v2, who a character can be trained by (RB open trainers §7): a trainer of the pack (a fixed one), or an open trainer
// the story or the reader offered, recorded in the `training` domain's `offers` (domain.js). Every place that resolves a trainer asks
// `trainerOf` with the state's training slice and keeps its own checks word for word. Pure.

import { isDefId, isTrainerOfferId } from '../rules/ids.js';

/** The key two names of the same person share: NFKC, trimmed, inner whitespace folded to one space, lower case. */
export const nameKey = name => String(name ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

/** A recorded offer in the shape of a trainer: { id, name, place, skills, fee, minutes, eventTemplates, open: true, template, where }. */
export const offerTrainer = offer => ({
    id: offer.id, name: offer.name, place: offer.place, skills: offer.skills, fee: offer.fee, minutes: offer.minutes,
    eventTemplates: offer.eventTemplates, open: true, template: offer.template, where: offer.where,
});

/**
 * The trainer a ref names: a pack trainer (never a template), else a live open-trainer offer of `training`, else null.
 * `ix`: the pinned index (rules/graph.js); `training`: the training slice (it may be absent).
 */
export function trainerOf(ix, training, ref) {
    if (isDefId(ref)) return ix.trainer(ref);
    const offer = isTrainerOfferId(ref) && Object.hasOwn(training?.offers ?? {}, ref) ? training.offers[ref] : null;
    return offer ? offerTrainer(offer) : null;
}

/** The live offers, sorted by where, then name, then id (the order the screens and `training.trainers` list them in). */
export function offersOf(training) {
    const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return Object.values(training?.offers ?? {}).sort((a, b) => text(a.where, b.where) || text(a.name, b.name) || text(a.id, b.id));
}
