// RPG Battle v2, the start card (UI 8f, cards under replies): under the greeting, until a character exists, a card that
// opens the Party screen (its empty state has the wizard's Create button, widget `rpg-battle.create-character`) or sets the
// card aside (`creation.skipStart`, a game-state flag, so a swipe or a rollback undoes it). Story Block's `cards` socket
// asks `for(state, message, ctx)` per assistant message; a card returned by the first message that answers it shows once.
//
// Create opens the Party screen rather than the wizard: a card's `open` opens a screen with the `screen` mount, and the
// wizard is dialog-only (see the note in the UI 8f live check).

const hasPc = party => Boolean(party?.pc && party.actors?.[party.pc]);

export const START_CARD_ID = 'start';
export const START_SCREEN_ID = 'rpg-battle/party';

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
            { id: 'create', label: 'Create', icon: 'fa-user-plus', primary: true, open: START_SCREEN_ID },
            { id: 'skip', label: 'Skip', command: 'creation.skipStart', payload: {} },
        ],
    };
}

/** The `cards` entry of the creation part: `for(state, message, ctx)`. */
export const startCard = Object.freeze({ for: state => startCardFor(state) });
