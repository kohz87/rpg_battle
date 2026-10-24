// RPG Battle v2, screens for the rules-v2 views (track C): the names of classes, skills and forms.
//
// The contract's views carry definition ids where a screen needs a name (a promotion's `choices: Ref[]`, a path
// step's `options`). The contract names no query for them, so this reads one stand-in, `rules.names({ refs })`, which
// answers { [ref]: name } and leaves out what it does not know (CONTRACT GAP, pending B: see tests/v2/screens/rules/
// fixtures.js). Without it, or for a ref it does not know, the tail of the id is shown, never a made-up name.

import { ASK, ask, isRecord } from './ask.js';
import { clip, refTail } from './format.js';

/** The most refs one lookup asks for (a screen needs a few dozen at most). */
export const NAMES_MAX = 200;

/**
 * namesFor(tools, refs) → name(ref) → text. One query for all refs; a missing or malformed answer is "no names".
 */
export function namesFor(tools, refs) {
    const wanted = [...new Set((Array.isArray(refs) ? refs : []).filter(ref => typeof ref === 'string' && ref))].slice(0, NAMES_MAX);
    const table = new Map();
    if (wanted.length) {
        const found = ask(tools, 'rules.names', { refs: wanted }, isRecord);
        if (found.status === ASK.OK) {
            for (const [ref, name] of Object.entries(found.value)) if (typeof name === 'string' && name.trim()) table.set(ref, clip(name.trim(), 80));
        }
    }
    return ref => table.get(ref) ?? refTail(ref);
}
