// RPG Battle v2, part **craft**: the `craft` domain, its limits and its validator (SPEC §2.5). Pure.
//
//   craft = {
//     known:  { [`<actor>|<recipe>`]: { actor, recipe, name, from, rev } },     // learned from the story
//     forgot: { [`<actor>|<recipe>`]: { actor, recipe, rev } },                 // a basic recipe forgotten
//     taught: { [`story/<slug>`]: { id, name, craft, makes: { name }, materials: [{ name, qty }], dc,
//               minutes, rarity, from, rev } },                                 // story-taught, this chat only
//     uses:   { [made id]: { actor, craft, rev } },                             // one use of a craft each
//     made:   { [made id]: { id, actor, name, recipe, recipeName, craft, carrier, rev, roll, die, modifiers,
//               mod, dc, total, quality, said, mismatch, note, item, qty, lost, refine, minutes, text } },
//   }
//
// Every record is written once under its own key (SPEC §2.2, B-b1r2-13): a learn adds a key, a
// forget removes it (and, for a pack's basic recipe, adds a `forgot` key), a craft adds its `made`
// and `uses` keys. Nothing is a list position and no reply rewrites a field another reply made, so a
// reply deleted from the middle of the chat takes exactly its own records with it. A pack recipe
// marked `known: true` is known by everyone from the start and never stored (derived). A craft's
// rank is counted from its uses (rules.js rankOf); uses past the top rank are not kept. `made` keeps
// the latest MAX_MADE crafts (the reply's card, the screen), the oldest removed (Story Block passes
// over the remove of a key a deleted reply had made).

export const MAX_MADE = 30;
export const MAX_KNOWN = 600;
export const MAX_KNOWN_EACH = 60;
export const MAX_TAUGHT = 40;
export const MAX_USES = 4000;
export const MAX_PER_REPLY = 2;
export const MAX_MATERIALS = 8;
// What the validator allows: 4× the kept number (a replay after a middle delete may keep one the
// deleted reply had pruned; the next write prunes again).
const slack = most => most * 4;

const ACTOR_ID = /^ac_[0-9a-z]{8}$/;
const MADE_ID = /^cr_[0-9a-z]{8}$/;
const RECIPE_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export const initialCraft = () => ({ known: {}, forgot: {}, taught: {}, uses: {}, made: {} });

export const knowKey = (actor, recipe) => `${actor}|${recipe}`;

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const str = (value, max, { empty = true } = {}) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);

/** The craft slice as a command finds it, every record there (an older chat's missing ones added). */
export function draftCraft(ctx) {
    const craft = ctx.draft('craft');
    for (const key of ['known', 'forgot', 'taught', 'uses', 'made']) if (!isRecord(craft[key])) craft[key] = {};
    return craft;
}

/** The oldest entries of `record` (by rev, then key) removed until `most` are left; `keep` stays. */
export function prune(record, most, keep) {
    const keys = Object.keys(record);
    if (keys.length <= most) return;
    const oldest = keys.filter(key => key !== keep)
        .sort((a, b) => ((record[a]?.rev ?? 0) - (record[b]?.rev ?? 0)) || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, keys.length - most);
    for (const key of oldest) delete record[key];
}

/** The crafts kept, oldest first (by rev, then id). */
export const madeEntries = craft => Object.values(isRecord(craft?.made) ? craft.made : {})
    .filter(isRecord).sort((a, b) => ((a.rev ?? 0) - (b.rev ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** How many uses of each craft each member has: { [actor]: { [craft]: n } }. */
export function usesOf(craft) {
    const out = {};
    for (const entry of Object.values(isRecord(craft?.uses) ? craft.uses : {})) {
        if (!isRecord(entry) || typeof entry.actor !== 'string' || typeof entry.craft !== 'string') continue;
        const mine = (out[entry.actor] ??= {});
        mine[entry.craft] = (mine[entry.craft] ?? 0) + 1;
    }
    return out;
}

function checkMaterials(list, where, errors) {
    if (!Array.isArray(list) || !list.length || list.length > MAX_MATERIALS) return errors.push(`${where}: 1 to ${MAX_MATERIALS} materials are needed.`);
    list.forEach((part, index) => {
        if (!isRecord(part) || !str(part.name, 80, { empty: false }) || !int(part.qty, 1, 99)) errors.push(`${where}, material ${index + 1}: a name and a count from 1 to 99.`);
    });
}

/** validate(slice) → string[] for the `craft` domain. */
export function validateCraft(slice) {
    if (!isRecord(slice)) return ['The crafting records are missing.'];
    const errors = [];
    for (const key of ['known', 'forgot', 'taught', 'uses', 'made']) {
        if (slice[key] !== undefined && !isRecord(slice[key])) errors.push(`craft.${key} must be a record.`);
    }
    if (errors.length) return errors;
    const known = Object.entries(slice.known ?? {});
    if (known.length > slack(MAX_KNOWN)) errors.push(`About ${MAX_KNOWN} known recipes are kept at most.`);
    for (const [key, entry] of known) {
        const at = `Known recipe ${key}`;
        if (!isRecord(entry) || !ACTOR_ID.test(String(entry.actor)) || !RECIPE_ID.test(String(entry.recipe)) || key !== knowKey(entry.actor, entry.recipe)) { errors.push(`${at}: an actor, a recipe id and its own key are needed.`); continue; }
        if (!str(entry.name, 80, { empty: false }) || !str(entry.from ?? '', 60) || !int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${at}: a name, where it was learned and a rev.`);
    }
    for (const [key, entry] of Object.entries(slice.forgot ?? {})) {
        if (!isRecord(entry) || !ACTOR_ID.test(String(entry.actor)) || !RECIPE_ID.test(String(entry.recipe)) || key !== knowKey(entry.actor, entry.recipe) || !int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`Forgotten recipe ${key}: an actor, a recipe id, its own key and a rev.`);
    }
    if (Object.keys(slice.forgot ?? {}).length > slack(MAX_KNOWN)) errors.push('Too many forgotten recipes are kept.');
    const taught = Object.entries(slice.taught ?? {});
    if (taught.length > slack(MAX_TAUGHT)) errors.push(`About ${MAX_TAUGHT} story-taught recipes are kept at most.`);
    for (const [key, entry] of taught) {
        const at = `Story recipe ${key}`;
        if (!isRecord(entry) || entry.id !== key || !/^story\/[a-z0-9-]+$/.test(key)) { errors.push(`${at}: kept under its own story/<slug> id.`); continue; }
        if (!str(entry.name, 80, { empty: false }) || !str(entry.craft, 40, { empty: false }) || !isRecord(entry.makes) || !str(entry.makes.name, 80, { empty: false })) errors.push(`${at}: a name, a craft and what it makes.`);
        checkMaterials(entry.materials, at, errors);
        if (!int(entry.dc, 1, 40) || !int(entry.minutes, 0, 24 * 60) || !int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${at}: a DC, minutes and a rev.`);
    }
    const uses = Object.entries(slice.uses ?? {});
    if (uses.length > slack(MAX_USES)) errors.push(`About ${MAX_USES} craft uses are kept at most.`);
    for (const [key, entry] of uses) {
        if (!MADE_ID.test(key) || !isRecord(entry) || !ACTOR_ID.test(String(entry.actor)) || !str(entry.craft, 40, { empty: false }) || !int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`Craft use ${key}: an actor, a craft and a rev.`);
    }
    const made = Object.entries(slice.made ?? {});
    if (made.length > slack(MAX_MADE)) errors.push(`About ${MAX_MADE} crafts are kept at most.`);
    for (const [key, entry] of made) {
        const at = `Craft ${key}`;
        if (!isRecord(entry) || entry.id !== key || !MADE_ID.test(key)) { errors.push(`${at}: kept under its own id.`); continue; }
        if (!ACTOR_ID.test(String(entry.actor)) || !str(entry.name, 80) || !str(entry.recipeName, 80, { empty: false }) || !str(entry.craft, 40, { empty: false })) errors.push(`${at}: who, which recipe and which craft.`);
        if (!int(entry.die, 1, 20) || !int(entry.roll, 0, 10) || !int(entry.mod, -200, 200) || !int(entry.dc, 1, 40) || !int(entry.total, -200, 220)) errors.push(`${at}: the die, roll, modifier, DC and total must be whole numbers.`);
        if (!['ruined', 'fail', 'normal', 'fine', 'masterwork'].includes(entry.quality)) errors.push(`${at}: ${entry.quality} is not a quality.`);
        if (!str(entry.carrier ?? '', 48) || !str(entry.mismatch ?? '', 120) || !str(entry.note ?? '', 200) || !str(entry.text ?? '', 300)) errors.push(`${at}: a note is too long.`);
        if (!int(entry.rev, 0, Number.MAX_SAFE_INTEGER)) errors.push(`${at}: the rev must be a whole number.`);
    }
    return errors;
}
