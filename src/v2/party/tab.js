// The Party tab, minimal and unstyled (SPEC §13 will turn screens into templates; until the UI
// spec lands this is a plain renderer): a form to make your character when there is none, the
// offers waiting (Accept / Dismiss), and each member with HP/MP/SP, stats, points to spend one at
// a time, and skills to set aside, take up or forget. Every button is a command through
// `api.command`; a rejection's message is shown above the list. Reads only the head state.

import { STATS } from '../../rules.js';
import { PRESETS } from '../../skills.js';
import { actorsInOrder, offerText, waitingOffers } from './util.js';

function make(doc, tag, { text = '', className = '', attrs = {} } = {}) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
}

function button(doc, label, className, run) {
    const node = make(doc, 'button', { text: label, className, attrs: { type: 'button' } });
    node.addEventListener('click', () => run());
    return node;
}

/** render(el, view, api) for the Party tab. */
export function renderPartyTab(el, view, api) {
    const doc = el.ownerDocument;
    el.textContent = '';
    const party = view?.state?.domains?.party ?? { pc: null, order: [], actors: {}, offers: [] };
    const status = make(doc, 'div', { className: 'rpg-party-status' });
    el.append(status);
    const run = async (type, payload) => {
        const result = await api.command(type, payload, { cause: 'ui' });
        status.textContent = result && result.ok === false ? String(result.message ?? 'That did not work.') : '';
        return result;
    };

    if (!party.pc) {
        const form = make(doc, 'div', { className: 'rpg-party-create' });
        const name = make(doc, 'input', { className: 'rpg-party-name', attrs: { type: 'text', placeholder: 'Name' } });
        const preset = make(doc, 'select', { className: 'rpg-party-preset' });
        for (const entry of PRESETS) preset.append(make(doc, 'option', { text: entry.name, attrs: { value: entry.id } }));
        form.append(make(doc, 'div', { text: 'Make your character' }), name, preset,
            button(doc, 'Create', 'rpg-party-create-go', () => run('party.create', { name: name.value, preset: preset.value || PRESETS[0].id })));
        el.append(form);
    }

    for (const offer of waitingOffers(party)) {
        const row = make(doc, 'div', { className: 'rpg-party-offer', attrs: { 'data-offer': offer.id } });
        const who = offerText(offer, party);
        row.append(make(doc, 'span', { text: who }),
            button(doc, 'Accept', 'rpg-party-accept', () => run('party.acceptOffer', { offer: offer.id })),
            button(doc, 'Dismiss', 'rpg-party-dismiss', () => run('party.dismissOffer', { offer: offer.id })));
        el.append(row);
    }

    for (const actor of actorsInOrder(party)) {
        const card = make(doc, 'div', { className: 'rpg-party-actor', attrs: { 'data-actor': actor.id } });
        const title = `${actor.name}${actor.id === party.pc ? ' (you)' : actor.role ? ` — ${actor.role}` : ''} · Lv ${actor.level} · XP ${actor.xp}`;
        card.append(make(doc, 'div', { text: title, className: 'rpg-party-title' }));
        card.append(make(doc, 'div', { text: `HP ${actor.hp.cur}/${actor.hp.max} · MP ${actor.mp.cur}/${actor.mp.max} · SP ${actor.sp.cur}/${actor.sp.max}`, className: 'rpg-party-pools' }));
        if (actor.conditions?.length) card.append(make(doc, 'div', { text: actor.conditions.map(entry => entry.kind).join(', '), className: 'rpg-party-conditions' }));
        const stats = make(doc, 'div', { className: 'rpg-party-stats' });
        for (const stat of STATS) {
            const cell = make(doc, 'span', { text: `${stat} ${actor.stats[stat]} `, attrs: { 'data-stat': stat } });
            if (actor.points > 0) cell.append(button(doc, '+', 'rpg-party-spend', () => run('party.spend', { actor: actor.id, points: { [stat]: 1 } })));
            stats.append(cell);
        }
        card.append(stats);
        if (actor.points > 0) card.append(make(doc, 'div', { text: `Points to spend: ${actor.points}`, className: 'rpg-party-points' }));
        const skills = make(doc, 'ul', { className: 'rpg-party-skills' });
        for (const skill of actor.skills ?? []) {
            const item = make(doc, 'li', { attrs: { 'data-skill': skill.name } });
            item.append(make(doc, 'span', { text: `${skill.name} (Lv ${skill.level})${skill.active ? '' : ' — set aside'} ` }),
                button(doc, skill.active ? 'Set aside' : 'Use', 'rpg-party-toggle', () => run('party.setSkillActive', { actor: actor.id, name: skill.name, active: !skill.active })),
                button(doc, 'Forget', 'rpg-party-forget', () => run('party.forgetSkill', { actor: actor.id, name: skill.name })));
            skills.append(item);
        }
        card.append(skills);
        el.append(card);
    }
}

export const tabs = [{ id: 'party', title: 'Party', icon: 'fa-users', render: renderPartyTab }];
