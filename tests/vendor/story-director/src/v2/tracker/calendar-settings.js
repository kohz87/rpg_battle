// What the Calendar settings show (terms2, live test 2026-10-22: "SD calendar should populate the field
// for calendar from pack if it's using pack, otherwise it's misleading").
//
// The tracker's calendar setting is `tracker.calendar.preset` (pack, gregorian or custom) and the fields of
// a custom calendar (era, months, leap years, weekdays). With `pack` the chat runs on the enabled pack's
// calendar (time.js calendarConfig), but the fields used to show their Gregorian defaults. Now:
//
// * the fields' defaults are the calendar in use while the reader has not written their own: the pack's
//   (its era and months, no leap years, no weekdays) when a pack has one, else Gregorian. So with `pack`
//   they show the pack's calendar, and switching to Custom starts from it (a field the reader edits is
//   theirs from then on);
// * while Calendar is pack the fields are read-only (Story Block's settings `readOnly`): they show the
//   pack's calendar (`shows`, even over a calendar the reader stored under Custom, which is kept) and
//   cannot be edited; switching to Custom makes them editable, pre-filled with it or the reader's own;
// * the Calendar choice's help says where the calendar comes from ("From the pack: Ersveil: Bluewatch
//   Starter, CY, 12 months: switch to Custom to edit"), and the fields' help that they are only used
//   with Custom.
//
// Both are worked out when the settings are drawn (getters on the module's defaults and schema), from
// Story Block's live queries (`packs.calendar`, `packs.list`) and this module's stored settings.
// The pure parts are exported for tests.

import { PRESETS } from '../../calendar.js';

export const CALENDAR_KEYS = Object.freeze({
    preset: 'tracker.calendar.preset',
    era: 'tracker.calendar.era',
    months: 'tracker.calendar.months',
    leapYears: 'tracker.calendar.leapYears',
    week: 'tracker.calendar.week',
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The pack's calendar (`packs.calendar`'s answer) as the settings fields, or null without one. */
export function packCalendarFields(calendar) {
    if (!isRecord(calendar) || !Array.isArray(calendar.months) || !calendar.months.length) return null;
    return {
        era: String(calendar.era ?? ''),
        months: calendar.months.map(month => ({ name: String(month?.name ?? ''), days: Number(month?.days) })),
        leapYears: false,
        week: '',
    };
}

/** The built-in Gregorian calendar as the settings fields. */
export function gregorianFields() {
    const g = PRESETS.gregorian;
    return { era: String(g.era ?? ''), months: structuredClone(g.months), leapYears: g.leapYears === true, week: Array.isArray(g.week) ? g.week.join(', ') : String(g.week ?? '') };
}

/** The pack's name for the calendar's `pack` id (`packs.list` rows), else the id. */
export function packName(list, id) {
    const found = (Array.isArray(list) ? list : []).find(entry => entry?.id === id);
    return String(found?.name || id || 'the pack');
}

/**
 * The Calendar choice's help for `preset` with the pack calendar `calendar` (or null) named `name`:
 * where the calendar in use comes from, in one sentence or two.
 */
export function presetHelp(preset, calendar, name = '') {
    const fields = packCalendarFields(calendar);
    const what = fields ? `${fields.era ? `${fields.era}, ` : ''}${fields.months.length} month${fields.months.length === 1 ? '' : 's'}` : '';
    if (preset === 'gregorian') return 'The built-in Gregorian calendar. The fields below are used only with Custom.';
    if (preset === 'custom') return fields ? `Your own calendar, from the fields below. A field you have not changed shows the pack's (${name}).` : 'Your own calendar, from the fields below.';
    return fields
        ? `From the pack: ${name} (${what}), shown below. Switch to Custom to edit it.`
        : 'No enabled pack has a calendar: the built-in Gregorian, shown below. Switch to Custom to edit it.';
}

/** A calendar field's help: read-only words unless the calendar is Custom. */
export function fieldHelp(preset, calendar) {
    if (preset === 'custom') return '';
    return packCalendarFields(calendar) && preset !== 'gregorian' ? 'The pack\'s, while Calendar is pack: switch to Custom to edit.' : 'Used only when Calendar is Custom.';
}

/** A calendar field's `readOnly`: true while the stored Calendar choice is pack (the default). */
export const calendarReadOnly = values => (values?.[CALENDAR_KEYS.preset] ?? 'pack') === 'pack';

/**
 * Lays the live view over the module's `defaults` and `schema` (getters, see above), and makes the
 * calendar fields read-only while Calendar is pack (calendarReadOnly). `live()` → {
 * calendar (packs.calendar's answer or null), list (packs.list or null), preset (the stored preset or
 * undefined) }, read each time a getter is; `live.calendar()` (optional) the pack calendar alone, for the
 * defaults (which every settings read evaluates).
 */
export function liveCalendarSettings(defaults, schema, live) {
    const read = () => {
        try { return live() ?? {}; } catch { return {}; }
    };
    // The defaults are read on every settings read: the fields are worked out once per burst of
    // synchronous reads (cleared on the next microtask), so a reply's many reads ask the packs once.
    let memo = null;
    const shown = () => {
        if (!memo) {
            const calendar = typeof live.calendar === 'function' ? (() => { try { return live.calendar(); } catch { return null; } })() : read().calendar;
            memo = packCalendarFields(calendar) ?? gregorianFields();
            queueMicrotask(() => { memo = null; });
        }
        return memo;
    };
    for (const field of ['era', 'months', 'leapYears', 'week']) {
        const key = CALENDAR_KEYS[field];
        if (!Object.hasOwn(defaults, key) && !schema[key]) continue;
        Object.defineProperty(defaults, key, { enumerable: true, configurable: true, get: () => structuredClone(shown()[field]) });
        const entry = schema[key];
        if (!entry) continue;
        // Read-only while Calendar is pack (Story Block's `readOnly`, SPEC §6): the pack's calendar shown,
        // not editable; Custom makes them editable, starting from what they showed.
        entry.readOnly = calendarReadOnly;
        // While read-only the row shows the calendar in use (the pack's, else Gregorian), not a calendar the
        // reader stored under Custom before; that one is kept and is back when they switch to Custom again
        // (Story Block's `shows`, display only; an older Story Block shows the stored value).
        entry.shows = values => (calendarReadOnly(values) ? structuredClone(shown()[field]) : undefined);
        const base = typeof entry.help === 'string' ? entry.help : '';
        Object.defineProperty(entry, 'help', {
            enumerable: true,
            configurable: true,
            get: () => {
                const now = read();
                return [base, fieldHelp(now.preset ?? 'pack', now.calendar)].filter(Boolean).join(' ') || undefined;
            },
        });
    }
    const choice = schema[CALENDAR_KEYS.preset];
    if (choice) {
        Object.defineProperty(choice, 'help', {
            enumerable: true,
            configurable: true,
            get: () => {
                const now = read();
                return presetHelp(now.preset ?? 'pack', now.calendar, packName(now.list, now.calendar?.pack));
            },
        });
    }
    return { defaults, schema };
}
