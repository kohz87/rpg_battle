// The invariant checks the fuzz test applies after every step (see fuzz.test.js). Pure.

import { createHash } from 'node:crypto';
import { bytes, holdings } from './harness.js';

export const hash = state => createHash('sha256').update(bytes(state)).digest('hex');

/** Every number under `value` that is not a whole number of at least 0: [path, value]. */
export function badNumbers(value, path = '', out = []) {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0) out.push([path, value]);
    } else if (Array.isArray(value)) value.forEach((item, i) => badNumbers(item, `${path}/${i}`, out));
    else if (value && typeof value === 'object') for (const key of Object.keys(value)) badNumbers(value[key], `${path}/${key}`, out);
    return out;
}

export function committedNumbers(state) {
    const { inventory, party, trade, combat, bestiary } = state.domains;
    const out = [];
    badNumbers(inventory, '/inventory', out);
    badNumbers(party, '/party', out);
    badNumbers(trade, '/trade', out);
    badNumbers(combat.offers, '/combat/offers', out);
    badNumbers(combat.beaten, '/combat/beaten', out);
    badNumbers(combat.session?.actions ?? [], '/combat/session/actions', out);
    for (const [id, fight] of Object.entries(combat.fights ?? {})) badNumbers(fight?.actions ?? [], `/combat/fights/${id}/actions`, out);
    for (const [key, entry] of Object.entries(bestiary.creatures)) badNumbers({ level: entry.level, rev: entry.rev }, `/bestiary/${key}`, out);
    // Anything at all that is not a finite number (the bus's own rule, checked again here).
    const walk = (value, path) => {
        if (typeof value === 'number' && !Number.isFinite(value)) out.push([path, value]);
        else if (value && typeof value === 'object') for (const key of Object.keys(value)) walk(value[key], `${path}/${key}`);
    };
    walk(state, '');
    return out;
}

export function delta(before, after) {
    const a = holdings(before);
    const b = holdings(after);
    const goods = {};
    for (const def of new Set([...Object.keys(a.goods), ...Object.keys(b.goods)])) {
        const d = (b.goods[def] ?? 0) - (a.goods[def] ?? 0);
        if (d) goods[def] = d;
    }
    return { goods, money: b.money - a.money };
}

const nameOf = (state, def) => state.domains.inventory.defs[def]?.name;

/** What a committed receipt may do to goods and money; '' when it did just that, else why not. */
export function conservationProblem({ type, payload, result, before, after }) {
    const { receipt } = result;
    const data = receipt.data ?? {};
    const d = delta(before, after);
    const goods = Object.entries(d.goods);
    const none = !goods.length && d.money === 0;
    const say = what => `${type}: ${what} (goods ${JSON.stringify(d.goods)}, money ${d.money}, data ${JSON.stringify(data).slice(0, 300)})`;
    switch (type) {
        case 'trade.sell':
            return goods.length === 1 && d.goods[data.def] === -data.qty && d.money === data.total ? '' : say('a sale must swap qty for exactly its total');
        case 'trade.buy':
            return goods.length === 1 && d.goods[data.def] === data.qty && d.money === -data.total ? '' : say('a purchase must swap its total for exactly qty');
        case 'craft.commission':
            return goods.every(([, n]) => n < 0) && d.money === -data.fee ? '' : say('a commission takes materials and exactly the fee');
        case 'craft.collect':
            return goods.length === 1 && goods[0][1] === 1 && d.money === 0 ? '' : say('collecting gives exactly one piece');
        case 'item.use':
            return goods.length === 1 && goods[0][1] === -1 && d.money === 0 ? '' : say('a use takes exactly one dose');
        case 'combat.act':
        case 'combat.flee': {
            // A draught drunk or a flask thrown leaves the inventory at use: exactly what `used` lists.
            const used = (data.used ?? []).reduce((sum, entry) => sum + entry.qty, 0);
            const lost = goods.reduce((sum, [, n]) => sum + n, 0);
            return d.money === 0 && goods.every(([, n]) => n < 0) && -lost === used ? '' : say('a fight action takes out exactly the consumables it used');
        }
        case 'combat.end': {
            if (d.money !== (data.loot?.money ?? 0)) return say('money must change by exactly the loot money');
            // What was used in the fight left the inventory at use (combat.act): the end takes nothing.
            if (goods.some(([, n]) => n < 0)) return say('the end of a fight takes nothing out');
            const loot = Object.fromEntries((data.loot?.items ?? []).map(item => [item.name, item.qty]));
            for (const [def, n] of goods) {
                const name = nameOf(after, def) ?? nameOf(before, def);
                if (n > 0 && loot[name] === undefined) return say(`${name} appeared without being loot`);
            }
            for (const [name, qty] of Object.entries(loot)) {
                const gained = goods.filter(([def]) => (nameOf(after, def) ?? nameOf(before, def)) === name).reduce((sum, [, n]) => sum + n, 0);
                if (gained > qty) return say(`${name}: more than the loot`);
            }
            return '';
        }
        case 'capture.coin':
        case 'wallet.pay':
        case 'wallet.receive': {
            const sign = type === 'wallet.pay' || (type === 'capture.coin' && payload?.op === '-') ? -1 : 1;
            return !goods.length && Math.abs(d.money) === data.amount && Math.sign(d.money) === sign ? '' : say('a coin change must move exactly its amount');
        }
        case 'capture.item': {
            // A money-named item ("+ item Gold Coins") is the story's coin (Story Block MODULES §F108): it moves
            // exactly its amount, as a coin line does, and no goods. Any other item line moves no money.
            if (Number.isInteger(data?.amount) && data?.owner !== undefined && data?.now !== undefined) {
                const sign = payload?.op === '-' ? -1 : 1;
                return !goods.length && Math.abs(d.money) === data.amount && (data.amount === 0 || Math.sign(d.money) === sign) ? '' : say('a money-named item must move exactly its amount');
            }
            return d.money === 0 ? '' : say('an item line moves no money');
        }
        default:
            return none ? '' : say('this command must not create or remove goods or money');
    }
}

export function newStacksWithoutCause({ result, before, after }) {
    const out = [];
    for (const [id, stack] of Object.entries(after.domains.inventory.stacks)) {
        if (!before.domains.inventory.stacks[id] && stack.from !== result.receipt.id) out.push(`${id} from "${stack.from}" (receipt ${result.receipt.id})`);
    }
    return out;
}
