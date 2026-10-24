// The reader's SillyTavern persona (MODULES §F11, §F22): your character's name and background come
// from it, never from the wizard, and its avatar is the default portrait. This is the only place
// creation reads SillyTavern, and every read falls back to empty, so the rest of the part stays pure
// and testable. Story Block may pass the persona in instead (`view.persona = { name, background,
// avatar }`), which wins.
//
// SillyTavern: the persona name is getContext().name1; the description is power_user's
// persona_description (getContext().powerUserSettings, else the global power_user); the avatar file
// is user_avatar (else the default persona of the settings), shown through /thumbnail?type=persona&file=….

export const BACKGROUND_LIMIT = 2000;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = value => (typeof value === 'string' ? value.trim() : '');

function safe(fn) {
    try {
        return fn();
    } catch {
        return null;
    }
}

/** A persona avatar file as the image path SillyTavern serves it ('' for none). */
export function avatarUrl(file) {
    const name = textOf(file);
    if (!name) return '';
    if (/^(?:https:|data:image\/|\/)/i.test(name)) return name;
    return `/thumbnail?type=persona&file=${encodeURIComponent(name)}`;
}

/**
 * { name, background, avatar } from SillyTavern (`st` = { context, powerUser, userAvatar } for
 * tests; by default the live globals). Empty strings for anything missing.
 */
export function readPersona(st = null) {
    const g = globalThis;
    const context = st ? st.context ?? null : safe(() => g.SillyTavern?.getContext?.()) ?? safe(() => g.getContext?.());
    const powerUser = (st ? st.powerUser : null) ?? context?.powerUserSettings ?? (st ? null : g.power_user) ?? null;
    // The avatar file as Story Block's readHeroContext finds it: the context's, else SillyTavern's global user_avatar, else the
    // default persona of the settings (power_user's default_persona: the file a new chat uses). The context may carry neither.
    const file = (st ? st.userAvatar : null) ?? context?.user_avatar ?? context?.userAvatar ?? (st ? null : g.user_avatar) ?? powerUser?.default_persona ?? '';
    return {
        name: textOf(context?.name1).slice(0, 40),
        background: textOf(powerUser?.persona_description).slice(0, BACKGROUND_LIMIT),
        avatar: avatarUrl(file),
    };
}

/** The persona for the wizard: `view.persona` when the host gives one, else readPersona(). */
export function personaFor(view = null, st = null) {
    const given = isRecord(view?.persona) ? view.persona : null;
    const live = given ? null : readPersona(st);
    const pick = key => textOf(given ? given[key] : live[key]);
    return {
        name: pick('name').slice(0, 40),
        background: pick('background').slice(0, BACKGROUND_LIMIT),
        avatar: given ? avatarUrl(given.avatar) : live.avatar,
    };
}
