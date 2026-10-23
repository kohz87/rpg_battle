// RPG Battle v2, the battle card (UI 8f, cards under replies): under the reply that started a fight, while the fight is on.
// It says who the foes are, the round and whose move it is, and offers Fight (opens the Fight screen), Flee (`combat.flee`,
// when the party can get away now) and Later (the viewer's fold). Once the fight is settled (its status is no longer
// `active`) the card is no longer returned and goes away on the next draw.
//
// `for(state, message, ctx)`: ctx.query('combat.session') reads the fight at that message's state (the combat part's view).

export const BATTLE_CARD_ID = 'battle';
export const FIGHT_SCREEN = 'rpg-battle/fight';

const TITLE_MAX = 60;

/** The fight on at a state (its session view), or null: a settled or missing fight is no fight. */
export function liveFight(ctx) {
    let session = null;
    try { session = ctx?.query?.('combat.session', {}) ?? null; } catch { session = null; }
    return session && session.status === 'active' ? session : null;
}

/** The battle card for a message's state: null without a fight on. */
export function battleCardFor(state, message, ctx) {
    const session = liveFight(ctx);
    if (!session) return null;
    const foes = (session.combatants ?? []).filter(c => c.side === 'enemy' && !c.gone);
    // The foes of one kind as one name: "Cellar Rat A", "Cellar Rat B" are "Cellar Rat ×2" (a letter tells them apart on the board).
    const kinds = new Map();
    for (const foe of foes) {
        const base = String(foe.name ?? '').replace(/\s+[A-Z]$/, '').trim();
        if (base) kinds.set(base, (kinds.get(base) ?? 0) + 1);
    }
    const names = [...kinds].map(([base, count]) => (count > 1 ? `${base} ×${count}` : base));
    let title = names.length ? `Fight: ${names.join(', ')}` : 'Fight';
    if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 3)}...`;
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
