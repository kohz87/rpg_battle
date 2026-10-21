// RPG Battle v2, part **screens**: the view queries the default screens read (SPEC §13.1 `data`).
//
// A template has no arithmetic and no way to filter or group a list (TEMPLATES.md §1.2), so what a
// screen shows that is not a plain field of the state is worked out here, once per drawing: an
// actor's EXP to the next level, their condition badges, skills grouped by tier for ss.skill-tree,
// stats as radar axes, the rows of the Items and Trade pages with their short prices and the people
// each thing can go to. Packs and cards that restyle a screen can bind the same queries.
//
// Every query is `(state, args, tools)` (MODULES §F3) and returns plain copies. The other parts are
// read only through their queries (`tools.query('party.actors')`, `trade.*`, `inventory.*`) or as
// plain state, with v1's pure rules for the numbers (src/*.js); nothing here changes anything. Pure and deterministic: the same state and settings
// give the same rows in the same order.

import { DEFAULT_RULES, STATS, checkModifier, makeRules, statCap, xpToNext } from '../../rules.js';
import { DEFAULT_SKILLS, findSkill } from '../../skills.js';
import { useItemOutside } from '../../recovery.js';
import { maxLevel } from '../../terms.js';
import { isMaterial } from '../../trade.js';

export const MODULE_ID = 'rpg-battle';

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const int = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback);
const capital = text => String(text ?? '').replace(/^\s*\p{L}/u, letter => letter.toUpperCase()).trim();

export const STAT_NAMES = Object.freeze({
    STR: 'Strength', VIT: 'Vitality', AGI: 'Agility', DEX: 'Dexterity', INT: 'Intelligence', LUK: 'Luck', CHA: 'Charisma',
});

// ---------------------------------------------------------------------------------------------------
// Settings and the other parts' queries

/**
 * RPG Battle's settings: given in `args.settings`, else the host's (`sdk.settings('rpg-battle')`, flat,
 * each part's keys under its part id: `party.xpBase`, src/v2/module.js), else what the query's tools
 * carry, else none.
 */
export function settingsFor(args, tools = null) {
    if (isRecord(args?.settings)) return args.settings;
    try {
        const sdk = globalThis.StoryBlock?.sdk;
        const found = typeof sdk?.settings === 'function' ? sdk.settings(MODULE_ID) : null;
        if (isRecord(found)) return found;
    } catch {
        // No host: the tools' settings, if any.
    }
    return isRecord(tools?.settings) ? tools.settings : {};
}

/**
 * v1's rules with the reader's 'Character' settings that change what these screens show (the party
 * part's keys, read as `party.<key>` in the module's settings or bare), and a rules file's own
 * `rules` and `terms` (module-wide keys).
 */
export function rulesFor(settings = {}) {
    const s = isRecord(settings) ? settings : {};
    const own = isRecord(s.rules) ? s.rules : {};
    const character = { ...(isRecord(own.character) ? own.character : {}) };
    for (const key of ['statCap', 'xpBase', 'maxLevel', 'activeSkills']) {
        const value = s[`party.${key}`] ?? s[key];
        if (Number.isInteger(value)) character[key] = value;
    }
    return makeRules({ ...own, character, ...(isRecord(s.terms) ? { terms: { ...DEFAULT_RULES.terms, ...s.terms } } : {}) });
}

// Another query through the tools (MODULES §F3); undefined when there are no tools, it is not
// registered, or it throws: the screen then shows less, never an error.
function ask(tools, name, args = {}) {
    if (typeof tools?.query !== 'function') return undefined;
    try {
        return tools.query(name, args);
    } catch {
        return undefined;
    }
}

const partyOf = state => {
    const party = state?.domains?.party;
    return isRecord(party) ? party : { pc: null, order: [], actors: {}, custom: {} };
};
const inventoryOf = state => {
    const inventory = state?.domains?.inventory;
    return isRecord(inventory) ? inventory : { defs: {}, stacks: {}, wallets: {} };
};

/** The party's people in display order (your character first), then anyone the order leaves out. */
function peopleOf(party) {
    const actors = isRecord(party.actors) ? party.actors : {};
    const order = (Array.isArray(party.order) ? party.order : []).filter(id => actors[id]);
    const rest = Object.keys(actors).sort().filter(id => !order.includes(id));
    const ids = [...order, ...rest];
    if (party.pc && ids.includes(party.pc)) return [party.pc, ...ids.filter(id => id !== party.pc)];
    return ids;
}

// ---------------------------------------------------------------------------------------------------
// Actor cards

const CONDITION_LOOK = [
    [/poison/i, 'fa-skull-crossbones', 'bad'],
    [/burn|fire|scorch/i, 'fa-fire', 'bad'],
    [/bleed/i, 'fa-droplet', 'bad'],
    [/stun|daze/i, 'fa-face-dizzy', 'warn'],
    [/slow/i, 'fa-hourglass-half', 'warn'],
    [/weak|tired|exhaust|fatigue/i, 'fa-arrow-trend-down', 'warn'],
    [/shield|ward/i, 'fa-shield-halved', 'good'],
    [/regen|bless|inspired|hasted?/i, 'fa-heart-circle-plus', 'good'],
    [/guard/i, 'fa-shield', 'good'],
    [/curse|hex|doom/i, 'fa-ghost', 'bad'],
    [/fear|frighten|terror/i, 'fa-face-flushed', 'warn'],
    [/\b(?:sick\w*|ill|diseased?|fever\w*)\b/i, 'fa-virus', 'bad'],
];

/**
 * A condition as ss.badge props: an icon and tone by its kind, and its rounds left as the counter
 * (a party condition's `stacks` are the rounds a fight left; 1 is "no rounds", MODULES §B1).
 */
export function conditionBadge(condition, index = 0) {
    const kind = String(condition?.kind ?? '').trim() || 'unwell';
    const [, icon, tone] = CONDITION_LOOK.find(([pattern]) => pattern.test(kind)) ?? [null, 'fa-circle-exclamation', 'neutral'];
    const stacks = int(condition?.stacks, 1);
    return { id: `${kind}-${index}`, kind, label: capital(kind), icon, tone, counter: stacks > 1 ? stacks : null, unit: stacks > 1 ? 'turns left' : '' };
}

const SKILL_ICONS = Object.freeze({ physical: 'fa-hand-fist', magic: 'fa-wand-sparkles', heal: 'fa-kit-medical', buff: 'fa-shield-halved', debuff: 'fa-skull' });

/** An actor's skills with what the library says about each: tier, type, cost. */
function skillsOf(actor, party, rules) {
    const library = [...DEFAULT_SKILLS, ...Object.values(isRecord(party.custom) ? party.custom : {})];
    const most = int(rules.masteryMax, 5);
    return (Array.isArray(actor.skills) ? actor.skills : []).map(skill => {
        const found = findSkill(library, skill?.name);
        const type = String(found?.type ?? '');
        return {
            name: String(skill?.name ?? ''),
            level: int(skill?.level, 1),
            max: most,
            active: skill?.active !== false,
            tier: int(found?.tier, 0),
            type,
            icon: SKILL_ICONS[type] ?? 'fa-star',
            cost: Number.isFinite(found?.mp) ? `${found.mp} ${type === 'physical' ? 'SP' : 'MP'}` : '',
            note: String(found?.description ?? ''),
        };
    }).filter(skill => skill.name);
}

/** Skills as ss.skill-tree tiers: tier 1 to 3 (then the story-taught without one), those in use first. */
export function skillTree(skills) {
    const tiers = [...new Set(skills.map(skill => skill.tier))].sort((a, b) => (a || 99) - (b || 99));
    return {
        tiers: tiers.map(tier => ({
            title: tier ? `Tier ${tier}` : 'Taught by the story',
            skills: skills
                .filter(skill => skill.tier === tier)
                .sort((a, b) => Number(b.active) - Number(a.active))
                .map(skill => ({ id: skill.name, name: skill.name, icon: skill.icon, level: skill.level, max: skill.max, active: skill.active })),
        })),
    };
}

function pool(value) {
    const max = Math.max(0, int(value?.max));
    return { cur: Math.min(max, Math.max(0, int(value?.cur))), max };
}

/** One actor's card: everything the Party, HUD and status screens show of them. */
export function actorCard(actor, party, { rules = DEFAULT_RULES, portrait = null } = {}) {
    const level = Math.max(1, int(actor.level, 1));
    const top = maxLevel(rules);
    const atTop = level >= top;
    const need = xpToNext(level, rules);
    const xp = atTop ? { cur: 1, max: 1 } : { cur: Math.min(need, Math.max(0, int(actor.xp))), max: need };
    const hp = pool(actor.hp);
    const points = Math.max(0, int(actor.points));
    const cap = statCap(rules);
    const statsRecord = isRecord(actor.stats) ? actor.stats : {};
    const stats = STATS.map(key => {
        const value = int(statsRecord[key], rules.character.startStat);
        const mod = checkModifier(value, rules);
        return { key, label: STAT_NAMES[key], value, mod: mod > 0 ? `+${mod}` : mod < 0 ? String(mod) : '', room: Math.max(0, Math.min(points, cap - value)) };
    });
    const largest = Math.max(...stats.map(stat => stat.value), 1);
    const axisMax = Math.min(cap, Math.max(10, Math.ceil(largest / 5) * 5));
    const skills = skillsOf(actor, party, rules);
    const you = actor.id === party.pc;
    const role = capital(actor.role);
    const who = you ? 'You' : actor.control === 'player' ? 'Companion · you lead' : 'Companion';
    return {
        id: actor.id,
        name: String(actor.name ?? ''),
        you,
        kind: actor.kind ?? (you ? 'pc' : 'companion'),
        control: actor.control ?? 'auto',
        role,
        level,
        line: [`Lv ${level}`, role, who].filter(Boolean).join(' · '),
        portrait: typeof portrait === 'string' && portrait ? portrait : typeof actor.portrait === 'string' && actor.portrait ? actor.portrait : '',
        hp,
        mp: pool(actor.mp),
        sp: pool(actor.sp),
        low: hp.max > 0 && hp.cur > 0 && hp.cur * 10 < hp.max * 3,
        down: hp.max > 0 && hp.cur === 0,
        xp,
        xpText: atTop ? 'Top level' : `${xp.cur} / ${need}`,
        points,
        spend: points > 0,
        // The draft key of this spending: a new level or a spend starts from zero again.
        spendKey: `${actor.id}_l${level}_p${points}`.replace(/\W/g, '_'),
        stats,
        statAxes: stats.map(stat => ({ label: stat.key, value: stat.value, max: axisMax })),
        badges: (Array.isArray(actor.conditions) ? actor.conditions : []).map(conditionBadge),
        skills,
        tree: skillTree(skills),
        activeCount: skills.filter(skill => skill.active).length,
        activeCap: int(rules.character.activeSkills, 6),
    };
}

/** `rpg-battle.cards({ settings? })`: a card per party member, your character first. */
export function cards(state, args = {}, tools = null) {
    const party = partyOf(state);
    const rules = rulesFor(settingsFor(args, tools));
    // party.actors gives each member's portrait (the persona's, or NSD's for an NPC companion).
    const listed = ask(tools, 'party.actors', {});
    const portraits = new Map((Array.isArray(listed) ? listed : []).map(entry => [entry?.id, entry?.portrait ?? null]));
    return copy(peopleOf(party).map(id => actorCard(party.actors[id], party, { rules, portrait: portraits.get(id) })));
}

/**
 * `rpg-battle.hud({ settings? })`: { ready, pc: card | null, pending, pendingText }. `pending`
 * counts the checks waiting for a roll (MODULES §F16: the checks part's `checks.pending`, else the
 * `checks` domain as it is).
 */
export function hud(state, args = {}, tools = null) {
    const party = partyOf(state);
    const pcId = party.pc && party.actors?.[party.pc] ? party.pc : null;
    const pc = pcId ? cards(state, args, tools).find(card => card.id === pcId) ?? null : null;
    const asked = ask(tools, 'checks.pending', {});
    const list = Array.isArray(asked) ? asked : Array.isArray(state?.domains?.checks?.pending) ? state.domains.checks.pending : [];
    const pending = list.length;
    return copy({ ready: Boolean(pc), pc, pending, pendingText: pending === 1 ? '1 check waits for a roll' : `${pending} checks wait for a roll` });
}

// ---------------------------------------------------------------------------------------------------
// Items

const SLOT_LABELS = Object.freeze({ weapon: 'Weapon', offhand: 'Off-hand', armour: 'Armour', armor: 'Armour', worn: 'Worn', accessory: 'Accessory', head: 'Head', hands: 'Hands', feet: 'Feet', waist: 'Waist' });

function effectText(effect) {
    if (!isRecord(effect)) return '';
    const parts = [];
    if (int(effect.heal) > 0) parts.push(`+${int(effect.heal)} HP`);
    if (int(effect.mp) > 0) parts.push(`+${int(effect.mp)} MP`);
    if (int(effect.sp) > 0) parts.push(`+${int(effect.sp)} SP`);
    const cure = (Array.isArray(effect.cure) ? effect.cure : []).map(String).filter(Boolean);
    if (cure.length) parts.push(`cures ${cure.join(', ')}`);
    if (int(effect.damage) > 0) parts.push(`${int(effect.damage)} damage`);
    return parts.join(' · ');
}

const statText = stats => (isRecord(stats) ? Object.entries(stats).filter(([, value]) => Number.isFinite(value) && value !== 0).map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`).join(', ') : '');
const helpsNow = effect => isRecord(effect) && (int(effect.heal) > 0 || int(effect.mp) > 0 || (Array.isArray(effect.cure) && effect.cure.length > 0));

/**
 * `rpg-battle.items`: { empty, people, consumables, equipment, other }. Each row has its `stack`,
 * name, quantity, who holds it, and the people it can be given to (`give`); consumables list their
 * `targets` (`helps` false when a dose would do nothing for them now, which item.use refuses), gear
 * whether it is on (`equipped`) and on whom.
 */
export function items(state) {
    const party = partyOf(state);
    const inventory = inventoryOf(state);
    const people = peopleOf(party);
    const nameOf = id => String(party.actors?.[id]?.name ?? id);
    const holders = ['party', ...people];
    const defs = isRecord(inventory.defs) ? inventory.defs : {};
    // Whether a dose would change anything for someone now, by the rule item.use applies (v1
    // useItemOutside: full HP and MP with nothing to cure refuses).
    const helpsWhom = (def, id) => {
        const who = party.actors?.[id];
        const sheet = {
            name: String(who?.name ?? ''), hp: pool(who?.hp), mp: pool(who?.mp),
            conditions: (Array.isArray(who?.conditions) ? who.conditions : []).map(entry => ({ name: entry?.kind, stacks: entry?.stacks })),
        };
        try {
            return useItemOutside(sheet, { name: def.name, effect: def.effect }).used === true;
        } catch {
            return null;
        }
    };
    const stacks = Object.keys(isRecord(inventory.stacks) ? inventory.stacks : {}).sort()
        .map(id => inventory.stacks[id])
        .filter(stack => isRecord(stack) && stack.qty > 0 && holders.includes(stack.owner) && defs[stack.def] && defs[stack.def].kind !== 'money')
        .sort((a, b) => holders.indexOf(a.owner) - holders.indexOf(b.owner) || String(defs[a.def].name).localeCompare(String(defs[b.def].name), 'en') || (a.id < b.id ? -1 : 1));

    const out = { empty: stacks.length === 0, people: people.map(id => ({ id, name: nameOf(id) })), consumables: [], equipment: [], other: [] };
    for (const stack of stacks) {
        const def = defs[stack.def];
        const holder = stack.owner === 'party' ? 'shared' : nameOf(stack.owner);
        const keeper = stack.owner === 'party' ? party.pc : stack.owner;
        const base = {
            stack: stack.id, def: def.id ?? stack.def, name: String(def.name ?? ''), qty: stack.qty, holder,
            rarity: String(def.rarity ?? 'common'), note: String(def.note ?? ''),
            give: people.filter(id => id !== keeper).map(id => ({ id, name: nameOf(id) })),
        };
        if (def.kind === 'consumable' && helpsNow(def.effect)) {
            out.consumables.push({
                ...base,
                effect: effectText(def.effect),
                targets: people.map(id => {
                    const ok = helpsWhom(def, id);
                    return { id, name: nameOf(id), helps: ok, title: ok === false ? `${nameOf(id)} would not gain anything now` : `Use on ${nameOf(id)}` };
                }),
            });
        } else if (def.kind === 'equipment' && def.slot) {
            const wearer = stack.owner === 'party' ? party.pc : stack.owner;
            const on = Boolean(stack.equipped);
            out.equipment.push({
                ...base,
                slot: String(def.slot), slotLabel: SLOT_LABELS[def.slot] ?? capital(def.slot),
                stats: statText(def.stats), equipped: on,
                wearer: wearer ? nameOf(wearer) : '',
                wearerLine: wearer ? `${on ? 'worn by' : 'for'} ${nameOf(wearer)}` : holder,
            });
        } else {
            out.other.push({ ...base, effect: effectText(def.effect) });
        }
    }
    return copy(out);
}

// ---------------------------------------------------------------------------------------------------
// Trade

/** The trader kinds the Trade page offers (v1 0.5.38), with who they are and whether they take commissions. */
export const TRADERS = Object.freeze([
    { kind: 'general', label: 'General store', commissions: false },
    { kind: 'apothecary', label: 'Apothecary', commissions: true },
    { kind: 'smith', label: 'Smith', commissions: true },
    { kind: 'crafter', label: 'Bone-carver', commissions: true },
    { kind: 'fence', label: 'Fence', commissions: false },
    { kind: 'guild', label: 'Guild', commissions: false },
]);

/** The chat's one currency (MODULES §F1): `inventory.currency` → { name, short }, else gold. */
function currencyFrom(tools) {
    const found = ask(tools, 'inventory.currency', {});
    const name = String(found?.name ?? '').trim() || 'gold';
    const short = String(found?.short ?? '').trim() || name[0].toLowerCase();
    return { name, short };
}

const shortPrice = (amount, currency) => `${Math.max(0, int(amount))} ${currency.short}`;
const longPrice = (amount, currency) => `${Math.max(0, int(amount))} ${currency.name}`;

// A def as v1's isMaterial reads an item (a slot is gear, an effect a consumable).
function asV1Item(def) {
    const effect = isRecord(def?.effect) && Object.keys(def.effect).length ? def.effect : null;
    return { name: def?.name ?? '', kind: def?.kind ?? 'goods', slot: def?.slot ?? null, effect, note: def?.note ?? '', rarity: def?.rarity ?? 'common' };
}

/**
 * `rpg-battle.trade`: the Trade page's rows from the trade part's queries (trade.market,
 * trade.stock, trade.quote, trade.orders) and the purse (inventory.wallet, MODULES §F1):
 * { open, place, line, purse, sell, traders, crafters, materials, orders }. Prices are whole
 * amounts of the one currency, shown short ("12 g") with the long words in each button's title.
 */
export function trade(state, args = {}, tools = null) {
    const currency = currencyFrom(tools);
    const market = ask(tools, 'trade.market', {});
    const party = partyOf(state);
    const inventory = inventoryOf(state);
    const wallet = ask(tools, 'inventory.wallet', { owner: 'party' }) ?? inventory.wallets?.party ?? {};
    const coin = Math.max(0, int(wallet?.coin));
    const open = market?.open === true;
    const place = String(market?.place ?? state?.domains?.scene?.place?.name ?? '') || 'Somewhere';
    const prices = market?.level ? `${market.level} prices` : market?.tier ? `${market.tier} prices` : '';
    const out = {
        open,
        available: market !== undefined && market !== null,
        place,
        line: !market ? 'Trade is not set up in this chat.' : open ? ['Market', prices].filter(Boolean).join(' · ') : 'No market here: trade in a settlement, or with a trader on the road.',
        purse: shortPrice(coin, currency),
        purseTitle: `${longPrice(coin, currency)} in the purse`,
        sell: [], traders: [], crafters: [], materials: [], orders: [],
    };

    const defs = isRecord(inventory.defs) ? inventory.defs : {};
    const ours = owner => owner === 'party' || Boolean(party.actors?.[owner]);
    const goods = Object.keys(isRecord(inventory.stacks) ? inventory.stacks : {}).sort()
        .map(id => inventory.stacks[id])
        .filter(stack => isRecord(stack) && stack.qty > 0 && !stack.equipped && ours(stack.owner) && defs[stack.def] && !['money', 'quest'].includes(defs[stack.def].kind))
        .sort((a, b) => String(defs[a.def].name).localeCompare(String(defs[b.def].name), 'en') || (a.id < b.id ? -1 : 1));

    if (open) {
        for (const stack of goods) {
            const def = defs[stack.def];
            const quote = ask(tools, 'trade.quote', { type: 'sell', stack: stack.id, qty: 1 });
            const each = quote?.ok ? int(quote.each ?? quote.total) : null;
            out.sell.push({
                stack: stack.id, name: String(def.name ?? ''), qty: stack.qty, note: stack.qty > 1 ? '' : String(def.note ?? ''),
                each, price: each === null ? 'Sell' : shortPrice(each, currency),
                title: each === null ? `Sell one ${def.name}` : `Sell one ${def.name} for ${longPrice(each, currency)}`,
            });
        }
        TRADERS.forEach((trader, index) => {
            const stock = ask(tools, 'trade.stock', { kind: trader.kind });
            const rows = (Array.isArray(stock?.items) ? stock.items : []).map(item => ({
                def: String(item?.def?.id ?? ''), name: String(item?.def?.name ?? ''), note: String(item?.note ?? item?.def?.note ?? ''),
                rarity: String(item?.def?.rarity ?? 'common'), cost: int(item?.price), price: shortPrice(item?.price, currency),
                title: `Buy ${item?.def?.name ?? 'it'} for ${longPrice(item?.price, currency)}`,
            })).filter(row => row.def && row.name);
            out.traders.push({ kind: trader.kind, label: trader.label, shop: String(stock?.shop ?? trader.kind), first: index === 0, items: rows });
        });
        out.crafters = TRADERS.filter(trader => trader.commissions).map(trader => ({ kind: trader.kind, label: trader.label }));
        out.materials = goods.filter(stack => isMaterial(asV1Item(defs[stack.def]))).map(stack => ({ stack: stack.id, name: `${defs[stack.def].name}${stack.qty > 1 ? ` (${stack.qty})` : ''}` }));
    }

    const orders = ask(tools, 'trade.orders', {});
    out.orders = (Array.isArray(orders) ? orders : []).map(order => ({
        id: String(order?.id ?? ''), name: String(order?.piece?.name ?? 'A piece'), crafter: capital(order?.crafter ?? ''),
        due: order?.due === true, collect: order?.due === true && open,
        status: order?.due === true ? (open ? 'ready' : 'ready: collect at a market') : 'not ready yet',
    })).filter(order => order.id);
    return copy(out);
}

/** The view queries, by name (merged into the module's queries by the coordinator). */
export const viewQueries = Object.freeze({
    'rpg-battle.cards': cards,
    'rpg-battle.hud': hud,
    'rpg-battle.items': items,
    'rpg-battle.trade': trade,
});
