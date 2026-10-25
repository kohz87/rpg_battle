// Quest noun normalization transferred with the parser; no state or payout authority.
const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const PLURALS = { wolves: 'wolf', knives: 'knife', leaves: 'leaf', mice: 'mouse', geese: 'goose' };

export function entityKey(value) {
    const words = clean(value).toLowerCase().split(' ');
    const last = words.at(-1) ?? '';
    words[words.length - 1] = PLURALS[last] ?? (last.endsWith('ies') ? `${last.slice(0, -3)}y`
        : /(?:ches|shes|xes|zes)$/.test(last) ? last.slice(0, -2)
            : /[^s]s$/.test(last) && !/(?:ss|us|is)$/.test(last) ? last.slice(0, -1) : last);
    return words.join(' ');
}
