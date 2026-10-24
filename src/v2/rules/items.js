// RPG Battle v2, the rules of items (contract §3 `rules.item`, `rules.registerItem`; §4 ItemRule; B3 "complete rule inputs",
// C18 "generated story/craft/trade def + rule + grant transaction").
//
//   rules.item({ def })   read-only → ItemRule | null    the rule of a pack item (frozen in the pin) or of a generated one (below)
//   rules.registerItem { write, def, rule, template, area, rulesHash }
//                         → { def, hash, ruleHash, created }    the single route by which an item that is not a pack's gets its
//                         rule: Story Block's own item grant (rule, area and rulesHash null: the module answers them) and this
//                         module's craft, trade and loot adapters (rule given). From those steps only (never a button), in the
//                         same transaction as the grant, buy or craft that needed the item, so one refusal later takes the
//                         definition, its rule and its provenance away together.
//
// What a registration does, in order, and refuses before it writes anything:
//   1. the caller is Story Block's item grant or one of this module's steps; the chat runs a ruleset (without one the definition is
//      passed to Story Block unchecked, as in a chat with no rules module: a failing sub-command would fail the whole root);
//   2. `rulesHash` is the pinned one (or null), the def is a closed ItemDef under story/, craft/ or trade/ (a pack's item is
//      frozen with the rules and cannot be registered again), the rule is the caller's or, only for an item that is not equipment,
//      the plain one (never inferred from a name; equipment states its slots and hands);
//   3. the source `template` is a pinned recipe (craft/), shop (trade/) or, for story/, nothing or any pinned recipe, shop, foe,
//      quest or item; a template that is not in the ruleset refuses;
//   4. the place's tier is Story Director's answer for where the party is now (`atlas.canonical` then `world.areaTier`), never the
//      caller's; a caller's area must be that answer; bounds.js holds the def and the rule to the tier's budget and closure;
//   5. the def is registered with Story Block (`inventory.registerDefinition`, hash = ctx.hash(def)); the def, rule and provenance
//      (template, area, rules hash, write) are stored here, immutable: the same bytes again are a no-op, other bytes under a used
//      id are a CONFLICT; the id is claimed (`rb:<epoch>:item:<def>`) and a replay guard remembers what it depended on.
// Ids are never assigned here: the def's id is the caller's (`story/<slug>`, `craft/<slug>`, `trade/<slug>[-rarity-l<level>]`).

import { boundProblems, defShapeProblems, GENERATED_PREFIXES, MAX_ITEM_RULES, ruleProblems } from './bounds.js';
import { hashJson } from './hash.js';
import { epochOf, isDefId, isHash, isObject, isRecordId } from './ids.js';
import { indexOfState } from './graph.js';

/** Who may register: Story Block's item grant (the story's items) and this module's own adapters. */
export const TRUSTED = Object.freeze(['story-block', 'rpg-battle']);
const FIELDS = ['write', 'def', 'rule', 'template', 'area', 'rulesHash'];

const ask = (query, name, args) => {
    try {
        return typeof query === 'function' ? query(name, args) : null;
    } catch {
        return null;
    }
};

/** The rule of an item: a pack's (the pin) or a generated one (the state), or null. */
export function ruleOf(ix, slice, ref) {
    if (!isDefId(ref)) return null;
    const mine = ix.itemRule(ref);
    if (mine) return mine;
    return isObject(slice?.generated) && Object.hasOwn(slice.generated, ref) ? slice.generated[ref].rule : null;
}

/** rules.item({ def }) → ItemRule | null. */
export function rulesItem(state, args) {
    const ix = indexOfState(state);
    if (!ix || !isObject(args) || Object.keys(args).some(key => key !== 'def')) return null;
    const rule = ruleOf(ix, state.domains.rules, args.def);
    return rule ? structuredClone(rule) : null;
}

/** The rule an item gets when the caller gave none: only an item that is not equipment has one that needs no saying. */
export const plainRule = def => (def.kind === 'equipment' ? null : { def: def.id, allowedSlots: [], hands: 0, requires: {}, weight: 0, unique: false });

/**
 * Where the party is, as Story Director tells it (never the caller): { place, tier, source, sourceId } with tier null when the area
 * is unknown or Story Director cannot be asked.
 */
export function areaNow(query) {
    const here = ask(query, 'atlas.canonical', {});
    const place = isObject(here) && typeof here.id === 'string' ? here.id : null;
    const found = place ? ask(query, 'world.areaTier', { place }) : null;
    if (!isObject(found) || !Number.isInteger(found.tier) || found.tier < 0 || found.tier > 9) return { place, tier: null, source: 'unknown', sourceId: null };
    return { place: found.place ?? place, tier: found.tier, source: found.source ?? 'unknown', sourceId: found.sourceId ?? null };
}

const templateOk = (ix, def, template) => {
    const prefix = def.id.slice(0, def.id.indexOf('/'));
    const kind = template === null ? null : ix.templateKind(template);
    if (template !== null && kind === null) return 'The source template is not in this ruleset.';
    if (prefix === 'craft' && kind !== 'recipe') return 'A crafted item comes from a recipe of this ruleset.';
    if (prefix === 'trade' && kind !== 'shop') return 'A traded item comes from a shop of this ruleset.';
    return '';
};

/**
 * The question both the command and the replay guard ask: could this registration stand on this state? `payload` is the fixed one
 * { write, def, rule, template, area (the snapshot), rulesHash }. env: { ix, rules }.
 * → { ok: true, inputs, existing } | { ok: false, code, why }.
 */
export function assessItem(env, payload) {
    const { ix, rules } = env;
    const { def, rule, template, area } = payload;
    if (payload.rulesHash !== ix.rulesHash) return { ok: false, code: 'RULES_MISMATCH', why: 'It was made under other rules than the ones this chat runs.' };
    const shape = defShapeProblems(def);
    if (shape.length) return { ok: false, code: 'INVALID', why: shape.join(' ') };
    if (!GENERATED_PREFIXES.includes(def.id.slice(0, def.id.indexOf('/')))) return { ok: false, code: 'REFUSED', why: 'Only story, craft and trade items are registered here; a pack\'s items are frozen with the rules.' };
    const broken = ruleProblems(rule, def);
    if (broken.length) return { ok: false, code: 'RULES_MISMATCH', why: broken.join(' ') };
    const source = templateOk(ix, def, template);
    if (source) return { ok: false, code: 'RULES_MISMATCH', why: source };
    const over = boundProblems(def, area);
    if (over.length) return { ok: false, code: 'RULES_MISMATCH', why: over.join(' ') };
    const existing = isObject(rules?.generated) && Object.hasOwn(rules.generated, def.id) ? rules.generated[def.id] : null;
    const defHash = hashJson(def);
    const ruleHash = hashJson(rule);
    if (existing && (existing.defHash !== defHash || existing.ruleHash !== ruleHash)) return { ok: false, code: 'CONFLICT', why: `${existing.def.name} (${def.id}) is already defined differently; a definition never changes once it exists.` };
    if (!existing && Object.keys(rules?.generated ?? {}).length + ix.itemRuleCount >= MAX_ITEM_RULES) return { ok: false, code: 'REFUSED', why: `A ruleset holds at most ${MAX_ITEM_RULES} item rules.` };
    return { ok: true, existing, inputs: { def: defHash, rule: ruleHash, template, area, rulesHash: ix.rulesHash } };
}

/** rules.registerItem: see above. `attach(ctx, ix, kind, payload, inputs)` puts the replay guard on. */
export function registerItem(ctx, payload, attach) {
    if (!isObject(payload) || Object.keys(payload).some(key => !FIELDS.includes(key))) ctx.fail('INVALID', `rules.registerItem takes { ${FIELDS.join(', ')} } and nothing else.`);
    for (const key of ['write', 'def', 'rule', 'template', 'area', 'rulesHash']) if (!Object.hasOwn(payload, key)) ctx.fail('INVALID', `rules.registerItem needs ${key} (null where there is none).`);
    if (!isRecordId(payload.write)) ctx.fail('INVALID', 'A registration needs the id of the write that asks for it.');
    if (ctx.cause === 'ui' || !TRUSTED.includes(ctx.caller)) ctx.fail('REFUSED', 'Item definitions are registered by the item grant and the rules\' own steps, not from a button or the story\'s words.');
    if (!(payload.rulesHash === null || isHash(payload.rulesHash))) ctx.fail('INVALID', 'rulesHash is a hash or null.');
    if (!(payload.template === null || isDefId(payload.template))) ctx.fail('INVALID', 'The template is a pinned id or null.');
    if (!isObject(payload.def)) ctx.fail('INVALID', 'The definition is a record.');
    const slice = ctx.read('rules');
    const ix = indexOfState({ domains: { rules: slice } });
    if (!ix) {
        // No ruleset in this chat. Story Block's own grant asked first; what it offered is registered as it is, as it would be with no
        // rules module (a sub-command that fails would fail the whole grant, so there is no "not here" to answer).
        if (ctx.caller !== 'story-block' || payload.rule !== null || payload.area !== null || payload.rulesHash !== null) ctx.fail('REFUSED', 'This chat does not run a rules pack, so rules.registerItem has no rules to register under.');
        const stored = ctx.call('inventory.registerDefinition', { write: payload.write, def: payload.def, hash: ctx.hash(payload.def) });
        return { summary: stored.summary, narrate: false, data: { def: payload.def.id, hash: stored.data.hash, ruleHash: null, created: stored.data.created } };
    }
    const def = payload.def;
    const rule = payload.rule ?? plainRule(def);
    if (rule === null) ctx.fail('RULES_MISMATCH', 'Equipment needs its rule (slots and hands) from the step that makes it; a name is never read for one.');
    // Registered before: the same bytes again are a no-op whatever the place (and its tier) is now; other bytes are a CONFLICT.
    const held = isObject(slice.generated) && Object.hasOwn(slice.generated, def.id) ? slice.generated[def.id] : null;
    if (held) {
        if (held.defHash !== ctx.hash(def) || held.ruleHash !== ctx.hash(rule)) ctx.fail('CONFLICT', `${held.def.name} (${def.id}) is already defined differently; a definition never changes once it exists.`);
        return { summary: `${held.def.name} is already defined.`, narrate: false, data: { def: def.id, hash: held.defHash, ruleHash: held.ruleHash, created: false } };
    }
    const area = areaNow((name, args) => ctx.query(name, args));
    if (payload.area !== null && (!isObject(payload.area) || hashJson({ place: payload.area.place, tier: payload.area.tier }) !== hashJson({ place: area.place, tier: area.tier }))) {
        ctx.fail('RULES_MISMATCH', 'The place the caller named is not where the party is now.');
    }
    const fixed = { write: payload.write, def, rule, template: payload.template, area, rulesHash: ix.rulesHash };
    const answer = assessItem({ ix, rules: slice }, fixed);
    if (!answer.ok) ctx.fail(answer.code, answer.why);
    const defHash = answer.inputs.def;
    const ruleHash = answer.inputs.rule;
    const stored = ctx.call('inventory.registerDefinition', { write: payload.write, def, hash: ctx.hash(def) });
    if (stored.data?.def !== def.id) ctx.fail('RULES_MISMATCH', 'Story Block did not register the definition under its id.');
    if (!ctx.claim(`rb:${epochOf()}:item:${def.id}`)) ctx.fail('CLAIMED', 'That item was already registered once.');
    ctx.draft('rules').generated[def.id] = { def: structuredClone(def), rule: structuredClone(rule), template: payload.template, area, rulesHash: ix.rulesHash, defHash, ruleHash, write: payload.write };
    attach(ctx, ix, 'rules.registerItem', fixed, answer.inputs);
    return { summary: `${def.name} is defined.`, narrate: false, data: { def: def.id, hash: defHash, ruleHash, created: true } };
}

/**
 * Activation's half (contract §3: "pack activation registers the frozen pack ItemDefs"): inside the step that pins the ruleset, every
 * complete ItemDef frozen in the pin is registered with Story Block, with no stack, in id order. Called from a command of this module
 * (Story Block accepts only this module's own nested call). → the list of { def, created }.
 */
export function registerPackDefs(ctx) {
    const ix = indexOfState({ domains: { rules: ctx.read('rules') } });
    if (!ix) return [];
    const pin = ctx.read('rules').pin;
    return Object.keys(pin.defs ?? {}).sort().map(ref => {
        const def = pin.defs[ref];
        const out = ctx.call('inventory.registerDefinition', { write: ctx.id('wr'), def, hash: ctx.hash(def) });
        return { def: ref, created: out.data.created === true };
    });
}

export const queries = { 'rules.item': rulesItem };
