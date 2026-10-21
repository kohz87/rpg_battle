// RPG Battle v2, part **checks** (MODULES §F16: a d20 for every uncertain action). The story
// writes `? check stealth — slipping past the guard | dc: hard | who: Ren` and stops before the
// outcome; capture keeps it as a pending check with the member's automatic stat modifier. The
// reader may add a skill, an ability, an item or a custom ±n with a reason (the check card
// widget, or check.addModifier), then rolls it (check.roll). A check still waiting when the next
// reply is asked for is rolled with what it has (beforeGenerate). The roll's receipt, with its
// numbers, is what the next reply narrates. The coordinator's src/v2/module.js merges this part
// with the others; its `check` kind takes over from the party part's.

import { commands, kinds } from './commands.js';
import { queries } from './queries.js';
import { initialChecks, validateChecks, attemptText, dcText, modifierList, signed, sumOf } from './shared.js';
import { checkCard } from './widget.js';

// The instruction every reply carries (byte-identical: no names, no numbers). The line's own
// grammar is added by Story Block from `kinds.check.grammar`.
export const STATIC_TEXT = 'Any action whose outcome is uncertain (sneaking, climbing, persuading, searching, picking a lock, resisting) gets a `? check` line, and the reply stops before the outcome: never tell whether it works. The reader rolls it, and the next reply is told the result in a [Happened] line.';

export const BUDGET = 120;

function nameOf(view, id) {
    if (typeof view?.query === 'function') {
        try {
            const actor = view.query('party.actor', { id });
            if (actor?.name) return actor.name;
        } catch { /* the party part is not there */ }
    }
    return view?.state?.domains?.party?.actors?.[id]?.name ?? null;
}

/** One line per waiting check: "Check waiting: Ren — stealth (slipping past the guard) against 20 (hard), d20 + 3 (DEX +3); …". */
export function tail(view) {
    const checks = view?.state?.domains?.checks;
    const lines = (checks?.pending ?? []).map(check => `Check waiting: ${nameOf(view, check.actor) ?? 'someone'} — ${attemptText(check)} against ${dcText(check)}, d20 ${signed(sumOf(check.modifiers))} (${modifierList(check.modifiers)}); the reader rolls it, do not write it again.`);
    return { lines, optional: [] };
}

/**
 * beforeGenerate(view): every check still waiting is rolled now with the modifiers it has, as
 * `system` receipts the reply about to be written narrates. A check whose member has left the
 * party is called off instead.
 */
export function beforeGenerate(view) {
    const list = view?.state?.domains?.checks?.pending ?? [];
    if (!list.length) return { commands: [] };
    return {
        commands: list.map(check => ({
            type: nameOf(view, check.actor) === null ? 'check.cancel' : 'check.roll',
            payload: { id: check.id },
        })),
    };
}

export const part = {
    domains: {
        checks: { initial: initialChecks, validate: slice => validateChecks(slice) },
    },
    commands,
    queries,
    kinds,
    context: { static: () => STATIC_TEXT, tail, budget: BUDGET },
    hooks: { beforeGenerate },
    widgets: { 'rpg-battle.check-card': checkCard },
};
