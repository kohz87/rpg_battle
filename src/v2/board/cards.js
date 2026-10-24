// RPG Battle v2, the battle card (UI 8f, cards under replies): under the newest reply, while a fight is on or waiting to be
// settled. Story Block asks a module card's `for(state, message, ctx)` once, on the head reply's state (`ctx.index` is the head,
// `ctx.head` is true) and draws the card there with its actions enabled; older replies carry no module cards.
//
// A fight on says who the foes are, the round and whose move it is, and offers Fight (opens the Fight screen), Flee (`combat.flee`,
// when the party can get away now) and Later (the viewer's fold). A fight that is over but not yet settled (won, lost or fled,
// before Finish or the settle that comes ahead of the next reply) is a result card instead: "Fight won", "Fight lost" or "Fight
// fled", with Finish (opens the Fight screen, where the result and its Finish button are), and no Later. Once it is settled
// (the session is gone) the card is no longer returned and goes away on the next draw.
//
// `for(state, message, ctx)`: ctx.query('combat.session') reads the fight at that message's state (the combat part's view).

export const BATTLE_CARD_ID = 'battle';
export const FIGHT_SCREEN = 'rpg-battle/fight';

const TITLE_MAX = 60;
const TITLE_START = 'Fight: ';
const OVER = Object.freeze({
    won: { tone: 'good', icon: 'fa-trophy', title: 'Fight won' },
    lost: { tone: 'bad', icon: 'fa-skull-crossbones', title: 'Fight lost' },
    fled: { tone: 'info', icon: 'fa-person-running', title: 'Fight fled' },
});

function sessionAt(ctx) {
    try { return ctx?.query?.('combat.session', {}) ?? null; } catch { return null; }
}

/** The fight on at a state (its session view), or null: a settled or missing fight is no fight. */
export function liveFight(ctx) {
    const session = sessionAt(ctx);
    return session && session.status === 'active' ? session : null;
}

/** The fight that is over but not yet settled (won, lost or fled, before Finish), or null. A settled fight has no session. */
export function overFight(ctx) {
    const session = sessionAt(ctx);
    return session && Object.hasOwn(OVER, session.status) ? session : null;
}

const points = text => Array.from(text);

/**
 * The foes of one kind as one name: "Cellar Rat A", "Cellar Rat B" are "Cellar Rat ×2" (a letter tells them apart on the
 * board). The letter goes only where the same name minus its letter is there more than once: a lone "Agent K" is "Agent K".
 */
function kindsOf(foes) {
    const names = foes.map(foe => String(foe.name ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const lettered = new Map();
    for (const name of names) {
        const base = name.match(/^(.*\S) [A-Z]$/)?.[1];
        if (base) lettered.set(base, (lettered.get(base) ?? 0) + 1);
    }
    const kinds = new Map();
    for (const name of names) {
        const base = name.match(/^(.*\S) [A-Z]$/)?.[1];
        const key = base && lettered.get(base) > 1 ? base : name;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
    return [...kinds].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
}

/**
 * "Fight: Cellar Rat ×3, Bat" within TITLE_MAX code points. Kinds that do not fit are dropped from the end and counted ("+2
 * more"); a single name too long for the title is cut at a word boundary (never inside a character) and ends in "...".
 */
export function fightTitle(names) {
    if (!names.length) return 'Fight';
    const more = dropped => (dropped ? ` +${dropped} more` : '');
    for (let kept = names.length; kept >= 1; kept -= 1) {
        const title = `${TITLE_START}${names.slice(0, kept).join(', ')}${more(names.length - kept)}`;
        if (points(title).length <= TITLE_MAX) return title;
    }
    const tail = more(names.length - 1);
    const room = TITLE_MAX - points(TITLE_START).length - points(tail).length - 3;
    let cut = points(names[0]).slice(0, Math.max(1, room));
    const space = cut.lastIndexOf(' ');
    if (space > 0 && cut.length < points(names[0]).length) cut = cut.slice(0, space);
    return `${TITLE_START}${cut.join('').trim()}...${tail}`;
}

/** The result card of a fight that is over, not yet settled: who won, and Finish (the Fight screen has the result and its button). */
function overCardFor(session) {
    const kind = OVER[session.status];
    return {
        tone: kind.tone,
        icon: kind.icon,
        title: kind.title,
        text: `${session.place ? `${session.place} · ` : ''}Round ${session.round ?? 1}. Finish settles it: HP, XP and loot.`,
        actions: [{ id: 'finish', label: 'Finish', icon: 'fa-flag-checkered', primary: true, open: FIGHT_SCREEN }],
        later: false,
    };
}

/** The battle card for a message's state: the fight on, the result of one that is over and not settled, else null. */
export function battleCardFor(state, message, ctx) {
    const over = overFight(ctx);
    if (over) return overCardFor(over);
    const session = liveFight(ctx);
    if (!session) return null;
    const foes = (session.combatants ?? []).filter(c => c.side === 'enemy' && !c.gone);
    const title = fightTitle(kindsOf(foes));
    const rows = foes.slice(0, 3).map(foe => ({
        icon: 'fa-skull',
        text: foe.hp ? `${foe.name} · HP ${foe.hp.cur}/${foe.hp.max}` : String(foe.name ?? ''),
    }));
    if (session.actions?.actor) rows.push({ icon: 'fa-hand', text: `Your move: ${session.turn?.name ?? 'your character'}`, tag: 'Your turn', tagTone: 'accent' });
    const actions = [{ id: 'fight', label: 'Fight', icon: 'fa-khanda', primary: true, open: FIGHT_SCREEN }];
    if (session.actions?.canFlee === true) actions.push({ id: 'flee', label: 'Flee', icon: 'fa-person-running', command: 'combat.flee', payload: { session: session.id } });
    return {
        tone: 'bad',
        icon: 'fa-khanda',
        title,
        text: `${session.place ? `${session.place} · ` : ''}Round ${session.round ?? 1}`,
        rows: rows.slice(0, 4),
        actions,
        later: true,
    };
}

/** The `cards` entry of the board part: `for(state, message, ctx)`. */
export const battleCard = Object.freeze({ for: (state, message, ctx) => battleCardFor(state, message, ctx) });
