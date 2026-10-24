// RPG Battle v2, the start card (UI 8f, cards under replies): under the greeting, until a character exists, a card that
// opens the creation wizard or sets the card aside (`creation.skipStart`, a game-state flag, so a swipe or a rollback undoes
// it; the party part's canGenerate lets replies through once it is set). Story Block's `cards` socket asks
// `for(state, message, ctx)` per assistant message; a card returned by the first message that answers it shows once.
//
// Create opens the wizard, which is dialog-only: a card's `open` shows a screen's dialog when the screen has no `screen`
// mount (Story Block's card actions), with the action's `payload` as the dialog's draft; the payload is the wizard's
// starting draft (the persona's name, background and portrait, open.js startDraft), as openCreation gives it. In a chat with only the greeting the greeting is the newest reply, so its card acts;
// the party part blocks every reply until a character exists, so this card is the only place to start.

import { startDraft } from './open.js';
import { CREATE_SCREEN_ID } from './screen.js';

const hasPc = party => Boolean(party?.pc && party.actors?.[party.pc]);

export const START_CARD_ID = 'start';
export const START_SCREEN_ID = CREATE_SCREEN_ID;

/** The start card for a state: null once a character exists or the reader set it aside. `persona` is the wizard's persona (default: SillyTavern's). */
export function startCardFor(state, { persona = null } = {}) {
    if (hasPc(state?.domains?.party)) return null;
    if (state?.domains?.creation?.skipped === true) return null;
    return {
        tone: 'accent',
        icon: 'fa-user-plus',
        title: 'Make your character',
        text: 'The story follows one character of yours. Make one now, or set this aside and make one later from the Party screen.',
        actions: [
            { id: 'create', label: 'Create', icon: 'fa-user-plus', primary: true, open: START_SCREEN_ID, payload: startDraft(null, { persona }) },
            { id: 'skip', label: 'Skip', command: 'creation.skipStart', payload: {} },
        ],
    };
}

/** The `cards` entry of the creation part: `for(state, message, ctx)`. The greeting is the first message asked, so it carries the card. */
export const startCard = Object.freeze({ for: state => startCardFor(state) });
