// RPG Battle v2, screens for the rules-v2 views (track C): the Links page's view query, `rpg-battle.linksView`.
//
// Four sections, each answered by its owner's public queries and each on its own (one being unavailable never hides
// the others):
//
//   checks    Story Director's check actors and their links to RPG Battle characters (checks.policy, pending B/SD)
//             commands: checks.actor { id, name, bonuses, makeDefault, expectedHash }, checks.link { actor, rbActor|null, expectedHash }
//   world     regions, which places belong to them, danger tiers and the canonical place ids (atlas.policy, atlas.canonical,
//             world.areaTier, pending B/SD)
//             commands: atlas.region, atlas.placeRegion, atlas.dangerSet, atlas.placeBind (all with expectedHash)
//   inputs    the flags and generated items the rules recorded (rules.flags, inventory.definitions, rules.item: read only)
//   dossiers  each companion's NPC State Delta dossier link (npc.identity by np_ id, never by name)
//
// Every write here is a player command carrying the `expectedHash` the query returned, so a page that went stale is
// refused (STALE) instead of overwriting. The host stamps each write's own id (`write`, RB_PHASE0 §3 P23/P24); a page
// never mints ids. The inputs section has no buttons at all: generated items, rules and flags are written only by their
// trusted owners (rules.registerItem, rules.flagSet are never sent from a screen), and reading them assigns nothing.

import { ASK, ask, isHash, isList, isParty, isRecord, isText } from './ask.js';
import { btn, clip } from './format.js';
import { npcModel } from './roster.js';

const isChecksPolicy = value => isRecord(value) && isRecord(value.actors) && isRecord(value.rbActors) && isHash(value.hash)
    && (value.defaultActor === null || isText(value.defaultActor)) && typeof value.rbModifiers === 'boolean' && typeof value.social === 'boolean';
const isAtlasPolicy = value => isRecord(value) && isList(value.regions, item => isRecord(item) && isText(item.id) && isText(item.name))
    && isRecord(value.placeRegions) && isRecord(value.placeRefs) && isRecord(value.danger) && isHash(value.hash);
const isFlags = value => isRecord(value) && isRecord(value.values) && isHash(value.hash);

const GENERATED = Object.freeze({ story: 'Story', craft: 'Crafted', trade: 'Bought' });

// ---- checks (C16) -----------------------------------------------------------------------------------------------------

function bonusesText(bonuses) {
    const entries = Object.entries(isRecord(bonuses) ? bonuses : {}).filter(([, amount]) => Number.isInteger(amount) && amount !== 0);
    return entries.length ? entries.map(([key, amount]) => `${key} ${amount > 0 ? '+' : ''}${amount}`).join(', ') : 'No bonuses';
}

function checksSection(tools, party) {
    const found = ask(tools, 'checks.policy', {}, isChecksPolicy);
    if (found.status !== ASK.OK) {
        return { state: found.status === ASK.MALFORMED ? 'mismatch' : 'unavailable', note: 'Check actors are not available. Story Director answers for them.', actors: [], create: null };
    }
    const policy = found.value;
    const durable = party ? [...party.active, ...party.reserve] : [];
    const rbReady = party !== null;
    const byId = new Map(durable.map(sheet => [sheet.id, sheet]));
    const actors = Object.values(policy.actors).filter(isRecord).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)).map(actor => {
        const target = policy.rbActors[actor.id] ?? null;
        const sheet = target ? byId.get(target) ?? null : null;
        let link;
        if (!target) link = { state: 'unlinked', text: 'Not linked to an RPG Battle character. This actor uses its own bonuses.', rbName: '' };
        else if (sheet) link = { state: 'linked', text: `Linked to ${clip(sheet.name, 80)}. Their sheet supplies the check modifier.`, rbName: clip(sheet.name, 80) };
        else if (!rbReady) link = { state: 'fallback', text: 'Linked, but RPG Battle is not answering. This actor\'s own bonuses are used for now; the link is kept.', rbName: '' };
        else link = { state: 'stale', text: 'Linked to a character RPG Battle no longer has. This actor\'s own bonuses are used; the link is kept until you change it.', rbName: '' };
        const base = { expectedHash: policy.hash };
        return {
            id: actor.id, name: clip(actor.name, 80), isDefault: policy.defaultActor === actor.id, bonuses: bonusesText(actor.bonuses), link,
            canUnlink: Boolean(target), unlinkPayload: { actor: actor.id, rbActor: null, ...base },
            unlinkButton: btn('checks.link', { actor: actor.id, rbActor: null, ...base }, 'Unlink'),
            linkOptions: durable.filter(sheet2 => sheet2.id !== target).map(sheet2 => {
                const label = `${target ? 'Relink to' : 'Link to'} ${clip(sheet2.name, 60)}`;
                const payload = { actor: actor.id, rbActor: sheet2.id, ...base };
                return { label, payload, button: btn('checks.link', payload, label) };
            }),
            canMakeDefault: policy.defaultActor !== actor.id,
            makeDefaultPayload: { id: actor.id, name: clip(actor.name, 80), bonuses: isRecord(actor.bonuses) ? actor.bonuses : {}, makeDefault: true, ...base },
            makeDefaultButton: btn('checks.actor', { id: actor.id, name: clip(actor.name, 80), bonuses: isRecord(actor.bonuses) ? actor.bonuses : {}, makeDefault: true, ...base }, 'Make default'),
        };
    });
    return {
        state: 'ready', hash: policy.hash, rbReady, rbModifiers: policy.rbModifiers, social: policy.social, actors,
        note: [
            policy.rbModifiers ? '' : 'RPG Battle modifiers are switched off for checks.',
            rbReady ? '' : 'RPG Battle is not answering, so linked actors use their own bonuses.',
        ].filter(Boolean).join(' '),
        create: { command: 'checks.actor', payload: { expectedHash: policy.hash }, valueAt: 'name', label: 'New check actor', submit: 'Add actor', placeholder: 'Name', max: 80 },
    };
}

// ---- world (C17) ------------------------------------------------------------------------------------------------------

function dangerText(policy) {
    return isRecord(policy) && Number.isInteger(policy.tier) ? `Tier ${policy.tier}` : 'Not set';
}

function tierSpec(scope, key, current, hash, label) {
    const keep = isRecord(current) ? current : {};
    return {
        command: 'atlas.dangerSet', valueAt: 'policy.tier', numeric: true, label, submit: 'Set tier', placeholder: '0 to 9', max: 1,
        payload: {
            scope, key, expectedHash: hash,
            policy: { tier: 0, allowedFoes: Array.isArray(keep.allowedFoes) ? keep.allowedFoes : [], allowedTags: Array.isArray(keep.allowedTags) ? keep.allowedTags : [], lore: Array.isArray(keep.lore) ? keep.lore : [] },
        },
    };
}

const SOURCE_LABELS = Object.freeze({ place: 'this place', region: 'its region', world: 'the world', unknown: 'nowhere' });

function worldSection(tools) {
    const found = ask(tools, 'atlas.policy', {}, isAtlasPolicy);
    if (found.status !== ASK.OK) {
        return { state: found.status === ASK.MALFORMED ? 'mismatch' : 'unavailable', note: 'The world map\'s regions and danger tiers are not available. Story Director answers for them.', regions: [], places: [], here: null };
    }
    const policy = found.value;
    const hash = policy.hash;
    const regionName = new Map(policy.regions.map(region => [region.id, clip(region.name, 80)]));
    const sortedRegions = [...policy.regions].sort((a, b) => (a.id < b.id ? -1 : 1));

    const placeIds = [...new Set([...Object.keys(policy.placeRegions), ...Object.keys(isRecord(policy.danger.places) ? policy.danger.places : {})])].sort();
    const hereAnswer = ask(tools, 'atlas.canonical', {});
    const hereId = hereAnswer.status === ASK.OK && isText(hereAnswer.value.id) ? hereAnswer.value.id : null;
    if (hereId && !placeIds.includes(hereId)) placeIds.push(hereId);

    const placeRow = id => {
        const canonical = ask(tools, 'atlas.canonical', { id });
        const tier = ask(tools, 'world.areaTier', { place: id });
        const regionId = policy.placeRegions[id] ?? (canonical.status === ASK.OK ? canonical.value.regionId ?? null : null);
        const held = canonical.status !== ASK.OK;
        const candidates = held ? ask(tools, 'atlas.candidates', { place: id }) : { status: ASK.MISSING };
        const tierValue = tier.status === ASK.OK ? tier.value : null;
        return {
            id, name: canonical.status === ASK.OK ? clip(canonical.value.name, 80) : clip(id, 80), canonicalId: canonical.status === ASK.OK ? canonical.value.id : '',
            idText: canonical.status === ASK.OK
                ? `${canonical.value.source === 'pack' ? 'Pack place' : 'Your place'}: ${canonical.value.id}${canonical.value.atlasId ? ` (visited as ${canonical.value.atlasId})` : ' (not visited yet)'}`
                : 'Held: this place matches more than one pack place or none yet. Dependent content waits until you choose.',
            held, regionId, regionText: regionId ? (regionName.get(regionId) ?? clip(regionId, 40)) : 'No region',
            tierText: tierValue ? (tierValue.tier === null ? 'Danger: not set anywhere' : `Danger tier ${tierValue.tier}, from ${SOURCE_LABELS[tierValue.source]}`) : 'Danger: not available',
            tierSource: tierValue?.source ?? '', tier: tierValue?.tier ?? null,
            memberOptions: sortedRegions.filter(region => region.id !== regionId).map(region => {
                const label = `Put in ${clip(region.name, 60)}`;
                const payload = { place: id, region: region.id, expectedHash: hash };
                return { label, payload, button: btn('atlas.placeRegion', payload, label) };
            }),
            canLeaveRegion: Boolean(regionId), leavePayload: { place: id, region: null, expectedHash: hash },
            leaveButton: btn('atlas.placeRegion', { place: id, region: null, expectedHash: hash }, 'Remove from region'),
            placeTier: tierSpec('place', id, policy.danger.places?.[id], hash, 'Danger tier for this place'),
            hasPlaceTier: isRecord(policy.danger.places?.[id]), clearPlaceTier: { scope: 'place', key: id, policy: null, expectedHash: hash },
            clearPlaceTierButton: btn('atlas.dangerSet', { scope: 'place', key: id, policy: null, expectedHash: hash }, 'Clear tier'),
            bindOptions: candidates.status === ASK.OK && Array.isArray(candidates.value.definitions)
                ? candidates.value.definitions.filter(isText).map(definition => {
                    const payload = { place: id, definition, expectedHash: hash };
                    return { label: `Use ${clip(definition, 80)}`, payload, button: btn('atlas.placeBind', payload, `Use ${clip(definition, 80)}`) };
                }) : [],
        };
    };
    const places = placeIds.map(placeRow);

    const regions = sortedRegions.map(region => {
        const aliases = Array.isArray(region.aliases) ? region.aliases.filter(isText) : [];
        const own = policy.danger.regions?.[region.id];
        return {
            id: region.id, name: clip(region.name, 80), aliases: aliases.map(item => clip(item, 80)), aliasText: aliases.length ? `Also called ${aliases.map(item => clip(item, 40)).join(', ')}` : '',
            dangerText: dangerText(own), hasTier: isRecord(own),
            members: places.filter(place => place.regionId === region.id).map(place => ({ id: place.id, name: place.name })),
            rename: { command: 'atlas.region', valueAt: 'name', label: 'Rename', submit: 'Rename', placeholder: 'New name', max: 80, payload: { id: region.id, aliases, expectedHash: hash } },
            tier: tierSpec('region', region.id, own, hash, 'Danger tier for this region'),
            clearTier: { scope: 'region', key: region.id, policy: null, expectedHash: hash },
            clearTierButton: btn('atlas.dangerSet', { scope: 'region', key: region.id, policy: null, expectedHash: hash }, 'Clear tier'),
        };
    });
    const world = policy.danger.world;
    return {
        state: 'ready', hash, regions, places, here: hereId ? places.find(place => place.id === hereId) ?? null : null,
        world: {
            text: dangerText(world), hasTier: isRecord(world), tier: tierSpec('world', null, world, hash, 'Danger tier for the world'),
            clear: { scope: 'world', key: null, policy: null, expectedHash: hash },
            clearButton: btn('atlas.dangerSet', { scope: 'world', key: null, policy: null, expectedHash: hash }, 'Clear tier'),
        },
        createRegion: { command: 'atlas.region', valueAt: 'name', label: 'New region', submit: 'Add region', placeholder: 'Region name', max: 80, payload: { expectedHash: hash } },
        precedence: 'A tier set for a place wins over its region\'s, which wins over the world\'s. No tier anywhere holds content for the place.',
    };
}

// ---- inputs (C18) -----------------------------------------------------------------------------------------------------

function inputsSection(tools) {
    const flags = ask(tools, 'rules.flags', {}, isFlags);
    const defs = ask(tools, 'inventory.definitions', {}, value => isList(value, item => isRecord(item) && isText(item.id)));
    const flagRows = flags.status === ASK.OK
        ? Object.entries(flags.value.values).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, on]) => ({ key: clip(key, 80), on: on === true, text: on === true ? 'On' : 'Off' })) : [];
    const items = defs.status === ASK.OK
        ? defs.value.filter(def => /^(?:story|craft|trade)\//.test(def.id)).slice(0, 40).map(def => {
            const rule = ask(tools, 'rules.item', { def: def.id });
            const kind = def.id.slice(0, def.id.indexOf('/'));
            return { id: def.id, name: clip(def.name ?? def.id, 80), source: GENERATED[kind] ?? '', rarity: clip(def.rarity ?? '', 20), ruled: rule.status === ASK.OK };
        }) : [];
    return {
        state: flags.status === ASK.OK || defs.status === ASK.OK ? 'ready' : 'unavailable',
        flags: flagRows, flagsState: flags.status === ASK.OK ? 'ready' : 'unavailable', items, itemsState: defs.status === ASK.OK ? 'ready' : 'unavailable',
        note: 'Flags and generated items are written only by the rules when a recognised story event happens. There is nothing to press here, and looking assigns nothing.',
    };
}

// ---- dossiers (C19) ---------------------------------------------------------------------------------------------------

function dossiersSection(tools, party) {
    if (!party) return { state: 'unavailable', rows: [] };
    const rows = [...party.active, ...party.reserve].filter(sheet => sheet.kind !== 'pc').map(sheet => ({ id: sheet.id, name: clip(sheet.name, 80), npcId: sheet.npcId ?? '', ...npcModel(sheet, tools) }));
    return { state: 'ready', rows };
}

/** rpg-battle.linksView({}) → { checks, world, inputs, dossiers }. */
export function linksView(state, args, tools) {
    const partyAnswer = ask(tools, 'rules.party', {}, isParty);
    const party = partyAnswer.status === ASK.OK ? partyAnswer.value : null;
    return {
        checks: checksSection(tools, party),
        world: worldSection(tools),
        inputs: inputsSection(tools),
        dossiers: dossiersSection(tools, party),
    };
}
