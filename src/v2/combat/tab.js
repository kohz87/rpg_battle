// The Fight tab, plain on purpose: the offers with Fight and Not now, the fight with one button
// per action, the last result. It reads only the view (queries on the head state) and acts only
// through api.command. The real battle screen comes with the screen and widget layer (SPEC §13);
// this keeps the part usable until then.

function make(doc, tag, text, className) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(doc, label, api, type, payload) {
    const node = make(doc, 'button', label, 'menu_button');
    node.type = 'button';
    node.dataset.command = type;
    node.addEventListener('click', () => api.command(type, payload));
    return node;
}

const pool = (label, value) => (value ? `${label} ${value.cur}/${value.max}` : '');

function offersPart(doc, offers, api) {
    const box = make(doc, 'div', undefined, 'rb-fight-offers');
    for (const offer of offers) {
        const row = make(doc, 'div', undefined, 'rb-fight-offer');
        const stakes = offer.stakes === 'death' ? ' · to the death' : '';
        row.append(make(doc, 'div', `${offer.text}${stakes}${offer.place ? ` · ${offer.place}` : ''}`));
        if (offer.note) row.append(make(doc, 'div', offer.note, 'rb-fight-note'));
        row.append(button(doc, 'Fight', api, 'combat.start', { offer: offer.id }), button(doc, 'Not now', api, 'combat.dismiss', { offer: offer.id }));
        box.append(row);
    }
    return box;
}

function sessionPart(doc, session, api) {
    const box = make(doc, 'div', undefined, 'rb-fight-session');
    for (const c of session.combatants) {
        const state = c.gone ? ` — ${c.gone}` : c.conditions.length ? ` — ${c.conditions.join(', ')}` : '';
        box.append(make(doc, 'div', `${c.name}: ${[pool('HP', c.hp), pool('MP', c.mp), pool('SP', c.sp)].filter(Boolean).join(' · ')}${state}`, `rb-fight-${c.side}`));
    }
    const log = make(doc, 'div', undefined, 'rb-fight-log');
    for (const entry of session.log.slice(-8)) log.append(make(doc, 'div', entry.text));
    box.append(log);
    const actions = make(doc, 'div', undefined, 'rb-fight-actions');
    if (session.status !== 'active') {
        actions.append(make(doc, 'div', `The fight is over: ${session.status}.`), button(doc, 'Finish', api, 'combat.end', {}));
    } else if (session.turn) {
        const a = session.actions;
        const foe = id => session.combatants.find(c => c.id === id)?.name ?? id;
        actions.append(make(doc, 'div', `${session.turn.name}'s turn.`));
        for (const target of a.targets.enemies) {
            const p = a.previews.attack?.[target];
            actions.append(button(doc, `Attack ${foe(target)}${p ? ` (${p.hit}% · ${p.low}–${p.high})` : ''}`, api, 'combat.act', { action: { type: 'attack', target } }));
        }
        for (const skill of a.skills.filter(entry => entry.usable)) {
            const target = skill.target === 'one' ? a.targets.enemies[0] : skill.target === 'ally' ? a.actor : undefined;
            actions.append(button(doc, skill.name, api, 'combat.act', { action: { type: 'skill', skill: skill.name, ...(target ? { target } : {}) } }));
        }
        for (const item of a.items) actions.append(button(doc, `${item.name} ×${item.qty}`, api, 'combat.act', { action: { type: 'item', item: item.name, ...(item.target === 'one' ? { target: a.targets.enemies[0] } : {}) } }));
        actions.append(
            button(doc, 'Defend', api, 'combat.act', { action: { type: 'defend' } }),
            button(doc, `Flee (${Math.round(a.fleeChance)}%)`, api, 'combat.flee', {}),
            button(doc, 'Auto', api, 'combat.act', { action: { type: 'auto' } }),
        );
    }
    box.append(actions);
    return box;
}

/** Tab render(el, view, api): rebuilt from the head state on every call. */
export function renderFightTab(el, view, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    const session = view.query('combat.session');
    const offers = view.query('combat.offers') ?? [];
    const last = view.query('combat.last');
    const parts = [];
    if (session) parts.push(sessionPart(doc, session, api));
    if (offers.length) parts.push(offersPart(doc, offers, api));
    if (!session && last) parts.push(make(doc, 'div', last.summary, 'rb-fight-result'));
    if (!parts.length) parts.push(make(doc, 'div', 'No fight on offer. When the story starts one, it shows here.', 'rb-fight-empty'));
    el.replaceChildren(...parts);
}
