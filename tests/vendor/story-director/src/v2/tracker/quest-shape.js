// The closed cross-owner Quest shape (phase 0 §4). SD validates transport, never RPG calculations.
export const recordId = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
export const defId = value => typeof value === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value);
export const id = value => recordId(value) || defId(value);
export const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const count = value => Number.isSafeInteger(value) && value >= 0;
export const minute = value => value === null || Number.isSafeInteger(value);
export const text = (value, max, nonempty = false) => typeof value === 'string' && [...value].length <= max
    && (!nonempty || value.trim().length > 0) && !/[\p{Cc}<>]/u.test(value);
export const closed = (value, required, optional = []) => map(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => [...required, ...optional].includes(key));
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const small = (value, max) => count(value) && value >= 1 && value <= max;
export const source = value => closed(value, ['sid', 'swipeKey', 'evidence', 'ordinal'])
    && ['sid', 'swipeKey', 'evidence'].every(key => recordId(value[key])) && count(value.ordinal) && value.ordinal <= 1000000;
export const cursor = value => closed(value, ['sid', 'swipeKey', 'block', 'op', 'rev'])
    && ['sid', 'swipeKey', 'block'].every(key => recordId(value[key])) && count(value.op) && count(value.rev);
const refs = list => Array.isArray(list) && list.length > 0 && list.every(defId);
const stats = ['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'];
function requirement(value) {
    const shape = {
        class: [ ['kind', 'classes'], () => refs(value.classes) && value.classes.length <= 40 ],
        flag: [ ['kind', 'key', 'value'], () => text(value.key, 80, true) && typeof value.value === 'boolean' ],
        level: [ ['kind', 'min'], () => small(value.min, 99) ],
        stat: [ ['kind', 'stat', 'min'], () => stats.includes(value.stat) && small(value.min, 99) ],
        quest: [ ['kind', 'template'], () => defId(value.template) ],
        item: [ ['kind', 'def', 'qty'], () => defId(value.def) && small(value.qty, 999) ],
        place: [ ['kind', 'place'], () => id(value.place) ],
        thread: [ ['kind', 'thread'], () => id(value.thread) ],
    }[value?.kind];
    return !!shape && closed(value, shape[0]) && shape[1]();
}
function objective(value) {
    const shape = {
        kill: [ ['id', 'kind', 'foe', 'count'], () => defId(value.foe) && small(value.count, 999) ],
        collect: [ ['id', 'kind', 'def', 'count', 'consume'], () => defId(value.def) && small(value.count, 999) && typeof value.consume === 'boolean' ],
        visit: [ ['id', 'kind', 'place'], () => id(value.place) ],
        story: [ ['id', 'kind', 'text'], () => text(value.text, 240) ],
    }[value?.kind];
    return !!shape && closed(value, shape[0]) && id(value.id) && shape[1]();
}
const items = value => Array.isArray(value) && value.length <= 8 && value.every(row => closed(row, ['def', 'qty']) && defId(row.def) && small(row.qty, 999));
const outcomes = ['done', 'failed', 'expired', 'abandoned'];
export function validQuest(q) {
    return closed(q, ['id', 'template', 'instance', 'title', 'category', 'giver', 'turnInPlace', 'requirements', 'objectives', 'evidence', 'reward', 'storyCredit', 'acceptedAt', 'acceptedCursor', 'deadline', 'repeat', 'chain', 'state', 'settlement'])
        && recordId(q.id) && defId(q.template) && small(q.instance, 1000000) && text(q.title, 80, true)
        && ['main', 'side', 'bounty'].includes(q.category) && (q.giver === null || id(q.giver)) && (q.turnInPlace === null || id(q.turnInPlace))
        && Array.isArray(q.requirements) && q.requirements.length <= 16 && q.requirements.every(requirement)
        && Array.isArray(q.objectives) && q.objectives.length >= 1 && q.objectives.length <= 8 && q.objectives.every(objective)
        && new Set(q.objectives.map(o => o.id)).size === q.objectives.length
        && map(q.evidence) && Object.entries(q.evidence).every(([key, v]) => recordId(key) && closed(v, ['objective', 'proof', 'amount'])
            && q.objectives.some(o => o.id === v.objective) && recordId(v.proof) && count(v.amount) && v.amount <= 999)
        && closed(q.reward, ['coin', 'xp', 'items']) && count(q.reward.coin) && count(q.reward.xp) && items(q.reward.items)
        && closed(q.storyCredit, ['coin', 'claims']) && count(q.storyCredit.coin) && Array.isArray(q.storyCredit.claims) && q.storyCredit.claims.every(v => typeof v === 'string')
        && minute(q.acceptedAt) && (q.acceptedCursor === null || cursor(q.acceptedCursor)) && minute(q.deadline)
        && (q.repeat === null || closed(q.repeat, ['cooldownMinutes', 'nextOfferAt']) && count(q.repeat.cooldownMinutes) && q.repeat.cooldownMinutes <= 525600 && minute(q.repeat.nextOfferAt))
        && (q.chain === null || closed(q.chain, ['previous', 'next']) && [q.chain.previous, q.chain.next].every(v => v === null || defId(v)))
        && ['offered', 'active', ...outcomes].includes(q.state)
        && (q.settlement === null ? !outcomes.includes(q.state) : closed(q.settlement, ['id', 'source', 'outcome', 'coinPaid', 'xpPaid', 'itemsPaid', 'claim'])
            && recordId(q.settlement.id) && source(q.settlement.source) && outcomes.includes(q.settlement.outcome) && q.state === q.settlement.outcome
            && count(q.settlement.coinPaid) && count(q.settlement.xpPaid) && items(q.settlement.itemsPaid) && typeof q.settlement.claim === 'string');
}
