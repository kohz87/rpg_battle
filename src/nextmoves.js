// Next moves (0.5.4): after a fight, a few things the reader's character could do next, offered
// on the result screen instead of only "Return to story". One short model call writes them from
// the hand-off (the settled outcome) and the scene; when there is no model, the call fails or it
// says nothing usable, code writes them from the result itself. A choice is the reader's own
// move, sent (or put in the message box) as their message, so the reply narrates the fight and
// then that move. Nothing here changes the fight: the hand-off still states the outcome. Pure:
// index.js makes the call.

export const NEXT_MOVES_MAX = 4;
const MAX_MOVE = 120;

/** The system prompt: four short moves for the player's character, nothing else. */
export const NEXT_MOVES_SYSTEM = [
    'A fight in an ongoing story has just been resolved by code; its outcome is settled and must not change.',
    'Suggest what the player\'s character could do next, right after it.',
    `Answer with exactly ${NEXT_MOVES_MAX} lines, numbered 1 to ${NEXT_MOVES_MAX}, and nothing else.`,
    'Each line is one short sentence, at most 15 words, an action the player\'s character takes, written as an instruction ("Skin the wolves for their pelts.").',
    'Make them different from each other and fitting the scene, the people present and how the fight ended. Never undo or retell the outcome, never decide for anyone else, and never write numbers, stats or game terms.',
].join('\n');

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The two messages for the call: [{ role: 'system', content }, { role: 'user', content }].
 * `handoff` is the fight's hand-off (the settled outcome), `scene` the latest story as prose
 * (flavour.sceneText), `quest` an open quest's name and goal when one is known.
 */
export function nextMovesPrompt({ handoff = '', scene = '', quest = '', pcName = '' } = {}) {
    const lines = [
        pcName ? `The player's character: ${clean(pcName)}` : '',
        quest ? `Open quest: ${clean(quest)}` : '',
        'How the fight ended:',
        String(handoff ?? '').replace(/^\[[^\]]*\]\s*/, '').trim() || '(no summary)',
        '',
        'The scene before it:',
        clean(scene) || '(no story yet)',
    ];
    return [
        { role: 'system', content: NEXT_MOVES_SYSTEM },
        { role: 'user', content: lines.filter((line, index) => line || index === 4).join('\n') },
    ];
}

/**
 * The moves in an answer: numbered or bulleted lines (or plain ones), each cut to one sentence
 * of at most MAX_MOVE characters, without quotes, numbers in brackets or duplicates; at most
 * NEXT_MOVES_MAX. [] when nothing usable.
 */
export function parseNextMoves(text) {
    const seen = new Set();
    const moves = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        let line = raw.replace(/^\s*(?:\d+[.):]|[-*•])\s*/, '').replace(/^["'“”‘’*_]+|["'“”‘’*_]+$/g, '').trim();
        if (!line || /^(?:here are|sure|options?|choices?|next moves?)\b/i.test(line)) continue;
        if (line.length > MAX_MOVE) {
            const cut = line.slice(0, MAX_MOVE);
            const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
            line = stop > 20 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).trim()}…`;
        }
        if (!/[.!?…]$/.test(line)) line = `${line}.`;
        const key = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        moves.push(line);
        if (moves.length >= NEXT_MOVES_MAX) break;
    }
    return moves;
}

// A creature's name inside a sentence: lower case ("the wolves", "the feral ditch-dogs").
const creatureWords = name => String(name ?? '').replace(/\s+[A-Z]$/, '').toLowerCase();

function plural(name, count) {
    if (count <= 1 || /s$/i.test(name)) return name;
    if (/(?:[^aeiou]|qu)y$/i.test(name)) return `${name.slice(0, -1)}ies`;
    if (/(?:x|ch|sh)$/i.test(name)) return `${name}es`;
    if (/(?:[^f]f|fe)$/i.test(name) && !/(?:roof|chief|reef)$/i.test(name)) return `${name.replace(/fe?$/i, '')}ves`;
    return `${name}s`;
}

/**
 * Moves written by code from the result, when there is no model answer: what is natural after
 * that outcome. `result` is the fight's (or plan's) Result; a plan's `notReached` places give
 * a fled or withdrawn party somewhere to think about reaching another way.
 */
export function fallbackMoves(result) {
    const outcome = result?.outcome ?? 'victory';
    const party = Array.isArray(result?.party) ? result.party : [];
    const hurt = party.filter(member => member.memberId !== 'pc' && !member.down && member.hp?.max > 0 && member.hp.cur / member.hp.max < 0.6);
    const down = party.filter(member => member.memberId !== 'pc' && member.down);
    const pc = party.find(member => member.memberId === 'pc');
    const pcHurt = pc && pc.hp?.max > 0 && pc.hp.cur / pc.hp.max < 0.5;
    const notReached = Array.isArray(result?.notReached) ? result.notReached.filter(Boolean) : [];
    const moves = [];
    if (outcome === 'victory') {
        const items = Array.isArray(result?.loot?.items) ? result.loot.items : [];
        const bodyParts = items.filter(item => item.kind === 'material' && /\b(?:pelt|hide|skin|fang|claw|horn|tusk|scale)s?$/i.test(item.name ?? ''));
        const foes = [...new Set(result?.defeated ?? [])];
        if (bodyParts.length && foes.length) moves.push(`Skin the ${plural(creatureWords(foes[0]), (result.defeated ?? []).length)} and take what is worth keeping.`);
        else if (items.length || result?.loot?.money) moves.push('Search the fallen for anything worth taking.');
        if (down.length) moves.push(`Get ${down[0].name} back on their feet.`);
        else if (hurt.length) moves.push(`Tend to ${hurt[0].name}'s wounds before moving on.`);
        if (pcHurt) moves.push('Bind your own wounds and catch your breath.');
        if ((result?.fled ?? []).length) moves.push((result.fled.length > 1 ? 'Follow the ones that got away.' : `Follow the ${creatureWords(result.fled[0])} that got away.`));
        moves.push('Look around for what brought them here.');
        moves.push('Press on before anything else arrives.');
    } else if (outcome === 'fled' || outcome === 'withdrew') {
        moves.push('Get clear before they regroup.');
        if (down.length || hurt.length) moves.push(`Help ${(down[0] ?? hurt[0]).name} keep up.`);
        moves.push('Find somewhere safe to hide and recover.');
        moves.push(notReached.length ? `Think of another way to reach ${notReached[0]}.` : 'Look back to see whether anything follows.');
    } else {
        moves.push('Try to come to your senses and see where you are.');
        moves.push('Stay still and listen before giving yourself away.');
        moves.push('Call out for help.');
        if (party.length > 1) moves.push(`Look for ${party.find(member => member.memberId !== 'pc')?.name ?? 'your companions'}.`);
    }
    return [...new Set(moves)].slice(0, NEXT_MOVES_MAX);
}
