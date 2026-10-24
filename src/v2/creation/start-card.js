// RPG Battle v2, the start card (UI 8f, cards under replies): under the newest reply, until a character exists, a card that
// opens the creation wizard or sets the card aside (`creation.skipStart`, a game-state flag, so a swipe or a rollback undoes
// it; the party part's canGenerate lets replies through once it is set). Story Block's `cards` socket asks `for(state, message,
// ctx)` once, on the head reply's state (`ctx.index` is the head, `ctx.head` is true) and draws the card there with its actions
// enabled; older replies carry no module cards. A chat with only the greeting has the greeting as its head; an existing chat
// with no character has its newest reply.
//
// Create opens the wizard, which is dialog-only: a card's `open` shows a screen's dialog when the screen has no `screen`
// mount (Story Block's card actions), with the action's `payload` as the dialog's draft. The payload is empty: the card is
// drawn long before it is tapped, and a persona switched in between must count, so the wizard's Start step fills an empty
// draft itself, from startDraft() with the persona of that moment (wizard-widgets.js, widget rpg-battle.draft-start), as
// openCreation gives it. The party part blocks every reply until a character exists, so this card is the only place to start.

import { CREATE_SCREEN_ID } from './screen.js';

const hasPc = party => Boolean(party?.pc && party.actors?.[party.pc]);

export const START_CARD_ID = 'start';
export const START_SCREEN_ID = CREATE_SCREEN_ID;

/** The start card for a state: null once a character exists or the reader set it aside. */
export function startCardFor(state) {
    if (hasPc(state?.domains?.party)) return null;
    if (state?.domains?.creation?.skipped === true) return null;
    return {
        tone: 'accent',
        icon: 'fa-user-plus',
        title: 'Make your character',
        text: 'The story follows one character of yours. Make one now, or set this aside and make one later from the Party screen.',
        actions: [
            { id: 'create', label: 'Create', icon: 'fa-user-plus', primary: true, open: START_SCREEN_ID, payload: {} },
            { id: 'skip', label: 'Skip', command: 'creation.skipStart', payload: {} },
        ],
    };
}

/** The `cards` entry of the creation part: `for(state, message, ctx)`, asked once, about the head reply (the greeting of a greeting-only chat). */
export const startCard = Object.freeze({ for: state => startCardFor(state) });
