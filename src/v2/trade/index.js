// RPG Battle v2, trade part (MODULES §B4): selling, buying, commissions and collecting them.
//
// The `trade` domain keeps only what nothing else can work out again: the orders waiting with a
// crafter (their piece, numbers already set, the materials and fee already taken) and what was
// bought from each shop today. Stock and prices are worked out on demand from the place, the
// trader, the story day and v1's pricing (core.js); money and goods move only through Story
// Block's wallet and inventory commands (calls.js). Every trade is a command with a receipt
// whose summary the next reply tells; the tail only reminds the story of orders now ready.

import { PRICE_LEVELS } from '../../trade.js';
import { consume, grant, pay, receive, sceneOf } from './calls.js';
import { CODES, currencyFrom, makeWorld, marketOf, ordersOf, planBuy, planCollect, planCommission, planSell, settingsOf, stockOf, summaryOf, worldFromState } from './core.js';
import { renderTradePage } from './page.js';

const ORDER_ID = /^or_[0-9a-z]{8}$/;
const SHOP_KEY = /^[^|]*\|[a-z]+$/;
const DEF_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
// Orders listed in the tail at most; the rest are counted.
const TAIL_ORDERS = 4;

/** The trade slice of a new chat. */
export const initialTrade = () => ({ orders: {}, shops: {} });

// The world as a command sees it: the transaction's current state.
function worldFromCtx(ctx) {
    return makeWorld({
        scene: sceneOf({ query: ctx.query, read: ctx.read }),
        inventory: ctx.read('inventory'),
        trade: ctx.read('trade'),
        party: safeRead(ctx, 'party'),
        settings: settingsOf(ctx.settings?.()),
        now: ctx.time?.() ?? null,
        currency: currencyFrom(ctx.query),
    });
}

// A domain that may not be registered (RPG Battle's party part absent): null.
function safeRead(ctx, domain) {
    try {
        return ctx.read(domain) ?? null;
    } catch {
        return null;
    }
}

function must(ctx, plan) {
    if (!plan.ok) ctx.fail(plan.code, plan.message);
    return plan;
}

// An order's id from this receipt's (`rc_x` → `or_x`), so replaying the same receipt gives the
// same order; from the receipt's seed when it has none.
function orderId(ctx, orders) {
    const fromReceipt = /^rc_([0-9a-z]{8})$/.exec(String(ctx.receiptId ?? ''))?.[1];
    if (fromReceipt && !orders[`or_${fromReceipt}`]) return `or_${fromReceipt}`;
    for (;;) {
        let id = 'or_';
        for (let i = 0; i < 8; i++) id += Math.floor(ctx.rng() * 36).toString(36);
        if (!orders[id]) return id;
    }
}

const commands = {
    /** Sell { stack, qty } (and optionally { kind | who }: to whom; the general store when unsaid). */
    'trade.sell'(ctx, payload = {}) {
        const world = worldFromCtx(ctx);
        const plan = must(ctx, planSell(world, payload));
        consume(ctx, plan.stack, plan.qty);
        receive(ctx, plan.total);
        return {
            summary: summaryOf(world, plan.line),
            narrate: true,
            data: { kind: 'sell', def: plan.def, name: plan.name, qty: plan.qty, each: plan.each, total: plan.total, who: plan.who },
        };
    },

    /** Buy { shop, def, qty }: `shop` is trade.stock's key (or a trader kind), `def` the stock line's def id. */
    'trade.buy'(ctx, payload = {}) {
        const world = worldFromCtx(ctx);
        const plan = must(ctx, planBuy(world, payload));
        pay(ctx, plan.total);
        grant(ctx, plan.def, plan.qty);
        const trade = ctx.draft('trade');
        trade.shops ??= {};
        const kept = trade.shops[plan.shop];
        const bought = kept && kept.day === plan.day ? kept.bought : [];
        trade.shops[plan.shop] = { day: plan.day, bought: [...bought, plan.def.id] };
        return {
            summary: summaryOf(world, plan.line),
            narrate: true,
            data: { kind: 'buy', def: plan.def.id, name: plan.def.name, qty: plan.qty, each: plan.each, total: plan.total, who: plan.who, shop: plan.shop },
        };
    },

    /**
     * Commission { piece, materials: [{ stack, qty }], crafter }: the materials and the fee are
     * taken now; the piece waits with the crafter until their time (ready minutes) has come.
     */
    'craft.commission'(ctx, payload = {}) {
        const world = worldFromCtx(ctx);
        const plan = must(ctx, planCommission(world, payload));
        for (const part of plan.materials) consume(ctx, part.stack, part.qty);
        pay(ctx, plan.fee);
        const trade = ctx.draft('trade');
        trade.orders ??= {};
        const id = orderId(ctx, trade.orders);
        const piece = { id: `craft/${id.slice(3)}`, ...plan.piece };
        trade.orders[id] = {
            id, piece, materials: plan.materials.map(part => ({ def: part.def, qty: part.qty })), fee: plan.fee,
            ready: plan.ready, crafter: plan.crafter, place: plan.place,
        };
        return {
            summary: summaryOf(world, plan.line),
            narrate: true,
            data: { kind: 'commission', order: id, name: piece.name, fee: plan.fee, ready: plan.ready, span: plan.span, who: plan.crafter },
        };
    },

    /** Collect { order }: once (claim `order:<id>:collected`), when it is ready, at a market. */
    'craft.collect'(ctx, payload = {}) {
        const world = worldFromCtx(ctx);
        const id = String(payload.order ?? '');
        if (!ctx.claim(`order:${id}:collected`)) ctx.fail(CODES.claimed, 'That order has already been collected.');
        const plan = must(ctx, planCollect(world, { order: id }));
        grant(ctx, plan.piece, 1);
        delete ctx.draft('trade').orders[id];
        return {
            summary: summaryOf(world, plan.line),
            narrate: true,
            data: { kind: 'collect', order: id, name: plan.piece.name, who: plan.crafter },
        };
    },
};

// A query's settings and query tools: the host's third argument ({ query } per MODULES §F3, and
// the part's `settings` from src/v2/module.js), else what the args carry, else the defaults.
const envOf = (args, env) => ({ settings: env?.settings ?? args?.settings ?? null, query: env?.query ?? null });

const queries = {
    /** { open, by, place, tier, buy, sell, level, day } */
    'trade.market': (state, args = {}, env) => marketOf(worldFromState(state, envOf(args, env))),
    /** { shop, kind, day, open, items: [{ def, price, note }] } for `kind` (a trader kind or a name) */
    'trade.stock': (state, args = {}, env) => stockOf(worldFromState(state, envOf(args, env)), args.kind ?? 'general'),
    /**
     * What a trade would do, nothing saved: { type: 'sell' | 'buy' | 'commission' | 'collect',
     * …that command's payload } → the plan ({ ok, total | fee, ready, line, … }) or { ok: false, code, message }.
     */
    'trade.quote': (state, args = {}, env) => {
        const world = worldFromState(state, envOf(args, env));
        const plan = { sell: planSell, buy: planBuy, commission: planCommission, collect: planCollect }[args.type];
        return plan ? plan(world, args) : { ok: false, code: CODES.invalid, message: 'Say what to quote: sell, buy, commission or collect.' };
    },
    /** [{ id, piece, materials, fee, ready, crafter, place, due }], oldest first */
    'trade.orders': (state, args = {}, env) => ordersOf(worldFromState(state, envOf(args, env))),
};

const isPlain = value => value && typeof value === 'object' && !Array.isArray(value);

/** The trade slice's rules (SPEC §2.5): plain records, whole numbers, well-formed ids. */
export function validateTrade(slice) {
    const errors = [];
    if (!isPlain(slice)) return ['trade: not an object'];
    if (!isPlain(slice.orders)) errors.push('trade.orders: not a record');
    if (!isPlain(slice.shops)) errors.push('trade.shops: not a record');
    for (const [id, order] of Object.entries(isPlain(slice.orders) ? slice.orders : {})) {
        const at = `trade.orders.${id}`;
        if (!ORDER_ID.test(id) || order?.id !== id) errors.push(`${at}: id is not or_ and 8 letters or digits, or does not match its key`);
        if (!isPlain(order?.piece) || !String(order.piece.name ?? '').trim()) errors.push(`${at}.piece: needs a name`);
        else if (!DEF_ID.test(String(order.piece.id ?? ''))) errors.push(`${at}.piece.id: not a namespaced def id`);
        if (!Array.isArray(order?.materials) || order.materials.some(part => typeof part?.def !== 'string' || !Number.isInteger(part?.qty) || part.qty < 1)) errors.push(`${at}.materials: each needs a def and a whole qty of at least 1`);
        if (!Number.isInteger(order?.fee) || order.fee < 0) errors.push(`${at}.fee: not a whole amount of at least 0`);
        if (order?.ready !== null && (!Number.isInteger(order?.ready) || order.ready < 0)) errors.push(`${at}.ready: not whole minutes or null`);
        if (typeof order?.crafter !== 'string' || typeof order?.place !== 'string') errors.push(`${at}: crafter and place must be text`);
    }
    for (const [key, shop] of Object.entries(isPlain(slice.shops) ? slice.shops : {})) {
        const at = `trade.shops.${key}`;
        if (!SHOP_KEY.test(key)) errors.push(`${at}: not a place|kind key`);
        if (shop?.day !== null && (!Number.isInteger(shop?.day) || shop.day < 0)) errors.push(`${at}.day: not a whole day or null`);
        if (!Array.isArray(shop?.bought) || shop.bought.some(def => typeof def !== 'string')) errors.push(`${at}.bought: not a list of def ids`);
    }
    return errors;
}

/** The tail: orders ready to collect, one line (budget ~100 tokens). */
export function tradeTail(view) {
    const world = worldFromState(view?.state, { settings: view?.settings, query: view?.query ?? null });
    const ready = ordersOf(world).filter(order => order.due);
    if (!ready.length) return { lines: [], optional: [] };
    const named = ready.slice(0, TAIL_ORDERS).map(order => `${order.piece?.name ?? 'a piece'}${order.crafter ? ` (${order.crafter}${order.place ? `, ${order.place}` : ''})` : ''}`);
    const more = ready.length > TAIL_ORDERS ? `, and ${ready.length - TAIL_ORDERS} more` : '';
    return { lines: [`[Trade] Ready to collect at a market: ${named.join('; ')}${more}.`], optional: [] };
}

export const part = {
    domains: {
        trade: { initial: initialTrade, validate: validateTrade },
    },
    commands,
    queries,
    kinds: {},
    context: { static: () => '', tail: tradeTail, budget: 100 },
    hooks: {},
    settings: {
        section: 'Trade',
        // (v1 0.5.46) The reader's word for a place's prices; a place not listed reads by its name.
        defaults: { placePrices: [] },
        schema: {
            placePrices: {
                type: 'list',
                label: 'Prices by place',
                help: 'A place listed here trades at your word for it (cheap, fair or dear) and always has a market. Others read their prices from their name: a village pays less than a city.',
                of: {
                    place: { type: 'text', label: 'Place', max: 80 },
                    level: { type: 'choice', label: 'Prices', options: [...PRICE_LEVELS] },
                },
            },
        },
    },
    tabs: [
        { id: 'trade', title: 'Trade', icon: 'fa-scale-balanced', render: (el, view, api) => renderTradePage(el, view, api) },
    ],
};
