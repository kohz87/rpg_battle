// A change line as the parts read it (B-b5b-robust-13): the host's parsed line ({ op, kind, name,
// text, labels, raw, index }) with every piece of the model's text cut to a bound BEFORE any pattern
// reads it. The model's text can be any length, and v1's parsers (story.js, items.js) run patterns
// that are slow on a long run of spaces; they are only ever reached with clipped text. Pure.

export const LINE_LIMITS = Object.freeze({ name: 200, text: 400, label: 200, key: 60, labels: 30, raw: 1000 });

const cut = (value, max) => String(value ?? '').trim().slice(0, max).trim();

/** The line with its name, text, labels (at most LINE_LIMITS.labels of them) and raw text cut to size. */
export function clipLine(line) {
    if (!line || typeof line !== 'object') return line;
    const labels = {};
    for (const [key, value] of Object.entries(line.labels && typeof line.labels === 'object' ? line.labels : {}).slice(0, LINE_LIMITS.labels)) {
        labels[cut(key, LINE_LIMITS.key)] = cut(value, LINE_LIMITS.label);
    }
    return {
        ...line,
        name: cut(line.name, LINE_LIMITS.name),
        text: cut(line.text, LINE_LIMITS.text),
        labels,
        ...(line.raw !== undefined ? { raw: String(line.raw ?? '').slice(0, LINE_LIMITS.raw) } : {}),
    };
}

/** How many template slugs a prompt line names before "and N more" (the quest line and the trainer line alike). */
export const LISTED_TEMPLATES = 8;

/** "templates: a, b, c" or, past LISTED_TEMPLATES, "templates: a, …, h and 3 more": the open templates a prompt line names. '' without any. */
export function templateList(slugs) {
    const list = (Array.isArray(slugs) ? slugs : []).filter(slug => typeof slug === 'string' && slug);
    if (!list.length) return '';
    const more = list.length - LISTED_TEMPLATES;
    return `templates: ${list.slice(0, LISTED_TEMPLATES).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** A kind's apply that only ever sees a clipped line. */
export const clipped = apply => (ctx, line) => apply(ctx, clipLine(line));
