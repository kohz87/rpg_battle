// Small text helpers shared by the parsers, the schema and the displays (pure).

/** One line: runs of whitespace (newlines included) as one space, trimmed; cut at `max` if given. */
export function oneLine(value, max) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return max === undefined ? text : text.slice(0, max);
}

/** A comparison key: NFKC-normalized, trimmed, lower case ("Ｐotion " and "potion" match). */
export const foldKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

/** How many whitespace-separated words a text has. */
export const countWords = text => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
