// Story Director v2, chronicle part: what the model is told (pure).
//
// static: two fixed lines, the same bytes every reply of every chat (SPEC §5): what is worth a
// world or faction line, and what the [World] lines in the tail are for. The kinds' one-line
// grammar (GRAMMAR) is written by Story Block under its `<Changes>` header.
// tail: `[World] Under way off-screen:` and at most three open events picked by code (pick.js),
// each with its place, its summary and how long since the last news of it, so the story can move
// the world on. Within about 120 tokens; nothing when no event is open.

import { isOpen } from './domain.js';
import { nearness, scenePlaceOf, tailPick } from './pick.js';
import { agoText, nowFrom } from './queries.js';

export const TAIL_BUDGET = 120;
// Characters the lines may take: Story Block estimates tokens as characters / 4.
const MAX_CHARS = TAIL_BUDGET * 4;
const MAX_ITEM = 130;
export const TAIL_HEADER = '[World] Under way off-screen:';

/** Each chronicle kind's one line for the change-line instruction (SPEC §4.4). */
export const GRAMMAR = Object.freeze({
    world: '+ world Name — what is changing in the wider world | state: looming|ongoing|resolved | place: where | factions: who (~ world Name — what changed; - world Name — how it ended)',
    faction: '+ faction Name — who they are, what they want | area: where they hold sway | stance: toward {{user}} (~ faction Name to change it; - faction Name when it is gone)',
});

/** The chronicle's part of the static prompt: no names, counts, times or dice. */
export const STATIC_TEXT = [
    'World lines are for what changes the wider world (a war, a plague, a calamity, a power rising or falling), never the scene\'s own business; a faction line for a power that shapes it. Code keeps their dates.',
    'Under [World] are events still under way: when time and place allow, let one move on in the story and write its ~ world line.',
].join('\n');

const queryOf = view => (typeof view?.query === 'function' ? (name, args) => view.query(name, args) : null);

// One event as a tail line, cut to MAX_ITEM characters.
function itemLine(event, now) {
    const head = `- ${event.name}${event.place ? ` (${event.place})` : ''}`;
    const ago = Number.isSafeInteger(now) && Number.isSafeInteger(event.updated) ? agoText(now - event.updated) : '';
    const tail = ago ? ` Last news ${ago}.` : '';
    let about = event.summary ? `: ${event.summary.replace(/[.!?…]+$/, '')}.` : '.';
    const room = MAX_ITEM - head.length - tail.length;
    if (about.length > room) about = room > 8 ? `${about.slice(0, room - 2).replace(/\s+\S*$/, '')}….` : '.';
    return `${head}${about}${tail}`;
}

/** `context.tail(view)` → `{ lines, optional }` (SPEC §5). */
export function chronicleTail(view) {
    const chronicle = view?.state?.domains?.chronicle;
    if (!chronicle || !Object.values(chronicle.events ?? {}).some(isOpen)) return { lines: [], optional: [] };
    const query = queryOf(view);
    const near = nearness(query, scenePlaceOf(query, view.state));
    const at = Number.isSafeInteger(view?.chat?.length) ? view.chat.length : null;
    const rev = Number.isSafeInteger(view?.state?.meta?.rev) ? view.state.meta.rev : 0;
    const ids = tailPick(chronicle, { at, rev, near });
    const now = nowFrom(query, view.state);
    const lines = [TAIL_HEADER];
    let used = TAIL_HEADER.length;
    for (const id of ids) {
        const line = itemLine(chronicle.events[id], now);
        if (used + 1 + line.length > MAX_CHARS) break;
        lines.push(line);
        used += 1 + line.length;
    }
    return { lines: lines.length > 1 ? lines : [], optional: [] };
}
