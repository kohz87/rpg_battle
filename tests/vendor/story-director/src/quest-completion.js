// Measurable quest terms, progress and settlement allocations. Pure; data comes from
// the existing providers, never from a generated completion sentence.

export const QUEST_CONTRACT_VERSION = 1;
const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const PLURALS = { wolves: 'wolf', knives: 'knife', leaves: 'leaf', mice: 'mouse', geese: 'goose' };

export function entityKey(value) {
    const words = clean(value).toLowerCase().split(' ');
    const last = words.at(-1) ?? '';
    words[words.length - 1] = PLURALS[last] ?? (last.endsWith('ies') ? `${last.slice(0, -3)}y`
        : /(?:ches|shes|xes|zes)$/.test(last) ? last.slice(0, -2)
            : /[^s]s$/.test(last) && !/(?:ss|us|is)$/.test(last) ? last.slice(0, -1) : last);
    return words.join(' ');
}

export function requirementOf(fields = {}, extra = {}) {
    const explicit = clean(fields.target ?? extra.target);
    const source = explicit || clean(fields.goal || fields.desc).replace(/[.!]$/, '');
    const match = /^(defeat|possess|deliver)\s+(?:at least\s+)?(\d+)\s+(.+)$/i.exec(source);
    if (!match) return explicit ? { managed: true, error: 'Unsupported target; use defeat, possess or deliver with a count.' } : { managed: false };
    const qty = Number(match[2]);
    const entity = clean(match[3]);
    if (!Number.isSafeInteger(qty) || qty < 1 || /\d|\b(?:and|or|then|until|each|per|at least)\b|[|;<>]/i.test(entity)) {
        return { managed: true, error: 'The target must name one entity and one positive whole count.' };
    }
    return { managed: true, action: match[1].toLowerCase(), qty, entity, key: entityKey(entity) };
}

export function rewardOf(text, requirement, currency, parseCoins) {
    const source = clean(text);
    if (/^none$/i.test(source)) return { kind: 'none', rate: 0, label: 'No coin reward' };
    if (!source) return { error: 'Reward unknown; use a coin amount or reward: none.' };
    const match = /^(\d+\s+[\p{L}][\p{L} -]*?)(?:\s+(?:per|each)\s+(.+))?$/iu.exec(source);
    if (!match || typeof parseCoins !== 'function') return { error: 'Unsupported reward or currency provider unavailable.' };
    const rate = parseCoins(match[1], currency);
    if (!Number.isSafeInteger(rate) || rate < 1) return { error: 'Reward must be a supported positive whole coin amount.' };
    const unit = match[2] ? entityKey(match[2]) : '';
    if (unit && (unit !== requirement.key || requirement.action === 'possess')) return { error: 'Per-unit reward does not match the target.' };
    return { kind: unit ? 'per-unit' : 'fixed', rate, label: source };
}

export function acceptedContract(record, context) {
    const requirement = requirementOf(record.fields, record.extra);
    if (!requirement.managed) return null;
    return {
        version: QUEST_CONTRACT_VERSION,
        id: context?.owner ? `${context.owner}:${record.id}` : null,
        requirement,
        rewardText: clean(record.fields?.reward),
        currency: context?.currency ? structuredClone(context.currency) : null,
        cursor: context?.cursor ? structuredClone(context.cursor) : null,
        owner: context?.owner ?? null,
        giver: clean(record.fields?.giver),
        issuer: clean(record.offeredAt || context?.place),
    };
}

export function evaluateQuest({ record, inventory, evidence, claims = [], presence, busy = false, parseCoins, formatCoins }) {
    const contract = record?.contract;
    const requirement = contract?.requirement ?? requirementOf(record?.fields, record?.extra);
    if (!requirement.managed) return { managed: false };
    const result = { managed: true, eligible: false, availability: 'unavailable', required: requirement.qty ?? null, observed: null, claimable: null, claims: [], payment: null, consume: null, reason: '' };
    const stop = reason => ({ ...result, reason });
    if (!contract?.id || contract.version !== QUEST_CONTRACT_VERSION) return stop('Acceptance history unavailable.');
    if (requirement.error) return stop(requirement.error);
    if (!contract.currency) return stop('Accepted currency unavailable.');
    const reward = rewardOf(contract.rewardText, requirement, contract.currency, parseCoins);
    if (reward.error) return stop(reward.error);
    if (!inventory || inventory.availability !== 'available') return stop('Inventory unavailable.');
    if (inventory.validMoney === false) return stop('Purse quantity is invalid.');
    if (JSON.stringify(inventory.currency) !== JSON.stringify(contract.currency)) return stop('Currency changed since acceptance.');
    if (requirement.action === 'defeat') {
        if (evidence?.availability !== 'available') return stop('Battle history unavailable.');
        const all = (evidence.events ?? []).flatMap(event => event.defeated ?? []).filter(enemy => entityKey(enemy.name) === requirement.key);
        const claimed = new Set(claims);
        const available = all.filter(enemy => !claimed.has(enemy.id));
        result.observed = all.length;
        result.claimable = available.length;
        result.claims = available.slice(0, reward.kind === 'per-unit' ? available.length : requirement.qty).map(enemy => enemy.id);
    } else {
        const items = (inventory.items ?? []).filter(item => entityKey(item.name) === requirement.key);
        if (items.some(item => !Number.isSafeInteger(item.qty) || item.qty < 0)) return stop('Item quantity is invalid.');
        result.observed = result.claimable = items.reduce((sum, item) => sum + item.qty, 0);
        if (!Number.isSafeInteger(result.observed)) return stop('Item quantity is too large.');
        if (requirement.action === 'deliver') result.consume = { names: [...new Set(items.map(item => item.name))], qty: requirement.qty };
    }
    result.availability = 'available';
    const units = requirement.action === 'defeat' ? result.claims.length : requirement.qty;
    result.payment = reward.rate * (reward.kind === 'per-unit' ? units : 1);
    if (!Number.isSafeInteger(result.payment) || result.payment < 0) return stop('Reward is too large.');
    result.label = `${requirement.entity} ${result.claimable}/${requirement.qty}`;
    result.paymentText = formatCoins?.(result.payment, contract.currency) ?? `${result.payment}`;
    result.revisions = { inventory: inventory.revision, evidence: evidence?.revision ?? '', award: inventory.rewardRevision ?? '', contract: JSON.stringify(contract) };
    if (record.status !== 'active' || record.settlement) return stop('This quest has already ended.');
    if (result.claimable < requirement.qty) return stop(`Need ${requirement.qty - result.claimable} more ${requirement.entity}.`);
    if (!presence?.here) return stop(presence?.reason || 'Turn-in availability unknown.');
    if (busy) return stop('Wait for the current reply, battle or settlement.');
    return { ...result, eligible: true, reason: '' };
}

export function settlementPlan(record, evaluation, id) {
    if (!evaluation.eligible) throw new Error(evaluation.reason || 'Quest is not ready.');
    return {
        version: QUEST_CONTRACT_VERSION, id, quest: record.contract.id, record: record.id, name: record.key,
        contract: structuredClone(record.contract), claims: [...evaluation.claims],
        payment: evaluation.payment, paymentText: evaluation.paymentText,
        consume: evaluation.consume ? { ...evaluation.consume } : null,
        revisions: { ...evaluation.revisions },
    };
}

export function turnInInstruction(plan) {
    const goods = plan.consume ? ` Remove exactly ${plan.consume.qty} ${plan.contract.requirement.entity} from the player's Inventory.` : '';
    return `Verified turn-in: ${plan.name}. ${plan.claims.length ? `${plan.claims.length} qualifying defeats. ` : ''}Pay exactly ${plan.paymentText}.${goods} Narrate the turn-in and write "- ${plan.name} — completed". Code records this payment once; do not invent additional rewards.`;
}
