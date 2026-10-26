// Story Director: world packs and travel maths (pure).
//
// A world pack is a route graph (places, undirected edges with km and a road code) plus
// paces per code and mode and a few travel rules. From it this module finds shortest routes,
// turns km into days with the pack's round-up rule, and checks the one-hop `leg:` lines the
// model writes, offering a corrected leg in the same grammar when one is wrong.
//
// Nothing here knows the calendar module: story time is abs minutes, and the functions that
// read or print dates take an optional `calendar` object (parse, format, addDays, dayIndex).
// Packs are treated as immutable; a lookup index is cached per pack object.

export const ROUTE_CODES = Object.freeze({
    W: 'river or canal',
    R: 'maintained road',
    L: 'local',
    B: 'bastion road',
    F: 'frontier road',
    C: 'caravan',
    A: 'aerial',
    G: 'dungeon approach',
    S: 'sea',
    T: 'trail',
    M: 'mountain',
    U: 'tunnel',
    H: 'hidden',
    X: 'seasonal or expedition',
    D: 'deep sea',
});

export const MODES = Object.freeze(['foot', 'ride', 'wagon', 'boat', 'ship', 'flight', 'courier']);

// Modern travel (0.9.0): a pack with `"era": "modern"` (or `pace_km_per_hour`) uses these road
// codes and modes, paces in km an hour, and times in hours. Each code says which modes may use
// it and how fast; a mode a code leaves out cannot use it. A pack's own paces are merged over
// these, and may add codes of its own (one to three capital letters).
export const MODERN_MODES = Object.freeze(['foot', 'bike', 'car', 'motorbike', 'bus', 'train', 'metro', 'ferry', 'ship', 'plane']);
export const MODERN_CODES = Object.freeze({
    MW: { name: 'motorway or highway', paces: { car: 100, motorbike: 100, bus: 80 } },
    RD: { name: 'road', paces: { car: 60, motorbike: 60, bus: 45, bike: 18, foot: 5 } },
    ST: { name: 'city streets', paces: { car: 25, motorbike: 25, bus: 18, bike: 15, foot: 5 } },
    OR: { name: 'off-road or dirt track', paces: { car: 30, motorbike: 30, bike: 10, foot: 4 } },
    TR: { name: 'trail or footpath', paces: { bike: 12, foot: 4 } },
    RL: { name: 'railway', paces: { train: 90 }, board: 0.25 },
    HS: { name: 'high-speed rail', paces: { train: 250 }, board: 0.5 },
    MT: { name: 'metro, subway or tram', paces: { metro: 30 } },
    FY: { name: 'ferry', paces: { ferry: 30, car: 30, motorbike: 30, bike: 30, foot: 30 }, board: 0.5 },
    SL: { name: 'sea lane', paces: { ship: 35 }, board: 1 },
    AR: { name: 'air route', paces: { plane: 750 }, board: 2 },
});
// Trains, planes and boats are reached by a short ride or walk: a hop the mode cannot take,
// up to this long, goes by the first of these that can (a taxi, else on foot).
const TRANSFER_MODES = ['car', 'foot'];
const TRANSFER_KM = 60;
// The mode a modern leg most likely means when it names only a road code.
const MODERN_DEFAULT_MODE = { MW: 'car', RD: 'car', ST: 'foot', OR: 'car', TR: 'foot', RL: 'train', HS: 'train', MT: 'metro', FY: 'ferry', SL: 'ship', AR: 'plane' };
// Modes someone drives, rides or walks themselves: they stop for the night on long trips.
const SELF_MODES = ['foot', 'bike', 'car', 'motorbike'];
const MODERN_ALIASES = {
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot', 'on foot': 'foot',
    bicycle: 'bike', cycle: 'bike', cycling: 'bike', biking: 'bike', bikes: 'bike',
    drive: 'car', driving: 'car', drives: 'car', cars: 'car', taxi: 'car', cab: 'car', van: 'car', truck: 'car',
    motorcycle: 'motorbike', scooter: 'motorbike', moped: 'motorbike',
    coach: 'bus', buses: 'bus',
    rail: 'train', trains: 'train',
    subway: 'metro', underground: 'metro', tube: 'metro', tram: 'metro',
    boat: 'ferry', ferries: 'ferry',
    ships: 'ship', cruise: 'ship',
    fly: 'plane', flying: 'plane', flies: 'plane', flight: 'plane', planes: 'plane', airplane: 'plane', aeroplane: 'plane', jet: 'plane',
};
export const MODERN_RULES = Object.freeze({ unit: 'hour', roundUpTo: 0.25, driveHoursPerDay: 10 });

// Words the model writes for a mode.
const MODE_ALIASES = {
    walk: 'foot', walking: 'foot', walks: 'foot', hike: 'foot', hiking: 'foot',
    rides: 'ride', riding: 'ride', rider: 'ride', riders: 'ride', horse: 'ride', horseback: 'ride', mounted: 'ride',
    wagons: 'wagon', cart: 'wagon', carts: 'wagon', dray: 'wagon',
    boats: 'boat', barge: 'boat', ferry: 'boat', riverboat: 'boat', keelboat: 'boat',
    ships: 'ship', sail: 'ship', sailing: 'ship',
    fly: 'flight', flying: 'flight', flies: 'flight',
    couriers: 'courier', messenger: 'courier',
};

const LAND_MODES = ['foot', 'ride', 'wagon'];
const WATER_MODES = ['boat', 'ship'];
// Pace keys of the normalized shape; the reference format writes `downstream_favorable`.
const PACE_KEYS = ['foot', 'ride', 'wagon', 'boat', 'upstream', 'downstream', 'ship', 'vessel', 'flight'];
const PACE_ALIASES = { downstream_favorable: 'downstream' };

export const DEFAULT_RULES = Object.freeze({
    roundUpTo: 0.5, restDayEvery: 6, crewedWaterRest: false, leveeRoads: [], noLevee: [],
});
const DEFAULT_COURIER_MULTIPLIER = 2;

const DAY_MINUTES = 1440;
const KM_TOLERANCE = 0.05;
const DAYS_TOLERANCE = 0.5;
// Float sums like 2.0000000001 must not round up to the next half day.
const EPSILON = 1e-9;
// "Blue" alone is too little to stand for "Bluewatch Village".
const MIN_PREFIX = 4;

// ---------------------------------------------------------------------------------------
// Loading

/**
 * Reads a world pack (JSON text or an object) in the reference format or the normalized
 * shape. Bad edges are skipped with a warning; an edge endpoint missing from `places` is a
 * warning (once per name) and the edge is kept, so the graph stays whole.
 */
export function loadWorldPack(json) {
    const errors = [];
    const warnings = [];
    const fail = message => ({ pack: null, errors: [...errors, message], warnings });

    let data = json;
    if (typeof json === 'string') {
        try {
            data = JSON.parse(json);
        } catch (error) {
            return fail(`Not valid JSON: ${error.message}`);
        }
    }
    if (!isObject(data)) return fail('A world pack must be a JSON object.');

    const places = readPlaces(data.places, errors);
    if (!places) return fail('The pack has no `places` object.');
    if (!Array.isArray(data.edges)) return fail('The pack has no `edges` list.');

    const edges = [];
    data.edges.forEach((raw, index) => {
        const edge = readEdge(raw);
        if (typeof edge === 'string') warnings.push(`Edge ${index + 1} skipped: ${edge}.`);
        else edges.push(edge);
    });
    if (!edges.length) return fail('The pack has no usable edges.');

    const missing = new Map();
    for (const edge of edges) {
        for (const name of [edge.a, edge.b]) {
            if (!Object.hasOwn(places, name)) missing.set(name, (missing.get(name) ?? 0) + 1);
        }
    }
    for (const [name, count] of missing) {
        warnings.push(`"${name}" is on ${count} ${count === 1 ? 'edge' : 'edges'} but not in places.`);
    }
    const codes = new Set(edges.map(edge => edge.code));
    const modern = isModernPack(data);
    const ownPaces = data.paces ?? data.pace_km_per_hour;
    for (const code of codes) {
        if (modern) {
            if (!Object.hasOwn(MODERN_CODES, code) && !(isObject(ownPaces) && Object.keys(ownPaces).some(key => key.trim().toUpperCase() === code))) {
                warnings.push(`Unknown road code "${code}" with no paces in pace_km_per_hour (nothing can use it).`);
            }
        } else if (!Object.hasOwn(ROUTE_CODES, code)) warnings.push(`Unknown road code "${code}" (R pace used).`);
    }

    warnings.push(...mapWarnings(places, edges, positive(data.scaleKmPerUnit ?? data.scale_km_per_unit)));

    const rules = data.rules ?? data.travel_rules ?? {};
    const pack = {
        name: String(data.name ?? data.source ?? ''),
        era: modern ? 'modern' : 'pre-modern',
        calendar: isObject(data.calendar) ? data.calendar : null,
        scaleKmPerUnit: positive(data.scaleKmPerUnit ?? data.scale_km_per_unit),
        places,
        edges,
        paces: modern ? modernPaces(data.paces ?? data.pace_km_per_hour, warnings) : readPaces(data.paces ?? data.pace_km_per_day, warnings),
        courierMultiplier: positive(data.courierMultiplier ?? data.courier_multiplier) ?? DEFAULT_COURIER_MULTIPLIER,
        rules: modern ? {
            unit: 'hour',
            roundUpTo: nonNegative(rules.roundUpTo ?? rules.round_edge_up_to_hours) ?? MODERN_RULES.roundUpTo,
            driveHoursPerDay: positive(rules.driveHoursPerDay ?? rules.drive_hours_per_day) ?? MODERN_RULES.driveHoursPerDay,
            restDayEvery: 0, crewedWaterRest: false, leveeRoads: [], noLevee: [],
        } : {
            roundUpTo: nonNegative(rules.roundUpTo ?? rules.round_edge_up_to_days) ?? DEFAULT_RULES.roundUpTo,
            restDayEvery: nonNegative(rules.restDayEvery ?? rules.rest_day_every_active_days) ?? DEFAULT_RULES.restDayEvery,
            crewedWaterRest: Boolean(rules.crewedWaterRest ?? rules.crewed_water_rest_days ?? false),
            leveeRoads: names(rules.leveeRoads ?? rules.levee_roads),
            noLevee: names(rules.noLevee ?? rules.no_levee),
        },
    };
    return { pack, errors, warnings };
}

// A modern pack says so, or gives its paces per hour.
function isModernPack(data) {
    const era = String(data?.era ?? '').trim().toLowerCase();
    if (era) return era === 'modern';
    if (data?.unit === 'hour' || data?.rules?.unit === 'hour') return true;
    return isObject(data?.pace_km_per_hour);
}

// The modern table with the pack's own paces merged over it: { CODE: { mode: pace } }. A pace
// of null takes a mode off a code.
function modernPaces(source, warnings) {
    const paces = Object.fromEntries(Object.entries(MODERN_CODES).map(([code, info]) => [code, { ...info.paces, ...(info.board ? { boardHours: info.board } : {}) }]));
    if (!isObject(source)) return paces;
    for (const [rawCode, table] of Object.entries(source)) {
        const code = rawCode.trim().toUpperCase();
        if (!isObject(table)) continue;
        paces[code] ??= {};
        for (const [rawKey, value] of Object.entries(table)) {
            if (rawKey === 'board_hours' || rawKey === 'boardHours') {
                if (nonNegative(value) === null) warnings.push(`Pace ${code}.${rawKey} is not a number of hours.`);
                else paces[code].boardHours = value;
                continue;
            }
            const key = normalizeMode(rawKey, { era: 'modern' });
            if (!key) {
                warnings.push(`Pace ${code}.${rawKey}: "${rawKey}" is not a modern mode (${MODERN_MODES.join(', ')}).`);
                continue;
            }
            const pace = readPace(value);
            if (pace === undefined || pace === 'foot') warnings.push(`Pace ${code}.${rawKey} is not a number, range or null.`);
            else if (pace === null) delete paces[code][key];
            else paces[code][key] = pace;
        }
    }
    return paces;
}

function readPlaces(source, errors) {
    const entries = Array.isArray(source)
        ? source.map(place => [place?.name, place])
        : isObject(source) ? Object.entries(source) : null;
    if (!entries) return null;
    const places = {};
    for (const [rawName, value] of entries) {
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) {
            errors.push('A place without a name was skipped.');
            continue;
        }
        const info = isObject(value) ? value : {};
        places[name] = {
            x: finite(info.x),
            y: finite(info.y),
            region: typeof info.region === 'string' ? info.region : null,
        };
    }
    return places;
}

// Returns the edge, or why it cannot be used.
function readEdge(raw) {
    if (!isObject(raw)) return 'not an object';
    const a = typeof raw.a === 'string' ? raw.a.trim() : '';
    const b = typeof raw.b === 'string' ? raw.b.trim() : '';
    if (!a || !b) return 'an endpoint is missing';
    if (a === b) return `"${a}" links to itself`;
    const km = positive(Number(raw.km));
    if (km === null) return `${a} – ${b} has no km`;
    const code = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : '';
    if (!code) return `${a} – ${b} has no road code`;
    if (!/^[A-Z]{1,3}$/.test(code)) return `${a} – ${b} has the road code "${raw.code}" (one to three letters)`;
    return {
        a, b, km, code,
        corridor: typeof raw.corridor === 'string' && raw.corridor.trim() ? raw.corridor.trim() : null,
        notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes : null,
        bearing: typeof raw.bearing === 'string' && raw.bearing.trim() ? raw.bearing.trim().toUpperCase() : null,
    };
}

// A pack made by hand or by a model can contradict itself (0.8.8): a road shorter than the
// straight line between its places, or a road's stated bearing ("SW/NE": b lies SW of a) that
// its coordinates do not give. Coordinates are read with y growing north; when the bearings
// fit y growing south instead, one warning says to set North is to Down.
const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const STRAIGHT_SLACK = 0.9;

function mapWarnings(places, edges, scale) {
    const warnings = [];
    const off = { up: [], down: [] };
    let stated = 0;
    for (const edge of edges) {
        const a = places[edge.a];
        const b = places[edge.b];
        if (![a?.x, a?.y, b?.x, b?.y].every(value => value !== null && value !== undefined)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (scale) {
            const straight = Math.hypot(dx, dy) * scale;
            if (edge.km < straight * STRAIGHT_SLACK) warnings.push(`${edge.a} – ${edge.b} is ${num(edge.km)} km, but the places are ${Math.round(straight)} km apart in a straight line.`);
        }
        const want = COMPASS_16.indexOf(String(edge.bearing ?? '').split('/')[0].trim());
        if (want < 0 || (dx === 0 && dy === 0)) continue;
        stated += 1;
        for (const north of ['up', 'down']) {
            const degrees = (Math.atan2(dx, north === 'up' ? dy : -dy) * 180 / Math.PI + 360) % 360;
            const gap = Math.abs(((degrees - want * 22.5) % 360 + 540) % 360 - 180);
            // Within one 8-point step (45°) agrees; coordinates are rounded and roads bend.
            if (gap > 45 + 1e-9) off[north].push({ edge, given: COMPASS_16[want], got: COMPASS_16[Math.round(degrees / 22.5) % 16] });
        }
    }
    if (stated && off.down.length < off.up.length && off.up.length > stated / 2) {
        warnings.unshift('The roads\' bearings fit a map whose y grows southwards (an image): set Map & travel → North is to Down.');
    } else {
        for (const { edge, given, got } of off.up) warnings.push(`${edge.a} – ${edge.b} says ${edge.b} lies ${given} of ${edge.a}, but the coordinates put it ${got}.`);
    }
    return warnings;
}

function readPaces(source, warnings) {
    const paces = {};
    if (!isObject(source)) return paces;
    for (const [rawCode, table] of Object.entries(source)) {
        const code = rawCode.trim().toUpperCase();
        paces[code] = {};
        if (!isObject(table)) continue;
        for (const [rawKey, value] of Object.entries(table)) {
            const key = PACE_ALIASES[rawKey] ?? rawKey;
            if (!PACE_KEYS.includes(key)) continue;   // notes, units
            const pace = readPace(value);
            if (pace === undefined) warnings.push(`Pace ${code}.${rawKey} is not a number, range, "foot" or null.`);
            else paces[code][key] = pace;
        }
    }
    return paces;
}

// number | [low, high] | 'foot' | null; undefined when unreadable.
function readPace(value) {
    if (value === null || value === 'foot') return value;
    if (positive(value) !== null) return value;
    if (Array.isArray(value) && value.length === 2 && value.every(n => positive(n) !== null)) {
        return [Math.min(...value), Math.max(...value)];
    }
    return undefined;
}

export function packSummary(pack) {
    if (!pack) return 'no world pack';
    const places = Object.keys(pack.places ?? {}).length;
    const routes = (pack.edges ?? []).length;
    return `${places} ${places === 1 ? 'place' : 'places'} · ${routes} ${routes === 1 ? 'route' : 'routes'}${pack.era === 'modern' ? ' · modern' : ''}`;
}

// ---------------------------------------------------------------------------------------
// Places

const INDEXES = new WeakMap();

// Known places are those in `places` and every edge endpoint (some packs link districts
// they never list). Names are compared lowercased, with straight apostrophes.
function indexOf(pack) {
    let index = INDEXES.get(pack);
    if (index) return index;
    const byKey = new Map();
    const adjacency = new Map();
    const add = name => {
        if (!byKey.has(normalizeName(name))) byKey.set(normalizeName(name), name);
        if (!adjacency.has(name)) adjacency.set(name, []);
    };
    Object.keys(pack.places ?? {}).forEach(add);
    for (const edge of pack.edges ?? []) {
        add(edge.a);
        add(edge.b);
        adjacency.get(edge.a).push(edge);
        adjacency.get(edge.b).push(edge);
    }
    const longestFirst = [...byKey].sort((x, y) => y[0].length - x[0].length);
    index = { byKey, adjacency, longestFirst };
    INDEXES.set(pack, index);
    return index;
}

function normalizeName(text) {
    return String(text ?? '').replace(/[’‘ʼ`]/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function containsWord(haystack, needle) {
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
        const before = haystack[at - 1];
        const after = haystack[at + needle.length];
        if ((!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after))) return true;
    }
    return false;
}

/**
 * The place named inside `text`: the longest name found as whole words, case-insensitive,
 * curly or straight apostrophes. Failing that, when the whole text is the first word(s) of
 * exactly one place ("Bluewatch" for "Bluewatch Village"), that place.
 */
export function findPlace(pack, text) {
    if (!pack || typeof text !== 'string') return null;
    const haystack = normalizeName(text);
    if (!haystack) return null;
    const { longestFirst } = indexOf(pack);
    for (const [key, name] of longestFirst) {
        if (containsWord(haystack, key)) return name;
    }
    if (haystack.length >= MIN_PREFIX) {
        const hits = longestFirst.filter(([key]) => key.startsWith(`${haystack} `));
        if (hits.length === 1) return hits[0][1];
    }
    return null;
}

/**
 * (0.9.22) Every place named inside `text`, in the order they first appear: whole words,
 * longest names first, so "Bluewatch Village" is found once and not again as a shorter name
 * inside it.
 */
export function placesIn(pack, text) {
    if (!pack || typeof text !== 'string') return [];
    const haystack = normalizeName(text);
    const found = [];
    for (const [key, name] of indexOf(pack).longestFirst) {
        if (found.some(entry => entry.key.includes(key)) || !containsWord(haystack, key)) continue;
        found.push({ key, name, at: haystack.indexOf(key) });
    }
    return found.sort((a, b) => a.at - b.at).map(entry => entry.name);
}

function resolvePlace(pack, name) {
    if (!pack || typeof name !== 'string') return null;
    return indexOf(pack).byKey.get(normalizeName(name)) ?? findPlace(pack, name);
}

export function exitsFrom(pack, place) {
    const name = resolvePlace(pack, place);
    if (!name) return [];
    return indexOf(pack).adjacency.get(name).map(edge => ({
        to: edge.a === name ? edge.b : edge.a,
        km: edge.km,
        code: edge.code,
        corridor: edge.corridor,
    }));
}

function edgesBetween(pack, a, b) {
    return (indexOf(pack).adjacency.get(a) ?? []).filter(edge =>
        (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
}

// ---------------------------------------------------------------------------------------
// Paces

function normalizeMode(mode, pack = null) {
    if (typeof mode !== 'string') return null;
    const word = mode.trim().toLowerCase().replace(/\s+/g, ' ');
    if (pack?.era === 'modern') return MODERN_MODES.includes(word) ? word : MODERN_ALIASES[word] ?? null;
    if (MODES.includes(word)) return word;
    return MODE_ALIASES[word] ?? null;
}

/** What a road code is called ("bastion road", "railway"). */
export function codeName(pack, code) {
    if (pack?.era === 'modern') return MODERN_CODES[code]?.name ?? 'road';
    return ROUTE_CODES[code] ?? 'road';
}

// The mode a leg most likely means when it names only a road code.
function inferMode(code, pack = null) {
    if (pack?.era === 'modern') {
        return MODERN_DEFAULT_MODE[code] ?? Object.keys(pack.paces?.[code] ?? {})[0] ?? 'foot';
    }
    if (code === 'W') return 'boat';
    if (code === 'S' || code === 'D') return 'ship';
    if (code === 'A') return 'flight';
    return 'foot';
}

function toPace(value) {
    if (typeof value === 'number') return { rate: value, low: value, high: value };
    if (Array.isArray(value)) return { rate: (value[0] + value[1]) / 2, low: value[0], high: value[1] };
    return null;
}

function hasLevee(pack, corridor) {
    if (!corridor) return false;
    const key = normalizeName(corridor);
    const listed = list => (list ?? []).some(name => normalizeName(name) === key);
    // A corridor in both lists has no levee: noLevee is the explicit exception.
    return listed(pack.rules?.leveeRoads) && !listed(pack.rules?.noLevee);
}

function landPace(pack, code, mode) {
    const table = pack.paces?.[code];
    const hasLand = table && LAND_MODES.some(name => table[name] !== undefined);
    // Codes with no land paces (L, G, unknown) go at R pace.
    if (!hasLand) return code === 'R' ? null : landPace(pack, 'R', mode);
    // A land mode the table leaves out goes at the code's foot pace.
    let value = table[mode] === undefined ? 'foot' : table[mode];
    if (value === 'foot') value = table.foot;
    return toPace(value);
}

/**
 * Km per day for `mode` on road `code`, `{ rate, low, high }` (rate = midpoint of a range),
 * or null when the mode cannot use the road. W is boat only, except along a levee road
 * (R pace); S is ship; D is ship or boat at vessel pace; A is flight.
 */
export function paceFor(pack, code, mode, { corridor = null } = {}) {
    const name = normalizeMode(mode, pack);
    if (!pack || !name) return null;
    const key = String(code ?? '').trim().toUpperCase();
    // Modern: the code's own table, km an hour; a mode it leaves out cannot use it.
    if (pack.era === 'modern') return toPace(pack.paces?.[key]?.[name]);

    if (name === 'courier') {
        const ride = paceFor(pack, key, 'ride', { corridor });
        const k = pack.courierMultiplier ?? DEFAULT_COURIER_MULTIPLIER;
        return ride && { rate: ride.rate * k, low: ride.low * k, high: ride.high * k };
    }
    const table = pack.paces?.[key] ?? {};
    if (key === 'W') {
        if (name === 'boat') return toPace(table.boat);
        return LAND_MODES.includes(name) && hasLevee(pack, corridor) ? landPace(pack, 'R', name) : null;
    }
    if (key === 'S') return name === 'ship' ? toPace(table.ship) : null;
    if (key === 'D') return WATER_MODES.includes(name) ? toPace(table.vessel) : null;
    if (key === 'A') return name === 'flight' ? toPace(table.flight) : null;
    return LAND_MODES.includes(name) ? landPace(pack, key, name) : null;
}

function edgePace(pack, edge, mode) {
    return paceFor(pack, edge.code, mode, { corridor: edge.corridor });
}

/** Days spent boarding on a modern code: check-in for a flight, the wait for a train. */
export function boardDays(pack, code) {
    if (pack?.era !== 'modern') return 0;
    return tidy((nonNegative(pack.paces?.[code]?.boardHours) ?? 0) / 24);
}

// The mode a hop goes by: the trip's own, or for public transport in a modern pack a short
// transfer (a taxi to the airport). Null when nothing can.
function hopMode(pack, edge, mode, transfer) {
    if (edgePace(pack, edge, mode)) return mode;
    if (!transfer || edge.km > TRANSFER_KM) return null;
    return TRANSFER_MODES.find(other => edgePace(pack, edge, other)) ?? null;
}

// One hop's time in days: the road at the mode's pace, plus boarding when the mode rides it.
function hopDays(pack, edge, mode, rate = null) {
    const pace = rate ?? edgePace(pack, edge, mode)?.rate;
    const days = legDays(edge.km, pace, pack.rules);
    return days === null ? null : tidy(days + boardDays(pack, edge.code));
}

// The rates a stated pace may use: the pace's range, and on a river also the upstream and
// downstream ranges (direction is not in the data).
function acceptedRange(pack, edge, mode) {
    const pace = edgePace(pack, edge, mode);
    if (!pace) return null;
    if (mode !== 'boat' || edge.code !== 'W') return pace;
    const ranges = ['boat', 'upstream', 'downstream'].map(key => toPace(pack.paces?.W?.[key])).filter(Boolean);
    return {
        ...pace,
        low: Math.min(...ranges.map(range => range.low)),
        high: Math.max(...ranges.map(range => range.high)),
    };
}

/** Days for one edge: `ceil(km / rate / roundUpTo) * roundUpTo`; null for a bad rate. */
export function legDays(km, rate, rules = DEFAULT_RULES) {
    if (!(rate > 0) || !(km >= 0)) return null;
    // Modern: km an hour, rounded up to the quarter hour (or the pack's step), in days.
    if (rules?.unit === 'hour') {
        const step = rules.roundUpTo ?? MODERN_RULES.roundUpTo;
        const hours = step > 0 ? Math.ceil(km / rate / step - EPSILON) * step : km / rate;
        return tidy(hours / 24);
    }
    const step = rules?.roundUpTo ?? DEFAULT_RULES.roundUpTo;
    if (!(step > 0)) return km / rate;
    return tidy(Math.ceil(km / rate / step - EPSILON) * step);
}

export function restDaysFor(mode, activeDays, rules = DEFAULT_RULES) {
    // Modern: whoever drives, rides or walks stops for the night after driveHoursPerDay; trains,
    // buses, ferries and planes go on. Returned in days, like a rest day.
    if (rules?.unit === 'hour') return tidy(overnights(mode, activeDays, rules) * (24 - driveHours(rules)) / 24);
    const every = rules?.restDayEvery ?? DEFAULT_RULES.restDayEvery;
    if (mode === 'courier' || !(every > 0) || !(activeDays > 0)) return 0;
    if (WATER_MODES.includes(mode) && !rules?.crewedWaterRest) return 0;
    // Flight rests like land travel: the beasts tire.
    return Math.floor((activeDays - EPSILON) / every);
}

function driveHours(rules) {
    return Math.min(24, positive(rules?.driveHoursPerDay) ?? MODERN_RULES.driveHoursPerDay);
}

/** Nights a modern trip stops for: 0 for public transport and trips within a day's driving. */
export function overnights(mode, activeDays, rules = MODERN_RULES) {
    if (rules?.unit !== 'hour' || !SELF_MODES.includes(mode) || !(activeDays > 0)) return 0;
    const hours = driveHours(rules);
    if (hours >= 24) return 0;
    return Math.max(0, Math.ceil(activeDays * 24 / hours - EPSILON) - 1);
}

// ---------------------------------------------------------------------------------------
// Routes

// Per neighbour, the edge this mode can use with the fewest days (shorter km on a tie).
function usableEdges(pack, place, mode, accept, transfer = false) {
    const best = new Map();
    for (const edge of indexOf(pack).adjacency.get(place) ?? []) {
        if (accept && !accept(edge)) continue;
        const by = hopMode(pack, edge, mode, transfer);
        if (!by) continue;
        const next = edge.a === place ? edge.b : edge.a;
        // A transfer weighs three times its time, so a train trip takes the train where there is one.
        const days = hopDays(pack, edge, by) * (by === mode ? 1 : 3);
        const current = best.get(next);
        const own = current && current.mode === mode;
        if (own && by !== mode) continue;
        if (!current || (by === mode && !own) || days < current.days || (days === current.days && edge.km < current.edge.km)) {
            best.set(next, { edge, days, mode: by });
        }
    }
    return best;
}

function bestEdge(pack, edges, mode) {
    let best = null;
    for (const edge of edges) {
        const pace = edgePace(pack, edge, mode);
        if (!pace) continue;
        const days = legDays(edge.km, pace.rate, pack.rules);
        if (!best || days < best.days || (days === best.days && edge.km < best.edge.km)) best = { edge, days };
    }
    return best?.edge ?? null;
}

// Dijkstra by km; in a modern pack by time, as a motorway's detour or a flight is quicker.
// `accept` narrows the edges (validateLeg uses it to stay on one road code); `transfer` lets
// public transport reach its stations (planRoute and shortestPath only).
function search(pack, start, goal, mode, accept = null, transfer = false) {
    const byTime = pack.era === 'modern';
    if (start === goal) return { from: start, to: goal, km: 0, hops: [] };
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const done = new Set();
    const queue = [start];
    while (queue.length) {
        let pick = 0;
        for (let i = 1; i < queue.length; i++) {
            if (dist.get(queue[i]) < dist.get(queue[pick])) pick = i;
        }
        const place = queue.splice(pick, 1)[0];
        if (done.has(place)) continue;
        done.add(place);
        if (place === goal) break;
        for (const [next, { edge, days, mode: by }] of usableEdges(pack, place, mode, accept, transfer)) {
            const cost = dist.get(place) + (byTime ? days : edge.km);
            if (cost < (dist.get(next) ?? Infinity)) {
                dist.set(next, cost);
                prev.set(next, { place, edge, mode: by });
                queue.push(next);
            }
        }
    }
    if (!prev.has(goal)) return null;
    const hops = [];
    for (let place = goal; place !== start; place = prev.get(place).place) {
        const { place: from, edge, mode: by } = prev.get(place);
        const hop = { from, to: place, km: edge.km, code: edge.code, corridor: edge.corridor };
        if (by !== mode) hop.mode = by;
        hops.unshift(hop);
    }
    return { from: start, to: goal, km: tidy(hops.reduce((sum, hop) => sum + hop.km, 0)), hops };
}

// Public transport in a modern pack may take a short transfer to its station.
const transfersFor = (pack, mode) => pack?.era === 'modern' && !SELF_MODES.includes(mode);

export function shortestPath(pack, from, to, { mode = 'foot' } = {}) {
    const name = normalizeMode(mode, pack);
    const start = resolvePlace(pack, from);
    const goal = resolvePlace(pack, to);
    if (!name || !start || !goal) return null;
    return search(pack, start, goal, name, null, transfersFor(pack, name));
}

/**
 * The shortest route with days per hop (an explicit `rate` replaces the pack's pace on every
 * hop), rest days for the mode, and the arrival when `depart` is given (abs, or a date text
 * read with `calendar`).
 */
export function planRoute(pack, from, to, { mode = 'foot', rate = null, depart = null, calendar = null } = {}) {
    const name = normalizeMode(mode, pack);
    const route = shortestPath(pack, from, to, { mode: name });
    if (!route) return null;
    const explicit = positive(rate);
    const rules = pack.rules ?? DEFAULT_RULES;
    const hops = route.hops.map(hop => {
        const by = hop.mode ?? name;
        // An explicit rate is the trip's own mode's; a transfer goes at its pace.
        const hopRate = (by === name ? explicit : null) ?? paceFor(pack, hop.code, by, { corridor: hop.corridor }).rate;
        return { ...hop, rate: hopRate, days: hopDays(pack, hop, by, hopRate) };
    });
    const activeDays = tidy(hops.reduce((sum, hop) => sum + hop.days, 0));
    const restDays = restDaysFor(name, activeDays, rules);
    const boardHours = tidy(hops.reduce((sum, hop) => sum + (hop.mode ? 0 : boardDays(pack, hop.code)), 0) * 24);
    const days = tidy(activeDays + restDays);
    const start = toAbs(depart, calendar);
    return {
        ...route, mode: name, hops, activeDays, restDays, days,
        unit: rules.unit === 'hour' ? 'hour' : 'day', boardHours,
        stops: overnights(name, activeDays, rules),
        depart: start,
        arrive: start === null ? null : addDays(start, days, calendar),
    };
}

// ---------------------------------------------------------------------------------------
// Legs

const ARROW = /\s*(?:→|⟶|➔|->|=>)\s*/u;
const BRACKETED = /\(([^()]*(?:→|⟶|➔|->|=>)[^()]*)\)/u;
const RATE = /(\d+(?:\.\d+)?)\s*(?:km\s*)?(?:\/\s*(day|d|h|hr|hour)\b|(?:a|an|per)\s+(day|hour)\b|(kph))/i;
const KM_CODE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:km\b\.?)?\s*(?:([A-Z]{1,3})(?![\p{L}\p{N}]))?/u;
const modeWord = words => new RegExp(`(?<![\\p{L}])(${words.sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])`, 'iu');
const MODE_WORD = modeWord([...MODES, ...Object.keys(MODE_ALIASES)]);
const MODERN_MODE_WORD = modeWord([...MODERN_MODES, ...Object.keys(MODERN_ALIASES)]);
// "→ 2.5 h", "→ 45 min", "→ 1.5 days", or a bare number in the pack's unit.
const DURATION = /^(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:rs?|ours?)?|d(?:ays?)?)?(?![\p{L}])/iu;

/**
 * Reads a `leg:` value: `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5`, also `->`,
 * `to`, and the legacy `(Shorn → Auvoth, 130 km B)`. Unknown pieces are null; the raw place
 * texts are kept in `fromText`/`toText` for messages. Null when there is no `from → to`.
 */
export function parseLeg(pack, text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    let body = text.replace(/[*_`]+/g, '').replace(/[’‘]/g, '\'').split(' | ')[0];
    body = body.replace(/^\s*leg\s*:\s*/i, '');
    const bracketed = BRACKETED.exec(body);
    if (bracketed) body = bracketed[1];
    body = body.trim();

    let parts = body.split(ARROW);
    if (parts.length < 2) {
        const to = /\s+to\s+/i.exec(body);
        if (!to) return null;
        parts = [body.slice(0, to.index), body.slice(to.index + to[0].length)];
    }
    const [fromText, middle, ...tail] = parts.map(part => part.trim());

    // The destination is the text before the numbers ("Varnhold Watch 35 B, …").
    const toText = /^[^\d,]*/.exec(middle)[0].trim();
    let rest = middle.slice(toText.length);

    let rate = null;
    const rateMatch = RATE.exec(rest);
    if (rateMatch) {
        rate = Number(rateMatch[1]);
        rest = rest.slice(0, rateMatch.index) + rest.slice(rateMatch.index + rateMatch[0].length);
    }
    const words = pack?.era === 'modern' ? MODERN_MODE_WORD : MODE_WORD;
    const modeMatch = words.exec(rest) ?? words.exec(tail.join(' '));
    const mode = modeMatch ? normalizeMode(modeMatch[1], pack) : null;

    const kmMatch = KM_CODE.exec(rest);
    // Days, whatever unit the leg wrote its time in.
    const durationMatch = DURATION.exec(tail[0] ?? '');
    const hourly = pack?.era === 'modern';
    const unit = (durationMatch?.[2] ?? '').toLowerCase();
    const perDay = /^min/.test(unit) ? 1440 : /^h/.test(unit) ? 24 : /^d/.test(unit) ? 1 : hourly ? 24 : 1;
    const days = durationMatch ? Number(durationMatch[1]) / perDay : null;

    const place = (raw, whole) => {
        if (!pack) return raw || null;
        return resolvePlace(pack, raw) ?? (whole ? findPlace(pack, whole) : null);
    };
    return {
        text,
        from: place(fromText),
        to: place(toText, middle),
        km: kmMatch ? Number(kmMatch[1]) : null,
        code: kmMatch?.[2] ?? null,
        mode,
        rate,
        days,
        fromText,
        toText: toText || middle,
    };
}

/**
 * Checks one leg against the pack. Findings are `{ kind, severity, key: null, message }`,
 * with `correction` (the right leg in the line grammar) whenever one can be given.
 *
 * Without a direct road, whether the leg is `leg-not-one-hop` or `leg-no-edge` depends on
 * the leg's mode (stated, or inferred from its code: W boat, S/D ship, A flight, else foot)
 * and, when the leg names a road code, on that code: the leg described one road, so a path
 * counts only if every hop is that code. `Bluewatch Village → Siltbarrow 130 L` has no L road
 * out of Bluewatch, so it is no-edge (with the exits), though a long foot path exists; the
 * same leg with no code, on foot, is not-one-hop.
 *
 * Beyond the contract's kinds: `leg-code` (warn, the code differs from the road's),
 * `leg-rate` (warn, a stated rate outside the pace range) and `leg-days` (warn, stated days
 * off by more than half a day). Days, rate and arrival are only checked when the leg states
 * a mode or a rate; a bare `130 km B` says nothing about speed.
 */
export function validateLeg(pack, leg, { from = null, depart = null, arrive = null, calendar = null } = {}) {
    if (typeof leg === 'string') leg = parseLeg(pack, leg);
    if (!pack || !leg) return [];
    const findings = [];
    const start = toAbs(depart, calendar);
    const ctx = { pack, calendar, start, legRate: positive(leg.rate) };

    if (!leg.from || !leg.to) {
        const unknown = [!leg.from && (leg.fromText || 'the start'), !leg.to && (leg.toText || 'the destination')]
            .filter(Boolean).map(name => `"${name}"`);
        let message = `${unknown.join(' and ')} ${unknown.length > 1 ? 'are' : 'is'} not in the world pack.`;
        if (leg.from) message += ` ${exitsText(pack, leg.from)}`;
        findings.push(finding('leg-unknown-place', 'warn', message));
        return findings;
    }

    const origin = from ? resolvePlace(pack, from) : null;
    const statedMode = normalizeMode(leg.mode, pack);
    if (origin && origin !== leg.from) {
        const mode = statedMode ?? inferMode(leg.code, pack);
        const plan = planRoute(pack, origin, leg.to, { mode });
        const hop = plan?.hops[0];
        findings.push(finding('leg-wrong-start', 'error',
            `The leg starts at ${leg.from}, but the traveller is at ${origin}.`
            + (hop ? ` First leg from ${origin}: ${hopText(hop)}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null));
        return findings;
    }
    if (leg.from === leg.to) return findings;

    const direct = edgesBetween(pack, leg.from, leg.to);
    const mode = statedMode ?? inferMode(leg.code ?? direct[0]?.code, pack);

    if (!direct.length) {
        const onCode = leg.code ? edge => edge.code === leg.code : null;
        if (!search(pack, leg.from, leg.to, mode, onCode)) {
            const road = leg.code ? `${leg.code} road` : `road ${mode === 'foot' ? 'on foot' : `by ${mode}`}`;
            const result = finding('leg-no-edge', 'error',
                `No ${road} from ${leg.from} to ${leg.to}. ${exitsText(pack, leg.from)}`);
            result.exits = exitsFrom(pack, leg.from);
            findings.push(result);
            return findings;
        }
        const plan = planRoute(pack, leg.from, leg.to, { mode });
        const hop = plan.hops[0];
        const result = finding('leg-not-one-hop', 'error',
            `${leg.from} → ${leg.to} is not one hop: ${routeText(plan)} (${num(plan.km)} km). First leg: ${hopText(hop)}.`,
            correctionFor({ ...ctx, hop, mode }).text);
        result.firstHop = { from: hop.from, to: hop.to, km: hop.km, code: hop.code, corridor: hop.corridor };
        result.path = plan;
        findings.push(result);
        return findings;
    }

    const named = leg.code ? direct.filter(edge => edge.code === leg.code) : [];
    const edge = bestEdge(pack, named.length ? named : direct, mode);
    if (!edge) {
        // The road exists but not for this mode: another road between the two, or the
        // first hop of a path the mode can take.
        const other = bestEdge(pack, direct, mode);
        const plan = other ? null : planRoute(pack, leg.from, leg.to, { mode });
        const hop = other ? toHop(other, leg.from) : plan?.hops[0];
        const road = direct.find(candidate => !leg.code || candidate.code === leg.code);
        const result = finding('leg-mode', 'error',
            `${capitalize(mode)} cannot use ${roadName(road)} from ${leg.from} to ${leg.to}.`
            + (hop ? ` Instead: ${hopText(hop)}${plan ? ` (${num(plan.km)} km in all)` : ''}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null);
        if (plan) result.path = plan;
        findings.push(result);
        return findings;
    }

    const hop = toHop(edge, leg.from);
    const fix = correctionFor({ ...ctx, hop, mode, rateOk: statedMode ? null : true });
    if (leg.code && !named.length) {
        findings.push(finding('leg-code', 'warn',
            `The road from ${leg.from} to ${leg.to} is ${edge.code} (${codeName(pack, edge.code)}), not ${leg.code}.`, fix.text));
    }
    if (leg.km !== null && leg.km !== undefined && Math.abs(leg.km - edge.km) > KM_TOLERANCE * edge.km) {
        findings.push(finding('leg-km', 'warn',
            `${leg.from} → ${leg.to} is ${num(edge.km)} km, not ${num(leg.km)}.`, fix.text));
    }
    if (!statedMode && !ctx.legRate) return findings;

    const unit = unitOf(pack);
    if (statedMode && ctx.legRate && !fix.rateInRange) {
        findings.push(finding('leg-rate', 'warn',
            `${capitalize(mode)} on ${edge.code} goes ${rangeText(fix.range)} ${rateWords(unit)}, not ${num(ctx.legRate)}.`, fix.text));
    }
    const tolerance = toleranceFor(fix.days, unit);
    if (leg.days !== null && leg.days !== undefined
        && Math.abs(leg.days - fix.days) > tolerance && Math.abs(leg.days - fix.activeDays) > tolerance) {
        findings.push(finding('leg-days', 'warn',
            `${num(edge.km)} km at ${num(fix.rate)} ${rateWords(unit)} is ${durationText(fix.days, unit)}, not ${durationText(leg.days, unit)}.`, fix.text));
    }
    if (fix.arrive !== null) {
        const gap = arrivalGap(fix.arrive, arrive, calendar);
        if (gap !== null && gap > tolerance) {
            findings.push(finding('leg-arrive', 'warn',
                `Arrival ${dateText(arrive, calendar)} is ${durationText(gap, unit)} off: `
                + `${durationText(fix.days, unit)} from ${dateText(start, calendar)} is ${dateText(fix.arrive, calendar)}.`, fix.text));
        }
    }
    return findings;
}

function finding(kind, severity, message, correction = null) {
    const result = { kind, severity, key: null, message };
    if (correction) result.correction = correction;
    return result;
}

// The corrected leg for one hop: the stated rate when it fits the pace, else the pace.
function correctionFor({ pack, calendar, start, legRate, hop, mode, rateOk = null }) {
    const pace = paceFor(pack, hop.code, mode, { corridor: hop.corridor });
    const range = acceptedRange(pack, hop, mode) ?? pace;
    const rateInRange = Boolean(legRate && range && legRate >= range.low - EPSILON && legRate <= range.high + EPSILON);
    const rate = legRate && (rateInRange || rateOk) ? legRate : pace?.rate ?? legRate;
    const activeDays = rate > 0 ? hopDays(pack, hop, mode, rate) : null;
    const days = tidy(activeDays + restDaysFor(mode, activeDays, pack.rules));
    const arrive = start === null ? null : addDays(start, days, calendar);
    const text = formatLeg(hop, { mode, rate, days, arrive, calendar, unit: unitOf(pack) });
    return { text, rate, range, rateInRange, activeDays, days, arrive };
}

function toHop(edge, from) {
    return { from, to: edge.a === from ? edge.b : edge.a, km: edge.km, code: edge.code, corridor: edge.corridor };
}

// How far (in days) a stated arrival is from the computed one. A date without a time
// covers its whole day.
function arrivalGap(expected, arrive, calendar) {
    if (typeof arrive === 'number' && Number.isFinite(arrive)) return Math.abs(arrive - expected) / DAY_MINUTES;
    if (typeof arrive !== 'string' || !calendar) return null;
    const parsed = calendar.parse(arrive, { reference: expected });
    if (!parsed) return null;
    if (parsed.hasTime) return Math.abs(parsed.abs - expected) / DAY_MINUTES;
    const dayStart = Math.floor(parsed.abs / DAY_MINUTES) * DAY_MINUTES;
    if (expected < dayStart) return (dayStart - expected) / DAY_MINUTES;
    if (expected > dayStart + DAY_MINUTES) return (expected - dayStart - DAY_MINUTES) / DAY_MINUTES;
    return 0;
}

// ---------------------------------------------------------------------------------------
// Formatting

/** `Shorn → Varnhold Watch 35 B → … = 220 km · ride 35/day · 7 active days + 1 rest = 8 days · arrive …` */
export function formatRoute(plan, calendar = null) {
    if (!plan) return '';
    const path = [plan.from, ...plan.hops.map(hop => `${hop.to} ${num(hop.km)} ${hop.code}${hop.mode ? ` (${hop.mode})` : ''}`)].join(' → ');
    const parts = [`${path} = ${num(plan.km)} km`];
    const rates = [...new Set(plan.hops.filter(hop => !hop.mode).map(hop => hop.rate))].sort((a, b) => a - b);
    if (rates.length) {
        const rate = rates.length === 1 ? num(rates[0]) : `${num(rates[0])}–${num(rates[rates.length - 1])}`;
        parts.push(`${plan.mode} ${rate}${plan.unit === 'hour' ? ' km/h' : '/day'}`);
    }
    if (plan.unit === 'hour') {
        if (plan.boardHours > 0) parts.push(`${durationText(plan.boardHours / 24, 'hour')} boarding`);
        parts.push(plan.stops > 0
            ? `${durationText(plan.activeDays, 'hour')} on the way + ${plan.stops} ${plan.stops === 1 ? 'night' : 'nights'} = ${durationText(plan.days, 'hour')}`
            : durationText(plan.days, 'hour'));
    } else {
        parts.push(plan.restDays > 0
            ? `${num(plan.activeDays)} active ${dayWord(plan.activeDays)} + ${num(plan.restDays)} rest = ${num(plan.days)} ${dayWord(plan.days)}`
            : `${num(plan.days)} ${dayWord(plan.days)}`);
    }
    if (plan.arrive !== null && plan.arrive !== undefined && calendar) {
        parts.push(`arrive ${calendar.format(plan.arrive, { era: false })}`);
    }
    return parts.join(' · ');
}

/**
 * One leg in the line grammar: `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5 | arrive: …`;
 * with `unit: 'hour'` (a modern pack) `Home → Office 25 RD, car 60/h → 0.5 h`.
 */
export function formatLeg(hop, { mode = null, rate = null, days = null, arrive = null, calendar = null, unit = 'day' } = {}) {
    if (!hop) return '';
    const m = normalizeMode(mode ?? hop.mode) ?? mode ?? null;
    const r = rate ?? hop.rate ?? null;
    const d = days ?? hop.days ?? null;
    let text = `${hop.from} → ${hop.to}`;
    if (hop.km !== null && hop.km !== undefined) text += ` ${num(hop.km)}`;
    if (hop.code) text += ` ${hop.code}`;
    const hourly = unit === 'hour';
    const working = [m, r !== null ? `${num(r)}/${hourly ? 'h' : 'day'}` : null].filter(Boolean).join(' ');
    if (working) text += `, ${working}`;
    if (d !== null) text += hourly ? ` → ${num(d * 24)} h` : ` → ${num(d)}`;
    const when = typeof arrive === 'number' ? (calendar ? calendar.format(arrive, { era: false }) : null) : arrive;
    if (when) text += ` | arrive: ${when}`;
    return text;
}

function hopText(hop) {
    return `${hop.from} → ${hop.to} ${num(hop.km)} ${hop.code}`;
}

function routeText(route) {
    return [route.from, ...route.hops.map(hop => `${hop.to} ${num(hop.km)} ${hop.code}`)].join(' → ');
}

function exitsText(pack, place) {
    const exits = exitsFrom(pack, place);
    if (!exits.length) return `${place} has no exits.`;
    return `Exits from ${place}: ${exits.map(exit => `${exit.to} ${num(exit.km)} ${exit.code}`).join(', ')}.`;
}

function roadName(edge) {
    if (!edge) return 'the road';
    return edge.corridor ? `the ${edge.corridor} (${edge.code})` : `the ${edge.code} road`;
}

function rangeText(range) {
    if (!range) return '?';
    return range.low === range.high ? num(range.low) : `${num(range.low)}–${num(range.high)}`;
}

function dateText(value, calendar) {
    if (typeof value === 'number' && calendar) return calendar.format(value, { era: false });
    return String(value);
}

function unitOf(pack) {
    return pack?.rules?.unit === 'hour' ? 'hour' : 'day';
}

function rateWords(unit) {
    return unit === 'hour' ? 'km/h' : 'km a day';
}

// Pre-modern: half a day. Modern: a quarter hour, or a tenth of the trip when that is more.
function toleranceFor(days, unit) {
    return unit === 'hour' ? Math.max(0.25 / 24, (days ?? 0) * 0.1) : DAYS_TOLERANCE;
}

/** "1.5 days"; for a modern pack "45 min", "2 h 15 min", "1 day 3 h". */
export function durationText(days, unit = 'day') {
    if (unit !== 'hour') return `${num(days)} ${dayWord(days)}`;
    const minutes = Math.round((days ?? 0) * 1440);
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    const m = minutes % 60;
    const parts = [d ? `${d} ${d === 1 ? 'day' : 'days'}` : '', h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean);
    return parts.join(' ') || '0 min';
}

function dayWord(days) {
    return days <= 1 ? 'day' : 'days';
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------
// Small helpers

function toAbs(value, calendar, reference = null) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && calendar) return calendar.parse(value, { reference })?.abs ?? null;
    return null;
}

// To the minute: hours in thirds and quarters must not land on 09:59.
function addDays(abs, days, calendar) {
    return Math.round(calendar?.addDays ? calendar.addDays(abs, days) : abs + days * DAY_MINUTES);
}

// 6.500000000001 → 6.5, so sums and printed numbers stay clean.
function tidy(value) {
    return Math.round(value * 1e9) / 1e9;
}

function num(value) {
    return String(Number(Number(value).toFixed(2)));
}

function names(list) {
    return Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()) : [];
}

function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
