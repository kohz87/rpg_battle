// RPG Battle's two tabs in Story Block's sidebar: Party (always there) and Battle (only while
// there is a battle).
//
// One entry point, `renderBattleTab(pane, view, handlers)`, draws whichever mode the glue
// asks for: the Party tab's create, idle (the party cards and what the story offers them),
// spend, learn, companion and items; the Battle tab's offer, setup, fight, between (a plan's
// stages, 0.5) and result (see docs/ARCHITECTURE.md), and reports what the reader chose
// through `handlers`. It owns no game state: every number
// arrives in `view`, and every decision leaves through a handler. What it does keep is the
// reader's half-finished input (a character being made, points being placed, the enemy
// rows of a setup, the action picked but not yet aimed), in module-level drafts, because
// the glue redraws the tab on every chat event and a form that emptied itself each time
// would be no use. A draft is dropped as soon as the tab leaves its mode.
//
// Drawn like Story Director's tab so the panel reads as one: quiet uppercase section labels
// with an icon, hairlines between records, labelled rows, SillyTavern's `menu_button`s.
// Phone first: the pane is often a ~390 px bottom sheet, so everything wraps, and the
// fight's action bar sticks to the bottom, thumb-sized.
//
// Names, descriptions, log lines and the hand-off come from the model, the sheet or data
// files the reader edits, so every node is filled through textContent, never innerHTML.
//
// Levels and XP are shown in the reader's terms (terms.js): "Soul Class III (Lv 24)" and
// "Soul Growth 54/100" rather than "Level 24" and "XP 54/100", and with terms of their own
// the enemy power picker offers their tiers (or levels) instead of F–SSS.
//
// A foe neither bestiary knows is made up when the fight starts (templates.js): the setup
// tags its name "new" and says "Preparing foes…" while the glue makes and flavours it, its
// card in the fight is tagged "new", and the idle screen's Bestiary fold lists this story's
// creatures with Regenerate and Forget, and Export and Import for the whole list.

import { STATS, RANKS, DEFAULT_RULES, costPool, maxHp, maxMp, maxSp, derive, checkModifiers, hitChance, statCap } from '../rules.js';
import { stateWords } from '../narrative.js';
import { SLOT_NAMES, formatStats } from '../items.js';
import { levelTag, levelText, progress, termsOf, xpGainText } from '../terms.js';
import { buildStats, cleanFocus, guessFocus } from '../builds.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];
const SKILL_TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const SKILL_TARGETS = ['one', 'all', 'self', 'ally', 'allies'];
// A template's element puts its condition on a hit (skills.skillFromTemplate); heals and buffs ignore it.
const SKILL_ELEMENTS = ['none', 'fire', 'ice', 'lightning', 'poison'];
const ELEMENT_LABELS = { none: 'none', fire: 'fire (burns)', ice: 'ice (slows)', lightning: 'lightning (stuns)', poison: 'poison' };
// The learn screen's "keep the new skill set aside" choice.
const NEW_ASIDE = '\u0000new';
const LOG_LINES = 8;
// Which tab a mode belongs to: the Party tab (always there) or the Battle tab (while there is a battle).
const PARTY_MODES = ['create', 'idle', 'spend', 'learn', 'companion', 'items'];
const BATTLE_MODES = ['offer', 'setup', 'fight', 'between', 'result'];

// What each stat does, in a few words, for the reader building a character.
const STAT_HINTS = {
    STR: 'physical attack, stamina',
    VIT: 'HP, defence, stamina',
    AGI: 'turn order, dodge, flee',
    DEX: 'accuracy, crits',
    INT: 'MP, magic',
    LUK: 'crits, loot',
    CHA: 'parley, talk',
};

const TYPE_ICONS = {
    physical: 'fa-hand-fist',
    magic: 'fa-wand-sparkles',
    heal: 'fa-heart-pulse',
    buff: 'fa-arrow-trend-up',
    debuff: 'fa-arrow-trend-down',
};

const TARGET_LABELS = {
    one: 'one enemy',
    all: 'all enemies',
    self: 'self',
    ally: 'one ally',
    allies: 'all allies',
};

const REASON_LABELS = {
    mp: 'Not enough MP',
    sp: 'Not enough SP',
    cooldown: 'On cooldown',
    stunned: 'Stunned',
};

const OUTCOME_TITLES = {
    victory: 'Victory',
    defeat: 'Defeated',
    fled: 'Escaped',
    withdrew: 'Fell back',
};

// ---------------------------------------------------------------------------
// DOM helpers (the same shapes as Story Director's tab)

function el(tag, { className, text, title, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, String(value));
    for (const child of children) if (child) node.append(child);
    return node;
}

function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

function button(label, className, { iconName, title, onClick, disabled = false } = {}) {
    const node = el('button', { className: `menu_button rpg-battle-button ${className}`.trim(), title });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { className: 'rpg-battle-button-label', text: label }));
    if (onClick) node.addEventListener('click', onClick);
    node.disabled = Boolean(disabled);
    return node;
}

/** The quiet section label: an icon, then the name in small capitals. */
function sub(label, iconName, count = null) {
    return el('div', { className: 'rpg-battle-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'rpg-battle-count', text: String(count) }),
    ]);
}

function section(className, children) {
    return el('section', { className: `rpg-battle-section ${className}` }, children);
}

function option(value, label = value) {
    const node = el('option', { text: label });
    node.value = value;
    return node;
}

function select(className, label, choices, value) {
    const node = el('select', { className: `text_pole rpg-battle-select ${className}`, attrs: { 'aria-label': label } },
        choices.map(choice => (Array.isArray(choice) ? option(choice[0], choice[1]) : option(choice))));
    node.value = value;
    return node;
}

// Which folds are open, by class name: a fold that snapped shut on every redraw would be no use.
const openFolds = new Map();

function fold(className, label, iconName, count, children, { open = false } = {}) {
    const details = el('details', { className: `rpg-battle-fold ${className}` }, [
        el('summary', { className: 'rpg-battle-fold-summary' }, [sub(label, iconName, count)]),
        el('div', { className: 'rpg-battle-fold-body' }, children),
    ]);
    details.open = openFolds.has(className) ? openFolds.get(className) : open;
    details.addEventListener('toggle', () => { openFolds.set(className, Boolean(details.open)); });
    return details;
}

const list = value => (Array.isArray(value) ? value : []);
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const str = value => String(value ?? '').trim();
const signed = value => (num(value) >= 0 ? `+${num(value)}` : String(num(value)));
const tidy = value => String(Math.round(num(value) * 10) / 10);
const sameName = (a, b) => str(a).toLowerCase().replace(/\s+/g, ' ') === str(b).toLowerCase().replace(/\s+/g, ' ');

/**
 * A labelled meter: "HP [████░░] 58/62". role="progressbar" so a screen reader reads the
 * numbers; the fill width is the only inline style.
 */
function bar(kind, cur, max, label = kind.toUpperCase(), { name = kind.toUpperCase(), text = null } = {}) {
    const value = Math.max(0, Math.round(num(cur)));
    const top = Math.max(0, Math.round(num(max)));
    const pct = top > 0 ? Math.min(100, Math.round((value / top) * 100)) : 0;
    const fill = el('span', { className: 'rpg-battle-bar-fill' });
    fill.style.width = `${pct}%`;
    const low = kind === 'hp' && top > 0 && pct <= 25;
    // A long name ("Soul Growth") gets a wider first column than HP and MP need.
    const named = name.length > 3 ? ' is-named' : '';
    return el('div', {
        className: `rpg-battle-bar is-${kind}${low ? ' is-low' : ''}${named}`,
        attrs: {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': '0',
            'aria-valuemax': String(top),
            'aria-valuenow': String(Math.min(value, top)),
            'aria-valuetext': text ?? `${value} of ${top}`,
        },
    }, [
        el('span', { className: 'rpg-battle-bar-name', text: name, attrs: { 'aria-hidden': 'true' } }),
        el('span', { className: 'rpg-battle-bar-track' }, [fill]),
        el('span', { className: 'rpg-battle-bar-value', text: text ?? `${value}/${top}`, attrs: { 'aria-hidden': 'true' } }),
    ]);
}

function chips(conditions, className = '') {
    const items = list(conditions).filter(entry => entry && str(entry.name));
    if (!items.length) return null;
    return el('ul', { className: `rpg-battle-chips ${className}`.trim(), attrs: { 'aria-label': 'Conditions' } }, items.map(entry => el('li', {
        className: `rpg-battle-chip is-${str(entry.name).toLowerCase().replace(/[^a-z0-9-]/g, '')}`,
        text: entry.rounds === null || entry.rounds === undefined ? str(entry.name) : `${str(entry.name)} ${entry.rounds}`,
    })));
}

/** A `label value` fact row inside a <dl>, as Story Director draws record parts. */
function facts(rows, className = '') {
    const node = el('dl', { className: `rpg-battle-facts ${className}`.trim() });
    for (const [label, value] of rows) {
        if (value === null || value === undefined || value === '') continue;
        node.append(el('dt', { text: label }), el('dd', { text: value }));
    }
    return node.children.length ? node : null;
}

// (0.5.29) "4 SP" for a physical skill (stamina), "5 MP" for the rest.
function costText(skill) {
    return `${num(skill.mp)} ${costPool(skill) === 'sp' ? 'SP' : 'MP'}`;
}

function skillMeta(skill) {
    const parts = [];
    if (skill.type) parts.push(skill.type);
    // (0.5.29) The stat it runs on, so a skill's build is never a guess.
    if (skill.stat) parts.push(skill.stat);
    parts.push(costText(skill));
    if (num(skill.cooldown) > 0) parts.push(`cooldown ${num(skill.cooldown)}`);
    if (skill.target && TARGET_LABELS[skill.target]) parts.push(TARGET_LABELS[skill.target]);
    return parts.join(' · ');
}

// The renderer's last arguments, so a click that changes only local state (open a menu, add
// a row) can redraw without the glue.
let current = { pane: null, view: null, handlers: null, root: null };

function rerender() {
    if (current.pane) renderBattleTab(current.pane, current.view, current.handlers);
}

/** Call a handler that may be missing; afterwards redraw if the glue did not. */
function emit(handlers, name, ...args) {
    const root = current.root;
    const fn = handlers?.[name];
    if (typeof fn === 'function') fn(...args);
    return root;
}

// ---------------------------------------------------------------------------
// Stat steppers (create and spend)

function stepper(stat, { onMinus, onPlus, hint = '' }) {
    const value = el('span', { className: 'rpg-battle-stepper-value', attrs: { 'aria-live': 'polite' } });
    const minus = button('', 'rpg-battle-step is-minus', { iconName: 'fa-minus', title: `Lower ${stat}`, onClick: onMinus });
    const plus = button('', 'rpg-battle-step is-plus', { iconName: 'fa-plus', title: `Raise ${stat}`, onClick: onPlus });
    const extra = el('span', { className: 'rpg-battle-stepper-extra' });
    const row = el('li', { className: 'rpg-battle-stepper' }, [
        el('span', { className: 'rpg-battle-stepper-name' }, [
            el('span', { className: 'rpg-battle-stat-name', text: stat }),
            hint ? el('span', { className: 'rpg-battle-stat-hint', text: hint }) : null,
        ]),
        el('span', { className: 'rpg-battle-stepper-controls' }, [minus, value, plus]),
        extra,
    ]);
    row.dataset.stat = stat;
    return { row, value, minus, plus, extra };
}

/** Max HP, Max MP and attacks for a set of stats, as before → after rows. */
function previewRows(before, after) {
    return [
        ['Max HP', before.hp, after.hp],
        ['Max MP', before.mp, after.mp],
        ['Max SP', before.sp, after.sp],
        ['Attack', before.patk, after.patk],
        ['Magic', before.matk, after.matk],
        ['Crit', `${tidy(before.crit)}%`, `${tidy(after.crit)}%`],
    ];
}

function previewList() {
    const node = el('dl', { className: 'rpg-battle-facts rpg-battle-preview', attrs: { 'aria-live': 'polite' } });
    return node;
}

function fillPreview(node, rows, showBefore) {
    node.replaceChildren();
    for (const [label, before, after] of rows) {
        const changed = String(before) !== String(after);
        const value = showBefore && changed ? `${before} → ${after}` : String(after);
        node.append(el('dt', { text: label }), el('dd', { className: changed && showBefore ? 'is-up' : '', text: value }));
    }
}

function numbersFor(stats, level, rules, { hpBonus = 0, mpBonus = 0, spBonus = 0 } = {}) {
    const d = derive(stats, {}, rules);
    return { hp: maxHp(stats, level, rules, hpBonus), mp: maxMp(stats, level, rules, mpBonus), sp: maxSp(stats, level, rules, spBonus), ...d };
}

// ---------------------------------------------------------------------------
// create: a new character

let createDraft = null;

const PERSONA_HINT = 'From your persona; change it if your character goes by another name.';

function renderCreate(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const { startStat, startPoints } = rules.character;
    // The name starts as the SillyTavern persona's and follows it (a persona switched meanwhile)
    // until the reader types in the Name box; from then on it is theirs.
    const persona = str(view.persona);
    if (!createDraft) createDraft = { name: persona, nameFromPersona: true, stats: Object.fromEntries(STATS.map(stat => [stat, startStat])) };
    else if (createDraft.nameFromPersona) createDraft.name = persona;
    const draft = createDraft;
    const spent = () => STATS.reduce((sum, stat) => sum + draft.stats[stat] - startStat, 0);
    const remaining = () => startPoints - spent();

    const nameInput = el('input', { className: 'text_pole rpg-battle-name-input', attrs: { type: 'text', maxlength: '60', placeholder: 'Name', 'aria-label': 'Character name', autocomplete: 'off' } });
    nameInput.value = draft.name;
    const nameHint = el('small', { className: 'rpg-battle-hint rpg-battle-name-hint', text: PERSONA_HINT });
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; draft.nameFromPersona = false; refresh(); });

    const remainingNode = el('span', { className: 'rpg-battle-remaining', attrs: { 'aria-live': 'polite' } });
    const steppers = STATS.map(stat => stepper(stat, {
        hint: STAT_HINTS[stat],
        onMinus: () => { if (draft.stats[stat] > startStat) { draft.stats[stat] -= 1; refresh(); } },
        onPlus: () => { if (remaining() > 0 && draft.stats[stat] < statCap(rules)) { draft.stats[stat] += 1; refresh(); } },
    }));

    const preview = previewList();
    const hint = el('p', { className: 'rpg-battle-hint rpg-battle-create-hint', attrs: { 'aria-live': 'polite' } });
    const create = button('Create character', 'rpg-battle-primary rpg-battle-create', {
        iconName: 'fa-user-plus',
        onClick: () => {
            if (!valid()) return;
            emit(handlers, 'onCreate', { name: str(draft.name), stats: { ...draft.stats } });
        },
    });

    function valid() {
        return Boolean(str(draft.name)) && remaining() === 0;
    }

    function refresh() {
        const left = remaining();
        remainingNode.textContent = `${left} of ${startPoints} points left`;
        remainingNode.classList.toggle('is-done', left === 0);
        for (const step of steppers) {
            const stat = step.row.dataset.stat;
            step.value.textContent = String(draft.stats[stat]);
            step.minus.disabled = draft.stats[stat] <= startStat;
            step.plus.disabled = left <= 0 || draft.stats[stat] >= statCap(rules);
            step.extra.textContent = `check ${signed(checkModifiers(draft.stats, rules)[stat])}`;
        }
        fillPreview(preview, previewRows(numbersFor(draft.stats, 1, rules), numbersFor(draft.stats, 1, rules)), false);
        const missing = [];
        if (!str(draft.name)) missing.push('a name');
        if (left > 0) missing.push(`${left} more ${left === 1 ? 'point' : 'points'}`);
        hint.textContent = missing.length ? `Still needed: ${missing.join(', ')}.` : 'Ready.';
        create.disabled = !valid();
        nameHint.hidden = !(draft.nameFromPersona && str(draft.name));
    }

    // append() would write a null as the text "null"; the import notice comes first only when there is one.
    if (view.importing) root.append(importNotice(view.importing, handlers));
    root.append(
        section('is-create-intro', [
            sub('New character', 'fa-user-plus'),
            el('p', { className: 'rpg-battle-hint', text: `No classes: every stat starts at ${startStat}; spend ${startPoints} points the way you see your character. Skills come from the story: the opening message or a later scene teaches them, and you accept each one.` }),
            el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text: 'Name' }), nameInput, nameHint]),
        ]),
        section('is-stats', [
            el('div', { className: 'rpg-battle-sub-row' }, [sub('Stats', 'fa-chart-simple'), remainingNode]),
            el('ul', { className: 'rpg-battle-steppers' }, steppers.map(step => step.row)),
        ]),
        section('is-preview', [sub(termsOf(rules).custom ? `At ${levelText(1, rules)}` : 'At level 1', 'fa-heart-pulse'), preview]),
        el('div', { className: 'rpg-battle-actions is-end' }, [hint, create]),
        el('div', { className: 'rpg-battle-actions' }, [el('span', { className: 'rpg-battle-hint', text: 'Or bring a party from a file:' }), importButton(handlers)]),
    );
    refresh();
}

// ---------------------------------------------------------------------------
// idle: the sheet at a glance

function renderIdle(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const sheet = view.sheet;
    if (!sheet && !view.gameOver) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No character sheet yet.' }));
        return;
    }

    if (view.importing) root.append(importNotice(view.importing, handlers));

    // Losing a fight to the death ends the character's story: the tab says so, and the only
    // way on is a new character (or a party file).
    if (view.gameOver) {
        root.append(el('div', { className: 'rpg-battle-notice is-game-over', attrs: { role: 'status' } }, [
            el('div', { className: 'rpg-battle-notice-text' }, [
                icon('fa-skull'),
                el('span', { className: 'rpg-battle-game-over-text', text: `${str(view.gameOver.name) || 'Your character'} has died.` }),
            ]),
            el('p', { className: 'rpg-battle-hint', text: 'The fight was to the death. Start over to make a new character; nothing is carried over.' }),
            startOverControls(handlers, { companions: list(view.party).length }),
        ]));
        root.append(el('div', { className: 'rpg-battle-actions' }, [importButton(handlers)]));
        return;
    }

    if (view.pending) {
        root.append(el('div', { className: 'rpg-battle-notice is-pending', attrs: { role: 'status' } }, [
            el('div', { className: 'rpg-battle-notice-text' }, [
                icon('fa-feather'),
                el('span', { text: 'A fight result is waiting to be narrated in the next reply.' }),
            ]),
            fold('is-pending-text', 'Hand-off', 'fa-scroll', null, [el('pre', { className: 'rpg-battle-handoff', text: view.pending })]),
            button('Return to story', 'rpg-battle-return', { iconName: 'fa-book-open', onClick: () => emit(handlers, 'onReturn') }),
        ]));
    } else if (view.narrating) {
        root.append(el('p', { className: 'rpg-battle-hint rpg-battle-narrating', attrs: { role: 'status' }, text: 'The fight is being narrated…' }));
    }

    // What the story offers the party (someone joins, leaves or learns a skill, XP, a quest
    // done, a rest, a fallen companion, a rename): each waits for Accept, never applied on its
    // own. A fight it offers is the Battle tab's.
    for (const offer of list(view.offers).filter(entry => entry && str(entry.key) && str(entry.text))) root.append(offerNotice(offer, handlers));

    // Story Block's own Character Sheet block keeps an HP of its own, written by the model; with
    // both on, the story reads two HP values that disagree. Only the reader may switch it off.
    if (view.sheetConflict) {
        root.append(el('div', { className: 'rpg-battle-notice is-quiet is-sheet-conflict', attrs: { role: 'status' } }, [
            el('div', { className: 'rpg-battle-notice-text' }, [
                icon('fa-triangle-exclamation'),
                el('span', { text: 'Story Block\'s Character Sheet is also on: two HP values will disagree.' }),
            ]),
            button('Turn it off', 'rpg-battle-sheet-off', { iconName: 'fa-power-off', onClick: () => emit(handlers, 'onDisableStorySheet') }),
        ]));
    }

    // The party as cards: yours first and open, each companion folded to one glance.
    const party = list(view.party).filter(member => member && member.sheet);
    const cards = [
        memberCard({ id: 'pc', you: true, name: sheet.name, sheet, skills: view.skills, gear: view.gear, combat: view.combat ?? null, checks: view.checks ?? checkModifiers(sheet.stats, rules) }, view, handlers),
        ...party.map(member => memberCard({ ...member, you: false, skills: member.skills, gear: member.gearSummary ?? null }, view, handlers)),
    ];
    root.append(section('is-party', [
        sub('Party', 'fa-users', cards.length),
        el('div', { className: 'rpg-battle-member-cards' }, cards),
    ]));

    if (view.recovered) root.append(el('p', { className: 'rpg-battle-hint rpg-battle-recovered', text: view.recovered }));
    // What the story's <Wounds> did to the sheets in the latest reply, undoable while that
    // reply's sheets are still the ones it wrote.
    const storyLines = list(view.story?.lines).map(str).filter(Boolean);
    if (storyLines.length) {
        root.append(el('div', { className: 'rpg-battle-story' }, [
            el('ul', { className: 'rpg-battle-story-lines' }, storyLines.map(line => el('li', { className: 'rpg-battle-hint rpg-battle-story-line', text: line }))),
            view.story.canUndo ? button('Undo', 'rpg-battle-story-undo', { iconName: 'fa-rotate-left', title: 'Put the sheets back as they were before these wounds', onClick: () => emit(handlers, 'onUndoStory') }) : null,
        ]));
    }

    // Fights, skills, companions and rests come from the story (its offers); a consumable from
    // the Inventory is the one thing used by hand, since it spends what the party carries.
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        button('Use item', 'rpg-battle-items', { iconName: 'fa-flask', onClick: () => emit(handlers, 'onItems') }),
    ]));
    // The whole party as a file: saved, or loaded into this chat (after a confirm).
    root.append(fold('is-party-file', 'Party file', 'fa-file-arrow-down', null, [
        el('p', { className: 'rpg-battle-hint', text: 'Your character and companions as a JSON file: sheets, skills and gear. Import loads one into this chat, replacing the party, after you confirm.' }),
        el('div', { className: 'rpg-battle-actions' }, [
            button('Export party', 'rpg-battle-party-export', { iconName: 'fa-file-export', onClick: () => emit(handlers, 'onExportParty') }),
            importButton(handlers),
        ]),
    ]));
    const creatures = list(view.bestiary).filter(entry => entry && str(entry.name));
    root.append(bestiaryFold(creatures, handlers));
}

// The offer whose Accept is armed (an offer that asks twice, like a fallen companion's Remove).
let offerArmed = null;

function offerNotice(offer, handlers) {
    const armed = offerArmed === offer.key;
    const accept = button(armed ? 'Click again to confirm' : str(offer.accept) || 'Accept', `rpg-battle-primary rpg-battle-offer-accept${armed ? ' is-armed' : ''}`, {
        iconName: 'fa-check',
        onClick: () => {
            if (offer.confirm && offerArmed !== offer.key) {
                offerArmed = offer.key;
                rerender();
                return;
            }
            offerArmed = null;
            emit(handlers, 'onAcceptOffer', offer.key);
        },
    });
    const node = el('div', { className: `rpg-battle-notice is-offer is-${str(offer.kind).replace(/[^a-z-]/g, '') || 'story'}`, attrs: { role: 'status' } }, [
        el('div', { className: 'rpg-battle-notice-text' }, [
            icon(OFFER_ICONS[offer.kind] ?? 'fa-feather'),
            el('span', { className: 'rpg-battle-offer-text', text: str(offer.text) }),
        ]),
        str(offer.note) ? el('p', { className: 'rpg-battle-hint rpg-battle-offer-note', text: str(offer.note) }) : null,
        el('div', { className: 'rpg-battle-actions' }, [
            accept,
            button('Not now', 'rpg-battle-offer-dismiss', { iconName: 'fa-xmark', onClick: () => { offerArmed = null; emit(handlers, 'onDismissOffer', offer.key); } }),
        ]),
    ]);
    node.dataset.offer = offer.key;
    return node;
}

const OFFER_ICONS = {
    joins: 'fa-user-plus',
    leaves: 'fa-person-walking-arrow-right',
    learned: 'fa-book',
    xp: 'fa-arrow-trend-up',
    quest: 'fa-flag-checkered',
    fallen: 'fa-skull',
    rename: 'fa-signature',
};

// A party file picked to import: its text goes to the glue, which asks to confirm (importNotice).
function importButton(handlers) {
    const picker = el('input', { className: 'rpg-battle-party-file', attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Party file to import' } });
    picker.hidden = true;
    picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (!file || typeof file.text !== 'function') return;
        void file.text().then(text => emit(handlers, 'onImportParty', text));
    });
    return el('span', { className: 'rpg-battle-import-wrap' }, [
        button('Import party', 'rpg-battle-party-import', { iconName: 'fa-file-import', title: 'Load a party file into this chat', onClick: () => picker.click?.() }),
        picker,
    ]);
}

function importNotice(importing, handlers) {
    return el('div', { className: 'rpg-battle-notice is-import', attrs: { role: 'status' } }, [
        el('div', { className: 'rpg-battle-notice-text' }, [
            icon('fa-file-import'),
            el('span', { className: 'rpg-battle-import-text', text: str(importing.summary) || 'Load this party into the chat?' }),
        ]),
        str(importing.note) ? el('p', { className: 'rpg-battle-hint rpg-battle-import-note', text: str(importing.note) }) : null,
        el('div', { className: 'rpg-battle-actions' }, [
            button('Load it', 'rpg-battle-primary rpg-battle-import-confirm', { iconName: 'fa-check', onClick: () => emit(handlers, 'onConfirmImport') }),
            button('Cancel', 'rpg-battle-import-cancel', { iconName: 'fa-xmark', onClick: () => emit(handlers, 'onCancelImport') }),
        ]),
    ]);
}

// The creature whose Forget is armed (it asks twice, like Remove).
let forgetArmed = null;

/**
 * This story's own creatures (made up for its fights, or imported): power, role, traits and
 * look, with Regenerate (made again, and flavoured again) and Forget (the name is made up anew
 * next time); Export and Import for the list as a JSON file.
 */
function bestiaryFold(creatures, handlers) {
    const record = entry => {
        const armed = forgetArmed === entry.name;
        const meta = [str(entry.power), str(entry.role), list(entry.traits).map(str).filter(Boolean).join(', ')].filter(Boolean).join(' · ');
        const item = el('li', { className: 'rpg-battle-record rpg-battle-creature' }, [
            el('div', { className: 'rpg-battle-record-head' }, [
                el('span', { className: 'rpg-battle-record-name', text: str(entry.name) }),
                str(entry.template) ? el('span', { className: 'rpg-battle-tag is-quiet', text: str(entry.template) }) : null,
                entry.flavoured ? null : el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-creature-plain', text: 'template', title: 'Not flavoured by the model: it fights as its template' }),
            ]),
            meta ? el('div', { className: 'rpg-battle-record-meta', text: meta }) : null,
            str(entry.kin) ? el('div', { className: 'rpg-battle-record-meta rpg-battle-creature-kin', text: `kin of ${str(entry.kin)}` }) : null,
            str(entry.look) ? el('p', { className: 'rpg-battle-hint rpg-battle-creature-look', text: str(entry.look) }) : null,
            el('div', { className: 'rpg-battle-member-actions' }, [
                button('Regenerate', 'rpg-battle-creature-regenerate', {
                    iconName: 'fa-rotate',
                    title: `Make ${str(entry.name)} again from its name`,
                    onClick: () => { forgetArmed = null; emit(handlers, 'onRegenerateCreature', entry.name); },
                }),
                button(armed ? 'Click again to forget' : 'Forget', `rpg-battle-creature-forget${armed ? ' is-armed' : ''}`, {
                    iconName: 'fa-eraser',
                    onClick: () => {
                        if (forgetArmed === entry.name) {
                            forgetArmed = null;
                            emit(handlers, 'onForgetCreature', entry.name);
                        } else {
                            forgetArmed = entry.name;
                            rerender();
                        }
                    },
                }),
            ]),
        ]);
        item.dataset.creature = str(entry.name);
        return item;
    };
    // (0.5.2) By family ("Canines"), in the order each family first appears.
    const families = [...new Set(creatures.map(entry => str(entry.family)))];
    const rows = families.flatMap(family => [
        family ? el('li', { className: 'rpg-battle-hint rpg-battle-bestiary-family', text: family }) : null,
        ...creatures.filter(entry => str(entry.family) === family).map(record),
    ]).filter(Boolean);
    // The file picker is hidden behind the Import button; its text goes to the glue as it is.
    const picker = el('input', { className: 'rpg-battle-bestiary-file', attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Bestiary file to import' } });
    picker.hidden = true;
    picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (!file || typeof file.text !== 'function') return;
        void file.text().then(text => emit(handlers, 'onImportBestiary', text));
    });
    return fold('is-bestiary', 'Bestiary', 'fa-book-skull', creatures.length, [
        rows.length
            ? el('ul', { className: 'rpg-battle-records' }, rows)
            : el('p', { className: 'rpg-battle-hint', text: 'No creatures of this story\'s own yet: a name the bestiary does not know is made up when its fight starts, and kept here.' }),
        el('div', { className: 'rpg-battle-actions' }, [
            rows.length ? button('Export', 'rpg-battle-bestiary-export', { iconName: 'fa-file-export', title: 'Save this story\'s creatures as a JSON file', onClick: () => emit(handlers, 'onExportBestiary') }) : null,
            button('Import', 'rpg-battle-bestiary-import', { iconName: 'fa-file-import', title: 'Add creatures from a JSON file', onClick: () => picker.click?.() }),
            picker,
        ]),
    ]);
}

// Which party cards are open, per chat and member: yours starts open, each companion folded,
// and a redraw (every chat event) keeps what the reader opened or closed. In memory only.
const openCards = new Map();
// What is armed or open on the cards: Remove and Start over ask twice; Give item opens a list.
let removeArmed = null;
let startOverArmed = false;
let keepCompanions = true;
let giveOpen = null;
// The companion being edited and the form's values, kept across redraws like every draft.
let editDraft = null;

/**
 * One member as a collapsible card. Folded: name, level (in the reader's terms), HP and MP
 * bars and the State words. Open: progress, conditions, stats (with checks for you), skills in
 * use and set aside, gear, and the controls (Spend, and for a companion Give item, control,
 * Dossier, Edit and Remove; for you Start over).
 */
function memberCard(member, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const sheet = member.sheet;
    const id = member.you ? 'pc' : member.id;
    const key = `${str(view.chatId)}|${id}`;
    const name = str(member.name ?? sheet.name);
    const level = num(sheet.level, 1);
    const editing = !member.you && editDraft?.id === id && id;
    const terms = termsOf(rules);
    const growth = progress(sheet, rules);
    const summary = el('summary', { className: 'rpg-battle-member-summary' }, [
        el('div', { className: 'rpg-battle-head' }, [
            el('span', { className: `rpg-battle-member-name ${member.you ? 'rpg-battle-head-name' : 'rpg-battle-record-name'}`, text: name }),
            el('span', { className: `rpg-battle-tag rpg-battle-member-level${member.you ? ' rpg-battle-level' : ''}`, text: member.you ? levelText(level, rules) : levelTag(level, rules) }),
            member.you ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-you', text: 'you' }) : str(member.role) ? el('span', { className: 'rpg-battle-tag is-quiet', text: str(member.role) }) : null,
            num(sheet.points) > 0 ? el('span', { className: 'rpg-battle-tag rpg-battle-points-tag', text: `+${num(sheet.points)}`, title: `${num(sheet.points)} unspent points` }) : null,
        ]),
        bar('hp', sheet.hp?.cur, sheet.hp?.max, member.you ? 'HP' : `${name} HP`),
        bar('mp', sheet.mp?.cur, sheet.mp?.max, member.you ? 'MP' : `${name} MP`),
        sheet.sp ? bar('sp', sheet.sp.cur, sheet.sp.max, member.you ? 'SP' : `${name} SP`) : null,
        // The words the model is told to portray, so the reader sees what the story will say.
        el('p', { className: 'rpg-battle-hint rpg-battle-state', text: stateWords(sheet, rules).text }),
    ]);

    const body = el('div', { className: 'rpg-battle-member-body' }, [
        // XP within the level against XP to the next, with tiers too (0.5.2); MAX at the cap.
        bar('xp', growth.cur, growth.max, terms.custom ? terms.xpName : 'XP to next level', { name: terms.xpName, text: growth.capped ? growth.text : null }),
        chips(sheet.conditions),
        statGrid(sheet, member.you ? member.checks : null),
        combatLine(member.combat, rules),
        pointsRow(member, sheet, view, handlers),
        cardSkills(member, id, view, handlers),
        member.you ? yourGear(member.gear) : companionGear(member, id, view, handlers),
        editing ? editForm(member, handlers) : member.you ? startOverControls(handlers, { companions: list(view.party).length }) : memberControls(member, handlers),
    ]);
    const details = el('details', { className: `rpg-battle-member-card${member.you ? ' is-you' : ' rpg-battle-member'}${editing ? ' is-editing' : ''}` }, [summary, body]);
    details.open = openCards.has(key) ? openCards.get(key) : member.you || Boolean(editing);
    details.addEventListener('toggle', () => { openCards.set(key, Boolean(details.open)); });
    details.dataset.memberId = id;
    return details;
}

function statGrid(sheet, checks) {
    return el('ul', { className: 'rpg-battle-stats' }, STATS.map(stat => {
        const item = el('li', { className: 'rpg-battle-stat' }, [
            el('span', { className: 'rpg-battle-stat-name', text: stat }),
            el('span', { className: 'rpg-battle-stat-value', text: String(num(sheet.stats?.[stat])) }),
            checks ? el('span', { className: 'rpg-battle-stat-check', text: signed(checks?.[stat]), title: `${stat} check bonus` }) : null,
        ]);
        item.dataset.stat = stat;
        return item;
    }));
}

/**
 * (0.5.13) The numbers a fight uses, with gear: "Attack 14 · Magic 12 · Defence 6 · M.Def 6 ·
 * Hit 81% · Dodge 37% · Crit 12%". Hit and dodge are against a typical foe of the member's
 * level; each title says where its number comes from.
 */
function combatLine(combat, rules) {
    if (!combat) return null;
    const d = rules.derived ?? DEFAULT_RULES.derived;
    const a = rules.attack ?? DEFAULT_RULES.attack;
    const s = combat.stats ?? {};
    const gearPart = (total, fromStats) => {
        const extra = Math.round(num(total) - fromStats);
        return extra ? `, ${signed(extra)} from gear` : '';
    };
    const foe = num(combat.foe);
    const parts = [
        ['attack', 'Attack', combat.attack, `Physical attack: STR ${num(s.STR)} × ${d.atkPerStr}${gearPart(combat.attack, num(s.STR) * d.atkPerStr)}`],
        ['magic', 'Magic', combat.magic, `Magic attack: INT ${num(s.INT)} × ${d.matkPerInt}${gearPart(combat.magic, num(s.INT) * d.matkPerInt)}`],
        ['defence', 'Defence', combat.defence, `Cuts physical damage: VIT ${num(s.VIT)}${gearPart(combat.defence, num(s.VIT))}`],
        ['mdef', 'M.Def', combat.mdef, `Cuts magic damage: (INT + VIT) ÷ 2${gearPart(combat.mdef, Math.round((num(s.INT) + num(s.VIT)) / 2))}`],
        ['hit', 'Hit', `${tidy(combat.hit)}%`, `Chance a physical attack lands on a typical foe of this level (AGI ${foe}): ${a.hitBase}% + ${a.hitPerPoint}% per point of your DEX (${num(s.DEX)}) over its AGI`],
        ['dodge', 'Dodge', `${tidy(combat.dodge)}%`, `Chance to dodge a physical attack from a typical foe of this level (DEX ${foe}): ${100 - a.hitBase}% + ${a.hitPerPoint}% per point of your AGI (${num(s.AGI)}) over its DEX. Spells never miss`],
        ['crit', 'Crit', `${tidy(combat.crit)}%`, `Chance of a ×${a.critMultiplier} hit: ${a.critBase}% + ${a.critPerDex}% per DEX + ${a.critPerLuk}% per LUK`],
    ];
    return el('ul', { className: 'rpg-battle-combat', attrs: { 'aria-label': 'Combat numbers' } }, parts.map(([key, label, value, title]) => el('li', { className: `rpg-battle-combat-part is-${key}`, attrs: { title } }, [
        el('span', { className: 'rpg-battle-combat-name', text: label }),
        el('span', { className: 'rpg-battle-combat-value', text: String(value) }),
    ])));
}

// Spend shows for you, for a companion you command, and for one on auto while the setting
// leaves companions' points to the reader.
function pointsRow(member, sheet, view, handlers) {
    const points = num(sheet.points);
    if (points <= 0) return null;
    const byHand = member.you || member.control === 'command' || view.autoSpend === false;
    return el('div', { className: 'rpg-battle-points' }, [
        el('span', { className: 'rpg-battle-points-text', text: `${points} unspent ${points === 1 ? 'point' : 'points'}${byHand ? '' : ' (spent on their next level)'}` }),
        byHand ? button('Spend', 'rpg-battle-spend', { iconName: 'fa-plus', onClick: () => emit(handlers, 'onSpend', member.you ? 'pc' : member.id) }) : null,
    ]);
}

/**
 * A skill's mastery and its fight uses toward the next (0.5.5), from the sheet's progress:
 * "Lv 2 · 3/12", "Lv 5 · max". The title says it in words.
 */
function masteryTag(skill, sheet, rules) {
    const max = Math.max(1, num(rules.masteryMax, 5));
    const level = Math.min(max, Math.max(1, num(skill.mastery, 1)));
    const needed = num(list(rules.masteryUses)[level], 0);
    if (level >= max) return el('span', { className: 'rpg-battle-tag rpg-battle-mastery is-max', text: `Lv ${level} · max`, attrs: { title: `${skill.name ?? 'This skill'} is fully mastered` } });
    const uses = sheet?.uses && typeof sheet.uses === 'object' ? sheet.uses : {};
    const key = Object.keys(uses).find(name => sameName(name, skill.name));
    const done = Math.max(0, Math.round(num(key ? uses[key] : 0, 0)));
    if (!(needed > 0)) return el('span', { className: 'rpg-battle-tag rpg-battle-mastery', text: `Lv ${level}` });
    return el('span', {
        className: 'rpg-battle-tag rpg-battle-mastery',
        text: `Lv ${level} · ${Math.min(done, needed)}/${needed}`,
        attrs: { title: `Used ${done} of ${needed} times in fights toward Lv ${level + 1}` },
    });
}

const withAttr = (node, name, value) => { node.setAttribute(name, value); return node; };

// (0.5.6) The set-aside folds left open, per member; the set-aside skill being swapped in
// ("member|skill") and the one whose Forget asks again.
const asideOpen = new Map();
let swapOpen = null;
let forgetSkillArmed = null;

/**
 * The skills on a card: the ones in use with "Set aside"; the ones set aside in a fold (closed
 * until opened, remembered) with "Use", or at the cap "Swap in" for a skill in use, and
 * "Forget" (asks twice). Resolved skills when the glue sends them (type, MP, mastery), else
 * the sheet's names.
 */
function cardSkills(member, id, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const cap = Math.max(1, num(rules.character?.activeSkills, 6));
    const named = list(member.sheet?.skills).map(entry => ({ name: entry?.name, mastery: entry?.mastery, aside: Boolean(entry?.aside) }));
    const resolved = list(member.skills).length ? list(member.skills) : named;
    const asideOf = skill => (skill.aside !== undefined ? Boolean(skill.aside) : named.some(entry => entry.aside && sameName(entry.name, skill.name)));
    const active = resolved.filter(skill => !asideOf(skill));
    const aside = resolved.filter(skill => asideOf(skill));
    const full = active.length >= cap;
    const asideControls = skill => {
        const key = `${id}|${skill.name}`;
        const armed = forgetSkillArmed === key;
        return [
            full
                ? withAttr(button('Swap in', `rpg-battle-skill-swap${swapOpen === key ? ' is-open' : ''}`, { iconName: 'fa-right-left', title: `Use ${skill.name} instead of a skill in use`, onClick: () => { swapOpen = swapOpen === key ? null : key; forgetSkillArmed = null; rerender(); } }), 'aria-expanded', String(swapOpen === key))
                : button('Use', 'rpg-battle-skill-use', { iconName: 'fa-arrow-up', title: `Use ${skill.name} in fights`, onClick: () => emit(handlers, 'onSetSkillActive', id, skill.name, true) }),
            withAttr(button(armed ? 'Forget? Click again' : '', `rpg-battle-skill-forget${armed ? ' is-armed' : ''}`, {
                iconName: 'fa-eraser',
                title: `Forget ${skill.name}: its mastery is lost, and learning it again starts at Lv 1`,
                onClick: () => {
                    if (!armed) { forgetSkillArmed = key; swapOpen = null; rerender(); return; }
                    forgetSkillArmed = null;
                    emit(handlers, 'onForgetSkill', id, skill.name);
                },
            }), 'aria-label', armed ? `Forget ${skill.name}? Click again` : `Forget ${skill.name}`),
        ];
    };
    // At the cap, the skills in use that the set-aside one can take the place of.
    const swapPicker = skill => (swapOpen !== `${id}|${skill.name}` ? null : el('div', { className: 'rpg-battle-swap' }, [
        el('p', { className: 'rpg-battle-hint', text: `Use ${skill.name} instead of:` }),
        el('div', { className: 'rpg-battle-actions' }, active.map(other => button(`${str(other.name)} (Lv ${num(other.mastery, 1)})`, 'rpg-battle-swap-out', {
            iconName: 'fa-arrow-down',
            title: `Set ${other.name} aside and use ${skill.name}`,
            onClick: () => { swapOpen = null; emit(handlers, 'onSwapSkill', id, skill.name, other.name); },
        }))),
    ]));
    const row = (skill, isAside) => el('li', { className: `rpg-battle-record rpg-battle-skill${isAside ? ' is-aside' : ''}` }, [
        el('div', { className: 'rpg-battle-record-head' }, [
            icon(TYPE_ICONS[skill.type] ?? 'fa-star'),
            el('span', { className: 'rpg-battle-record-name', text: skill.name ?? '' }),
            masteryTag(skill, member.sheet, rules),
            ...(isAside
                ? asideControls(skill)
                : [button('Set aside', 'rpg-battle-skill-aside', { iconName: 'fa-arrow-down', title: `Keep ${skill.name} but leave it out of fights`, onClick: () => emit(handlers, 'onSetSkillActive', id, skill.name, false) })]),
        ]),
        skill.type ? el('div', { className: 'rpg-battle-record-meta', text: skillMeta(skill) }) : null,
        isAside ? swapPicker(skill) : null,
    ]);
    let asideFold = null;
    if (aside.length) {
        asideFold = el('details', { className: 'rpg-battle-aside-fold' }, [
            el('summary', { className: 'rpg-battle-aside-label' }, [
                el('span', { text: 'Set aside' }),
                el('span', { className: 'rpg-battle-count', text: String(aside.length) }),
                el('span', { className: 'rpg-battle-hint', text: 'kept, not used in fights' }),
            ]),
            el('ul', { className: 'rpg-battle-records rpg-battle-aside' }, aside.map(skill => row(skill, true))),
        ]);
        // Closed until opened; open while a swap or a forget is under way in it.
        const pending = [swapOpen, forgetSkillArmed].some(key => typeof key === 'string' && key.startsWith(`${id}|`));
        asideFold.open = pending || asideOpen.get(id) === true;
        asideFold.addEventListener('toggle', () => { asideOpen.set(id, Boolean(asideFold.open)); });
    }
    return el('div', { className: 'rpg-battle-card-skills' }, [
        el('div', { className: 'rpg-battle-sub-row' }, [sub('Skills', 'fa-wand-sparkles'), el('span', { className: 'rpg-battle-count rpg-battle-skill-count', text: `${active.length}/${cap}` })]),
        active.length ? el('ul', { className: 'rpg-battle-records' }, active.map(skill => row(skill, false))) : el('p', { className: 'rpg-battle-hint', text: 'No skills in use.' }),
        asideFold,
    ]);
}

// What the fight will use from the Inventory: each counted piece with its stats as capped by
// rarity, and anything else marked equipped that does not count, with why.
function gearPiece(piece, extra = null) {
    const item = el('li', { className: 'rpg-battle-record rpg-battle-gear' }, [
        el('div', { className: 'rpg-battle-record-head' }, [
            el('span', { className: 'rpg-battle-record-name', text: str(piece.name) }),
            el('span', { className: 'rpg-battle-tag is-quiet', text: SLOT_NAMES[piece.slot] ?? str(piece.slot) }),
            extra,
        ]),
        el('div', { className: 'rpg-battle-record-meta', text: [formatStats(piece.stats) || 'no stats', piece.capped && piece.from ? `capped from ${formatStats(piece.from)}` : '', piece.why ? `not counted: ${str(piece.why)}` : ''].filter(Boolean).join(' · ') }),
    ]);
    if (piece.capped) item.classList.add('is-capped');
    if (piece.why) item.classList.add('is-unused');
    return item;
}

function yourGear(gear) {
    if (!gear) return null;
    const counted = list(gear.counted);
    const unused = list(gear.unused);
    return el('div', { className: 'rpg-battle-card-gear is-gear' }, [
        sub('Gear', 'fa-shield-halved', counted.length),
        counted.length ? el('ul', { className: 'rpg-battle-records' }, counted.map(piece => gearPiece(piece))) : el('p', { className: 'rpg-battle-hint', text: 'Nothing equipped. Gear counts when its Inventory note says "equipped".' }),
        unused.length ? el('p', { className: 'rpg-battle-hint rpg-battle-gear-unused', text: `Not counted: ${unused.map(piece => `${str(piece.name)} (${str(piece.why)})`).join(' · ')}` }) : null,
    ]);
}

/**
 * A companion's gear (their Equipped line), capped by rarity at their level, each piece with
 * Take back (into your Inventory); Give item opens your Inventory's equipment to hand over.
 */
function companionGear(member, id, view, handlers) {
    const gear = member.gear ?? { counted: list(member.sheetGear).map(item => ({ name: item.name, slot: item.slot, stats: item.stats })), unused: [] };
    const pieces = [...list(gear.counted), ...list(gear.unused).map(piece => ({ ...piece, stats: piece.stats ?? {} }))];
    const giveable = list(view.giveable).filter(item => item && str(item.name));
    const open = giveOpen === id;
    const takeBack = piece => button('Take back', 'rpg-battle-take-back', { iconName: 'fa-hand-holding', title: `Put ${str(piece.name)} back in your Inventory`, onClick: () => emit(handlers, 'onTakeBack', id, piece.name) });
    return el('div', { className: 'rpg-battle-card-gear' }, [
        sub('Equipped', 'fa-shield-halved', list(gear.counted).length),
        pieces.length ? el('ul', { className: 'rpg-battle-records' }, pieces.map(piece => gearPiece(piece, takeBack(piece)))) : el('p', { className: 'rpg-battle-hint', text: 'Nothing equipped.' }),
        open ? el('div', { className: 'rpg-battle-give' }, [
            el('p', { className: 'rpg-battle-hint', text: giveable.length ? `From your Inventory to ${str(member.name)}:` : 'Your Inventory has no equipment to give.' }),
            giveable.length ? el('ul', { className: 'rpg-battle-records' }, giveable.map(item => el('li', { className: 'rpg-battle-record rpg-battle-give-item' }, [
                el('div', { className: 'rpg-battle-record-head' }, [
                    el('span', { className: 'rpg-battle-record-name', text: str(item.name) }),
                    el('span', { className: 'rpg-battle-tag is-quiet', text: [str(item.rarity), SLOT_NAMES[item.slot] ?? str(item.slot)].filter(Boolean).join(' · ') }),
                    button('Give', 'rpg-battle-give-confirm', { iconName: 'fa-hand-holding-hand', onClick: () => { giveOpen = null; if (emit(handlers, 'onGiveItem', id, item.name) === current.root) rerender(); } }),
                ]),
                formatStats(item.stats) ? el('div', { className: 'rpg-battle-record-meta', text: formatStats(item.stats) }) : null,
            ]))) : null,
            button('Close', 'rpg-battle-give-close', { iconName: 'fa-xmark', onClick: () => { giveOpen = null; rerender(); } }),
        ]) : null,
    ]);
}

// Start over: your sheet cleared (and, unless kept, the companions) and creation opened; it
// asks twice, and nothing is carried over.
function startOverControls(handlers, { companions = 0 } = {}) {
    const keep = el('input', { className: 'rpg-battle-keep-companions', attrs: { type: 'checkbox', 'aria-label': 'Keep the companions' } });
    keep.checked = keepCompanions;
    keep.addEventListener('change', () => { keepCompanions = Boolean(keep.checked); });
    const start = button(startOverArmed ? 'Click again to start over' : 'Start over', `rpg-battle-start-over${startOverArmed ? ' is-armed' : ''}`, {
        iconName: 'fa-rotate-left',
        title: 'Clear your character and make a new one; nothing is carried over',
        onClick: () => {
            if (!startOverArmed) {
                startOverArmed = true;
                rerender();
                return;
            }
            startOverArmed = false;
            emit(handlers, 'onStartOver', { keepCompanions: companions > 0 && keepCompanions });
        },
    });
    return el('div', { className: 'rpg-battle-member-actions rpg-battle-start-over-row' }, [
        start,
        companions > 0 ? el('label', { className: 'rpg-battle-check' }, [keep, el('span', { text: 'Keep companions' })]) : null,
    ]);
}

// A companion's control mode (tap to switch), Give item, Dossier (when linked), Edit, and Remove, which asks twice.
function memberControls(member, handlers) {
    const command = member.control === 'command';
    const toggle = button(command ? 'You command' : 'Acts on its own', `rpg-battle-control is-${command ? 'command' : 'auto'}`, {
        iconName: command ? 'fa-hand-pointer' : 'fa-robot',
        title: command ? 'You choose its actions; tap to let it act on its own' : 'Acts on its own; tap to command it',
        onClick: () => emit(handlers, 'onSetControl', member.id, command ? 'auto' : 'command'),
    });
    toggle.setAttribute('aria-pressed', command ? 'true' : 'false');
    const armed = removeArmed === member.id;
    const remove = button(armed ? 'Click again to remove' : 'Remove', `rpg-battle-remove-companion${armed ? ' is-armed' : ''}`, {
        iconName: 'fa-user-minus',
        onClick: () => {
            if (removeArmed === member.id) {
                removeArmed = null;
                emit(handlers, 'onRemoveCompanion', member.id);
            } else {
                removeArmed = member.id;
                rerender();
            }
        },
    });
    const edit = button('Edit', 'rpg-battle-edit-companion', {
        iconName: 'fa-pen',
        title: `Change ${member.name ?? 'this companion'}'s name, role or control`,
        onClick: () => {
            removeArmed = null;
            editDraft = { id: member.id, name: str(member.name ?? member.sheet?.name), role: str(member.role) || 'companion', control: member.control === 'command' ? 'command' : 'auto' };
            rerender();
        },
    });
    const give = button('Give item', 'rpg-battle-give-open', { iconName: 'fa-hand-holding-hand', title: `Give ${member.name ?? 'them'} equipment from your Inventory`, onClick: () => { giveOpen = giveOpen === member.id ? null : member.id; rerender(); } });
    // Linked to an NPC State Delta NPC (and its dossier can be opened): straight to it.
    const dossier = member.dossier ? button('Dossier', 'rpg-battle-dossier', { iconName: 'fa-address-card', title: `Open ${member.name ?? 'their'} dossier in NPC State Delta`, onClick: () => emit(handlers, 'onOpenDossier', member.id) }) : null;
    return el('div', { className: 'rpg-battle-member-actions' }, [toggle, give, dossier, edit, remove]);
}

/**
 * The small Edit form in a companion's row: name, role and control. Save sends
 * onEditCompanion(memberId, { name, role, control }); the sheet, stats and gear are untouched.
 */
function editForm(member, handlers) {
    const draft = editDraft;
    const label = `${member.name ?? 'Companion'}`;
    const name = el('input', { className: 'text_pole rpg-battle-edit-name', attrs: { type: 'text', maxlength: '40', placeholder: 'Name', 'aria-label': `${label}: name`, autocomplete: 'off' } });
    name.value = draft.name;
    const role = el('input', { className: 'text_pole rpg-battle-edit-role', attrs: { type: 'text', maxlength: '30', placeholder: 'companion, hireling, familiar…', 'aria-label': `${label}: role` } });
    role.value = draft.role;
    const control = select('rpg-battle-edit-control', `${label}: control`, [['auto', 'Acts on its own'], ['command', 'I command it']], draft.control);
    const save = button('Save', 'rpg-battle-primary rpg-battle-edit-save', { iconName: 'fa-check' });
    const sync = () => { save.disabled = !str(draft.name); };
    name.addEventListener('input', () => { draft.name = name.value; sync(); });
    role.addEventListener('input', () => { draft.role = role.value; });
    control.addEventListener('change', () => { draft.control = control.value === 'command' ? 'command' : 'auto'; });
    save.addEventListener('click', () => {
        if (save.disabled) return;
        const payload = { name: str(draft.name), role: str(draft.role) || 'companion', control: draft.control };
        editDraft = null;
        emit(handlers, 'onEditCompanion', member.id, payload);
        rerender();
    });
    const cancel = button('Cancel', 'rpg-battle-edit-cancel', { iconName: 'fa-xmark', onClick: () => { editDraft = null; rerender(); } });
    sync();
    const field = (text, control) => el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text }), control]);
    return el('div', { className: 'rpg-battle-edit-form', attrs: { role: 'group', 'aria-label': `Edit ${label}` } }, [
        field('Name', name),
        field('Role', role),
        field('Control', control),
        el('p', { className: 'rpg-battle-hint', text: 'Their sheet, skills and gear stay as they are.' }),
        el('div', { className: 'rpg-battle-actions' }, [save, cancel]),
    ]);
}

// ---------------------------------------------------------------------------
// items: a consumable used out of a fight

function effectText(effect) {
    if (!effect) return '';
    const parts = [];
    if (effect.heal) parts.push(`heals ${effect.heal}`);
    if (effect.mp) parts.push(`${effect.mp} MP`);
    if (effect.cure?.length) parts.push(`cures ${effect.cure.join(', ')}`);
    if (effect.damage) parts.push(`${effect.damage.amount} ${effect.damage.element ?? ''} damage (fights only)`.replace(/\s+/g, ' '));
    return parts.join(' · ');
}

function renderItems(root, view, handlers) {
    const items = list(view.items);
    const people = [
        ...(view.sheet ? [{ id: 'pc', name: view.sheet.name, sheet: view.sheet }] : []),
        ...list(view.party).filter(member => member?.sheet),
    ];
    let target = itemsTarget && people.some(person => person.id === itemsTarget) ? itemsTarget : people[0]?.id ?? 'pc';
    const who = select('rpg-battle-item-target', 'Use on', people.map(person => [person.id, `${person.name} (HP ${num(person.sheet.hp?.cur)}/${num(person.sheet.hp?.max)})`]), target);
    who.addEventListener('change', () => { target = who.value; itemsTarget = who.value; });
    root.append(section('is-items', [
        sub('Use an item', 'fa-flask', items.length),
        people.length > 1 ? el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text: 'On' }), who]) : null,
        items.length ? el('ul', { className: 'rpg-battle-records' }, items.map(item => {
            const usable = Boolean(item.effect && (item.effect.heal || item.effect.mp || item.effect.cure?.length));
            return el('li', { className: `rpg-battle-record rpg-battle-use-item${usable ? '' : ' is-unusable'}` }, [
                el('div', { className: 'rpg-battle-record-head' }, [
                    el('span', { className: 'rpg-battle-record-name', text: item.name ?? '' }),
                    el('span', { className: 'rpg-battle-tag', text: `×${num(item.qty, 1)}` }),
                ]),
                el('div', { className: 'rpg-battle-record-meta', text: effectText(item.effect) }),
                button('Use', 'rpg-battle-use', { iconName: 'fa-hand-holding-medical', disabled: !usable, onClick: () => emit(handlers, 'onUseItem', { name: item.name, target }) }),
            ]);
        })) : el('p', { className: 'rpg-battle-hint', text: 'Nothing usable in the Inventory block. Consumables need an effect in their note, like "heal 30", "mp 20" or "cure poison".' }),
    ]));
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
    ]));
}

let itemsTarget = null;

// ---------------------------------------------------------------------------
// companion: someone the story brought joins

let companionDraft = null;

const FOCUS_LABELS = ['First focus (×3)', 'Second focus (×2)', 'Third focus (×1)'];

/**
 * Add companion, opened from a story's <Joins> (`view.prefill`, seeding the draft once): name,
 * role, level, control, equipment and up to three focus stats (their points are spread over
 * them, 3/2/1; none: evenly; the role's words fill them in until the reader picks their own).
 * Their skills are generated from who they are (`view.kit`, from the glue: the model's words,
 * or library skills that fit), shown before Add with Generate again and a Remove per skill.
 * With NPC State Delta, "From the story's NPCs" fills in name, role and focus and keeps the link.
 */
function renderCompanion(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const terms = termsOf(rules);
    const npcs = list(view.npcs).filter(npc => npc && str(npc.name));
    const top = Math.min(terms.cap, Math.max(1, num(view.maxLevel, 20)));
    const prefill = view.prefill && str(view.prefill.name) ? view.prefill : null;
    const prefillKey = prefill ? JSON.stringify(prefill) : '';
    if (!companionDraft || (prefillKey && companionDraft.prefillKey !== prefillKey)) {
        companionDraft = { name: '', role: '', control: 'auto', level: num(view.level, 1), focus: [], focusTouched: false, npcId: null, summary: '', kit: [], kitKey: null, kitStatus: null, prefillKey };
        if (prefill) {
            Object.assign(companionDraft, {
                name: str(prefill.name),
                role: str(prefill.role),
                level: Math.min(top, Math.max(1, Math.round(num(prefill.level, num(view.level, 1))))),
                focus: cleanFocus(prefill.focus?.length ? prefill.focus : guessFocus(prefill.role, prefill.summary)),
                focusTouched: Boolean(prefill.focus?.length),
                npcId: prefill.npcId ?? null,
                summary: str(prefill.summary),
            });
        }
    }
    const draft = companionDraft;
    // A new kit from the glue (generated, or again) replaces the draft's; removals stay until then.
    const kit = view.kit ?? null;
    // The same run reports twice, 'working' (empty) then 'ready': the second must land too.
    if (kit && str(kit.key) && (draft.kitKey !== kit.key || draft.kitStatus !== kit.status)) {
        draft.kitKey = kit.key;
        draft.kitStatus = kit.status;
        draft.kit = list(kit.skills).filter(spec => spec && str(spec.name)).map(spec => ({ ...spec }));
    }
    const working = kit?.status === 'working';

    const name = el('input', { className: 'text_pole rpg-battle-companion-name', attrs: { type: 'text', maxlength: '40', placeholder: 'Name', 'aria-label': 'Companion name' } });
    name.value = draft.name;
    const role = el('input', { className: 'text_pole rpg-battle-companion-role', attrs: { type: 'text', maxlength: '30', placeholder: 'healer, guard, scout…', 'aria-label': 'Role' } });
    role.value = draft.role;
    const level = select('rpg-battle-companion-level', terms.levelName, Array.from({ length: top }, (_, i) => [String(i + 1), levelText(i + 1, rules)]), String(Math.min(draft.level, top)));
    // The story's level is theirs; without one, they join at most at yours.
    const storyLevel = num(view.prefill?.level, 0) >= 1;
    if (storyLevel) level.disabled = true;
    const control = select('rpg-battle-companion-control', 'Control', [['auto', 'Acts on its own'], ['command', 'I command it']], draft.control);
    const focusSelects = FOCUS_LABELS.map((label, index) => select(`rpg-battle-companion-focus is-${index + 1}`, label, [['', index ? 'none' : 'none (even spread)'], ...STATS.map(stat => [stat, `${stat} · ${STAT_HINTS[stat]}`])], draft.focus[index] ?? ''));
    const statsLine = el('p', { className: 'rpg-battle-hint rpg-battle-companion-stats', attrs: { 'aria-live': 'polite' } });
    const why = el('p', { className: 'rpg-battle-hint rpg-battle-companion-why', attrs: { 'aria-live': 'polite' } });
    const add = button('Add to the party', 'rpg-battle-primary rpg-battle-companion-add', { iconName: 'fa-user-plus' });

    function refresh() {
        const stats = buildStats(draft.focus, draft.level, rules);
        statsLine.textContent = `${STATS.map(stat => `${stat} ${stats[stat]}`).join(' · ')}${draft.focus.length ? '' : ' (no focus: spread evenly)'}`;
        why.textContent = !str(draft.name) ? 'Still needed: a name.' : working ? 'Their skills are being worked out…' : 'Ready.';
        add.disabled = !str(draft.name) || working;
        focusSelects.forEach((node, index) => { node.value = draft.focus[index] ?? ''; });
    }

    const who = () => ({ name: str(draft.name), role: str(draft.role), level: draft.level, focus: [...draft.focus], npcId: draft.npcId ?? null, summary: draft.summary });
    name.addEventListener('input', () => { draft.name = name.value; refresh(); });
    role.addEventListener('input', () => {
        draft.role = role.value;
        if (!draft.focusTouched) draft.focus = guessFocus(draft.role, draft.summary);
        refresh();
    });
    level.addEventListener('change', () => { draft.level = num(level.value, 1); refresh(); });
    control.addEventListener('change', () => { draft.control = control.value; });
    focusSelects.forEach((node, index) => node.addEventListener('change', () => {
        const next = [...draft.focus];
        next[index] = node.value;
        draft.focus = cleanFocus(next.filter(Boolean));
        draft.focusTouched = true;
        refresh();
    }));
    add.addEventListener('click', () => {
        if (add.disabled) return;
        emit(handlers, 'onAddCompanion', {
            name: str(draft.name), role: str(draft.role) || 'companion', control: draft.control, level: draft.level,
            focus: [...draft.focus], skills: draft.kit.map(spec => ({ ...spec })), npcId: draft.npcId ?? null,
        });
    });

    // The generated skills: each with its words and template, removable; Generate again asks anew.
    const kitRows = draft.kit.map((spec, index) => el('li', { className: 'rpg-battle-record rpg-battle-kit-skill' }, [
        el('div', { className: 'rpg-battle-record-head' }, [
            icon(TYPE_ICONS[spec.type] ?? 'fa-star'),
            el('span', { className: 'rpg-battle-record-name', text: str(spec.name) }),
            spec.library ? el('span', { className: 'rpg-battle-tag is-quiet', text: 'library' }) : null,
            button('', 'rpg-battle-icon-button rpg-battle-kit-remove', { iconName: 'fa-xmark', title: `Leave out ${str(spec.name)}`, onClick: () => { draft.kit.splice(index, 1); rerender(); } }),
        ]),
        el('div', { className: 'rpg-battle-record-meta', text: [str(spec.type), str(spec.stat), TARGET_LABELS[spec.target] ?? str(spec.target), spec.element && spec.element !== 'none' ? ELEMENT_LABELS[spec.element] ?? str(spec.element) : ''].filter(Boolean).join(' · ') }),
        str(spec.words) ? el('p', { className: 'rpg-battle-record-desc', text: str(spec.words) }) : null,
    ]));
    const again = button(working ? 'Working…' : 'Generate again', 'rpg-battle-kit-again', { iconName: 'fa-rotate', disabled: working, onClick: () => emit(handlers, 'onGenerateKit', who()) });

    // From NPC State Delta's dossiers: present NPCs first. Picking one fills the form.
    let picker = null;
    if (npcs.length) {
        const ordered = [...npcs.filter(npc => npc.present), ...npcs.filter(npc => !npc.present)];
        picker = select('rpg-battle-companion-npc', 'From the story\'s NPCs', [['', 'Pick someone…'], ...ordered.map(npc => [str(npc.id), [str(npc.name), str(npc.role)].filter(Boolean).join(' — ')])], draft.npcId ?? '');
        picker.addEventListener('change', () => {
            const npc = ordered.find(entry => str(entry.id) === picker.value);
            if (!npc) return;
            Object.assign(draft, { name: str(npc.name), role: str(npc.role) || draft.role, npcId: str(npc.id), summary: str(npc.summary), focus: guessFocus(npc.role || draft.role, npc.summary), focusTouched: false });
            emit(handlers, 'onGenerateKit', who());
            rerender();
        });
    }
    const chosen = npcs.find(npc => str(npc.id) === draft.npcId);
    const field = (label, control, hint) => el('label', { className: 'rpg-battle-field' }, [
        el('span', { className: 'rpg-battle-field-label', text: label }),
        control,
        hint ? el('small', { className: 'rpg-battle-hint', text: hint }) : null,
    ]);
    root.append(section('is-companion', [
        sub('New companion', 'fa-user-plus'),
        el('p', { className: 'rpg-battle-hint', text: 'Someone the story brought along. No classes: their points go where their focus is, and they level with you from then on.' }),
        prefill ? el('p', { className: 'rpg-battle-hint rpg-battle-prefill-hint', text: 'Filled in from the story. Change anything before you add them.' }) : null,
        picker ? field('From the story\'s NPCs', picker, chosen && str(chosen.summary) ? str(chosen.summary) : 'Fills in the name, role and focus; they stay linked to that NPC.') : null,
        field('Name', name),
        field('Role', role, 'Free words. Known role words suggest the focus below.'),
        field(terms.levelName, level, `You are ${levelText(num(view.level, 1), rules)}.`),
        field('Control', control),
    ]));
    root.append(section('is-focus', [
        sub('Focus', 'fa-chart-simple'),
        el('div', { className: 'rpg-battle-field-row' }, focusSelects.map((node, index) => field(FOCUS_LABELS[index], node))),
        statsLine,
    ]));
    root.append(section('is-companion-skills', [
        el('div', { className: 'rpg-battle-sub-row' }, [sub('Skills', 'fa-wand-sparkles'), el('span', { className: 'rpg-battle-count', text: String(draft.kit.length) })]),
        el('p', { className: 'rpg-battle-hint rpg-battle-kit-note', text: working ? 'Working out what they can do…' : str(kit?.note) || 'What they can already do. Code sets every number for their level.' }),
        draft.kit.length ? el('ul', { className: 'rpg-battle-records rpg-battle-kit' }, kitRows) : el('p', { className: 'rpg-battle-hint', text: working ? '' : 'No skills: they fight with attacks until the story teaches them one.' }),
        el('div', { className: 'rpg-battle-actions' }, [again]),
        why,
    ]));
    root.append(el('p', { className: 'rpg-battle-hint rpg-battle-companion-gear-hint', text: 'Gear: give them equipment from your Inventory on their card once they join.' }));
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        add,
        button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
    ]));
    refresh();
}

// ---------------------------------------------------------------------------
// spend: place unspent points

let spendDraft = null;

function renderSpend(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const sheet = view.sheet;
    if (!sheet) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No character sheet yet.' }));
        return;
    }
    const budget = Math.max(0, num(sheet.points));
    const level = num(sheet.level, 1);
    // A sheet that changed under the draft (a reply wrote new points) starts the draft over.
    const key = `${sheet.name}|${level}|${budget}|${STATS.map(stat => num(sheet.stats?.[stat])).join(',')}`;
    if (!spendDraft || spendDraft.key !== key) spendDraft = { key, alloc: Object.fromEntries(STATS.map(stat => [stat, 0])) };
    const alloc = spendDraft.alloc;
    const used = () => STATS.reduce((sum, stat) => sum + alloc[stat], 0);
    const base = Object.fromEntries(STATS.map(stat => [stat, num(sheet.stats?.[stat])]));
    // Gear adds to the sheet's maxima; keep that part as it is so the preview matches the sheet.
    const hpBonus = num(sheet.hp?.max, maxHp(base, level, rules)) - maxHp(base, level, rules);
    const mpBonus = num(sheet.mp?.max, maxMp(base, level, rules)) - maxMp(base, level, rules);
    const spBonus = num(sheet.sp?.max, maxSp(base, level, rules)) - maxSp(base, level, rules);

    const remainingNode = el('span', { className: 'rpg-battle-remaining', attrs: { 'aria-live': 'polite' } });
    const steppers = STATS.map(stat => stepper(stat, {
        hint: STAT_HINTS[stat],
        onMinus: () => { if (alloc[stat] > 0) { alloc[stat] -= 1; refresh(); } },
        onPlus: () => { if (used() < budget && base[stat] + alloc[stat] < statCap(rules)) { alloc[stat] += 1; refresh(); } },
    }));
    const preview = previewList();
    const confirm = button('Confirm', 'rpg-battle-primary rpg-battle-confirm', {
        iconName: 'fa-check',
        onClick: () => { if (used() > 0 && used() <= budget) emit(handlers, 'onConfirmSpend', { ...alloc }, str(view.memberId) || 'pc'); },
    });

    function refresh() {
        const left = budget - used();
        remainingNode.textContent = `${left} of ${budget} points left`;
        remainingNode.classList.toggle('is-done', left === 0);
        for (const step of steppers) {
            const stat = step.row.dataset.stat;
            const added = alloc[stat];
            step.value.textContent = String(base[stat] + added);
            const full = base[stat] + added >= statCap(rules);
            step.minus.disabled = added <= 0;
            step.plus.disabled = left <= 0 || full;
            step.extra.textContent = [added ? `+${added}` : '', full ? 'max' : ''].filter(Boolean).join(' · ');
            step.row.classList.toggle('is-changed', added > 0);
        }
        const after = Object.fromEntries(STATS.map(stat => [stat, base[stat] + alloc[stat]]));
        fillPreview(preview, previewRows(numbersFor(base, level, rules, { hpBonus, mpBonus, spBonus }), numbersFor(after, level, rules, { hpBonus, mpBonus, spBonus })), true);
        confirm.disabled = used() === 0;
    }

    root.append(
        section('is-spend', [
            el('div', { className: 'rpg-battle-sub-row' }, [sub(view.memberId && view.memberId !== 'pc' ? `Spend points: ${str(sheet.name)}` : 'Spend points', 'fa-plus'), remainingNode]),
            el('ul', { className: 'rpg-battle-steppers' }, steppers.map(step => step.row)),
        ]),
        section('is-preview', [sub('Effect', 'fa-heart-pulse'), preview]),
        el('div', { className: 'rpg-battle-actions is-end' }, [
            button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
            confirm,
        ]),
    );
    refresh();
}

// ---------------------------------------------------------------------------
// learn: a library skill, or a new one from a template

let learnDraft = null;

// The stat and target a template type usually wants, offered until the reader picks their own.
const TEMPLATE_DEFAULTS = {
    physical: { stat: 'STR', target: 'one' },
    magic: { stat: 'INT', target: 'one' },
    heal: { stat: 'INT', target: 'ally' },
    buff: { stat: 'INT', target: 'self' },
    debuff: { stat: 'INT', target: 'one' },
};

function requirementCheck(stats, skill) {
    const missing = {};
    for (const [stat, need] of Object.entries(skill?.requires ?? {})) {
        if (num(stats?.[stat]) < num(need)) missing[stat] = num(need);
    }
    return { ok: !Object.keys(missing).length, missing };
}

function renderLearn(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const sheet = view.sheet ?? { stats: {}, skills: [] };
    const memberId = str(view.memberId) || 'pc';
    const known = name => list(sheet.skills).some(entry => sameName(entry?.name ?? entry, name));
    // A skill the story taught (<Learned>) arrives as `prefill`: its name and the type, stat,
    // target and element its words suggest, seeding the template once.
    const prefill = view.prefill && str(view.prefill.name) ? view.prefill : null;
    const prefillKey = prefill ? JSON.stringify(prefill) : '';
    if (!learnDraft || (prefillKey && learnDraft.prefillKey !== prefillKey)) {
        learnDraft = { name: '', type: 'physical', stat: 'STR', target: 'one', element: 'none', touched: {}, setAside: '', prefillKey };
        if (prefill) {
            Object.assign(learnDraft, {
                name: str(prefill.name),
                type: SKILL_TYPES.includes(prefill.type) ? prefill.type : 'physical',
                stat: STATS.includes(prefill.stat) ? prefill.stat : TEMPLATE_DEFAULTS[prefill.type]?.stat ?? 'STR',
                target: SKILL_TARGETS.includes(prefill.target) ? prefill.target : TEMPLATE_DEFAULTS[prefill.type]?.target ?? 'one',
                element: SKILL_ELEMENTS.includes(prefill.element) ? prefill.element : 'none',
            });
        }
    }
    const draft = learnDraft;

    // At the cap of skills in use, something must sit out: an active skill, or the new one.
    const cap = Math.max(1, num(rules.character?.activeSkills, 6));
    const active = list(sheet.skills).filter(entry => entry && !entry.aside);
    const full = active.length >= cap;
    let aside = null;
    if (full) {
        aside = select('rpg-battle-learn-aside', 'Set aside', [['', 'Choose one to set aside…'], ...active.map(entry => [entry.name, `Set aside ${entry.name}`]), [NEW_ASIDE, 'Keep the new skill set aside']], draft.setAside);
        aside.addEventListener('change', () => { draft.setAside = aside.value; rerender(); });
    }
    const blocked = full && !draft.setAside;
    const withAside = payload => (full ? { ...payload, setAside: draft.setAside === NEW_ASIDE ? payload.name : draft.setAside } : payload);
    const send = payload => emit(handlers, 'onConfirmLearn', { ...withAside(payload), ...(memberId !== 'pc' ? { memberId } : {}) });

    // Library: by tier, the reader's next steps open first. Skills come from the story, so a
    // story's skill shows only its own library entry (when it has one), never the whole library.
    const library = list(view.library).filter(skill => skill && str(skill.name) && (!prefill || sameName(skill.name, prefill.name)));
    const tiers = [...new Set(library.map(skill => num(skill.tier, 1)))].sort((a, b) => a - b);
    const tierFolds = tiers.map(tier => {
        const skills = library.filter(skill => num(skill.tier, 1) === tier);
        const learnable = skills.filter(skill => !known(skill.name) && requirementCheck(sheet.stats, skill).ok).length;
        const items = skills.map(skill => {
            // The opening message's skills are theirs from the start: no stat requirement.
            const given = Boolean(prefill?.free && sameName(prefill.name, skill.name));
            const check = given ? { ok: true, missing: {} } : requirementCheck(sheet.stats, skill);
            const have = known(skill.name);
            const requires = Object.entries(skill.requires ?? {});
            const item = el('li', { className: `rpg-battle-record rpg-battle-library-skill${have ? ' is-known' : ''}${check.ok ? '' : ' is-locked'}` }, [
                el('div', { className: 'rpg-battle-record-head' }, [
                    icon(TYPE_ICONS[skill.type] ?? 'fa-star'),
                    el('span', { className: 'rpg-battle-record-name', text: skill.name }),
                    have ? el('span', { className: 'rpg-battle-tag', text: 'known' }) : null,
                ]),
                el('div', { className: 'rpg-battle-record-meta', text: skillMeta(skill) }),
                str(skill.description) ? el('p', { className: 'rpg-battle-record-desc', text: skill.description }) : null,
                requires.length ? el('ul', { className: 'rpg-battle-requires', attrs: { 'aria-label': 'Requires' } }, requires.map(([stat, need]) => {
                    const met = !(stat in check.missing);
                    return el('li', {
                        className: `rpg-battle-require ${met ? 'is-met' : 'is-unmet'}`,
                        text: `${stat} ${num(need)}${met ? '' : ` (${memberId === 'pc' ? 'you have' : 'has'} ${num(sheet.stats?.[stat])})`}`,
                        title: met ? `${stat} ${num(need)}: met` : `${stat} ${num(need)}: not met`,
                    });
                })) : null,
                el('div', { className: 'rpg-battle-record-actions' }, [
                    button('Learn', 'rpg-battle-learn-library', {
                        iconName: 'fa-book',
                        title: `Learn ${skill.name}`,
                        disabled: have || !check.ok || blocked,
                        onClick: () => send({ name: skill.name, fromLibrary: true }),
                    }),
                ]),
            ]);
            item.dataset.skill = skill.name;
            return item;
        });
        const prefilled = prefill && skills.some(skill => sameName(skill.name, prefill.name));
        return fold(`is-tier-${tier}`, `Tier ${tier}`, 'fa-layer-group', skills.length, [el('ul', { className: 'rpg-battle-records' }, items)], { open: learnable > 0 || Boolean(prefilled) });
    });

    const nameInput = el('input', { className: 'text_pole rpg-battle-template-name', attrs: { type: 'text', maxlength: '60', placeholder: 'e.g. Tidebreaker Stance', 'aria-label': 'Skill name', autocomplete: 'off' } });
    nameInput.value = draft.name;
    // The story names the skill; only how it works is the reader's to adjust.
    if (prefill) nameInput.readOnly = true;
    const typeSelect = select('rpg-battle-template-type', 'Type', SKILL_TYPES, draft.type);
    const statSelect = select('rpg-battle-template-stat', 'Stat', STATS, draft.stat);
    const targetSelect = select('rpg-battle-template-target', 'Target', SKILL_TARGETS.map(target => [target, TARGET_LABELS[target]]), draft.target);
    const elementSelect = select('rpg-battle-template-element', 'Element', SKILL_ELEMENTS.map(element => [element, ELEMENT_LABELS[element]]), draft.element);
    const learnTemplate = button('Learn new skill', 'rpg-battle-primary rpg-battle-learn-template', {
        iconName: 'fa-feather',
        onClick: () => {
            const name = str(draft.name);
            if (learnTemplate.disabled || !name || known(name)) return;
            send({ name, template: { type: draft.type, stat: draft.stat, target: draft.target, element: draft.element } });
        },
    });
    const templateHint = el('p', { className: 'rpg-battle-hint rpg-battle-template-hint', attrs: { 'aria-live': 'polite' } });
    const refresh = () => {
        const name = str(draft.name);
        // A library skill's name is learned from the library, with its requirements.
        const inLibrary = library.find(skill => sameName(skill.name, name));
        learnTemplate.disabled = !name || known(name) || Boolean(inLibrary) || blocked;
        templateHint.textContent = name && known(name) ? `${name} is already known.`
            : inLibrary ? `${inLibrary.name} is in the library: learn it there${Object.keys(inLibrary.requires ?? {}).length && !(prefill?.free && sameName(prefill.name, inLibrary.name)) ? ` (it needs ${Object.entries(inLibrary.requires).map(([stat, need]) => `${stat} ${need}`).join(', ')})` : ''}.`
                : 'Its power, cost (SP for a physical skill, MP for the rest) and cooldown are set by code for this level.';
    };
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; refresh(); });
    typeSelect.addEventListener('change', () => {
        draft.type = typeSelect.value;
        const defaults = TEMPLATE_DEFAULTS[draft.type];
        if (defaults && !draft.touched.stat) { draft.stat = defaults.stat; statSelect.value = defaults.stat; }
        if (defaults && !draft.touched.target) { draft.target = defaults.target; targetSelect.value = defaults.target; }
    });
    statSelect.addEventListener('change', () => { draft.stat = statSelect.value; draft.touched.stat = true; });
    targetSelect.addEventListener('change', () => { draft.target = targetSelect.value; draft.touched.target = true; });
    elementSelect.addEventListener('change', () => { draft.element = elementSelect.value; });

    const field = (label, control) => el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text: label }), control]);
    const who = memberId === 'pc' ? '' : `: ${str(sheet.name)}`;
    root.append(
        section('is-learn-intro', [
            sub(`Learn skill${who}`, 'fa-book'),
            el('p', { className: 'rpg-battle-hint', text: prefill ? `From the story: ${str(prefill.name)}${str(prefill.words) ? ` (${str(prefill.words)})` : ''}. Check how it works below; code sets its numbers for your level.` : 'A mentor, a scroll, a lesson from the story: take a skill from the library, or name a new one and build it from a template.' }),
            aside ? el('div', { className: 'rpg-battle-learn-cap' }, [
                el('p', { className: 'rpg-battle-hint', text: `${memberId === 'pc' ? 'You already use' : `${str(sheet.name)} already uses`} ${cap} skills: one sits out (kept, set aside).` }),
                field('To make room', aside),
            ]) : null,
        ]),
        ...(prefill && !library.length ? [] : [section('is-library', [
            sub('From the library', 'fa-book-bookmark'),
            library.length ? el('div', { className: 'rpg-battle-tiers' }, tierFolds) : el('p', { className: 'rpg-battle-hint', text: 'The skill library is empty.' }),
        ])]),
        section('is-template', [
            sub('New from a template', 'fa-feather'),
            field('Name', nameInput),
            el('div', { className: 'rpg-battle-field-row' }, [field('Type', typeSelect), field('Stat', statSelect), field('Target', targetSelect), field('Element', elementSelect)]),
            templateHint,
            el('div', { className: 'rpg-battle-actions is-end' }, [learnTemplate]),
        ]),
        el('div', { className: 'rpg-battle-actions' }, [
            button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
        ]),
    );
    refresh();
}

// ---------------------------------------------------------------------------
// setup: the story's engagement and stakes, to start or put away (0.4.2: never to change)

const STAKES = {
    normal: 'Stakes: Normal — defeat means the story decides (captured, robbed, left for dead).',
    death: 'Stakes: To the death — defeat is death.',
};

// The level a rank stands for, to show a rank in the reader's own terms.
const rankLevel = (rank, rules) => num(rules?.ranks?.[rank]?.level, 1);

/**
 * A row's power in the reader's terms, as a level (0.5.2: never the rank letter): 'Lv 12'
 * with the plain terms, 'Soul Power 12', 'Soul Class II (Lv 11)'; a rank row shows the level
 * its rank stands for. '' when neither is set.
 */
function powerText(row, rules) {
    const level = num(row?.level, 0) >= 1 ? Math.round(num(row.level)) : RANKS.includes(row?.rank) ? rankLevel(row.rank, rules) : null;
    if (!level) return '';
    return termsOf(rules).custom ? levelText(level, rules) : levelTag(level, rules);
}

/** "Stage 1 of 3: the gate", or "Stage 1 of 3" for a stage the story did not name. */
function stageTitle(number, total, place) {
    return `Stage ${number} of ${total}${str(place) ? `: ${str(place)}` : ''}`;
}

/** A place as a sentence's subject: "The gate", or "Stage 2" for a stage the story did not name. */
function placeSubject(number, place) {
    const text = str(place) || `stage ${number}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What one foe of a row is worth to your character, as the glue worked it out (row.xp: the
 * result's formula at the XP rate): "~15 XP each", "~15 Soul Growth" for one; '' without it.
 */
function foeXpText(row, rules, count) {
    if (row?.xp === null || row?.xp === undefined || row.xp === '' || !Number.isFinite(Number(row.xp))) return '';
    return `~${Math.max(0, Math.round(num(row.xp)))} ${termsOf(rules).xpName}${count > 1 ? ' each' : ''}`;
}

/** One foe line of the setup (and the next stage between stages): count, name, new, Boss, power, threat, role, XP. */
function enemyLine(row, rules, isNew) {
    const count = Math.min(9, Math.max(1, Math.round(num(row.count, 1))));
    const power = powerText(row, rules);
    const role = ROLES.includes(row.role) ? row.role : '';
    const worth = foeXpText(row, rules, count);
    return el('li', { className: 'rpg-battle-enemy-row' }, [
        el('span', { className: 'rpg-battle-enemy-count', text: `${count} ×` }),
        el('span', { className: 'rpg-battle-enemy-name', text: str(row.name) }),
        isNew(row.name) ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-new', text: 'new', title: str(row.kin) ? `Not in the bestiary: made up as kin of ${str(row.kin)} when the fight starts` : 'Not in the bestiary: made up from its name when the fight starts' }) : null,
        row.boss ? el('span', { className: 'rpg-battle-tag rpg-battle-boss', text: 'Boss' }) : null,
        power ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-enemy-power', text: power }) : null,
        str(row.threat) ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-threat', text: str(row.threat), title: 'How dangerous the story says it is, beside the power it means for your level' }) : null,
        role ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-enemy-role', text: role }) : null,
        worth ? el('span', { className: 'rpg-battle-tag is-quiet rpg-battle-enemy-xp', text: worth, title: 'What one is worth to your character if defeated, at your XP rate' }) : null,
    ]);
}

/** Rows in their engagements, in order ("then:"), each fought once the one before is done. */
function engagementGroups(rows, rules, isNew) {
    const waves = [...new Set(rows.map(row => num(row.wave, 0)))].sort((a, b) => a - b);
    return waves.map((wave, index) => el('div', { className: 'rpg-battle-engagement' }, [
        waves.length > 1 ? el('p', { className: 'rpg-battle-hint rpg-battle-wave', text: index ? `Then, engagement ${index + 1}` : 'Engagement 1' }) : null,
        el('ul', { className: 'rpg-battle-enemy-rows' }, rows.filter(row => num(row.wave, 0) === wave).map(row => enemyLine(row, rules, isNew))),
    ]));
}

/** Whether a name is new: neither bestiary knows it (`known`: names and aliases), so it is made up. */
function newChecker(knownNames) {
    const known = new Set(list(knownNames).map(name => str(name).toLowerCase().replace(/\s+/g, ' ')).filter(Boolean));
    return name => {
        const wanted = str(name).toLowerCase().replace(/\s+/g, ' ');
        return Boolean(wanted) && !known.has(wanted) && !known.has(wanted.replace(/\s*(?:#?\d+|\b[a-z])$/, ''));
    };
}

/**
 * The setup is the story's engagement as it will be fought, read-only: per engagement each
 * line's count, name (tagged new when it is made up when the fight starts), power, role, the
 * story's threat word and Boss, then the stakes as text. Start sends nothing: the glue builds
 * the fight from the offer it parsed, so nothing on this page can change it.
 */
function renderSetup(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const rows = list(view.rows).filter(row => str(row?.name));
    // A name neither bestiary knows will be made up when the fight starts.
    const isNew = newChecker(view.known);
    const preparing = list(view.preparing).map(str).filter(Boolean);
    const dismiss = button('Not now', 'rpg-battle-encounter-dismiss', { iconName: 'fa-xmark', onClick: () => emit(handlers, 'onDismissEncounter') });
    if (!rows.length) {
        root.append(
            el('p', { className: 'rpg-battle-empty', text: 'No fight right now: the story starts them.' }),
            el('div', { className: 'rpg-battle-actions is-end' }, [dismiss]),
        );
        return;
    }

    // A plan (0.5): its stages in order, each a fight of its own somewhere else, its waves
    // grouped under it; otherwise the engagements as before.
    const places = list(view.stages);
    const numbers = [...new Set(rows.map(row => num(row.stage, 0)))].sort((a, b) => a - b);
    const groups = places.length > 1 && numbers.every(number => number >= 1)
        ? numbers.map(number => el('div', { className: 'rpg-battle-stage' }, [
            el('p', { className: 'rpg-battle-hint rpg-battle-stage-title', text: stageTitle(number, places.length, places[number - 1]?.place) }),
            ...engagementGroups(rows.filter(row => num(row.stage, 0) === number), rules, isNew),
        ]))
        : engagementGroups(rows, rules, isNew);

    const total = rows.reduce((sum, row) => sum + Math.min(9, Math.max(1, Math.round(num(row.count, 1)))), 0);
    const fresh = rows.filter(row => isNew(row.name)).length;
    const summary = el('p', {
        className: 'rpg-battle-hint rpg-battle-setup-summary',
        attrs: { 'aria-live': 'polite' },
        text: preparing.length
            ? `Preparing foes: ${preparing.join(', ')}…`
            : `${places.length > 1 ? `${places.length} stages, ` : ''}${total} ${total === 1 ? 'enemy' : 'enemies'}.${fresh ? ` ${fresh} new, made up from ${fresh === 1 ? 'its name' : 'their names'} when the fight starts.` : ''}`,
    });
    const stakes = view.stakes === 'death' ? 'death' : 'normal';
    root.append(
        section('is-setup', [
            sub('Enemies', 'fa-skull'),
            el('p', { className: 'rpg-battle-hint rpg-battle-prefill-hint', text: places.length > 1 ? 'As the story gave it: a fight at each stage, the party carrying its hurts from one to the next. Fight it, or put it away.' : 'As the story gave it: fight it, or put it away.' }),
            ...groups,
        ]),
        el('p', { className: `rpg-battle-section rpg-battle-stakes is-${stakes}`, text: STAKES[stakes] }),
        el('div', { className: 'rpg-battle-actions is-end' }, [
            summary,
            dismiss,
            // Not twice while the foes are being prepared.
            button('Start', 'rpg-battle-primary rpg-battle-begin', { iconName: 'fa-dragon', disabled: preparing.length > 0, onClick: () => { if (!preparing.length) emit(handlers, 'onStart'); } }),
        ]),
    );
}

// ---------------------------------------------------------------------------
// fight

// The action picked but not yet aimed, and an open Skill / Item list. Keyed by the fight's
// id, round, turn and action count: a redraw of the same moment keeps it, any step resets it.
let fightUi = null;

const fightKey = fight => `${fight.id}|${fight.round}|${fight.turn}|${list(fight.actions).length}`;

/** Which side an action aims at: 'enemy' | 'ally' (pick one), 'self', or 'none' (an area). */
function aimOf(target, { type = null, damages = false } = {}) {
    switch (target) {
        case 'all':
        case 'allies':
            return 'none';
        case 'self':
            return 'self';
        case 'ally':
            return 'ally';
        default:
            // A 'one' heal or buff is aimed at a friend; so is an item that does not hurt.
            if (type === 'heal' || type === 'buff') return 'ally';
            if (type === 'item') return damages ? 'enemy' : 'ally';
            return 'enemy';
    }
}

/**
 * (0.5.14) How an enemy stacks up against `versus` (the member whose turn it is, else you):
 * its attack, defence, AGI and DEX, then the two hit chances the fight rolls for physical
 * attacks. Each part's title says where it comes from.
 */
function matchup(enemy, versus, rules) {
    const s = enemy.stats ?? {};
    const a = rules.attack ?? DEFAULT_RULES.attack;
    const parts = [
        ['atk', `Atk ${num(enemy.patk)}`, `Its physical attack (magic ${num(enemy.matk)})`],
        ['def', `Def ${num(enemy.pdef)}`, `Cuts your physical damage (magic defence ${num(enemy.mdef)})`],
        ['agi', `AGI ${num(s.AGI)}`, 'Speed on the turn timeline, and how hard it is to hit'],
        ['dex', `DEX ${num(s.DEX)}`, 'How well it hits'],
    ];
    if (versus) {
        const name = versus.memberId === 'pc' || versus.id === 'pc' ? null : str(versus.name);
        const yours = hitChance(versus.stats?.DEX, s.AGI, rules);
        const theirs = hitChance(s.DEX, versus.stats?.AGI, rules);
        parts.push(
            ['hit', `${name ? `${name} hits` : 'You hit'} ${tidy(yours)}%`, `A physical attack lands ${tidy(yours)}% of the time: ${a.hitBase}% + ${a.hitPerPoint}% per point of ${name ?? 'your'} DEX (${num(versus.stats?.DEX)}) over its AGI (${num(s.AGI)}). Spells never miss`],
            ['dodge', `${name ? `${name} dodges` : 'You dodge'} ${tidy(100 - theirs)}%`, `${name ?? 'You'} dodge${name ? 's' : ''} its physical attacks ${tidy(100 - theirs)}% of the time: they land ${a.hitBase}% + ${a.hitPerPoint}% per point of its DEX (${num(s.DEX)}) over ${name ?? 'your'} AGI (${num(versus.stats?.AGI)}). Its spells never miss`],
        );
    }
    // Its numbers on one line, the two chances on the next, so a narrow card wraps cleanly.
    const line = list => el('ul', { className: 'rpg-battle-matchup-line' }, list.map(([key, text, title]) => el('li', { className: `rpg-battle-matchup-part is-${key}`, text, attrs: { title } })));
    return el('div', { className: 'rpg-battle-matchup', attrs: { 'aria-label': `${str(enemy.name)} against ${versus ? str(versus.name) : 'the party'}` } }, [
        line(parts.slice(0, 4)),
        parts.length > 4 ? line(parts.slice(4)) : null,
    ]);
}

/**
 * (0.5.15) While aiming at an enemy: what this attack would do to it, as tactics games show it
 * before you commit. "Hit 63% · 8–10 dmg · Crit 12%".
 */
function previewLine(preview) {
    const damage = preview.low === preview.high ? `${preview.low}` : `${preview.low}–${preview.high}`;
    return el('div', { className: 'rpg-battle-preview-strike', attrs: { role: 'note' } }, [
        el('span', { className: 'rpg-battle-preview-part is-hit', text: `Hit ${tidy(preview.hit)}%` }),
        el('span', { className: 'rpg-battle-preview-part is-damage', text: `${damage} dmg` }),
        el('span', { className: 'rpg-battle-preview-part is-crit', text: `Crit ${tidy(preview.crit)}%` }),
    ]);
}

function combatantCard(unit, { turnId, pick, onPick, versus = null, previews = null, rules = DEFAULT_RULES }) {
    const isEnemy = unit.side === 'enemy';
    const pickable = Boolean(pick && pick.ids.includes(unit.id) && !unit.gone);
    const preview = isEnemy && pickable ? previews?.[unit.id] ?? null : null;
    const classes = ['rpg-battle-card', isEnemy ? 'is-enemy' : 'is-party'];
    if (unit.gone) classes.push('is-gone', `is-${unit.gone}`);
    if (unit.id === turnId) classes.push('is-turn');
    if (unit.boss) classes.push('is-boss');
    if (pickable) classes.push('is-pickable');
    const badges = [];
    if (isEnemy) {
        // (0.5.2) Its level in the reader's terms ("Lv 3", "Soul Power 3", "Soul Class I")
        // rather than the rank letter, and the story's threat word when its row had one: the
        // level (and, below level 1, the scale) the word set is what makes it easy or hard.
        const power = num(unit.level, 0) >= 1 ? levelTag(Math.round(num(unit.level)), rules) : unit.rank;
        const rankRole = [power, str(unit.threat), unit.role].filter(Boolean).join(' · ');
        if (rankRole) badges.push(el('span', { className: 'rpg-battle-badge', text: rankRole }));
        if (unit.boss) badges.push(el('span', { className: 'rpg-battle-badge is-boss' }, [icon('fa-crown'), el('span', { text: 'boss' })]));
        // Made up from its name for this fight (templates.js); its look, when the model gave one.
        if (unit.fresh) badges.push(el('span', { className: 'rpg-battle-badge is-new', text: 'new', title: str(unit.look) || 'Made up from its name for this fight' }));
    } else if (unit.controller === 'auto') {
        badges.push(el('span', { className: 'rpg-battle-badge is-quiet', text: 'auto' }));
    }
    if (unit.gone) badges.push(el('span', { className: 'rpg-battle-badge is-gone', text: unit.gone }));
    const card = el('li', { className: classes.join(' ') }, [
        el('div', { className: 'rpg-battle-card-head' }, [
            unit.id === turnId ? icon('fa-caret-right') : null,
            el('span', { className: 'rpg-battle-card-name', text: unit.name ?? '', title: isEnemy && str(unit.look) ? str(unit.look) : undefined }),
            ...badges,
        ]),
        bar('hp', unit.hp?.cur, unit.hp?.max, `${unit.name ?? ''} HP`),
        !isEnemy ? bar('mp', unit.mp?.cur, unit.mp?.max, `${unit.name ?? ''} MP`) : null,
        !isEnemy && unit.sp ? bar('sp', unit.sp.cur, unit.sp.max, `${unit.name ?? ''} SP`) : null,
        pickable && preview ? previewLine(preview) : null,
        isEnemy && !unit.gone ? matchup(unit, versus, rules) : null,
        chips(unit.conditions),
    ]);
    card.dataset.combatantId = unit.id;
    if (unit.id === turnId) card.setAttribute('aria-current', 'true');
    if (pickable) {
        // The whole card is the target button: big enough for a thumb, and it is what the eye is on.
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Target ${unit.name ?? ''}`);
        card.addEventListener('click', () => onPick(unit.id));
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault?.();
                onPick(unit.id);
            }
        });
    }
    return card;
}

function renderFight(root, view, handlers) {
    const fight = view.fight;
    if (!fight) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No fight in progress.' }));
        return;
    }
    const actions = view.actions ?? null;
    const units = list(fight.combatants);
    const byId = new Map(units.map(unit => [unit.id, unit]));
    const active = fight.status === 'active';
    const actor = active ? actions?.actor ?? null : null;
    const turnId = actor?.id ?? (active ? fight.order?.[fight.turn] ?? null : null);
    const key = fightKey(fight);
    if (!fightUi || fightUi.key !== key || !actor) fightUi = { key, menu: null, pick: null };
    const ui = fightUi;

    const send = action => {
        fightUi = { key, menu: null, pick: null };
        const before = emit(handlers, 'onAction', action);
        // The glue redraws with the next fight; when it does not (no handler, or it threw
        // before drawing), clear the picking state here.
        if (current.root === before) rerender();
    };
    const pickTarget = id => {
        if (!ui.pick) return;
        const { type, skill, item } = ui.pick;
        send({ type, target: id, ...(skill ? { skill } : {}), ...(item ? { item } : {}) });
    };
    const cancel = () => { fightUi = { key, menu: null, pick: null }; rerender(); };

    /** Start an action: aim it, or send it straight away when there is nothing to choose. */
    const choose = ({ type, skill = null, item = null, aim, label }) => {
        const payload = { type, ...(skill ? { skill } : {}), ...(item ? { item } : {}) };
        if (aim === 'none') return send({ ...payload, target: null });
        if (aim === 'self') return send({ ...payload, target: actor.id });
        let ids = list(aim === 'ally' ? actions?.targets?.allies : actions?.targets?.enemies);
        if (type === 'parley') {
            const talkers = ids.filter(id => byId.get(id)?.talks);
            if (talkers.length) ids = talkers;
        }
        ids = ids.filter(id => !byId.get(id)?.gone);
        if (!ids.length) return undefined;
        if (ids.length === 1) return send({ ...payload, target: ids[0] });
        fightUi = { key, menu: null, pick: { type, skill, item, side: aim, ids, label } };
        return rerender();
    };

    const pick = ui.pick;
    // The member the matchups are against: whoever's turn it is, else you (or the first standing).
    const party0 = units.filter(unit => unit.side !== 'enemy');
    const versus = (actor ? byId.get(actor.id) ?? actor : null) ?? party0.find(unit => unit.memberId === 'pc' && !unit.gone) ?? party0.find(unit => !unit.gone) ?? null;
    // While aiming Attack or a damaging skill at an enemy, each target shows what it would do.
    const aimed = pick?.side === 'enemy' ? (pick.type === 'attack' ? actions?.previews?.attack : pick.type === 'skill' ? actions?.previews?.skills?.[pick.skill] : null) : null;
    const cardOptions = { turnId, pick, onPick: pickTarget, versus, previews: aimed ?? null, rules: view.rules ?? DEFAULT_RULES };
    const enemies = units.filter(unit => unit.side === 'enemy');
    const party = units.filter(unit => unit.side !== 'enemy');

    // Turn order: who acts this round, the current one marked.
    const order = list(fight.order).filter(id => byId.has(id));
    // (0.5.14) On the turn timeline the strip is the turns ahead, the current one first: a
    // faster fighter shows up more than once.
    const ahead = fight.turns === 'timeline';
    const strip = order.length ? el('ol', { className: `rpg-battle-order${ahead ? ' is-timeline' : ''}`, attrs: { 'aria-label': ahead ? 'Next turns' : `Turn order, round ${num(fight.round, 1)}` } }, order.map((id, index) => {
        const unit = byId.get(id);
        const classes = ['rpg-battle-order-item', unit.side === 'enemy' ? 'is-enemy' : 'is-party'];
        if (index === fight.turn && active) classes.push('is-current');
        if (index < fight.turn && active) classes.push('is-done');
        if (unit.gone) classes.push('is-gone');
        const item = el('li', { className: classes.join(' '), text: unit.name ?? '' });
        if (index === fight.turn && active) item.setAttribute('aria-current', 'step');
        return item;
    })) : null;

    root.append(el('div', { className: 'rpg-battle-fight-head' }, [
        el('span', { className: 'rpg-battle-round', text: `Round ${num(fight.round, 1)}` }),
        fight.stakes === 'death' ? el('span', { className: 'rpg-battle-badge is-death', text: 'to the death' }) : null,
    ]));
    if (strip) root.append(section('is-order', [sub(ahead ? 'Next turns' : 'Turn order', 'fa-list-ol'), strip]));
    root.append(section(`is-enemies${pick?.side === 'enemy' ? ' is-picking' : ''}`, [
        sub('Enemies', 'fa-skull', enemies.filter(unit => !unit.gone).length),
        el('ul', { className: 'rpg-battle-cards' }, enemies.map(unit => combatantCard(unit, cardOptions))),
    ]));
    root.append(section(`is-party${pick?.side === 'ally' ? ' is-picking' : ''}`, [
        sub('Party', 'fa-users'),
        el('ul', { className: 'rpg-battle-cards' }, party.map(unit => combatantCard(unit, cardOptions))),
    ]));

    const lines = list(fight.log).slice(-LOG_LINES);
    const log = el('ol', { className: 'rpg-battle-log', attrs: { 'aria-label': 'Fight log', 'aria-live': 'polite', tabindex: '0' } }, lines.map(line => {
        const kind = str(line?.kind).replace(/[^a-z-]/g, '') || 'info';
        return el('li', { className: `rpg-battle-log-line is-${kind}${line?.important ? ' is-important' : ''}` }, [
            el('span', { className: 'rpg-battle-log-round', text: `R${num(line?.round, 1)}`, attrs: { 'aria-hidden': 'true' } }),
            el('span', { className: 'rpg-battle-log-text', text: line?.text ?? '' }),
        ]);
    }));
    root.append(section('is-log', [sub('Log', 'fa-scroll'), lines.length ? log : el('p', { className: 'rpg-battle-hint', text: 'The fight begins.' })]));

    if (!active) {
        root.append(el('p', { className: 'rpg-battle-over', attrs: { role: 'status' }, text: `Fight over: ${OUTCOME_TITLES[fight.status] ?? fight.status}.` }));
        return { log };
    }
    if (!actor) {
        root.append(el('p', { className: 'rpg-battle-over', attrs: { role: 'status' }, text: 'Waiting for the next turn…' }));
        return { log };
    }

    // The action bar, stuck to the bottom of the pane.
    const actionBar = el('div', { className: 'rpg-battle-actionbar', attrs: { role: 'group', 'aria-label': `Actions for ${actor.name ?? ''}` } });
    let focusTarget = null;
    if (pick) {
        const cancelButton = button('Cancel', 'rpg-battle-cancel', { iconName: 'fa-xmark', onClick: cancel });
        actionBar.append(el('div', { className: 'rpg-battle-picking' }, [
            el('span', { className: 'rpg-battle-picking-text', attrs: { role: 'status' }, text: `${pick.label}: tap ${pick.side === 'ally' ? 'an ally' : 'an enemy'}.` }),
            cancelButton,
        ]));
        focusTarget = cancelButton;
    } else {
        const actorSkills = new Map(list(actor.skills).map(skill => [str(skill.name).toLowerCase(), skill]));
        const actorItems = new Map(list(actor.items).map(item => [str(item.name).toLowerCase(), item]));
        const skills = list(actions?.skills);
        const items = list(actions?.items).filter(item => num(item.qty, 1) > 0);
        const enemyTargets = list(actions?.targets?.enemies);

        if (ui.menu === 'skill' || ui.menu === 'item') {
            const isSkill = ui.menu === 'skill';
            const entries = (isSkill ? skills : items).map(entry => {
                const full = isSkill ? actorSkills.get(str(entry.name).toLowerCase()) : actorItems.get(str(entry.name).toLowerCase());
                const usable = isSkill ? entry.usable !== false : true;
                let meta;
                if (isSkill) {
                    const parts = [];
                    if (full) parts.push(costText(full));
                    if (full && num(full.cooldown) > 0) parts.push(`cooldown ${num(full.cooldown)}`);
                    if (TARGET_LABELS[entry.target ?? full?.target]) parts.push(TARGET_LABELS[entry.target ?? full?.target]);
                    meta = parts.join(' · ');
                } else {
                    meta = [`×${num(entry.qty, 1)}`, TARGET_LABELS[entry.target]].filter(Boolean).join(' · ');
                }
                let reason = '';
                if (!usable) {
                    reason = entry.reason === 'cooldown' && num(full?.cooldownLeft) > 0
                        ? `Cooldown: ${num(full.cooldownLeft)} ${num(full.cooldownLeft) === 1 ? 'round' : 'rounds'}`
                        : REASON_LABELS[entry.reason] ?? 'Not usable now';
                }
                const node = el('button', { className: `menu_button rpg-battle-pick rpg-battle-menu-entry${usable ? '' : ' is-unusable'}` }, [
                    el('span', { className: 'rpg-battle-pick-head' }, [
                        icon(isSkill ? TYPE_ICONS[full?.type] ?? 'fa-wand-sparkles' : 'fa-flask'),
                        el('span', { className: 'rpg-battle-pick-name', text: entry.name ?? '' }),
                        isSkill && full?.mastery ? el('span', { className: 'rpg-battle-tag', text: `Lv ${num(full.mastery, 1)}` }) : null,
                    ]),
                    meta ? el('span', { className: 'rpg-battle-pick-meta', text: meta }) : null,
                    reason ? el('span', { className: 'rpg-battle-pick-reason', text: reason }) : null,
                ]);
                node.type = 'button';
                node.disabled = !usable;
                node.dataset[isSkill ? 'skill' : 'item'] = entry.name ?? '';
                node.addEventListener('click', () => {
                    if (!usable) return;
                    const target = entry.target ?? full?.target ?? 'one';
                    const aim = isSkill
                        ? aimOf(target, { type: full?.type ?? null })
                        : aimOf(target, { type: 'item', damages: Boolean(full?.effect?.damage) });
                    choose({ type: isSkill ? 'skill' : 'item', skill: isSkill ? entry.name : null, item: isSkill ? null : entry.name, aim, label: entry.name ?? '' });
                });
                return node;
            });
            const close = button('Close', 'rpg-battle-menu-close', { iconName: 'fa-xmark', onClick: cancel });
            actionBar.append(el('div', { className: `rpg-battle-menu is-${ui.menu}` }, [
                el('div', { className: 'rpg-battle-menu-head' }, [sub(isSkill ? 'Skills' : 'Items', isSkill ? 'fa-wand-sparkles' : 'fa-flask'), close]),
                entries.length ? el('div', { className: 'rpg-battle-menu-list' }, entries) : el('p', { className: 'rpg-battle-hint', text: isSkill ? 'No skills.' : 'No items.' }),
            ]));
            focusTarget = close;
        }

        const openMenu = menu => { fightUi = { key, menu: ui.menu === menu ? null : menu, pick: null }; rerender(); };
        const parleyText = actions?.parleyChance === null || actions?.parleyChance === undefined ? 'Parley' : `Parley ${Math.round(num(actions.parleyChance))}%`;
        const fleeText = actions?.fleeChance === null || actions?.fleeChance === undefined ? 'Flee' : `Flee ${Math.round(num(actions.fleeChance))}%`;
        const skillButton = button('Skill', 'rpg-battle-act is-skill', { iconName: 'fa-wand-sparkles', disabled: !skills.length, onClick: () => openMenu('skill') });
        skillButton.setAttribute('aria-expanded', String(ui.menu === 'skill'));
        const itemButton = button('Item', 'rpg-battle-act is-item', { iconName: 'fa-flask', disabled: !items.length, onClick: () => openMenu('item') });
        itemButton.setAttribute('aria-expanded', String(ui.menu === 'item'));
        // A tooltip only: the accessible name stays the visible "Auto".
        const autoButton = button('Auto', 'rpg-battle-act is-auto', {
            iconName: 'fa-robot',
            onClick: () => {
                fightUi = { key, menu: null, pick: null };
                if (typeof handlers?.onAuto === 'function') emit(handlers, 'onAuto');
                else send({ type: 'auto' });
            },
        });
        actionBar.append(el('div', { className: 'rpg-battle-actbar-head' }, [
            el('span', { className: 'rpg-battle-actor', text: `${actor.name ?? ''}’s turn` }),
        ]), el('div', { className: 'rpg-battle-actgrid' }, [
            button('Attack', 'rpg-battle-act is-attack', {
                iconName: 'fa-hand-fist',
                disabled: !enemyTargets.length,
                onClick: () => choose({ type: 'attack', aim: 'enemy', label: 'Attack' }),
            }),
            skillButton,
            itemButton,
            button('Defend', 'rpg-battle-act is-defend', { iconName: 'fa-shield-halved', onClick: () => send({ type: 'defend' }) }),
            button(parleyText, 'rpg-battle-act is-parley', {
                iconName: 'fa-comments',
                disabled: !actions?.canParley,
                onClick: () => choose({ type: 'parley', aim: 'enemy', label: 'Parley' }),
            }),
            button(fleeText, 'rpg-battle-act is-flee', {
                iconName: 'fa-person-running',
                disabled: actions?.canFlee === false,
                onClick: () => send({ type: 'flee' }),
            }),
            autoButton,
        ]));
        autoButton.title = 'Fight the rest on auto';
    }
    root.append(actionBar);
    // Esc leaves the picking state or closes an open list.
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape' && (fightUi?.pick || fightUi?.menu)) {
            event.preventDefault?.();
            cancel();
        }
    });
    return { log, focusTarget };
}

// ---------------------------------------------------------------------------
// result

function moneyText(money, view) {
    if (str(view.moneyText)) return str(view.moneyText);
    const currency = (view.rules ?? DEFAULT_RULES).currency ?? {};
    const unit = currency.mode === 'single' ? currency.single : currency.tiers?.[0]?.name;
    return `${num(money)} ${unit || 'coins'}`;
}

function perMember(value, memberId) {
    if (value && typeof value === 'object') return num(value[memberId]);
    return null;
}

/** The party as a fight (or a stage) left it: HP and MP bars, conditions, who is down. */
function partyAfter(party, title) {
    return section('is-after', [
        sub(title, 'fa-heart-pulse'),
        el('ul', { className: 'rpg-battle-records' }, party.map(member => {
            const item = el('li', { className: `rpg-battle-record rpg-battle-after${member.down ? ' is-down' : ''}` }, [
                el('div', { className: 'rpg-battle-record-head' }, [
                    el('span', { className: 'rpg-battle-record-name', text: member.name ?? '' }),
                    member.down ? el('span', { className: 'rpg-battle-badge is-gone', text: 'down' }) : null,
                ]),
                bar('hp', member.hp?.cur, member.hp?.max, `${member.name ?? ''} HP`),
                bar('mp', member.mp?.cur, member.mp?.max, `${member.name ?? ''} MP`),
                member.sp ? bar('sp', member.sp.cur, member.sp.max, `${member.name ?? ''} SP`) : null,
                chips(member.conditions),
            ]);
            if (member.memberId) item.dataset.memberId = member.memberId;
            return item;
        })),
    ]);
}

/** "Stage 1, the gate: victory in 3 rounds", "Stage 3, the tower: not reached". */
function stageLine(stage, withdrew = false) {
    const place = str(stage?.place);
    const head = `Stage ${num(stage?.number, 1)}${place ? `, ${place}` : ''}`;
    const rounds = num(stage?.rounds);
    const count = `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
    if (stage?.outcome === 'victory') return `${head}: victory in ${count}`;
    if (stage?.outcome === 'defeat') return `${head}: defeated after ${count}`;
    if (stage?.outcome === 'fled') return `${head}: escaped after ${count}`;
    return `${head}: ${withdrew ? 'not attempted' : 'not reached'}`;
}

function renderResult(root, view, handlers) {
    const result = view.result;
    if (!result) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No result.' }));
        return;
    }
    const outcome = result.outcome ?? 'victory';
    const rounds = num(result.rounds);
    const seconds = num(result.seconds);

    const fought = list(result.stages).filter(stage => stage?.outcome).length;
    root.append(section(`is-outcome is-${outcome}`, [
        el('h3', { className: `rpg-battle-outcome is-${outcome}`, text: OUTCOME_TITLES[outcome] ?? outcome }),
        el('p', { className: 'rpg-battle-hint', text: `${rounds} ${rounds === 1 ? 'round' : 'rounds'}${fought ? ` in ${fought} ${fought === 1 ? 'stage' : 'stages'}` : ''} · about ${seconds} seconds${result.stakes === 'death' ? ' · to the death' : ''}` }),
    ]));

    // A plan's stages (0.5), each with how it went; the sections below are the totals.
    const stages = list(result.stages);
    if (stages.length) {
        root.append(section('is-stages', [
            sub('Stages', 'fa-route', stages.length),
            el('ul', { className: 'rpg-battle-stages' }, stages.map(stage => el('li', {
                className: `rpg-battle-stage-line is-${str(stage.outcome) || (result.withdrew ? 'not-attempted' : 'not-reached')}`,
                text: stageLine(stage, result.withdrew),
            }))),
        ]));
    }

    const party = list(result.party);
    if (party.length) root.append(partyAfter(party, stages.length ? 'After the plan' : 'After the fight'));

    // XP, level-ups and points: per member when the glue gives a map, else one line for the PC.
    // In the reader's terms: "Soul Growth +30" (0.5.2: XP, with tiers too, at the XP rate).
    const rules = view.rules ?? DEFAULT_RULES;
    const terms = termsOf(rules);
    const xp = result.xp && typeof result.xp === 'object' ? result.xp : {};
    const xpRows = [];
    const gains = Object.entries(xp).map(([memberId, value]) => [memberId, num(value), xpGainText(value)]);
    if (gains.length && gains.every(([, value, text]) => value === gains[0][1] && text === gains[0][2])) {
        if (gains[0][1] > 0) xpRows.push([terms.xpName, `${gains[0][2]}${gains.length > 1 ? ' each' : ''}`]);
    } else {
        for (const [memberId, , text] of gains) {
            const name = party.find(member => member.memberId === memberId)?.name ?? memberId;
            xpRows.push([`${name} ${terms.xpName}`, text]);
        }
    }
    // Where a member got to, when the glue says (view.levelsReached: number or { memberId: level }).
    const reached = memberId => {
        const value = view.levelsReached && typeof view.levelsReached === 'object' ? num(view.levelsReached[memberId], 0) : memberId === 'pc' ? num(view.levelsReached, 0) : 0;
        return value >= 1 ? ` (${levelText(value, rules)})` : '';
    };
    const levels = typeof view.levelsGained === 'object' && view.levelsGained ? null : num(view.levelsGained);
    const points = typeof view.pointsGained === 'object' && view.pointsGained ? null : num(view.pointsGained);
    if (levels) xpRows.push([terms.levelName, `+${levels}${levels === 1 ? ' level' : ' levels'}${reached('pc')}`]);
    if (points) xpRows.push(['Points', `${points} to spend`]);
    for (const member of party) {
        const memberLevels = perMember(view.levelsGained, member.memberId);
        const memberPoints = perMember(view.pointsGained, member.memberId);
        if (memberLevels) xpRows.push([`${member.name ?? ''}`, `+${memberLevels} ${memberLevels === 1 ? 'level' : 'levels'}${reached(member.memberId)}${memberPoints ? `, ${memberPoints} points to spend` : ''}`]);
    }
    // Skills that reached a new mastery in this fight (0.5.5): "Power Strike Lv 2 · Lyra's Mend Lv 3".
    const masteryUps = list(view.masteryUps).filter(up => up && str(up.skill));
    if (masteryUps.length) {
        xpRows.push(['Mastery', masteryUps.map(up => `${up.memberId && up.memberId !== 'pc' && str(up.name) ? `${str(up.name)}'s ` : ''}${str(up.skill)} Lv ${num(up.level, 2)}`).join(' · ')]);
    }
    const xpFacts = facts(xpRows, 'rpg-battle-gains');
    if (xpFacts) root.append(section('is-gains', [sub('Gains', 'fa-arrow-trend-up'), xpFacts]));

    const lootItems = list(result.loot?.items);
    const money = num(result.loot?.money);
    if (lootItems.length || money > 0) {
        root.append(section('is-loot', [
            sub('Loot', 'fa-sack-dollar', lootItems.length + (money > 0 ? 1 : 0)),
            el('ul', { className: 'rpg-battle-loot' }, [
                money > 0 ? el('li', { className: 'rpg-battle-loot-item is-money' }, [icon('fa-coins'), el('span', { text: moneyText(money, view) })]) : null,
                ...lootItems.map(item => el('li', { className: `rpg-battle-loot-item is-${str(item.rarity).toLowerCase() || 'common'}` }, [
                    el('span', { className: 'rpg-battle-loot-name', text: item.name ?? '' }),
                    num(item.qty, 1) > 1 ? el('span', { className: 'rpg-battle-tag', text: `×${num(item.qty, 1)}` }) : null,
                    item.rarity && item.rarity !== 'common' ? el('span', { className: 'rpg-battle-tag is-quiet', text: item.rarity }) : null,
                ])),
            ]),
        ]));
    }

    const moments = list(result.keyMoments).filter(Boolean);
    if (moments.length) {
        root.append(section('is-moments', [
            sub('Key moments', 'fa-star'),
            el('ul', { className: 'rpg-battle-moments' }, moments.map(moment => el('li', { text: moment }))),
        ]));
    }

    if (str(view.handoff)) {
        root.append(section('is-handoff', [
            sub('Hand-off to the story', 'fa-feather'),
            el('pre', { className: 'rpg-battle-handoff', text: view.handoff }),
        ]));
    }

    // (0.5.4) What the reader's character could do next: each one their message, put in the
    // message box (a click) or sent (Shift-click); the reply narrates the fight, then that move.
    const next = view.nextMoves;
    const moves = list(next?.moves).filter(move => str(move));
    if (next && (next.status === 'loading' || moves.length)) {
        root.append(section('is-next', [
            sub('What next?', 'fa-route'),
            next.status === 'loading'
                ? el('p', { className: 'rpg-battle-hint rpg-battle-next-loading', attrs: { role: 'status' }, text: 'Thinking of what could come next…' })
                : el('ul', { className: 'rpg-battle-next-moves' }, moves.map(move => el('li', {}, [
                    button(move, 'rpg-battle-next-move', { title: 'Click puts it in the message box · Shift-click sends it', onClick: event => emit(handlers, 'onMove', move, Boolean(event?.shiftKey)) }),
                ]))),
            next.status === 'loading' ? null : el('p', { className: 'rpg-battle-hint', text: 'Click puts it in the message box · Shift-click sends it. The reply tells the fight, then your move.' }),
        ]));
    }

    // The result always reaches the story: Return to story now, or Done and the next reply.
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        button(moves.length ? 'Just continue' : 'Return to story', 'rpg-battle-primary rpg-battle-return', { iconName: 'fa-book-open', onClick: () => emit(handlers, 'onReturn') }),
        button('Done', 'rpg-battle-done', { iconName: 'fa-check', onClick: () => emit(handlers, 'onDone') }),
    ]));
}

// ---------------------------------------------------------------------------
// between: a plan's stage cleared, the next one ahead (0.5)

/**
 * Between a plan's stages: the stage just cleared, the party as it stands (nothing healed
 * between stages), the next stage as it will be fought, read-only; Go on or Fall back, nothing
 * else. Both send nothing: the glue goes on with the plan it stored.
 */
function renderBetween(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const cleared = view.cleared ?? {};
    const next = view.next ?? null;
    const total = Math.max(1, Math.round(num(view.total, 1)));
    const number = Math.max(1, Math.round(num(cleared.number, 1)));
    const rounds = num(cleared.rounds);
    const nextName = next ? str(next.place) || `stage ${num(next.number, number + 1)}` : '';
    root.append(section('is-between', [
        sub(`Stage ${number} of ${total}`, 'fa-flag-checkered'),
        el('h3', { className: 'rpg-battle-between-cleared', text: `${placeSubject(number, cleared.place)} is cleared (${rounds} ${rounds === 1 ? 'round' : 'rounds'}).` }),
        next ? el('p', { className: 'rpg-battle-between-next', text: `Next: ${nextName}${str(next.text) ? ` — ${str(next.text)}` : ''}` }) : null,
    ]));
    const party = list(view.party);
    if (party.length) root.append(partyAfter(party, 'The party now'));
    if (next) {
        const rows = list(next.rows).filter(row => str(row?.name));
        root.append(section('is-setup is-next', [
            sub(stageTitle(num(next.number, number + 1), total, next.place), 'fa-skull'),
            ...engagementGroups(rows, rules, newChecker(view.known)),
        ]));
    }
    root.append(el('p', { className: 'rpg-battle-hint rpg-battle-between-hint', text: 'Nothing heals between stages: HP, MP and conditions carry over, and whoever is down stays down. Fall back ends the plan here, keeping what the cleared stages gave.' }));
    if (view.stakes === 'death') root.append(el('p', { className: 'rpg-battle-section rpg-battle-stakes is-death', text: STAKES.death }));
    const busy = Boolean(view.busy);
    root.append(el('div', { className: 'rpg-battle-actions is-end' }, [
        button('Fall back', 'rpg-battle-fall-back', { iconName: 'fa-rotate-left', disabled: busy, onClick: () => { if (!busy) emit(handlers, 'onFallBack'); } }),
        button('Go on', 'rpg-battle-primary rpg-battle-go-on', { iconName: 'fa-forward', disabled: busy, onClick: () => { if (!busy) emit(handlers, 'onGoOn'); } }),
    ]));
}

// ---------------------------------------------------------------------------
// offer: a fight the story starts (the Battle tab's first screen)

/**
 * The Battle tab exists while there is a battle: first the story's offer (the reply's
 * <Encounter>, or one Story Director planned), Fight? or Not now; never started on its own,
 * so the reader decides whether it is a fight at all. Engagements after the first ("then:")
 * are listed in order.
 */
function renderOffer(root, view, handlers) {
    const encounter = view.encounter;
    if (!encounter || !str(encounter.text)) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No fight right now: the story starts them.' }));
        return;
    }
    const waves = [...new Set(list(encounter.rows).map(row => num(row.wave, 0)))].sort((a, b) => a - b);
    // A plan (0.5): its summary is the line ("A plan in 3 stages: the gate, the yard, the tower").
    const stages = list(encounter.stages).length;
    root.append(el('div', { className: 'rpg-battle-notice is-encounter', attrs: { role: 'status' } }, [
        el('div', { className: 'rpg-battle-notice-text' }, [
            icon('fa-dragon'),
            el('span', { className: 'rpg-battle-encounter-text', text: stages > 1 ? str(encounter.summary) || str(encounter.text) : `A fight is starting: ${str(encounter.summary) || str(encounter.text)}` }),
        ]),
        str(encounter.label) ? el('p', { className: 'rpg-battle-hint rpg-battle-encounter-label', text: str(encounter.label) }) : null,
        stages > 1 ? el('p', { className: 'rpg-battle-hint rpg-battle-encounter-stages', text: `${stages} fights, one after another in different places: HP, MP and conditions carry over, and between them you go on or fall back.` }) : null,
        stages < 2 && waves.length > 1 ? el('p', { className: 'rpg-battle-hint rpg-battle-encounter-waves', text: `${waves.length} engagements, fought back to back: HP, MP and conditions carry over between them.` }) : null,
        encounter.stakes === 'death' ? el('p', { className: 'rpg-battle-hint rpg-battle-encounter-stakes is-death', text: STAKES.death }) : null,
        view.pending ? el('p', { className: 'rpg-battle-hint', text: 'The last fight\'s result is still to be narrated.' }) : null,
        el('div', { className: 'rpg-battle-actions' }, [
            // Nothing sent back: the glue opens the offer it parsed from the story.
            button('Fight?', 'rpg-battle-primary rpg-battle-encounter-fight', { iconName: 'fa-dragon', onClick: () => emit(handlers, 'onFightEncounter') }),
            button('Not now', 'rpg-battle-encounter-dismiss', { iconName: 'fa-xmark', onClick: () => emit(handlers, 'onDismissEncounter') }),
        ]),
    ]));
}

// ---------------------------------------------------------------------------

const RENDERERS = {
    offer: renderOffer,
    create: renderCreate,
    idle: renderIdle,
    spend: renderSpend,
    learn: renderLearn,
    items: renderItems,
    companion: renderCompanion,
    setup: renderSetup,
    fight: renderFight,
    between: renderBetween,
    result: renderResult,
};

/**
 * Render the Battle tab into `pane` (Story Block calls tab.render(pane) and leaves the
 * pane's content to us). `view.mode` picks the screen; `handlers` are optional callbacks.
 */
export function renderBattleTab(pane, view, handlers = {}) {
    if (!pane) return;
    const mode = view?.mode ?? '';
    // Drafts belong to their mode: coming back later starts clean. Two tabs draw with this
    // renderer (the Party tab and, during a battle, the Battle tab), so a mode only drops the
    // drafts of its own tab's other modes.
    const group = BATTLE_MODES.includes(mode) ? BATTLE_MODES : PARTY_MODES;
    const leaving = name => group.includes(name) && mode !== name;
    if (leaving('create')) createDraft = null;
    if (leaving('spend')) spendDraft = null;
    if (leaving('learn')) learnDraft = null;
    if (leaving('fight')) fightUi = null;
    if (leaving('companion')) companionDraft = null;
    if (leaving('items')) itemsTarget = null;
    if (leaving('idle')) {
        removeArmed = null;
        editDraft = null;
        forgetArmed = null;
        startOverArmed = false;
        giveOpen = null;
        offerArmed = null;
    }

    const root = el('div', { className: `rpg-battle-tab is-${mode || 'none'}` });
    root.dataset.mode = mode;
    const drawn = { pane, view, handlers: handlers ?? {}, root };
    current = drawn;
    // Whatever the reader does in this pane redraws this pane: the other tab may have drawn since.
    for (const type of ['click', 'input', 'change', 'toggle', 'keydown']) root.addEventListener(type, () => { current = drawn; }, true);
    const render = RENDERERS[mode];
    const extra = render ? render(root, view, handlers ?? {}) : (root.append(el('p', { className: 'rpg-battle-empty', text: 'Nothing to show.' })), null);
    pane.replaceChildren(root);

    // Newest log line in view; focus kept where the reader is about to act (Cancel / Close),
    // since the redraw replaced the button they pressed.
    if (extra?.log && Number.isFinite(extra.log.scrollHeight)) extra.log.scrollTop = extra.log.scrollHeight;
    if (extra?.focusTarget && typeof extra.focusTarget.focus === 'function') {
        try {
            extra.focusTarget.focus({ preventScroll: true });
        } catch {
            // Focus is a convenience; a pane that is not attached yet cannot take it.
        }
    }
}
