// The "Battle" tab in Story Block's sidebar.
//
// One entry point, `renderBattleTab(pane, view, handlers)`, draws whichever mode the glue
// asks for (create, idle, spend, learn, setup, fight, result; see docs/ARCHITECTURE.md) and
// reports what the reader chose through `handlers`. It owns no game state: every number
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

import { STATS, RANKS, DEFAULT_RULES, maxHp, maxMp, derive, checkModifiers, xpToNext } from '../rules.js';
import { stateWords } from '../narrative.js';

const ROLES = ['brute', 'skirmisher', 'caster', 'tank', 'support'];
const SKILL_TYPES = ['physical', 'magic', 'heal', 'buff', 'debuff'];
const SKILL_TARGETS = ['one', 'all', 'self', 'ally', 'allies'];
const LOG_LINES = 8;

// What each stat does, in a few words, for the reader building a character.
const STAT_HINTS = {
    STR: 'physical attack',
    VIT: 'HP, defence',
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
    cooldown: 'On cooldown',
    stunned: 'Stunned',
};

const OUTCOME_TITLES = {
    victory: 'Victory',
    defeat: 'Defeated',
    fled: 'Escaped',
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
function bar(kind, cur, max, label = kind.toUpperCase()) {
    const value = Math.max(0, Math.round(num(cur)));
    const top = Math.max(0, Math.round(num(max)));
    const pct = top > 0 ? Math.min(100, Math.round((value / top) * 100)) : 0;
    const fill = el('span', { className: 'rpg-battle-bar-fill' });
    fill.style.width = `${pct}%`;
    const low = kind === 'hp' && top > 0 && pct <= 25;
    return el('div', {
        className: `rpg-battle-bar is-${kind}${low ? ' is-low' : ''}`,
        attrs: {
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': '0',
            'aria-valuemax': String(top),
            'aria-valuenow': String(Math.min(value, top)),
            'aria-valuetext': `${value} of ${top}`,
        },
    }, [
        el('span', { className: 'rpg-battle-bar-name', text: kind.toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
        el('span', { className: 'rpg-battle-bar-track' }, [fill]),
        el('span', { className: 'rpg-battle-bar-value', text: `${value}/${top}`, attrs: { 'aria-hidden': 'true' } }),
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

function skillMeta(skill) {
    const parts = [];
    if (skill.type) parts.push(skill.type);
    parts.push(`${num(skill.mp)} MP`);
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

function numbersFor(stats, level, rules, { hpBonus = 0, mpBonus = 0 } = {}) {
    const d = derive(stats, {}, rules);
    return { hp: maxHp(stats, level, rules, hpBonus), mp: maxMp(stats, level, rules, mpBonus), ...d };
}

// ---------------------------------------------------------------------------
// create: a new character

let createDraft = null;

function renderCreate(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const { startStat, startPoints, starterSkills } = rules.character;
    const library = list(view.library).filter(skill => skill && str(skill.name) && num(skill.tier, 1) === 1);
    if (!createDraft) createDraft = { name: '', stats: Object.fromEntries(STATS.map(stat => [stat, startStat])), skills: [], preset: null };
    const draft = createDraft;
    const spent = () => STATS.reduce((sum, stat) => sum + draft.stats[stat] - startStat, 0);
    const remaining = () => startPoints - spent();

    const nameInput = el('input', { className: 'text_pole rpg-battle-name-input', attrs: { type: 'text', maxlength: '60', placeholder: 'Name', 'aria-label': 'Character name', autocomplete: 'off' } });
    nameInput.value = draft.name;
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; refresh(); });

    const presetButtons = list(view.presets).filter(preset => preset && preset.id).map(preset => {
        const node = button(str(preset.name) || preset.id, 'rpg-battle-preset', {
            onClick: () => {
                draft.stats = Object.fromEntries(STATS.map(stat => [stat, startStat + Math.max(0, num(preset.points?.[stat]))]));
                // A preset may name a skill the reader's library no longer has; skip it.
                draft.skills = list(preset.skills)
                    .map(name => library.find(skill => sameName(skill.name, name))?.name)
                    .filter(Boolean)
                    .slice(0, starterSkills);
                draft.preset = preset.id;
                refresh();
            },
        });
        node.dataset.preset = preset.id;
        return node;
    });

    const remainingNode = el('span', { className: 'rpg-battle-remaining', attrs: { 'aria-live': 'polite' } });
    const steppers = STATS.map(stat => stepper(stat, {
        hint: STAT_HINTS[stat],
        onMinus: () => { if (draft.stats[stat] > startStat) { draft.stats[stat] -= 1; draft.preset = null; refresh(); } },
        onPlus: () => { if (remaining() > 0) { draft.stats[stat] += 1; draft.preset = null; refresh(); } },
    }));

    const skillButtons = library.map(skill => {
        const node = el('button', { className: 'menu_button rpg-battle-pick rpg-battle-skill-pick' }, [
            el('span', { className: 'rpg-battle-pick-head' }, [
                icon(TYPE_ICONS[skill.type] ?? 'fa-star'),
                el('span', { className: 'rpg-battle-pick-name', text: skill.name }),
            ]),
            el('span', { className: 'rpg-battle-pick-meta', text: skillMeta(skill) }),
            str(skill.description) ? el('span', { className: 'rpg-battle-pick-desc', text: skill.description }) : null,
        ]);
        node.type = 'button';
        node.dataset.skill = skill.name;
        node.addEventListener('click', () => {
            const index = draft.skills.findIndex(name => sameName(name, skill.name));
            if (index >= 0) draft.skills.splice(index, 1);
            else if (draft.skills.length < starterSkills) draft.skills.push(skill.name);
            else return;
            draft.preset = null;
            refresh();
        });
        return node;
    });
    const skillCount = el('span', { className: 'rpg-battle-count' });

    const preview = previewList();
    const hint = el('p', { className: 'rpg-battle-hint rpg-battle-create-hint', attrs: { 'aria-live': 'polite' } });
    const create = button('Create character', 'rpg-battle-primary rpg-battle-create', {
        iconName: 'fa-user-plus',
        onClick: () => {
            if (!valid()) return;
            emit(handlers, 'onCreate', { name: str(draft.name), stats: { ...draft.stats }, skills: [...draft.skills] });
        },
    });

    function valid() {
        return Boolean(str(draft.name)) && remaining() === 0 && draft.skills.length === starterSkills;
    }

    function refresh() {
        const left = remaining();
        remainingNode.textContent = `${left} of ${startPoints} points left`;
        remainingNode.classList.toggle('is-done', left === 0);
        for (const step of steppers) {
            const stat = step.row.dataset.stat;
            step.value.textContent = String(draft.stats[stat]);
            step.minus.disabled = draft.stats[stat] <= startStat;
            step.plus.disabled = left <= 0;
            step.extra.textContent = `check ${signed(checkModifiers(draft.stats, rules)[stat])}`;
        }
        for (const node of presetButtons) {
            const on = draft.preset === node.dataset.preset;
            node.setAttribute('aria-pressed', String(on));
            node.classList.toggle('is-selected', on);
        }
        const full = draft.skills.length >= starterSkills;
        for (const node of skillButtons) {
            const on = draft.skills.some(name => sameName(name, node.dataset.skill));
            node.setAttribute('aria-pressed', String(on));
            node.classList.toggle('is-selected', on);
            node.disabled = full && !on;
        }
        skillCount.textContent = `${draft.skills.length}/${starterSkills}`;
        fillPreview(preview, previewRows(numbersFor(draft.stats, 1, rules), numbersFor(draft.stats, 1, rules)), false);
        const missing = [];
        if (!str(draft.name)) missing.push('a name');
        if (left > 0) missing.push(`${left} more ${left === 1 ? 'point' : 'points'}`);
        if (draft.skills.length < starterSkills) missing.push(`${starterSkills - draft.skills.length} more ${starterSkills - draft.skills.length === 1 ? 'skill' : 'skills'}`);
        hint.textContent = missing.length ? `Still needed: ${missing.join(', ')}.` : 'Ready.';
        create.disabled = !valid();
    }

    root.append(
        section('is-create-intro', [
            sub('New character', 'fa-user-plus'),
            el('p', { className: 'rpg-battle-hint', text: `No classes: every stat starts at ${startStat}; spend ${startPoints} points and pick ${starterSkills} starter skills. A preset only fills these in.` }),
            el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text: 'Name' }), nameInput]),
        ]),
        presetButtons.length ? section('is-presets', [
            sub('Presets', 'fa-wand-magic-sparkles'),
            el('div', { className: 'rpg-battle-chooser', attrs: { role: 'group', 'aria-label': 'Presets' } }, presetButtons),
        ]) : null,
        section('is-stats', [
            el('div', { className: 'rpg-battle-sub-row' }, [sub('Stats', 'fa-chart-simple'), remainingNode]),
            el('ul', { className: 'rpg-battle-steppers' }, steppers.map(step => step.row)),
        ]),
        section('is-skills', [
            el('div', { className: 'rpg-battle-sub-row' }, [sub('Starter skills', 'fa-wand-sparkles'), skillCount]),
            library.length
                ? el('div', { className: 'rpg-battle-picks', attrs: { role: 'group', 'aria-label': 'Starter skills' } }, skillButtons)
                : el('p', { className: 'rpg-battle-hint', text: 'The skill library has no tier-1 skills.' }),
        ]),
        section('is-preview', [sub('At level 1', 'fa-heart-pulse'), preview]),
        el('div', { className: 'rpg-battle-actions is-end' }, [hint, create]),
    );
    refresh();
}

// ---------------------------------------------------------------------------
// idle: the sheet at a glance

function renderIdle(root, view, handlers) {
    const rules = view.rules ?? DEFAULT_RULES;
    const sheet = view.sheet;
    if (!sheet) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No character sheet yet.' }));
        return;
    }
    const level = num(sheet.level, 1);
    const checks = view.checks ?? checkModifiers(sheet.stats, rules);

    if (view.pending) {
        root.append(el('div', { className: 'rpg-battle-notice is-pending', attrs: { role: 'status' } }, [
            el('div', { className: 'rpg-battle-notice-text' }, [
                icon('fa-feather'),
                el('span', { text: 'A fight result is waiting to be narrated in the next reply.' }),
            ]),
            fold('is-pending-text', 'Hand-off', 'fa-scroll', null, [el('pre', { className: 'rpg-battle-handoff', text: view.pending })]),
            button('Return to story', 'rpg-battle-return', { iconName: 'fa-book-open', onClick: () => emit(handlers, 'onReturn') }),
        ]));
    }

    // A fight the story has started (the reply's <Encounter>, or one Story Director planned):
    // offered, never started on its own, so the reader decides whether it is a fight at all.
    const encounter = view.encounter;
    if (encounter && str(encounter.text)) {
        root.append(el('div', { className: 'rpg-battle-notice is-encounter', attrs: { role: 'status' } }, [
            el('div', { className: 'rpg-battle-notice-text' }, [
                icon('fa-dragon'),
                el('span', { className: 'rpg-battle-encounter-text', text: `A fight is starting: ${str(encounter.text)}` }),
            ]),
            str(encounter.label) ? el('p', { className: 'rpg-battle-hint rpg-battle-encounter-label', text: str(encounter.label) }) : null,
            el('div', { className: 'rpg-battle-actions' }, [
                button('Fight?', 'rpg-battle-primary rpg-battle-encounter-fight', { iconName: 'fa-dragon', onClick: () => emit(handlers, 'onFightEncounter', list(encounter.rows).map(row => ({ ...row }))) }),
                button('Not now', 'rpg-battle-encounter-dismiss', { iconName: 'fa-xmark', onClick: () => emit(handlers, 'onDismissEncounter') }),
            ]),
        ]));
    }

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

    root.append(section('is-sheet', [
        el('div', { className: 'rpg-battle-head' }, [
            el('span', { className: 'rpg-battle-head-name', text: sheet.name ?? '' }),
            el('span', { className: 'rpg-battle-tag rpg-battle-level', text: `Level ${level}` }),
        ]),
        bar('hp', sheet.hp?.cur, sheet.hp?.max, 'HP'),
        bar('mp', sheet.mp?.cur, sheet.mp?.max, 'MP'),
        // The words the model is told to portray, so the reader sees what the story will say.
        el('p', { className: 'rpg-battle-hint rpg-battle-state', text: stateWords(sheet, rules).text }),
        bar('xp', sheet.xp, xpToNext(level, rules), 'XP to next level'),
        chips(sheet.conditions),
    ]));

    const statGrid = el('ul', { className: 'rpg-battle-stats' }, STATS.map(stat => {
        const item = el('li', { className: 'rpg-battle-stat' }, [
            el('span', { className: 'rpg-battle-stat-name', text: stat }),
            el('span', { className: 'rpg-battle-stat-value', text: String(num(sheet.stats?.[stat])) }),
            el('span', { className: 'rpg-battle-stat-check', text: signed(checks?.[stat]), title: `${stat} check bonus` }),
        ]);
        item.dataset.stat = stat;
        return item;
    }));
    const points = num(sheet.points);
    root.append(section('is-stats', [
        sub('Stats', 'fa-chart-simple'),
        statGrid,
        points > 0 ? el('div', { className: 'rpg-battle-points' }, [
            el('span', { className: 'rpg-battle-points-text', text: `${points} unspent ${points === 1 ? 'point' : 'points'}` }),
            button('Spend', 'rpg-battle-spend', { iconName: 'fa-plus', onClick: () => emit(handlers, 'onSpend') }),
        ]) : null,
    ]));

    const skills = list(view.skills);
    root.append(section('is-skills', [
        sub('Skills', 'fa-wand-sparkles', skills.length),
        skills.length ? el('ul', { className: 'rpg-battle-records' }, skills.map(skill => el('li', { className: 'rpg-battle-record rpg-battle-skill' }, [
            el('div', { className: 'rpg-battle-record-head' }, [
                icon(TYPE_ICONS[skill.type] ?? 'fa-star'),
                el('span', { className: 'rpg-battle-record-name', text: skill.name ?? '' }),
                el('span', { className: 'rpg-battle-tag', text: `Lv ${num(skill.mastery, 1)}` }),
            ]),
            el('div', { className: 'rpg-battle-record-meta', text: skillMeta(skill) }),
        ]))) : el('p', { className: 'rpg-battle-hint', text: 'No skills yet.' }),
    ]));

    const party = list(view.party).filter(member => member && member.sheet);
    if (party.length) {
        root.append(section('is-party', [
            sub('Party', 'fa-users', party.length),
            el('ul', { className: 'rpg-battle-records' }, party.map(member => {
                const item = el('li', { className: 'rpg-battle-record rpg-battle-member' }, [
                    el('div', { className: 'rpg-battle-record-head' }, [
                        el('span', { className: 'rpg-battle-record-name', text: member.name ?? member.sheet.name ?? '' }),
                        el('span', { className: 'rpg-battle-tag', text: `Lv ${num(member.sheet.level, 1)}` }),
                        member.role ? el('span', { className: 'rpg-battle-tag is-quiet', text: member.role }) : null,
                    ]),
                    bar('hp', member.sheet.hp?.cur, member.sheet.hp?.max, `${member.name ?? ''} HP`),
                    memberControls(member, handlers),
                ]);
                if (member.id) item.dataset.memberId = member.id;
                return item;
            })),
        ]));
    }

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

    root.append(el('div', { className: 'rpg-battle-actions' }, [
        button('Start fight', 'rpg-battle-primary rpg-battle-start', { iconName: 'fa-dragon', onClick: () => emit(handlers, 'onSetup') }),
        button('Learn skill', 'rpg-battle-learn', { iconName: 'fa-book', onClick: () => emit(handlers, 'onLearn') }),
        button('Use item', 'rpg-battle-items', { iconName: 'fa-flask', onClick: () => emit(handlers, 'onItems') }),
        button('Add companion', 'rpg-battle-add-companion', { iconName: 'fa-user-plus', onClick: () => emit(handlers, 'onCompanion') }),
    ]));
    // HP and MP come back when the story says so: story time heals on its own (with Story
    // Director), and these are for what the clock cannot see.
    root.append(section('is-rest', [
        sub('Rest', 'fa-bed'),
        el('div', { className: 'rpg-battle-actions' }, [
            button('Short rest', 'rpg-battle-rest-short', { iconName: 'fa-mug-hot', title: 'An hour or so: a quarter of max HP and MP back', onClick: () => emit(handlers, 'onRest', 'short') }),
            button('Long rest', 'rpg-battle-rest-long', { iconName: 'fa-moon', title: 'A night\'s sleep: full HP and MP, fight conditions end', onClick: () => emit(handlers, 'onRest', 'long') }),
        ]),
    ]));
}

// A companion's control mode (tap to switch) and Remove, which asks twice.
let removeArmed = null;

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
    return el('div', { className: 'rpg-battle-member-actions' }, [toggle, remove]);
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
// companion: a new companion joins

let companionDraft = null;

function renderCompanion(root, view, handlers) {
    const presets = list(view.presets);
    if (!companionDraft) companionDraft = { name: '', role: '', control: 'auto', level: num(view.level, 1), preset: presets[0]?.id ?? '', gear: '' };
    const draft = companionDraft;
    const name = el('input', { className: 'text_pole rpg-battle-companion-name', attrs: { type: 'text', maxlength: '40', placeholder: 'Name', 'aria-label': 'Companion name' } });
    name.value = draft.name;
    const role = el('input', { className: 'text_pole rpg-battle-companion-role', attrs: { type: 'text', maxlength: '30', placeholder: 'companion, hireling, familiar…', 'aria-label': 'Role' } });
    role.value = draft.role;
    const level = select('rpg-battle-companion-level', 'Level', Array.from({ length: Math.max(1, num(view.maxLevel, 20)) }, (_, i) => [String(i + 1), `Level ${i + 1}`]), String(draft.level));
    const preset = select('rpg-battle-companion-preset', 'Build', presets.map(entry => [entry.id, `${entry.name} — ${list(entry.skills).join(', ')}`]), draft.preset);
    const control = select('rpg-battle-companion-control', 'Control', [['auto', 'Acts on its own'], ['command', 'I command it']], draft.control);
    const gear = el('textarea', { className: 'text_pole rpg-battle-companion-gear', attrs: { rows: '3', placeholder: 'Ashwood Staff (rare) · MATK +7\nTraveller\'s Robe (common) · DEF +2', 'aria-label': 'Equipment, one per line' } });
    gear.value = draft.gear;
    const add = button('Add to the party', 'rpg-battle-primary rpg-battle-companion-add', { iconName: 'fa-user-plus' });
    const sync = () => { add.disabled = !str(draft.name) || !draft.preset; };
    name.addEventListener('input', () => { draft.name = name.value; sync(); });
    role.addEventListener('input', () => { draft.role = role.value; });
    level.addEventListener('change', () => { draft.level = num(level.value, 1); });
    preset.addEventListener('change', () => { draft.preset = preset.value; sync(); });
    control.addEventListener('change', () => { draft.control = control.value; });
    gear.addEventListener('input', () => { draft.gear = gear.value; });
    add.addEventListener('click', () => {
        if (add.disabled) return;
        emit(handlers, 'onAddCompanion', { name: str(draft.name), role: str(draft.role) || 'companion', control: draft.control, level: draft.level, presetId: draft.preset, gearLines: draft.gear });
    });
    sync();
    const field = (label, control, hint) => el('label', { className: 'rpg-battle-field' }, [
        el('span', { className: 'rpg-battle-field-label', text: label }),
        control,
        hint ? el('small', { className: 'rpg-battle-hint', text: hint }) : null,
    ]);
    root.append(section('is-companion', [
        sub('New companion', 'fa-user-plus'),
        el('p', { className: 'rpg-battle-hint', text: 'Someone the story brought along. They join at the level you pick, built like the preset, and level with you from then on.' }),
        field('Name', name),
        field('Role', role),
        field('Level', level, `Your level is ${num(view.level, 1)}.`),
        field('Build', preset, 'Spreads their points and gives three starter skills.'),
        field('Control', control),
        field('Equipment', gear, 'Optional, one item per line: name (rarity) · stats. Capped by rarity like yours.'),
    ]));
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        add,
        button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
    ]));
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

    const remainingNode = el('span', { className: 'rpg-battle-remaining', attrs: { 'aria-live': 'polite' } });
    const steppers = STATS.map(stat => stepper(stat, {
        hint: STAT_HINTS[stat],
        onMinus: () => { if (alloc[stat] > 0) { alloc[stat] -= 1; refresh(); } },
        onPlus: () => { if (used() < budget) { alloc[stat] += 1; refresh(); } },
    }));
    const preview = previewList();
    const confirm = button('Confirm', 'rpg-battle-primary rpg-battle-confirm', {
        iconName: 'fa-check',
        onClick: () => { if (used() > 0 && used() <= budget) emit(handlers, 'onConfirmSpend', { ...alloc }); },
    });

    function refresh() {
        const left = budget - used();
        remainingNode.textContent = `${left} of ${budget} points left`;
        remainingNode.classList.toggle('is-done', left === 0);
        for (const step of steppers) {
            const stat = step.row.dataset.stat;
            const added = alloc[stat];
            step.value.textContent = String(base[stat] + added);
            step.minus.disabled = added <= 0;
            step.plus.disabled = left <= 0;
            step.extra.textContent = added ? `+${added}` : '';
            step.row.classList.toggle('is-changed', added > 0);
        }
        const after = Object.fromEntries(STATS.map(stat => [stat, base[stat] + alloc[stat]]));
        fillPreview(preview, previewRows(numbersFor(base, level, rules, { hpBonus, mpBonus }), numbersFor(after, level, rules, { hpBonus, mpBonus })), true);
        confirm.disabled = used() === 0;
    }

    root.append(
        section('is-spend', [
            el('div', { className: 'rpg-battle-sub-row' }, [sub('Spend points', 'fa-plus'), remainingNode]),
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
    const sheet = view.sheet ?? { stats: {}, skills: [] };
    const known = name => list(sheet.skills).some(entry => sameName(entry?.name ?? entry, name));
    if (!learnDraft) learnDraft = { name: '', type: 'physical', stat: 'STR', target: 'one', touched: {} };
    const draft = learnDraft;

    // Library: by tier, the reader's next steps open first.
    const library = list(view.library).filter(skill => skill && str(skill.name));
    const tiers = [...new Set(library.map(skill => num(skill.tier, 1)))].sort((a, b) => a - b);
    const tierFolds = tiers.map(tier => {
        const skills = library.filter(skill => num(skill.tier, 1) === tier);
        const learnable = skills.filter(skill => !known(skill.name) && requirementCheck(sheet.stats, skill).ok).length;
        const items = skills.map(skill => {
            const check = requirementCheck(sheet.stats, skill);
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
                        text: `${stat} ${num(need)}${met ? '' : ` (you have ${num(sheet.stats?.[stat])})`}`,
                        title: met ? `${stat} ${num(need)}: met` : `${stat} ${num(need)}: not met`,
                    });
                })) : null,
                el('div', { className: 'rpg-battle-record-actions' }, [
                    button('Learn', 'rpg-battle-learn-library', {
                        iconName: 'fa-book',
                        title: `Learn ${skill.name}`,
                        disabled: have || !check.ok,
                        onClick: () => emit(handlers, 'onConfirmLearn', { name: skill.name, fromLibrary: true }),
                    }),
                ]),
            ]);
            item.dataset.skill = skill.name;
            return item;
        });
        return fold(`is-tier-${tier}`, `Tier ${tier}`, 'fa-layer-group', skills.length, [el('ul', { className: 'rpg-battle-records' }, items)], { open: learnable > 0 });
    });

    const nameInput = el('input', { className: 'text_pole rpg-battle-template-name', attrs: { type: 'text', maxlength: '60', placeholder: 'e.g. Tidebreaker Stance', 'aria-label': 'Skill name', autocomplete: 'off' } });
    nameInput.value = draft.name;
    const typeSelect = select('rpg-battle-template-type', 'Type', SKILL_TYPES, draft.type);
    const statSelect = select('rpg-battle-template-stat', 'Stat', STATS, draft.stat);
    const targetSelect = select('rpg-battle-template-target', 'Target', SKILL_TARGETS.map(target => [target, TARGET_LABELS[target]]), draft.target);
    const learnTemplate = button('Learn new skill', 'rpg-battle-primary rpg-battle-learn-template', {
        iconName: 'fa-feather',
        onClick: () => {
            const name = str(draft.name);
            if (!name || known(name)) return;
            emit(handlers, 'onConfirmLearn', { name, template: { type: draft.type, stat: draft.stat, target: draft.target } });
        },
    });
    const templateHint = el('p', { className: 'rpg-battle-hint', attrs: { 'aria-live': 'polite' } });
    const refresh = () => {
        const name = str(draft.name);
        learnTemplate.disabled = !name || known(name);
        templateHint.textContent = name && known(name) ? `${name} is already known.` : 'Its power, MP and cooldown are set by code for your level.';
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

    const field = (label, control) => el('label', { className: 'rpg-battle-field' }, [el('span', { className: 'rpg-battle-field-label', text: label }), control]);
    root.append(
        section('is-learn-intro', [
            sub('Learn skill', 'fa-book'),
            el('p', { className: 'rpg-battle-hint', text: 'A mentor, a scroll, a lesson from the story: take a skill from the library, or name a new one and build it from a template.' }),
        ]),
        section('is-library', [
            sub('From the library', 'fa-book-bookmark'),
            library.length ? el('div', { className: 'rpg-battle-tiers' }, tierFolds) : el('p', { className: 'rpg-battle-hint', text: 'The skill library is empty.' }),
        ]),
        section('is-template', [
            sub('New from a template', 'fa-feather'),
            field('Name', nameInput),
            el('div', { className: 'rpg-battle-field-row' }, [field('Type', typeSelect), field('Stat', statSelect), field('Target', targetSelect)]),
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
// setup: the enemies and the stakes

let setupDraft = null;

// A new row's rank is blank: a bestiary creature keeps its own rank, anything else gets the fair one.
const blankRow = () => ({ name: '', count: 1, rank: '', role: '', boss: false });

// A row offered by the story (view.prefill), made safe for the form: any name, a count of
// 1 to 9, a known rank and role or blank.
function prefillRow(row) {
    return {
        name: str(row?.name),
        count: Math.min(9, Math.max(1, Math.round(num(row?.count, 1)))),
        rank: RANKS.includes(row?.rank) ? row.rank : '',
        role: ROLES.includes(row?.role) ? row.role : '',
        boss: Boolean(row?.boss),
    };
}

function renderSetup(root, view, handlers) {
    const suggested = RANKS.includes(view.suggestedRank) ? view.suggestedRank : RANKS[0];
    // A fight from the story arrives with its rows filled in; they seed the draft once, and the
    // reader's edits are kept across redraws. A different offer starts the draft over.
    const prefill = list(view.prefill).map(prefillRow).filter(row => row.name);
    const prefillKey = prefill.length ? JSON.stringify(prefill) : '';
    if (!setupDraft || (prefillKey && setupDraft.prefillKey !== prefillKey)) {
        setupDraft = { rows: prefill.length ? prefill : [blankRow()], stakes: 'normal', prefillKey };
    }
    const draft = setupDraft;
    const names = list(view.bestiary).map(entry => str(entry?.name ?? entry)).filter(Boolean);
    const listId = 'rpg-battle-bestiary';
    const datalist = el('datalist', { attrs: { id: listId } }, names.map(name => option(name)));

    const named = () => draft.rows.filter(row => str(row.name));
    const start = button('Start', 'rpg-battle-primary rpg-battle-begin', {
        iconName: 'fa-dragon',
        onClick: () => {
            const rows = named().map(row => ({
                name: str(row.name),
                count: Math.min(9, Math.max(1, Math.round(num(row.count, 1)))),
                rank: row.rank || null,
                role: row.role || null,
                boss: Boolean(row.boss),
            }));
            if (rows.length) emit(handlers, 'onStart', { rows, stakes: draft.stakes === 'death' ? 'death' : 'normal' });
        },
    });
    const summary = el('p', { className: 'rpg-battle-hint rpg-battle-setup-summary', attrs: { 'aria-live': 'polite' } });
    const refresh = () => {
        const rows = named();
        const total = rows.reduce((sum, row) => sum + num(row.count, 1), 0);
        start.disabled = !rows.length;
        summary.textContent = rows.length ? `${total} ${total === 1 ? 'enemy' : 'enemies'}.` : 'Name at least one enemy.';
    };

    const rowNodes = draft.rows.map((row, index) => {
        const label = `Enemy ${index + 1}`;
        const nameInput = el('input', { className: 'text_pole rpg-battle-enemy-name', attrs: { type: 'text', list: listId, maxlength: '60', placeholder: 'Name (any name works)', 'aria-label': `${label} name`, autocomplete: 'off' } });
        nameInput.value = row.name;
        nameInput.addEventListener('input', () => { row.name = nameInput.value; refresh(); });
        const count = select('rpg-battle-enemy-count', `${label} count`, Array.from({ length: 9 }, (_, i) => [String(i + 1), `×${i + 1}`]), String(row.count));
        count.addEventListener('change', () => { row.count = Math.min(9, Math.max(1, num(count.value, 1))); refresh(); });
        const rank = select('rpg-battle-enemy-rank', `${label} rank`, [['', `auto (fair: ${suggested})`], ...RANKS.map(value => [value, value === suggested ? `${value} (fair)` : value])], row.rank);
        rank.addEventListener('change', () => { row.rank = rank.value; });
        const role = select('rpg-battle-enemy-role', `${label} role`, [['', 'auto role'], ...ROLES], row.role);
        role.addEventListener('change', () => { row.role = role.value; });
        const boss = el('input', { className: 'rpg-battle-enemy-boss', attrs: { type: 'checkbox', 'aria-label': `${label} is a boss` } });
        boss.checked = Boolean(row.boss);
        boss.addEventListener('change', () => { row.boss = Boolean(boss.checked); });
        const remove = button('', 'rpg-battle-icon-button rpg-battle-remove-row', {
            iconName: 'fa-trash-can',
            title: `Remove ${label.toLowerCase()}`,
            onClick: () => {
                draft.rows.splice(index, 1);
                if (!draft.rows.length) draft.rows.push(blankRow());
                rerender();
            },
        });
        const item = el('li', { className: 'rpg-battle-enemy-row' }, [
            el('div', { className: 'rpg-battle-enemy-line' }, [nameInput, remove]),
            el('div', { className: 'rpg-battle-enemy-line is-options' }, [
                count, rank, role,
                el('label', { className: 'rpg-battle-check' }, [boss, el('span', { text: 'Boss' })]),
            ]),
        ]);
        item.dataset.row = String(index);
        return item;
    });

    const stakes = [
        { value: 'normal', label: 'Normal', note: 'Defeat means the story decides: captured, robbed, left for dead.' },
        { value: 'death', label: 'To the death', note: 'Defeat is death, and the hand-off says so.' },
    ];
    const stakeNodes = stakes.map(stake => {
        const input = el('input', { className: 'rpg-battle-stake-input', attrs: { type: 'radio', name: 'rpg-battle-stakes', value: stake.value } });
        input.value = stake.value;
        input.checked = draft.stakes === stake.value;
        input.addEventListener('change', () => { if (input.checked) draft.stakes = stake.value; });
        return el('label', { className: `rpg-battle-stake is-${stake.value}` }, [
            input,
            el('span', { className: 'rpg-battle-stake-text' }, [
                el('span', { className: 'rpg-battle-stake-name', text: stake.label }),
                el('span', { className: 'rpg-battle-stake-note', text: stake.note }),
            ]),
        ]);
    });

    root.append(
        section('is-setup', [
            sub('Enemies', 'fa-skull'),
            prefillKey ? el('p', { className: 'rpg-battle-hint rpg-battle-prefill-hint', text: 'Filled in from the story. Change anything before you start.' }) : null,
            datalist,
            el('ul', { className: 'rpg-battle-enemy-rows' }, rowNodes),
            el('div', { className: 'rpg-battle-actions' }, [
                button('Add enemy', 'rpg-battle-add-row', {
                    iconName: 'fa-plus',
                    onClick: () => { draft.rows.push(blankRow()); rerender(); },
                }),
            ]),
        ]),
        el('fieldset', { className: 'rpg-battle-section rpg-battle-stakes' }, [
            el('legend', { className: 'rpg-battle-sub' }, [icon('fa-scale-balanced'), el('span', { text: 'Stakes' })]),
            ...stakeNodes,
        ]),
        el('div', { className: 'rpg-battle-actions is-end' }, [
            summary,
            button('Back', 'rpg-battle-back', { iconName: 'fa-arrow-left', onClick: () => emit(handlers, 'onBack') }),
            start,
        ]),
    );
    refresh();
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

function combatantCard(unit, { turnId, pick, onPick }) {
    const isEnemy = unit.side === 'enemy';
    const pickable = Boolean(pick && pick.ids.includes(unit.id) && !unit.gone);
    const classes = ['rpg-battle-card', isEnemy ? 'is-enemy' : 'is-party'];
    if (unit.gone) classes.push('is-gone', `is-${unit.gone}`);
    if (unit.id === turnId) classes.push('is-turn');
    if (unit.boss) classes.push('is-boss');
    if (pickable) classes.push('is-pickable');
    const badges = [];
    if (isEnemy) {
        const rankRole = [unit.rank, unit.role].filter(Boolean).join(' · ');
        if (rankRole) badges.push(el('span', { className: 'rpg-battle-badge', text: rankRole }));
        if (unit.boss) badges.push(el('span', { className: 'rpg-battle-badge is-boss' }, [icon('fa-crown'), el('span', { text: 'boss' })]));
    } else if (unit.controller === 'auto') {
        badges.push(el('span', { className: 'rpg-battle-badge is-quiet', text: 'auto' }));
    }
    if (unit.gone) badges.push(el('span', { className: 'rpg-battle-badge is-gone', text: unit.gone }));
    const card = el('li', { className: classes.join(' ') }, [
        el('div', { className: 'rpg-battle-card-head' }, [
            unit.id === turnId ? icon('fa-caret-right') : null,
            el('span', { className: 'rpg-battle-card-name', text: unit.name ?? '' }),
            ...badges,
        ]),
        bar('hp', unit.hp?.cur, unit.hp?.max, `${unit.name ?? ''} HP`),
        !isEnemy ? bar('mp', unit.mp?.cur, unit.mp?.max, `${unit.name ?? ''} MP`) : null,
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
    const cardOptions = { turnId, pick, onPick: pickTarget };
    const enemies = units.filter(unit => unit.side === 'enemy');
    const party = units.filter(unit => unit.side !== 'enemy');

    // Turn order: who acts this round, the current one marked.
    const order = list(fight.order).filter(id => byId.has(id));
    const strip = order.length ? el('ol', { className: 'rpg-battle-order', attrs: { 'aria-label': `Turn order, round ${num(fight.round, 1)}` } }, order.map((id, index) => {
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
    if (strip) root.append(section('is-order', [sub('Turn order', 'fa-list-ol'), strip]));
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
                    if (full) parts.push(`${num(full.mp)} MP`);
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

// The first click on Discard arms it; the second, on the same result, discards.
let discardArmed = null;

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

function renderResult(root, view, handlers) {
    const result = view.result;
    if (!result) {
        root.append(el('p', { className: 'rpg-battle-empty', text: 'No result.' }));
        return;
    }
    if (discardArmed && discardArmed !== result) discardArmed = null;
    const outcome = result.outcome ?? 'victory';
    const rounds = num(result.rounds);
    const seconds = num(result.seconds);

    root.append(section(`is-outcome is-${outcome}`, [
        el('h3', { className: `rpg-battle-outcome is-${outcome}`, text: OUTCOME_TITLES[outcome] ?? outcome }),
        el('p', { className: 'rpg-battle-hint', text: `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · about ${seconds} seconds${result.stakes === 'death' ? ' · to the death' : ''}` }),
    ]));

    const party = list(result.party);
    if (party.length) {
        root.append(section('is-after', [
            sub('After the fight', 'fa-heart-pulse'),
            el('ul', { className: 'rpg-battle-records' }, party.map(member => {
                const item = el('li', { className: `rpg-battle-record rpg-battle-after${member.down ? ' is-down' : ''}` }, [
                    el('div', { className: 'rpg-battle-record-head' }, [
                        el('span', { className: 'rpg-battle-record-name', text: member.name ?? '' }),
                        member.down ? el('span', { className: 'rpg-battle-badge is-gone', text: 'down' }) : null,
                    ]),
                    bar('hp', member.hp?.cur, member.hp?.max, `${member.name ?? ''} HP`),
                    bar('mp', member.mp?.cur, member.mp?.max, `${member.name ?? ''} MP`),
                    chips(member.conditions),
                ]);
                if (member.memberId) item.dataset.memberId = member.memberId;
                return item;
            })),
        ]));
    }

    // XP, level-ups and points: per member when the glue gives a map, else one line for the PC.
    const xp = result.xp && typeof result.xp === 'object' ? result.xp : {};
    const xpRows = [];
    const xpValues = Object.values(xp).map(value => num(value));
    if (xpValues.length && xpValues.every(value => value === xpValues[0])) {
        if (xpValues[0] > 0) xpRows.push(['XP', `+${xpValues[0]}${xpValues.length > 1 ? ' each' : ''}`]);
    } else {
        for (const [memberId, value] of Object.entries(xp)) {
            const name = party.find(member => member.memberId === memberId)?.name ?? memberId;
            xpRows.push([`${name} XP`, `+${num(value)}`]);
        }
    }
    const levels = typeof view.levelsGained === 'object' && view.levelsGained ? null : num(view.levelsGained);
    const points = typeof view.pointsGained === 'object' && view.pointsGained ? null : num(view.pointsGained);
    if (levels) xpRows.push(['Level', `+${levels}${levels === 1 ? ' level' : ' levels'}`]);
    if (points) xpRows.push(['Points', `${points} to spend`]);
    for (const member of party) {
        const memberLevels = perMember(view.levelsGained, member.memberId);
        const memberPoints = perMember(view.pointsGained, member.memberId);
        if (memberLevels) xpRows.push([`${member.name ?? ''}`, `+${memberLevels} ${memberLevels === 1 ? 'level' : 'levels'}${memberPoints ? `, ${memberPoints} points to spend` : ''}`]);
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

    const armed = discardArmed === result;
    const discard = button(armed ? 'Click again to discard' : 'Discard result', `rpg-battle-discard${armed ? ' is-armed' : ''}`, {
        iconName: 'fa-trash-can',
        onClick: () => {
            if (discardArmed === result) {
                discardArmed = null;
                emit(handlers, 'onDiscard');
                return;
            }
            discardArmed = result;
            rerender();
        },
    });
    root.append(el('div', { className: 'rpg-battle-actions' }, [
        button('Return to story', 'rpg-battle-primary rpg-battle-return', { iconName: 'fa-book-open', onClick: () => emit(handlers, 'onReturn') }),
        discard,
        button('Done', 'rpg-battle-done', { iconName: 'fa-check', onClick: () => emit(handlers, 'onDone') }),
    ]));
}

// ---------------------------------------------------------------------------

const RENDERERS = {
    create: renderCreate,
    idle: renderIdle,
    spend: renderSpend,
    learn: renderLearn,
    items: renderItems,
    companion: renderCompanion,
    setup: renderSetup,
    fight: renderFight,
    result: renderResult,
};

/**
 * Render the Battle tab into `pane` (Story Block calls tab.render(pane) and leaves the
 * pane's content to us). `view.mode` picks the screen; `handlers` are optional callbacks.
 */
export function renderBattleTab(pane, view, handlers = {}) {
    if (!pane) return;
    const mode = view?.mode ?? '';
    // Drafts belong to their mode: coming back later starts clean.
    if (mode !== 'create') createDraft = null;
    if (mode !== 'spend') spendDraft = null;
    if (mode !== 'learn') learnDraft = null;
    if (mode !== 'setup') setupDraft = null;
    if (mode !== 'fight') fightUi = null;
    if (mode !== 'result') discardArmed = null;
    if (mode !== 'companion') companionDraft = null;
    if (mode !== 'items') itemsTarget = null;
    if (mode !== 'idle') removeArmed = null;

    const root = el('div', { className: `rpg-battle-tab is-${mode || 'none'}` });
    root.dataset.mode = mode;
    current = { pane, view, handlers: handlers ?? {}, root };
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
