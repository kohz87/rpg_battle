// Pure construction of the shared Quest extension. SD assigns its outer thread stamps and journal.
import { copy } from './seams.js';

export function offeredQuest(template, id, { instance = 1, nextOfferAt = null } = {}) {
    return { id, template: template.id, instance, title: template.name, category: template.category,
        giver: template.giver, turnInPlace: template.turnInPlace, requirements: copy(template.requirements),
        // The bounds on a count (Story Block 2.5.0) are the pack's: the quest is Story Director's closed shape, which has no place for them.
        objectives: copy(template.objectives).map(({ countMin: _min, countMax: _max, ...objective }) => objective),
        evidence: {}, reward: copy(template.reward), storyCredit: { coin: 0, claims: [] }, acceptedAt: null, acceptedCursor: null,
        deadline: null, repeat: template.repeat ? { cooldownMinutes: template.repeat.cooldownMinutes, nextOfferAt } : null,
        chain: copy(template.chain), state: 'offered', settlement: null };
}

/** No terminal minute is guessed. Repeat cooldowns are anchored to this settlement boundary. */
export function terminalQuest(quest, { outcome, id, source, epoch, minute, payout }) {
    if (!['done', 'failed', 'expired', 'abandoned'].includes(outcome)) return { ok: false, code: 'INVALID', message: 'Unknown quest outcome.' };
    if (quest.repeat && !Number.isSafeInteger(minute)) return { ok: false, code: 'CLOCK_UNSET', message: 'A repeat cooldown needs the terminal story minute.' };
    const next = copy(quest);
    next.state = outcome;
    if (next.repeat) {
        const due = minute + next.repeat.cooldownMinutes;
        if (!Number.isSafeInteger(due)) return { ok: false, code: 'INVALID', message: 'The repeat cooldown overflowed.' };
        next.repeat.nextOfferAt = due;
    }
    const paid = outcome === 'done' ? payout : { coin: 0, xp: 0, items: [] };
    next.settlement = { id, source: copy(source), outcome, coinPaid: paid.coin, xpPaid: paid.xp,
        itemsPaid: copy(paid.items), claim: `rb:${epoch}:quest:${quest.id}:${quest.instance}:settled` };
    return { ok: true, quest: next };
}

export function nextOffers(quest, outcome, terminalMinute, templates) {
    const out = [];
    if (quest.repeat) {
        const template = templates.find(t => t.id === quest.template);
        if (template) out.push({ template, instance: quest.instance + 1, nextOfferAt: terminalMinute + quest.repeat.cooldownMinutes });
    }
    if (outcome === 'done' && quest.chain?.next) {
        const template = templates.find(t => t.id === quest.chain.next);
        if (template) out.push({ template, instance: 1, nextOfferAt: null });
    }
    return out;
}
