// Money: one currency per chat (MODULES.md F1). The currency has one name, set in Story Block's
// settings (default 'gold'); the reader may rename it, never add a second. A wallet is one integer
// per owner under `coin`: wallets[owner] = { coin: 125 }. Pure.

export const WALLET_KEY = 'coin';
export const DEFAULT_CURRENCY = Object.freeze({ name: 'gold', short: 'g' });

const MAX_NAME = 24;
const MAX_SHORT = 6;

/**
 * The currency from this module's settings ({ currency?, currencyShort? }): { name, short }.
 * The short form defaults to the name's first letter, lowercased.
 */
export function currencyOf(settings) {
    const name = String(settings?.currency ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || DEFAULT_CURRENCY.name;
    const short = String(settings?.currencyShort ?? '').trim().slice(0, MAX_SHORT)
        || (name === DEFAULT_CURRENCY.name ? DEFAULT_CURRENCY.short : name[0].toLowerCase());
    return { name, short };
}

/**
 * An amount from a coin line: only the number counts ("30", "30 gold", "1,200 crowns"); coin words
 * are ignored. { amount } or { error } with a plain sentence. Two numbers are refused, not added up.
 */
export function parseAmount(text) {
    const numbers = String(text ?? '').match(/\d[\d,.]*/g) ?? [];
    if (!numbers.length) return { error: 'No amount of money was written.' };
    if (numbers.length > 1) return { error: `"${String(text).trim()}" holds more than one number; write one amount.` };
    const written = numbers[0].replace(/[.,]$/, '');
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(written)) return { error: `"${written}" is not a whole amount.` };
    const amount = Number(written.replace(/,/g, ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'The amount must be more than nothing.' };
    return { amount };
}

/** "30 gold". */
export function formatAmount(amount, currency = DEFAULT_CURRENCY) {
    return `${Math.max(0, Math.round(Number(amount) || 0))} ${currency.name}`;
}

/** One wallet ({ coin: n }) as text. */
export function formatWallet(wallet, currency = DEFAULT_CURRENCY) {
    return formatAmount(wallet?.[WALLET_KEY] ?? 0, currency);
}
