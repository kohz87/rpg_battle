// RPG Battle v2, one question to another part: its answer, or null when the query is not there, throws, or no query function was given.
// The part asks by query only, never by reading another owner's domain; a part that is absent holds only what depends on it.

/** `query(name, args)` through a ctx's or a view's query, or null. */
export const ask = (query, name, args) => {
    try {
        return typeof query === 'function' ? query(name, args) : null;
    } catch {
        return null;
    }
};
