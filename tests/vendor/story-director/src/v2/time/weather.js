// Story Director v2, part **time**: the day's weather by rule (Story Block MODULES §F122; pure).
//
// The model writes `~ weather` only when the weather changes, and often never, so the Status card, the Scene
// and the tail's Place line had none. Code picks one instead: right after a reply's last story line (Story
// Block's afterCapture, F121) this part asks for Story Block's `scene.weather` command (cause `system`, kept
// on that reply) when the story day or the region changed.
//
// * **Season** from the chat's calendar (`director.calendar`): a pack's `weather.seasons` names the months
//   of each season; otherwise the year is split by where the day falls in it, as on Earth's northern half
//   (the last and first twelfth of the year are the middle of winter): winter, spring, summer, autumn.
//   Without a story clock there is no day and no season: a mild table, picked by the region alone.
// * **Region**: the scene's region, else the one the atlas knows for the place (`atlas.here`), else none.
// * **Table**: the enabled pack's `weather.tables` (`packs.weather`): the season's and region's (the region by
//   name, any case, or one that contains it), else the season's for any region, else the region's for any
//   season, else one for any; otherwise the built-in temperate table for the season.
// * **Seed**: the pick is a hash of the story day and the region (FNV-1a), never Math.random or the date, so a
//   swipe, a Re-read, a rebuild and a reload pick the same weather for the same day and place.
// * **The story's word wins** for the rest of that day and place: Story Block keeps a story `~ weather` without
//   a key, and this step then only marks it with the day's key (`scene.weather { key }`, its words kept); a new
//   day or another region brings the rule's weather back.
// * Feature `story-director.weather` (on), and Story Block's `story-block.weather`: off, nothing is asked.
//   An older Story Block without the `scene.weather` command is not asked either (nothing changes there).

import { makeCalendar } from '../../calendar.js';

export const WEATHER_FEATURE = 'story-director.weather';
export const HOST_WEATHER_FEATURE = 'story-block.weather';
export const WEATHER_COMMAND = 'scene.weather';
/** Story Block's key is at most 80 code points. */
export const WEATHER_KEY_CHARS = 80;
const DAY_MINUTES = 1440;

export const SEASONS = Object.freeze(['winter', 'spring', 'summer', 'autumn']);

/** The built-in table: a temperate land by season, and a mild one for a story without a clock. */
export const TEMPERATE = Object.freeze({
    winter: Object.freeze(['hard frost, clear and cold', 'grey skies, a raw wind', 'light snow falling', 'freezing fog at dawn',
        'sleet on a north wind', 'cold, still and overcast', 'thin sun, bitter cold', 'heavy snow, low cloud']),
    spring: Object.freeze(['soft rain, mild', 'showers and bright spells', 'cool and breezy, high cloud', 'warm sun, a light breeze',
        'morning mist, clearing later', 'grey drizzle', 'blustery, clouds racing', 'clear and fresh']),
    summer: Object.freeze(['hot and clear', 'warm, hazy sunshine', 'humid, thunder by evening', 'bright and breezy',
        'sultry and still', 'a summer storm rolling in', 'warm with high cloud', 'clear skies, a cool night']),
    autumn: Object.freeze(['cool and misty', 'steady rain, a cold wind', 'crisp and clear', 'low grey cloud, drizzle',
        'gusty, leaves on the wind', 'fog in the hollows', 'mild and overcast', 'first frost, bright sun']),
    any: Object.freeze(['mild and overcast', 'clear and fair', 'light rain', 'a fresh breeze, scattered cloud', 'grey and still', 'bright, high cloud']),
});

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const fold = value => text(value).normalize('NFKC').toLowerCase();
const cutPoints = (value, max) => Array.from(value).slice(0, max).join('');

function tryQuery(query, name, args) {
    if (typeof query !== 'function') return null;
    try { return query(name, args) ?? null; } catch { return null; }
}

/** FNV-1a (32 bit) of a string: the seed of a day's pick. */
export function hashOf(value) {
    let hash = 0x811c9dc5;
    for (const point of Array.from(String(value))) {
        hash ^= point.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

/** Where `minutes` falls in its year on `config` (normalizeCalendar's shape): `{ month, dayOfYear, yearDays }`. */
function placeInYear(config, minutes) {
    const calendar = makeCalendar(config);
    const date = calendar.fromAbs(minutes);
    const months = config.months;
    const before = months.slice(0, date.month).reduce((sum, month) => sum + month.days, 0);
    const yearDays = months.reduce((sum, month) => sum + month.days, 0) || 1;
    return { month: months[date.month]?.name ?? '', dayOfYear: before + date.day - 1, yearDays };
}

/** The built-in season of a day: the year split as on Earth's northern half (winter around the year's turn). */
export function seasonByYear(dayOfYear, yearDays) {
    const twelfth = ((dayOfYear + 0.5) / yearDays) * 12;
    return SEASONS[Math.floor(((Math.floor(twelfth) + 1) % 12) / 3)];
}

/**
 * The day's season: `{ name, builtIn }`. `name` the pack's season holding the month when its `seasons` name
 * one, else the built-in season; `builtIn` the built-in season (for the built-in table). Null without a clock.
 */
export function seasonOf(config, minutes, seasons = []) {
    if (!Number.isSafeInteger(minutes) || !config?.months?.length) return null;
    const at = placeInYear(config, minutes);
    const builtIn = seasonByYear(at.dayOfYear, at.yearDays);
    const own = (Array.isArray(seasons) ? seasons : []).find(season => (season?.months ?? []).some(month => fold(month) === fold(at.month)));
    return { name: own ? fold(own.name) : builtIn, builtIn };
}

const regionFits = (table, region) => {
    const want = fold(table.region);
    return Boolean(want) && Boolean(region) && (region === want || region.includes(want));
};

/** The list of weathers to pick from (see the header), never empty. */
export function tableFor(packWeather, season, region) {
    const tables = Array.isArray(packWeather?.tables) ? packWeather.tables.filter(table => Array.isArray(table?.weather) && table.weather.some(entry => text(entry))) : [];
    const name = season?.name ?? '';
    const seasonFits = table => Boolean(name) && fold(table.season) === name;
    const anySeason = table => !fold(table.season);
    const anyRegion = table => !fold(table.region);
    const found = tables.find(table => seasonFits(table) && regionFits(table, region))
        ?? tables.find(table => seasonFits(table) && anyRegion(table))
        ?? tables.find(table => anySeason(table) && regionFits(table, region))
        ?? tables.find(table => anySeason(table) && anyRegion(table));
    if (found) return found.weather.map(text).filter(Boolean);
    return [...TEMPERATE[season?.builtIn ?? 'any']];
}

/** The region the weather is picked for: the scene's, else the atlas's for the place; folded, '' for none. */
export function regionOf(state, query) {
    const own = fold(state?.domains?.scene?.place?.region);
    if (own) return own;
    return fold(tryQuery(query, 'atlas.here', {})?.region);
}

/** The key the weather is set for: the story day (`-` without a clock) and the region, at most 80 code points. */
export function weatherKey(minutes, region) {
    const day = Number.isSafeInteger(minutes) ? `day ${Math.floor(minutes / DAY_MINUTES)}` : 'no day';
    return cutPoints(`${day}|${region}`, WEATHER_KEY_CHARS);
}

// The chat's calendar config (the tracker's `director.calendar`: the reader's, else the pack's, else Gregorian).
function calendarConfigOf(query) {
    const config = tryQuery(query, 'director.calendar', {});
    return config && typeof config === 'object' && Array.isArray(config.months) && config.months.length ? config : null;
}

/** The weather by rule for where the story stands: `{ key, text, season, region }`. */
export function weatherFor(state, query) {
    const minutes = state?.domains?.director?.time?.minutes;
    const region = regionOf(state, query);
    const key = weatherKey(minutes, region);
    const packWeather = tryQuery(query, 'packs.weather', {});
    let season = null;
    try { season = seasonOf(calendarConfigOf(query), minutes, packWeather?.seasons); } catch { season = null; }
    const list = tableFor(packWeather, season, region);
    return { key, text: list[hashOf(key) % list.length], season: season?.name ?? '', region };
}

const featureOn = (view, id) => (typeof view?.feature === 'function' ? view.feature(id) !== false : true);

// Whether Story Block has the `scene.weather` command (its live module list); true when it cannot be asked.
function hostHasCommand() {
    try {
        const modules = globalThis.StoryBlock?.sdk?.modules?.();
        if (!Array.isArray(modules)) return true;
        const core = modules.find(entry => entry?.id === 'story-block');
        return !core || !Array.isArray(core.commands) || core.commands.includes(WEATHER_COMMAND);
    } catch {
        return true;
    }
}

/**
 * `afterCapture(view)`: `{ commands: [scene.weather] }` when the day's weather is not set for where the story
 * stands: the rule's weather for a new day or region, or a mark on the story's own `~ weather` (kept for the
 * rest of that day and place). Nothing while the weather or this feature is off, or Story Block has no
 * `scene.weather`.
 */
export function weatherHook(view) {
    const state = view?.state;
    if (!state?.domains?.scene || !featureOn(view, WEATHER_FEATURE) || !featureOn(view, HOST_WEATHER_FEATURE) || !hostHasCommand()) return undefined;
    const now = weatherFor(state, view.query);
    const current = state.domains.scene.weather;
    if (current?.key === now.key) return undefined;
    // The story wrote the weather (no key): its word stands for this day and place.
    const payload = text(current?.text) && !current.key ? { key: now.key } : { text: now.text, key: now.key };
    return { lines: [], commands: [{ type: WEATHER_COMMAND, payload }] };
}
