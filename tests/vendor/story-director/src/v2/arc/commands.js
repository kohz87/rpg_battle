// Story Director v2, part **arc**: the reader's commands for arcs (SPEC §3; cause `ui`, from the arc
// panel). Planning itself (the model call) is never a command: commands are pure. The panel asks the
// planner, shows the plan, and only the reader's Accept sends it here, as text; code reads it again
// (plan.js readPlan), so what is kept is what code read and capped, edited or not (WAVE rule 1).
//
// * `director.arc.accept { plan, reason?, note? }`: the new arc, and a thread for every item the Director
//   does not track yet, made by the tracker's own rules (tracker/capture.js applyThreadLine, as a `+` line
//   tagged `arc: <id>`), so they are the Director's beats, agendas, hooks, clocks and secrets like any
//   other. → data `{ arc, added: [thread id], pending: [item line] }`: `pending` are the items that name a
//   thread already tracked, which the panel sends one by one as `director.arc.update`, so a later delete of
//   the reply that made such a thread takes only that change away, never the whole plan (SPEC §2.2 blocks).
// * `director.arc.update { arc, line }`: one plan item onto a tracked thread (`~`, or `+` to open a closed
//   one again), for the current arc only, once per arc and thread (claim).
// * `director.arc.end { reason? }`: the current arc is over (End arc, or every beat played out). Its beats
//   stay open threads; the next plan supersedes it.
// The plan's lines are their own reply for the tracker's per-reply rules (one plan adds at most 16
// threads) and do not count as a reply: the tracker's reply count is put back as it was.

import { makeCalendar } from '../../calendar.js';
import { lineKey } from '../../changes.js';
import { applyThreadLine } from '../tracker/capture.js';
import { ARC_ROOM, FEATURE, arcList, currentArc } from './domain.js';
import { flat, itemLine, planCounts, readPlan } from './plan.js';

export const ACCEPT = 'director.arc.accept';
export const UPDATE = 'director.arc.update';
export const END = 'director.arc.end';

const REASONS = new Set(['manual', 'no-arc', 'arc-end', 'stalled', 'running-low']);
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const ARC_ID = /^arc_[0-9a-z]{8}$/;

function fail(ctx, code, message) {
    ctx.fail(code, message);
    const error = new Error(message);
    error.code = code;
    throw error;
}

const revOf = ctx => (Number.isSafeInteger(ctx?.rev) ? ctx.rev : 0);
const has = (object, key) => Boolean(object) && Object.hasOwn(object, key);

// The chat's calendar (the tracker's `director.calendar`), or null without one.
function calendarOf(ctx) {
    try {
        const config = ctx.query?.('director.calendar', {});
        return config && typeof config === 'object' ? makeCalendar(config) : null;
    } catch {
        return null;
    }
}

function planOptions(ctx, director, extra = {}) {
    const minutes = director?.time?.minutes;
    return { calendar: calendarOf(ctx), now: Number.isSafeInteger(minutes) ? minutes : null, fights: ctx.fights !== false, ...extra };
}

function newArcId(ctx, taken) {
    for (let tries = 0; tries < 64; tries += 1) {
        let id = typeof ctx.id === 'function' ? ctx.id('arc') : '';
        if (!ARC_ID.test(id ?? '')) {
            id = 'arc_';
            for (let i = 0; i < 8; i += 1) id += ID_CHARS[Math.floor(ctx.rng() * ID_CHARS.length) % ID_CHARS.length];
        }
        if (!has(taken, id)) return id;
    }
    throw new Error('No free arc id.');
}

// A plan item as the change line the tracker reads (SPEC §4.4's parsed form).
const lineOf = (item, arcId, index, op = '+') => ({
    op, kind: item.kind, word: item.kind, name: item.key, text: item.desc,
    labels: { ...item.parts, arc: arcId }, raw: itemLine(item), index,
});

// Runs plan lines through the tracker's rules as a reply of their own (`plan:<arc>`), then puts the
// tracker's reply count back: a plan is not a reply.
function applyLines(ctx, director, arcId, lines) {
    const saved = structuredClone(director.turn);
    const lineCtx = Object.freeze({ ...ctx, carrier: Object.freeze({ sid: `plan:${arcId}` }), chat: Object.freeze({ lastUser: '' }) });
    const out = lines.map(line => applyThreadLine(lineCtx, line));
    director.turn = saved;
    return out;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function countsText(plan) {
    const counts = planCounts(plan);
    return [
        counts.beat ? plural(counts.beat, 'beat') : '', counts.agenda ? plural(counts.agenda, 'agenda') : '',
        counts.hook ? plural(counts.hook, 'hook') : '', counts.clock ? plural(counts.clock, 'clock') : '',
        counts.secret ? plural(counts.secret, 'secret') : '',
    ].filter(Boolean).join(', ');
}

/** `director.arc.accept { plan, reason?, note? }` (cause ui). */
export function acceptArc(ctx, payload = {}) {
    const text = typeof payload?.plan === 'string' ? payload.plan : '';
    if (!text.trim()) fail(ctx, 'INVALID', 'There is no plan to accept.');
    const director = ctx.draft('director');
    const plan = readPlan(text, planOptions(ctx, director));
    const error = plan.findings.find(entry => entry.severity === 'error');
    if (error) fail(ctx, 'INVALID', error.text);
    const slice = ctx.draft('arc');
    const id = newArcId(ctx, slice.arcs);
    const minutes = director.time?.minutes;
    slice.arcs[id] = {
        id,
        key: plan.arc.key,
        desc: plan.arc.desc,
        rev: revOf(ctx),
        minutes: Number.isSafeInteger(minutes) ? minutes : null,
        reason: REASONS.has(payload?.reason) ? payload.reason : 'manual',
        note: flat(payload?.note, 16),
    };
    // The oldest arcs past ARC_ROOM go, by key, with their endings.
    const list = arcList(slice);
    for (const old of list.slice(0, Math.max(0, list.length - ARC_ROOM))) {
        delete slice.arcs[old.id];
        if (has(slice.ends, old.id)) delete slice.ends[old.id];
    }
    const fresh = [];
    const pending = [];
    for (const item of plan.items) {
        if (has(director.keys, lineKey(item.key))) pending.push(itemLine(item));
        else fresh.push(item);
    }
    const results = applyLines(ctx, director, id, fresh.map((item, index) => lineOf(item, id, index)));
    const added = results.map(result => result?.data?.thread).filter(thread => typeof thread === 'string');
    const counts = countsText(plan);
    return {
        summary: `New arc: ${plan.arc.key}${counts ? ` (${counts})` : ''}.`,
        // The Director note carries the arc and its threads from the next reply on.
        narrate: false,
        data: { arc: id, added, pending },
    };
}

/** `director.arc.update { arc, line }` (cause ui): one plan item onto a thread the Director already tracks. */
export function updateArc(ctx, payload = {}) {
    const slice = ctx.draft('arc');
    const current = currentArc(slice);
    if (!current?.active || current.id !== payload?.arc) fail(ctx, 'REFUSED', 'That arc is not the current one.');
    const director = ctx.draft('director');
    const plan = readPlan(String(payload?.line ?? ''), planOptions(ctx, director, { lone: true }));
    const [item] = plan.items;
    if (!item || plan.items.length !== 1) fail(ctx, 'INVALID', 'One plan line is needed.');
    const key = lineKey(item.key);
    const id = has(director.keys, key) ? director.keys[key] : null;
    const thread = id && has(director.threads, id) ? director.threads[id] : null;
    if (!thread) fail(ctx, 'REFUSED', `"${item.key}" is not tracked; it comes with the arc itself.`);
    if (!ctx.claim(`arc:${current.id}:${key}`)) fail(ctx, 'CLAIMED', `"${item.key}" is already part of this arc.`);
    const [result] = applyLines(ctx, director, current.id, [lineOf(item, current.id, 0, thread.status === 'active' ? '~' : '+')]);
    return {
        summary: `Arc ${current.key}: ${item.key}.`,
        narrate: false,
        data: { arc: current.id, thread: result?.data?.thread ?? null },
    };
}

/** `director.arc.end { reason? }` (cause ui): the current arc is over. */
export function endArc(ctx, payload = {}) {
    const slice = ctx.draft('arc');
    const current = currentArc(slice);
    if (!current?.active) fail(ctx, 'REFUSED', 'No arc is running.');
    if (!ctx.claim(`arc:${current.id}:end`)) fail(ctx, 'CLAIMED', 'That arc has already ended.');
    const reason = flat(payload?.reason, 120) || 'the arc ended';
    slice.ends[current.id] = { rev: revOf(ctx), reason };
    return { summary: `Arc ended: ${current.key} (${reason}).`, narrate: false, data: { arc: current.id, reason } };
}

const tagged = fn => Object.assign(fn, { feature: FEATURE });

export const commands = Object.freeze({
    [ACCEPT]: tagged((ctx, payload) => acceptArc(ctx, payload)),
    [UPDATE]: tagged((ctx, payload) => updateArc(ctx, payload)),
    [END]: tagged((ctx, payload) => endArc(ctx, payload)),
});
