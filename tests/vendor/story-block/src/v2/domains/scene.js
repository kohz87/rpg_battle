// The `scene` domain (§7): where the story is and who is present, with its validator,
// commands, capture kinds `place` and `present`, queries and prompt view. Pure.

import { isPlainObject, labelOf } from './common.js';
import { cleanName, trimText } from './names.js';

const MAX_NAME = 80;
const MAX_PRESENT = 40;

export function initialScene() {
    return { place: { name: '', kind: '', region: '' }, present: [] };
}

/** §2.5 validator for the scene slice: [] when fine, else plain sentences. */
export function validateScene(slice) {
    if (!isPlainObject(slice)) return ['The scene is not a record.'];
    const errors = [];
    const place = slice.place;
    if (!isPlainObject(place)) errors.push('The scene has no place record.');
    else {
        for (const field of ['name', 'kind', 'region']) {
            if (typeof place[field] !== 'string') errors.push(`The place's ${field} is not text.`);
            else if (place[field].length > MAX_NAME) errors.push(`The place's ${field} is longer than ${MAX_NAME} characters.`);
        }
    }
    if (!Array.isArray(slice.present)) errors.push('The scene has no list of who is present.');
    else {
        const seen = new Set();
        for (const name of slice.present) {
            if (typeof name !== 'string' || !name.trim()) {
                errors.push('Someone present has no name.');
                continue;
            }
            if (name.length > MAX_NAME) errors.push(`The name "${trimText(name, 30)}" is longer than ${MAX_NAME} characters.`);
            if (seen.has(name.toLowerCase())) errors.push(`${name} is listed as present twice.`);
            seen.add(name.toLowerCase());
        }
        if (slice.present.length > MAX_PRESENT) errors.push(`At most ${MAX_PRESENT} people can be listed as present.`);
    }
    return errors;
}

const told = ctx => ctx.cause !== 'story';
const nameList = value => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function field(ctx, value, what) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') ctx.fail('INVALID', `The place's ${what} must be text.`);
    const text = value.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_NAME) ctx.fail('INVALID', `The place's ${what} is longer than ${MAX_NAME} characters.`);
    return text;
}

// A new place clears its kind (a village is not a dungeon) but keeps the region unless told.
function setPlace(ctx, { name, kind, region }) {
    const scene = ctx.draft('scene');
    const placeName = field(ctx, name, 'name');
    if (!placeName) ctx.fail('INVALID', 'A place needs a name.');
    const moved = placeName.toLowerCase() !== scene.place.name.toLowerCase();
    scene.place = {
        name: placeName,
        kind: field(ctx, kind, 'kind') ?? (moved ? '' : scene.place.kind),
        region: field(ctx, region, 'region') ?? scene.place.region,
    };
    return {
        summary: moved ? `The scene moves to ${placeName}.` : `${placeName} is described anew.`,
        data: { ...scene.place, moved },
        narrate: told(ctx),
    };
}

function changePresent(ctx, { add, remove }) {
    const scene = ctx.draft('scene');
    const index = name => scene.present.findIndex(other => other.toLowerCase() === name.toLowerCase());
    const added = [];
    const removed = [];
    for (const raw of nameList(remove)) {
        const name = typeof raw === 'string' ? cleanName(raw) : '';
        if (!name) ctx.fail('INVALID', 'Say who leaves.');
        const at = index(name);
        if (at < 0) ctx.fail('NOT_FOUND', `${name} is not in the scene.`);
        removed.push(scene.present[at]);
        scene.present.splice(at, 1);
    }
    for (const raw of nameList(add)) {
        const name = typeof raw === 'string' ? cleanName(raw) : '';
        if (!name) ctx.fail('INVALID', 'Say who arrives.');
        if (name.length > MAX_NAME) ctx.fail('INVALID', `A name is at most ${MAX_NAME} characters.`);
        if (index(name) >= 0) continue;   // already here: nothing to change
        scene.present.push(name);
        added.push(name);
    }
    const parts = [];
    if (added.length) parts.push(`${added.join(', ')} ${added.length === 1 ? 'is' : 'are'} here`);
    if (removed.length) parts.push(`${removed.join(', ')} ${removed.length === 1 ? 'leaves' : 'leave'}`);
    return {
        summary: parts.length ? `${parts.join('; ')}.` : 'No one arrives or leaves.',
        data: { added, removed, present: [...scene.present] },
        narrate: told(ctx) && parts.length > 0,
    };
}

export const sceneCommands = {
    // { name, kind?, region? }
    'scene.place': (ctx, payload = {}) => setPlace(ctx, payload),
    // { add?: name | name[], remove?: name | name[] }
    'scene.present': (ctx, payload = {}) => changePresent(ctx, payload),
};

/** `~ place Name | kind | region` (or `+ place`). */
export function capturePlace(ctx, line) {
    if (line?.op !== '~' && line?.op !== '+') {
        ctx.fail('INVALID', `"${line?.op} place" is not a change the scene understands; use ~ place Name.`);
    }
    return setPlace(ctx, { name: cleanName(line.name), kind: labelOf(line, 'kind', 'type'), region: labelOf(line, 'region', 'area') });
}

/** `+ present Name`, `- present Name` (several names may be separated by commas). */
export function capturePresent(ctx, line) {
    const names = String(line?.name ?? '').split(',').map(cleanName).filter(Boolean);
    if (!names.length) ctx.fail('INVALID', 'A present line needs a name.');
    if (line.op === '+') return changePresent(ctx, { add: names });
    if (line.op === '-') return changePresent(ctx, { remove: names });
    return ctx.fail('INVALID', `"${line.op} present" is not a change the scene understands; use + present or - present.`);
}

export const sceneQueries = {
    'scene.place': state => ({ ...(state?.domains?.scene?.place ?? initialScene().place) }),
    'scene.present': state => [...(state?.domains?.scene?.present ?? [])],
};

/** The scene's tail lines: the place and who is present (nothing when both are empty). */
export function sceneTail(state) {
    const scene = state?.domains?.scene;
    const lines = [];
    const place = scene?.place;
    if (place?.name) {
        const about = [place.kind, place.region].filter(Boolean);
        lines.push(`Place: ${place.name}${about.length ? ` (${about.join(', ')})` : ''}`);
    }
    if (scene?.present?.length) lines.push(`Present: ${scene.present.join(', ')}`);
    return lines;
}
