// RPG Battle v2, screens for the rules-v2 views (track C): how a view reads the contract's queries.
//
// Every query these screens read (RB_PHASE0 §3) is read through `ask`, which tells four things apart so a screen can
// give each its own state instead of one blank:
//
//   ok         the query answered and the answer has the shape the contract gives it
//   missing    the query is not registered or threw (a module that is absent, off, late or too old)
//   empty      the query answered null (an unknown actor, quest or place; or a feature that is off)
//   malformed  the query answered something the contract's shape does not allow (a version mismatch)
//
// A screen never computes a rule: it asks, it checks the shape, it shows. The shape checks below look at types and
// counts only (three skills, mastery 0..5); they never decide whether anything is allowed.

export const ASK = Object.freeze({ OK: 'ok', MISSING: 'missing', EMPTY: 'empty', MALFORMED: 'malformed' });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value, low = -Infinity, high = Infinity) => Number.isSafeInteger(value) && value >= low && value <= high;
const isText = value => typeof value === 'string';
const isList = (value, each) => Array.isArray(value) && value.every(each);

/**
 * ask(tools, name, args, valid) → { status, value, reason }. `valid` is a shape check; without one any answer is ok.
 * The reason is plain text for a diagnostics line, never markup.
 */
export function ask(tools, name, args = {}, valid = null) {
    if (typeof tools?.query !== 'function') return { status: ASK.MISSING, value: null, reason: 'no queries here' };
    let value;
    try {
        value = tools.query(name, args);
    } catch (error) {
        return { status: ASK.MISSING, value: null, reason: String(error?.message ?? error).slice(0, 200) };
    }
    if (value === null || value === undefined) return { status: ASK.EMPTY, value: null, reason: '' };
    if (typeof valid === 'function' && !valid(value)) return { status: ASK.MALFORMED, value: null, reason: `${name} answered an unexpected shape` };
    return { status: ASK.OK, value, reason: '' };
}

// ---- shape checks (types and counts only) ----------------------------------------------------------------

export const isClock = value => isRecord(value) && (value.minutes === null || isInt(value.minutes)) && isText(value.text);

export const isSkillView = value => isRecord(value) && isText(value.skill) && isText(value.form) && isText(value.name)
    && isInt(value.mastery, 0, 5) && isInt(value.uses, 0, 35) && (value.nextAt === null || isInt(value.nextAt, 1, 35)) && isInt(value.steps, 0, 2);

/** A sheet: exactly three skills is part of the shape (a sheet with two or four is a rules mismatch, not a short list). */
export const isSheet = value => isRecord(value) && isText(value.id) && isText(value.name) && isInt(value.level, 1, 99)
    && isInt(value.tier, 0, 3) && isText(value.class) && Array.isArray(value.skills) && value.skills.length === 3 && value.skills.every(isSkillView)
    && isRecord(value.hp) && isRecord(value.gear);

export const isParty = value => isRecord(value) && (value.pc === null || isText(value.pc))
    && Array.isArray(value.active) && Array.isArray(value.reserve) && Array.isArray(value.temporary)
    && isInt(value.activeLimit, 1, 99)
    && [...value.active, ...value.reserve].every(isSheet)
    && value.temporary.every(item => isRecord(item) && isText(item.id) && isText(item.name));

export const isProgress = value => isRecord(value) && isText(value.actor) && isText(value.class) && isInt(value.tier, 0, 3)
    && isList(value.checklist, row => isRecord(row) && isText(row.skill) && isText(row.form) && isInt(row.mastery, 0, 5) && isInt(row.needed, 1, 5))
    && isList(value.promotions, row => isRecord(row) && isInt(row.milestone) && typeof row.eligible === 'boolean' && isList(row.choices, isText) && isList(row.why, isText))
    && isList(value.pathways, row => isRecord(row) && isInt(row.milestone) && typeof row.eligible === 'boolean' && isList(row.why, isText)
        && isList(row.skills, item => isRecord(item) && isText(item.skill) && isText(item.fromForm) && isInt(item.step, 1, 2) && isList(item.options, isText)));

export const isQuestView = value => isRecord(value) && isText(value.id) && isText(value.title) && isText(value.state)
    && typeof value.ready === 'boolean' && isList(value.blocked, isText)
    && (value.remainingMinutes === null || isInt(value.remainingMinutes, 0));

export const isContract = value => isRecord(value) && value.api === 2 && typeof value.enabled === 'boolean';

export const isAreaTier = value => isRecord(value) && isText(value.place) && (value.tier === null || isInt(value.tier, 0, 9))
    && ['place', 'region', 'world', 'unknown'].includes(value.source);

export const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export { isInt, isList, isRecord, isText };
