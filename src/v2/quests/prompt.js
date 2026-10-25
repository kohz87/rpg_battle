// Retained quest context from Story Director; only its query owner has changed.
const TAIL_NAMES = 6;
const READY_SHOWN = 2;
const TAIL_CHARS = 1000;
const JUDGED_SHOWN = 3;
const GOAL_CHARS = 80;
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cut = (value, max) => [...String(value)].slice(0, max).join('');
const byRecent = (a, b) => (b.rev ?? 0) - (a.rev ?? 0) || text(a.key).localeCompare(text(b.key)) || (a.id < b.id ? -1 : 1);
function listText(names) {
    const shown = names.slice(0, TAIL_NAMES);
    const more = names.length - shown.length;
    return `${shown.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

export function questTail(view) {
    const lines = [];
    if (view?.state?.domains?.rules?.rulesHash) lines.push('Open quest: + quest Name | like: <open template slug> | text: <objective text> [| foe: <canonical ref>] [| place: <canonical ref>] [| item: <canonical ref>]. Code fixes rewards. Variant fight: ! encounter Variant name | like: <pack foe slug>.');
    const optional = [];
    if (typeof view?.query !== 'function') return { lines, optional };
    const quests = view.query('rules.quests', {}) ?? [];
    const board = view.query('quest.board', {}) ?? {};
    const active = (board.active ?? []).filter(row => row.taken);
    const goalless = active.filter(row => !row.details?.hasGoal);
    if (goalless.length) lines.push(`Quests with no goal yet (give each a concrete goal: ~ quest Name | goal: …): ${listText(goalless.map(row => row.key))}.`);
    const recent = row => ({ ...row, rev: quests.find(quest => quest.id === row.id)?.acceptedCursor?.rev ?? 0 });
    const judged = active.filter(row => !row.progress?.countable && !row.ready && row.details?.hasGoal);
    for (const row of judged.map(recent).sort(byRecent).slice(0, JUDGED_SHOWN)) {
        lines.push(`Quest goal the story judges: ${row.key} — ${cut(text(row.goal), GOAL_CHARS)}.`);
    }
    const ready = active.filter(row => row.progress?.met);
    if (ready.length) {
        const named = ready.map(recent).sort(byRecent).slice(0, READY_SHOWN).map(row => {
            const giver = cut(text(row.giver), 40);
            const where = row.progress.finish?.ok ? 'here' : giver ? `at a settlement or where ${giver} is` : 'at a settlement';
            return `${row.key} (${giver ? `to ${giver}, ` : ''}${where})`;
        });
        lines.push(`Ready to turn in: ${named.join('; ')}.`);
    }
    while (optional.length && [...lines, ...optional].join('\n').length > TAIL_CHARS) optional.pop();
    return { lines: lines.map(line => cut(line, TAIL_CHARS)), optional };
}

export const QUEST_STATIC = [
    'Quest rewards: when a quest is turned in, code checks it, pays the reward and tells you under [Happened]; never add coins for a quest reward yourself.',
    'Turning in: close a quest when {{user}} turns it in (- quest Name — turned in); code checks the goal and the place, then pays, or tells you why it stays open.',
    'Every quest needs a concrete goal (| goal: what counts as done). When the goal of a quest code cannot count is met in the story, write ~ quest Name | met: yes (met: no if it is undone). Keep one short line of where it stands: ~ quest Name | progress: …',
    'Quest pacing: offer a new quest rarely, when the story calls for it, and leave quiet stretches with no new jobs. A passer-by is only a passer-by, not a quest-giver. Trouble does not come looking for {{user}} unless they provoke it.',
].join('\n');
