// Story Director v2, chronicle part: the change lines and the reader's commands that write the
// chronicle (pure).
//
// Kinds (run by Story Block as story commands, SPEC §4.2):
// - `world`: `+ world Dragon Calamity — awakens near Dragonfang | state: ongoing | place: Dragonfang
//   | factions: Ashen Court`; `~ world Dragon Calamity | state: resolved — slain at the pass`;
//   `- world Dragon Calamity — how it ended` resolves it (the entry stays, under Resolved).
//   `! world …` is news, read as `~`. The kind is `world`, not `event`: `event` is the tracker
//   part's (MODULES §C1, a dated happening with `then:` and `on:`), and a kind has one owner.
// - `faction`: `+ faction Ashen Court — the old nobility | area: the north | stance: wary of {{user}}`;
//   `~ faction …` changes it; `- faction Name` takes it out of the chronicle.
// A `~` on a name the chronicle does not have yet adds it. Times are the Director's clock when
// the line is read (`ctx.time()`, else the `director.time` query, else the `director` domain),
// never the model's. A line the rules cannot use fails with a plain sentence, which Story Block
// keeps in its problems list; nothing is saved for it.
//
// Commands (cause `ui`, from the Chronicle screen): `chronicle.edit { id, …fields }` and
// `chronicle.remove { id }`, for an event (`ev_…`) or a faction (`fa_…`).

import {
    EVENT_ID, FACTION_ID, MAX_AKA, MAX_EVENTS, MAX_FACTIONS, MAX_NAME, MAX_NAMED, STATES,
    cleanName, cleanSummary, findIn, forgetSeen, isOpen, isRecord, keyOf, newId, prune, revOf,
} from './domain.js';

// The separator between a word and more text inside a label: an em or en dash, or a spaced hyphen.
const TEXT_DASH = /\s*[—–]\s*|\s+-\s+/;
const LIST = /\s*[,;/]\s*|\s+(?:and|&|vs\.?|versus|against)\s+/i;
const CLEAR = /^(?:none|-|—|nothing|nowhere|no one)$/i;

// The words a model writes for each state.
const STATE_WORDS = Object.freeze({
    looming: ['looming', 'brewing', 'rumoured', 'rumored', 'building', 'threatened', 'pending', 'rising', 'gathering', 'imminent'],
    ongoing: ['ongoing', 'active', 'underway', 'under way', 'open', 'raging', 'spreading', 'escalating', 'continuing', 'worsening', 'waning'],
    resolved: ['resolved', 'ended', 'over', 'done', 'finished', 'closed', 'averted', 'defeated', 'won', 'lost', 'stopped', 'ended peacefully'],
});

const asText = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const isInt = value => Number.isSafeInteger(value);

/** The line as the story wrote it, for messages. */
export function lineText(line) {
    const labels = Object.entries(line?.labels ?? {}).map(([label, value]) => ` | ${label}: ${value}`).join('');
    return `${line?.op ?? ''} ${line?.kind ?? ''} ${line?.name ?? ''}${line?.text ? ` — ${line.text}` : ''}${labels}`.trim();
}

/**
 * The Director's clock now, in story minutes, or null while it is not set: Story Block's
 * `ctx.time()` (SPEC §3.2), else the tracker's `director.time` query, else `director.time.minutes`.
 */
export function clockOf(ctx) {
    const tries = [
        () => (typeof ctx?.time === 'function' ? ctx.time() : undefined),
        () => (typeof ctx?.query === 'function' ? ctx.query('director.time', {})?.minutes : undefined),
        () => (typeof ctx?.read === 'function' ? ctx.read('director')?.time?.minutes : undefined),
    ];
    for (const fn of tries) {
        let value;
        try { value = fn(); } catch { value = undefined; }
        if (isInt(value)) return value;
    }
    return null;
}

/** A state word (`resolved — slain at the pass`): `{ state, rest }`, or `{ error }`. */
export function readState(value) {
    const text = asText(value).trim();
    const dash = TEXT_DASH.exec(text);
    const word = (dash ? text.slice(0, dash.index) : text).trim().toLowerCase().replace(/[.!]+$/, '');
    const rest = dash ? text.slice(dash.index + dash[0].length).trim() : '';
    const state = STATES.find(name => STATE_WORDS[name].includes(word));
    if (!state) return { error: `"${word || text}" is not a state; write looming, ongoing or resolved.` };
    return { state, rest };
}

/** Names in a list label (`Ashen Court, River Guild`), cleaned, at most `max`, no repeats. */
export function readNames(value, max = MAX_NAMED) {
    const out = [];
    for (const part of asText(value).split(LIST)) {
        const name = cleanName(part);
        if (!keyOf(name) || CLEAR.test(name) || out.some(other => keyOf(other) === keyOf(name))) continue;
        out.push(name);
        if (out.length >= max) break;
    }
    return out;
}

// The first label of `labels` given under one of `names`, or undefined.
function labelOf(labels, names) {
    for (const name of names) if (labels[name] !== undefined) return labels[name];
    return undefined;
}

const sameList = (a, b) => a.length === b.length && a.every((name, i) => name === b[i]);

// Keeps the old name findable after a rename (newest last, at most MAX_AKA).
function rememberName(entry, oldName) {
    const aka = (entry.aka ?? []).filter(name => keyOf(name) !== keyOf(oldName) && keyOf(name) !== keyOf(entry.name));
    entry.aka = [...aka, oldName].slice(-MAX_AKA);
}

/**
 * Applies `fields` (`summary`, `state`, `place`, `factions`) to an event (on the draft): what
 * changed, as words. `updated` and `rev` move only when something did.
 */
function changeEvent(chronicle, event, fields, { now, rev }) {
    const changes = [];
    if (fields.summary !== undefined && fields.summary !== event.summary) {
        event.summary = fields.summary;
        changes.push('summary');
    }
    if (fields.state !== undefined && fields.state !== event.state) {
        event.state = fields.state;
        changes.push(fields.state);
        if (!isOpen(event)) forgetSeen(chronicle, event.id);
    }
    if (fields.place !== undefined && fields.place !== event.place) {
        event.place = fields.place;
        changes.push(fields.place ? `at ${fields.place}` : 'no place');
    }
    if (fields.factions !== undefined && !sameList(fields.factions, event.factions)) {
        event.factions = fields.factions;
        changes.push(fields.factions.length ? `with ${fields.factions.join(', ')}` : 'no factions');
    }
    if (changes.length) {
        if (now !== null) event.updated = now;
        event.rev = rev;
    }
    return changes;
}

function eventSummary(event, created) {
    const where = event.place ? ` (${event.place})` : '';
    const about = event.summary ? ` — ${event.summary}` : '';
    if (event.state === 'resolved') return `World: ${event.name}${where} has ended${about}.`;
    return `World: ${event.name}${where} is ${created ? 'now ' : ''}${event.state}${about}.`;
}

// A summary text as the receipt tells it: the sentence's own full stop is not doubled.
const sentence = text => text.replace(/([.!?…])\.$/, '$1');

/** `apply(ctx, line)` for `world` lines. */
export function applyWorldLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '-', '!'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": world lines use +, ~, ! or -.`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names no world event.`);
    const labels = isRecord(line?.labels) ? line.labels : {};
    const stateLabel = labelOf(labels, ['state', 'status']);
    const read = stateLabel !== undefined ? readState(stateLabel) : null;
    if (read?.error) return ctx.fail('INVALID', `"${lineText(line)}": ${read.error}`);
    const text = cleanSummary([asText(line?.text).trim(), read?.rest ?? ''].filter(Boolean).join('; '));
    const placeLabel = labelOf(labels, ['place', 'where', 'at', 'near']);
    const place = placeLabel === undefined ? undefined : CLEAR.test(asText(placeLabel).trim()) ? '' : cleanName(placeLabel);
    const factionsLabel = labelOf(labels, ['factions', 'faction', 'who', 'sides']);
    const factions = factionsLabel === undefined ? undefined : readNames(factionsLabel);

    const chronicle = ctx.draft('chronicle');
    const now = clockOf(ctx);
    const rev = revOf(ctx);
    const found = findIn(chronicle.events, name);

    if (op === '-') {
        if (!found) return ctx.fail('NOT_FOUND', `There is no world event "${name}" in the chronicle to end.`);
        const event = chronicle.events[found.id];
        const changes = changeEvent(chronicle, event, { summary: text || undefined, state: 'resolved', place, factions }, { now, rev });
        prune(chronicle);
        return { summary: changes.length ? sentence(eventSummary(event, false)) : `World: ${event.name} had already ended.`, narrate: false, data: { event: event.id, state: event.state } };
    }

    if (!found) {
        const events = Object.values(chronicle.events);
        if (events.length >= MAX_EVENTS && events.every(isOpen)) {
            return ctx.fail('REFUSED', `The chronicle already follows ${MAX_EVENTS} world events under way; resolve or remove one first.`);
        }
        const id = newId(ctx, 'ev', chronicle.events);
        const event = {
            id, name, summary: text, state: read?.state ?? 'ongoing', since: now, updated: now,
            place: place ?? '', factions: factions ?? [], aka: [], rev,
        };
        chronicle.events[id] = event;
        const gone = prune(chronicle);
        if (!Object.hasOwn(chronicle.events, id)) return { summary: `World: ${name} has ended (too old to keep).`, narrate: false, data: { event: null, pruned: gone } };
        return { summary: sentence(eventSummary(event, true)), narrate: false, data: { event: id, created: true, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
    }

    const event = chronicle.events[found.id];
    const changes = changeEvent(chronicle, event, { summary: text || undefined, state: read?.state, place, factions }, { now, rev });
    const gone = prune(chronicle);
    if (!changes.length) return { summary: `World: ${event.name} is unchanged.`, narrate: false, data: { event: event.id, state: event.state } };
    return { summary: sentence(eventSummary(event, false)), narrate: false, data: { event: event.id, state: event.state, ...(gone.length ? { pruned: gone } : {}) } };
}

function changeFaction(faction, fields, rev) {
    const changes = [];
    for (const field of ['summary', 'area', 'stance']) {
        if (fields[field] === undefined || fields[field] === faction[field]) continue;
        faction[field] = fields[field];
        changes.push(field);
    }
    if (changes.length) faction.rev = rev;
    return changes;
}

function factionSummary(faction) {
    const about = [faction.area && `in ${faction.area}`, faction.stance].filter(Boolean).join(', ');
    return sentence(`Faction: ${faction.name}${about ? ` (${about})` : ''}${faction.summary ? ` — ${faction.summary}` : ''}.`);
}

const optionalText = value => (value === undefined ? undefined : CLEAR.test(asText(value).trim()) ? '' : cleanName(value));

/** `apply(ctx, line)` for `faction` lines. */
export function applyFactionLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '-', '!'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": faction lines use +, ~ or -.`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names no faction.`);
    const labels = isRecord(line?.labels) ? line.labels : {};
    const chronicle = ctx.draft('chronicle');
    const found = findIn(chronicle.factions, name);
    const rev = revOf(ctx);

    if (op === '-') {
        if (!found) return ctx.fail('NOT_FOUND', `There is no faction "${name}" in the chronicle.`);
        delete chronicle.factions[found.id];
        const why = cleanSummary(line?.text);
        return { summary: `Faction: ${found.name} is gone${why ? ` — ${why}` : ''}.`, narrate: false, data: { faction: found.id, removed: true } };
    }

    const fields = {
        summary: asText(line?.text).trim() ? cleanSummary(line.text) : undefined,
        area: optionalText(labelOf(labels, ['area', 'region', 'where', 'territory', 'holds'])),
        stance: optionalText(labelOf(labels, ['stance', 'toward', 'towards', 'attitude'])),
    };
    if (!found) {
        if (Object.keys(chronicle.factions).length >= MAX_FACTIONS) return ctx.fail('REFUSED', `The chronicle already keeps ${MAX_FACTIONS} factions; remove one first.`);
        const id = newId(ctx, 'fa', chronicle.factions);
        const faction = { id, name, summary: fields.summary ?? '', area: fields.area ?? '', stance: fields.stance ?? '', aka: [], rev };
        chronicle.factions[id] = faction;
        return { summary: factionSummary(faction), narrate: false, data: { faction: id, created: true } };
    }
    const faction = chronicle.factions[found.id];
    const changes = changeFaction(faction, fields, rev);
    return { summary: changes.length ? factionSummary(faction) : `Faction: ${faction.name} is unchanged.`, narrate: false, data: { faction: faction.id } };
}

// ---- the reader's commands -----------------------------------------------------------------------

const EVENT_FIELDS = ['id', 'name', 'summary', 'state', 'place', 'factions'];
const FACTION_FIELDS = ['id', 'name', 'summary', 'area', 'stance'];

// A field of an edit: undefined (keep: missing or empty), '' (clear: null or "none"), or the text.
function editText(value, { clearable = true } = {}) {
    if (value === undefined) return undefined;
    if (value === null) return clearable ? '' : undefined;
    if (typeof value !== 'string') return { error: true };
    const text = value.trim();
    if (!text) return undefined;
    if (clearable && CLEAR.test(text)) return '';
    return text;
}

function rename(ctx, table, entry, given, what) {
    const name = cleanName(given);
    if (!keyOf(name)) return ctx.fail('INVALID', `A ${what} needs a name.`);
    if (given.trim().length > MAX_NAME) return ctx.fail('INVALID', `A name has at most ${MAX_NAME} characters.`);
    if (name === entry.name) return false;
    const owner = findIn(table, name);
    if (owner && owner.id !== entry.id) return ctx.fail('REFUSED', `There is already a ${what} called ${owner.name}.`);
    const old = entry.name;
    entry.name = name;
    if (keyOf(old) !== keyOf(name)) rememberName(entry, old);
    entry.aka = (entry.aka ?? []).filter(other => keyOf(other) !== keyOf(name));
    return true;
}

/**
 * `chronicle.edit { id, name?, summary?, state?, place?, factions? }` for an event, or
 * `{ id, name?, summary?, area?, stance? }` for a faction: the reader's corrections. An empty
 * field keeps what is there; `none` (or null) clears a place, the factions, an area or a stance.
 */
export function edit(ctx, payload = {}) {
    if (!isRecord(payload) || typeof payload.id !== 'string') return ctx.fail('INVALID', 'Say what to change: { id, … }.');
    const chronicle = ctx.draft('chronicle');
    const isEvent = EVENT_ID.test(payload.id);
    if (!isEvent && !FACTION_ID.test(payload.id)) return ctx.fail('INVALID', `"${payload.id}" is not a world event or a faction.`);
    const table = isEvent ? chronicle.events : chronicle.factions;
    if (!Object.hasOwn(table, payload.id)) return ctx.fail('NOT_FOUND', `There is no ${isEvent ? 'world event' : 'faction'} ${payload.id} in the chronicle.`);
    const allowed = isEvent ? EVENT_FIELDS : FACTION_FIELDS;
    const unknown = Object.keys(payload).filter(key => !allowed.includes(key));
    if (unknown.length) return ctx.fail('INVALID', `A ${isEvent ? 'world event' : 'faction'} has no ${unknown.join(', ')} to change.`);

    const read = {};
    for (const key of allowed.slice(1)) {
        read[key] = editText(payload[key], { clearable: !['name', 'summary', 'state'].includes(key) });
        if (read[key]?.error) return ctx.fail('INVALID', `The ${key} must be text.`);
    }
    if (Object.values(read).every(value => value === undefined)) return ctx.fail('INVALID', 'Nothing to change: every field is empty.');

    const entry = table[payload.id];
    const rev = revOf(ctx);
    const changes = [];
    if (read.name !== undefined && rename(ctx, table, entry, read.name, isEvent ? 'world event' : 'faction')) changes.push(`now called ${entry.name}`);
    if (isEvent) {
        let state;
        if (read.state !== undefined) {
            const parsed = readState(read.state);
            if (parsed.error) return ctx.fail('INVALID', parsed.error);
            state = parsed.state;
        }
        const fields = {
            summary: read.summary !== undefined ? cleanSummary(read.summary) : undefined,
            state,
            place: read.place !== undefined ? cleanName(read.place) : undefined,
            factions: read.factions !== undefined ? readNames(read.factions) : undefined,
        };
        changes.push(...changeEvent(chronicle, entry, fields, { now: clockOf(ctx), rev }));
        prune(chronicle);
    } else {
        const fields = {
            summary: read.summary !== undefined ? cleanSummary(read.summary) : undefined,
            area: read.area !== undefined ? cleanName(read.area) : undefined,
            stance: read.stance !== undefined ? cleanName(read.stance) : undefined,
        };
        changes.push(...changeFaction(entry, fields, rev));
    }
    if (!changes.length) return { summary: '', narrate: false, data: { id: entry.id, changed: false } };
    entry.rev = rev;
    return { summary: `${entry.name}: ${changes.join(', ')}.`, narrate: false, data: { id: entry.id, changed: true } };
}

/** `chronicle.remove { id }`: the reader takes a world event or a faction out of the chronicle. */
export function remove(ctx, payload = {}) {
    if (!isRecord(payload) || typeof payload.id !== 'string') return ctx.fail('INVALID', 'Say what to remove: { id }.');
    const chronicle = ctx.draft('chronicle');
    if (EVENT_ID.test(payload.id) && Object.hasOwn(chronicle.events, payload.id)) {
        const { name } = chronicle.events[payload.id];
        delete chronicle.events[payload.id];
        forgetSeen(chronicle, payload.id);
        return { summary: `${name} is out of the chronicle.`, narrate: false, data: { id: payload.id, removed: 'event' } };
    }
    if (FACTION_ID.test(payload.id) && Object.hasOwn(chronicle.factions, payload.id)) {
        const { name } = chronicle.factions[payload.id];
        delete chronicle.factions[payload.id];
        return { summary: `${name} is out of the chronicle.`, narrate: false, data: { id: payload.id, removed: 'faction' } };
    }
    return ctx.fail('NOT_FOUND', `There is nothing called ${payload.id} in the chronicle.`);
}
