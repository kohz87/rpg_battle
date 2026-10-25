// Change lines: the short `<Director>` lines the main model writes at the end of each reply
// (`+ agenda Courier — now: … | then: …`). Parsing is lenient because models drift (bold,
// bullets, either dash, a colon instead of a dash); a line that is not an op becomes an
// error entry, never an exception. Pure: no DOM, no globals.

export const KINDS = ['agenda', 'event', 'hook', 'quest', 'clock', 'beat', 'secret', 'arc'];

// The old World_State list names and Megumin's blueprint names, so a model that writes the
// list it remembers still lands on the right kind.
export const KIND_ALIASES = Object.freeze({
    offscreen: 'agenda',
    'off-screen': 'agenda',
    npc: 'agenda',
    world: 'event',
    thread: 'hook',
    hooks: 'hook',
    timer: 'clock',
    clocks: 'clock',
    plan: 'beat',
    'off-limits': 'secret',
    'story arc': 'arc',
    quests: 'quest',
    bounty: 'quest',
    bounties: 'quest',
    contract: 'quest',
    contracts: 'quest',
    mission: 'quest',
    favour: 'quest',
    favor: 'quest',
});

// `+ bounty Wolf pelts — …` is a quest of type bounty: the word written is its category.
export const QUEST_TYPE_WORDS = Object.freeze({
    bounty: 'bounty', bounties: 'bounty', contract: 'contract', contracts: 'contract',
    mission: 'mission', favour: 'favour', favor: 'favour',
});

// A quest's own parts: its category (main, side, bounty, contract…), who gave it, what it
// asks, what it pays, the step it is at, and (v0.8.2) how hard it is.
export const QUEST_FIELDS = ['type', 'giver', 'goal', 'reward', 'step', 'difficulty', 'target'];

// A quest's difficulty is one of four words, so other extensions can scale by it (RPG Battle
// awards quest XP by it). A missing or unreadable one is normal.
export const QUEST_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard', 'nightmare']);
const DIFFICULTY_WORDS = Object.freeze({
    easy: 'easy', trivial: 'easy', simple: 'easy', minor: 'easy', light: 'easy', low: 'easy',
    normal: 'normal', medium: 'normal', moderate: 'normal', average: 'normal', standard: 'normal', regular: 'normal',
    hard: 'hard', difficult: 'hard', tough: 'hard', challenging: 'hard', dangerous: 'hard', high: 'hard',
    nightmare: 'nightmare', deadly: 'nightmare', impossible: 'nightmare', extreme: 'nightmare', lethal: 'nightmare', insane: 'nightmare',
});

/** `easy | normal | hard | nightmare` for a written difficulty: the first word it knows, else normal. */
export function questDifficulty(value) {
    const words = stripMarkdown(value).toLowerCase().split(/[^\p{L}]+/u);
    const known = words.find(word => Object.hasOwn(DIFFICULTY_WORDS, word));
    return known ? DIFFICULTY_WORDS[known] : 'normal';
}
// A planned fight: who the foes are, as free text in RPG Battle's shape (`3 bandit, bandit
// captain (boss)`, `2 x dire wolf rank D`). Story Director only stores and schedules it; the
// fight itself is resolved by another extension, so the text is never parsed here.
// (0.9.19) `reach`: how a beat touches {{user}} wherever they are (a price, a door shut, a
// mood), free text the planner writes; the note shows it once the beat is due.
export const FIELDS = ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people', 'encounter', 'reach', ...QUEST_FIELDS];
// A comma or semicolon before one of the format's fields ("…, giver: Nelke"), for runs written without "|".
// Read at each comma or semicolon with a sticky regex (see splitFieldRun), so a long run of spaces
// is walked once, not once per space.
const FIELD_AFTER = new RegExp(`\\s*(?:${FIELDS.join('|')})\\s*:`, 'iy');

// Only a spaced hyphen ends a key, so `Jean-Luc` and `Hall-Warden` stay whole; em and en
// dashes never appear inside names, so they count with or without spaces. Found by keyDash in one
// pass (it was `/\s*[—–]\s*|\s+-(?:\s+|$)/`, quadratic on a long run of spaces).
const isSpace = ch => /\s/.test(ch);

// `label: value`: the label is words (so the `09` of `09:00` is not one) and the colon is
// followed by a space or the end (so `09:00` and `a:b` stay inside values). Read by labelled in
// one pass (it was `/^(\p{L}[\p{L}\p{N}'’ -]*?)\s*:(?:\s+|$)(.*)$/su`, quadratic on spaces).
const LABEL_WORDS = /^\p{L}[\p{L}\p{N}'’ -]*$/u;
// A known field may skip the space (`on:Haywane 13`); an arbitrary label may not.
const TIGHT_FIELD = /^(\p{L}+):(.*)$/su;

const MAX_COLON_KEY_WORDS = 8;
const MAX_EXTRA_LABEL_WORDS = 3;

function stripMarkdown(text) {
    return String(text ?? '').replace(/\*\*|__|[*`]/g, '');
}

function wordCount(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Identity of a key: lowercase, markdown and punctuation squashed, single spaces. */
export function lineKey(key) {
    return stripMarkdown(key)
        .normalize('NFKC')
        .toLowerCase()
        // Dropped rather than spaced, so `Hollin's` and `Hollins` are the same record.
        .replace(/['’‘`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** The kind a word names (`hook`, or an alias such as `thread`), or null. */
export function kindOf(word) {
    const lower = String(word ?? '').trim().toLowerCase();
    if (KINDS.includes(lower)) return lower;
    return Object.hasOwn(KIND_ALIASES, lower) ? KIND_ALIASES[lower] : null;
}

// A quest only with who it is for, what it pays or a quest type (0.9.3); a goal, step or
// difficulty alone is an open thread, a hook.
function inferKind(fields) {
    const type = String(fields.type ?? '').trim().toLowerCase();
    if (fields.giver || fields.reward || type === 'quest' || type === 'quests' || Object.hasOwn(QUEST_TYPE_WORDS, type)) return 'quest';
    if (fields.goal || fields.step || fields.difficulty) return 'hook';
    if (fields.leg || fields.now) return 'agenda';
    if (fields.due) return 'clock';
    // Foes with nothing else to say what the record is: a planned fight is a beat.
    if (fields.encounter) return 'beat';
    return 'event';
}

// The format's own words (CHANGE_INSTRUCTION, the capture prompt), copied as if they were text.
const PLACEHOLDER = /^(?:part|summary|reason|what happened|(?:label|field):\s*value)$/i;

// The first spaced dash in `text` as `{ index, length }` (the spaces around it included), or null.
function keyDash(text) {
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const long = ch === '—' || ch === '–';
        const spaced = ch === '-' && i > 0 && isSpace(text[i - 1]) && (i + 1 === text.length || isSpace(text[i + 1]));
        if (!long && !spaced) continue;
        let start = i;
        while (start > 0 && isSpace(text[start - 1])) start -= 1;
        let end = i + 1;
        while (end < text.length && isSpace(text[end])) end += 1;
        return { index: start, length: end - start };
    }
    return null;
}

// `[label, value]` for `label: value` (the label untrimmed of inner spaces), or null. The label can
// hold no colon, so only the first colon can end it.
function labelled(part) {
    const colon = part.indexOf(':');
    if (colon < 1) return null;
    const after = part.slice(colon + 1);
    if (after && !isSpace(after[0])) return null;
    const label = part.slice(0, colon).trimEnd();
    if (!LABEL_WORDS.test(label)) return null;
    return [label, after.trimStart()];
}

// `text` split at each comma or semicolon that comes before one of the format's fields.
function splitFieldRun(text) {
    const pieces = [];
    let from = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== ',' && text[i] !== ';') continue;
        FIELD_AFTER.lastIndex = i + 1;
        if (!FIELD_AFTER.test(text)) continue;
        pieces.push(text.slice(from, i).trimEnd());
        from = i + 1;
        while (from < text.length && isSpace(text[from])) from += 1;
        i = from - 1;
    }
    pieces.push(text.slice(from));
    return pieces;
}

/** `{ field, value }`, `{ label, value }` (extra) or null for an unlabeled part. */
function splitLabel(part) {
    const match = labelled(part);
    if (match) {
        const label = match[0].trim().toLowerCase();
        const value = match[1].trim();
        if (FIELDS.includes(label)) return { field: label, value };
        if (wordCount(label) <= MAX_EXTRA_LABEL_WORDS) return { label, value };
        return null;
    }
    const tight = part.match(TIGHT_FIELD);
    if (tight && FIELDS.includes(tight[1].toLowerCase())) {
        return { field: tight[1].toLowerCase(), value: tight[2].trim() };
    }
    return null;
}

/** Splits the first part into the key and whatever follows it. */
function splitKey(first) {
    const dash = keyDash(first);
    if (dash) {
        return { key: first.slice(0, dash.index), head: first.slice(dash.index + dash.length) };
    }
    const colon = first.search(/:(?:\s|$)/);
    if (colon > 0 && wordCount(first.slice(0, colon)) <= MAX_COLON_KEY_WORDS) {
        let key = first.slice(0, colon);
        let head = first.slice(colon + 1).trim();
        // `Geva now: Court` (what is left of `**Geva now:** Court`): the trailing field word
        // labels the first part. Lowercase only, so a name like `The Long Leg` keeps its word.
        const tail = key.match(/^(.*\S)\s+([a-z]+)$/);
        if (tail && FIELDS.includes(tail[2])) {
            key = tail[1];
            head = `${tail[2]}: ${head}`;
        }
        return { key, head };
    }
    return { key: first, head: '' };
}

// Repeated loose text is joined rather than overwritten, so nothing the model wrote is lost.
function addText(target, name, value) {
    target[name] = target[name] && value ? `${target[name]}; ${value}` : target[name] || value;
}

function parseLine(raw) {
    let text = raw.replace(/\*\*|__/g, '').trim();
    // A bullet is decoration only when an op follows it: `- Thys — …` is itself an op.
    text = text.replace(/^[*•-]\s*(?=[+~!-]\s)/, '');
    const opMatch = text.match(/^([+~!-])\s+(.*)$/s);
    if (!opMatch) return { error: 'not a change line (expected + ~ - or ! followed by a key)' };
    const op = opMatch[1];
    let body = opMatch[2].trim();

    let kind = null;
    let kindWord = '';
    if (op === '+') {
        // `+ kind hook …`, the format's own word copied in front of the kind.
        const copied = body.match(/^kind\s*:?\s+(\S+)\s+(.*)$/is);
        if (copied && kindOf(copied[1])) {
            kind = kindOf(copied[1]);
            kindWord = copied[1].toLowerCase();
            // The kind is certain here, so a separator after it only means the key comes next.
            body = copied[2].replace(/^(?:[—–:|]|-(?=\s))\s*/, '');
        } else {
            const first = body.match(/^(\S+)\s+(.*)$/s);
            // The kind word only counts when a key follows it, not a separator.
            if (first && kindOf(first[1]) && !/^(?:[—–:|]|-(?:\s|$))/.test(first[2])) {
                kind = kindOf(first[1]);
                kindWord = first[1].toLowerCase();
                body = first[2];
            }
        }
    }

    // Split at "|" and trimmed (as `/\s*\|\s*/` did, without its quadratic walk over spaces).
    const parts = body.split('|').map(part => part.trim());
    const { key: rawKey, head } = splitKey(parts.shift());
    // (0.9.10) "~ Hook: Sheepfold Wolves — …": a kind and a colon in front of the key name the
    // kind, they are not part of the key. On a + with no kind yet, they set it.
    let key = stripMarkdown(rawKey).trim();
    const prefixed = key.match(/^([A-Za-z]+)\s*:\s*(\S.*)$/s);
    if (prefixed && kindOf(prefixed[1])) {
        key = prefixed[2].trim();
        if (op === '+' && !kind) {
            kind = kindOf(prefixed[1]);
            kindWord = prefixed[1].toLowerCase();
        }
    }
    const id = lineKey(key);
    if (!id) return { error: 'missing key' };
    if (head.trim()) parts.unshift(head);
    // (0.9.8) Fields run together with commas or semicolons, "type: contract, giver: Nelke, reward:
    // 2 silver", are split as if written with "|": only before a field the format knows, so a
    // comma inside a value ("Nelke, the clerk") stays.
    const expanded = parts.flatMap(splitFieldRun);

    const closing = op === '-' || op === '!';
    const fields = {};
    const extra = {};
    const loose = { text: '' };
    for (const part of expanded) {
        const trimmed = part.trim();
        // A placeholder copied from the format (`- Key — part`) says nothing.
        if (!trimmed || PLACEHOLDER.test(trimmed)) continue;
        const labelled = splitLabel(trimmed);
        if (labelled?.field === 'desc') addText(fields, 'desc', labelled.value);
        // Stored as one of the four words; an empty one clears it (and reads as normal).
        else if (labelled?.field === 'difficulty') fields.difficulty = labelled.value ? questDifficulty(labelled.value) : '';
        else if (labelled?.field) fields[labelled.field] = labelled.value;
        else if (labelled && closing && labelled.label === 'reason') addText(loose, 'text', labelled.value);
        // `label: …` or `field: …` copied from the format: the value is plain text.
        else if (labelled && (labelled.label === 'label' || labelled.label === 'field')) addText(loose, 'text', labelled.value);
        else if (labelled) extra[labelled.label] = labelled.value;
        else addText(loose, 'text', trimmed);
    }

    let reason = '';
    if (closing) reason = loose.text;
    else if (loose.text) {
        // Unlabeled text comes before an explicit `desc:` in the joined description.
        const labelled = fields.desc;
        fields.desc = '';
        addText(fields, 'desc', loose.text);
        addText(fields, 'desc', labelled ?? '');
    }

    if (op === '+' && !kind) kind = inferKind(fields);
    if (kind === 'quest' && !fields.type && Object.hasOwn(QUEST_TYPE_WORDS, kindWord)) fields.type = QUEST_TYPE_WORDS[kindWord];
    return { op: { op, kind, key, id, fields, extra, reason, raw: raw.trim() } };
}

/**
 * Parses change lines, one op per line. Blank lines are ignored; any other line that is not
 * an op becomes `{ line, text, message }` in `errors` (line is 1-based).
 */
export function parseChanges(text) {
    const ops = [];
    const errors = [];
    String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
        if (!raw.trim()) return;
        const result = parseLine(raw);
        if (result.op) ops.push(result.op);
        else errors.push({ line: index + 1, text: raw.trim(), message: result.error });
    });
    return { ops, errors };
}

function labelledPart(name, value) {
    return value ? `${name}: ${value}` : `${name}:`;
}

// Unlabeled leading text that would read back as `label: value` gets its label written out,
// so the round trip cannot reclassify it.
function leadPart(name, value) {
    return splitLabel(value) ? labelledPart(name, value) : value;
}

/** One change line for an op; `parseChanges(formatOp(op))` gives the same op back. */
export function formatOp(op) {
    const fields = op.fields ?? {};
    const extra = op.extra ?? {};
    const closing = op.op === '-' || op.op === '!';
    const parts = [];

    if (closing) {
        if (op.reason) parts.push(leadPart('reason', op.reason));
    } else if (Object.hasOwn(fields, 'desc')) {
        parts.push(fields.desc ? leadPart('desc', fields.desc) : 'desc:');
    }
    for (const name of FIELDS) {
        if (name === 'desc' && !closing) continue;
        if (Object.hasOwn(fields, name)) parts.push(labelledPart(name, fields[name]));
    }
    for (const [label, value] of Object.entries(extra)) parts.push(labelledPart(label, value));

    // A `+` always names its kind: inference could differ, and a key starting with an alias
    // word (`World Bank`) would otherwise lose that word to the kind.
    const kind = op.op === '+' ? ` ${op.kind || inferKind(fields)}` : '';
    const head = `${op.op}${kind} ${op.key}`;
    if (parts.length) return `${head} — ${parts.join(' | ')}`;
    // A bare dash keeps a key containing `: ` from being split at the colon.
    return /:(?:\s|$)/.test(op.key) ? `${head} —` : head;
}
