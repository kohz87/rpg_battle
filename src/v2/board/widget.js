// rpg-battle.battle-board (SPEC §13.5, MODULES §F9): the fight as the reader plays it. A port of v1's
// battle screen (src/ui/tab.js renderFight / renderResult) to the widget contract of Story Block's
// standard widgets (WIDGETS.md): `{ props, primary, render(el, props, api) → { update, destroy }, validate }`.
//
// It draws the `combat.session` view (src/v2/combat/view.js), or the richer `combat.board` view of
// this part (costs, cooldowns, condition turns, the result's loot and XP): the two sides with
// portraits, HP/MP/SP meters and conditions; the turn order; the acting member's actions with
// target selection and the numbers an attack would do; the last lines of the log; and, once the
// fight is over, the result with Finish. Every click is a command through `api.command`
// (`combat.act { action, session, board, logLength }`, `combat.end { session }`); the board never touches the state.
//
// What the reader is in the middle of (an open skill list, the target being picked, the log's scroll
// position, the focused button) survives an update that does not move the fight on.

import { levelTag } from '../../terms.js';
import {
    clamp, docOf, ensureStyles, findWidget, h, icon, initials, isPlain, list, num, propProblems, resolveProps, slug, str, tidy,
} from './dom.js';

export const WIDGET_NAME = 'rpg-battle.battle-board';
export const LOG_LINES = 8;
const MAX_LOG_LINES = 40;

export const OUTCOME_TITLES = Object.freeze({ won: 'Victory', lost: 'Defeated', fled: 'Escaped' });
const REASON_LABELS = { mp: 'Not enough MP', sp: 'Not enough SP', cooldown: 'On cooldown', stunned: 'Stunned' };
const TARGET_LABELS = { one: 'one enemy', all: 'all enemies', self: 'self', ally: 'one ally', allies: 'all allies' };
const TYPE_ICONS = { physical: 'fa-hand-fist', magic: 'fa-wand-sparkles', heal: 'fa-heart-pulse', buff: 'fa-arrow-trend-up', debuff: 'fa-arrow-trend-down' };
// Conditions that help whoever has them (v1's names and the session view's labels).
const HELPFUL = new Set(['shield', 'shielded', 'regen', 'regenerating', 'guard', 'on-guard']);

// The rules the level tag is read with: the chat's terms (MODULES §F25) over v1's plain Lv and XP.
const termRules = terms => ({ terms: isPlain(terms) ? terms : {}, character: { maxLevel: 999 } });
const xpWord = terms => (isPlain(terms) && str(terms.xpName) && str(terms.xpName) !== 'XP' ? str(terms.xpName) : 'XP');

const props = {
    // The fight: the fields of the combat.session (or combat.board) view. A bound view is unfolded.
    combatants: { type: 'array', required: true, default: [] },
    id: { type: 'string', default: '' },
    status: { type: 'string', default: 'active' },
    round: { type: 'number', default: 1 },
    stakes: { type: 'string', default: 'normal' },
    place: { type: 'string', default: '' },
    order: { type: 'array', default: [] },
    turn: { type: 'object', default: null },
    turnIndex: { type: 'number', default: null },
    turns: { type: 'string', default: '' },
    actions: { type: 'object', default: null },
    log: { type: 'array', default: [] },
    logLength: { type: 'number', default: 0 },
    board: { type: 'string', default: '' },        // the view's moment token (combat.act refuses a stale one)
    result: { type: 'object', default: null },
    // The whole view as one prop, for a caller that does not bind it.
    session: { type: 'object', default: null },
    // How it is shown.
    logLines: { type: 'number', default: LOG_LINES },
    portraits: { type: 'object', default: null },   // { [combatant id or name]: image URL } for ss.portrait
    currency: { type: 'string', default: '' },      // the money's name when the view does not say
    terms: { type: 'object', default: null },       // party.terms ({ levelName, xpName, tiers }); combat.board carries it
    label: { type: 'string', default: 'Battle' },
};

/**
 * The props as the board reads them: a bound `value` (the view) and a `session` prop are unfolded
 * into their fields, and the props given beside them win (WIDGETS.md "Bound values").
 */
function prepare(input) {
    let source = isPlain(input) ? input : {};
    if ('value' in source) {
        const { value, ...rest } = source;
        if (isPlain(value)) source = { ...value, ...rest };
        else if (Array.isArray(value) && rest.combatants === undefined) source = { ...rest, combatants: value };
        else source = rest;
    }
    if (isPlain(source.session)) {
        const { session, ...rest } = source;
        source = { ...session, ...rest };
    }
    return source;
}

// --- reading the view ------------------------------------------------------------------------

/** A condition as { name, label, turns } from a view's string label or { name|kind, label, turns|rounds }. */
function conditionOf(entry) {
    if (typeof entry === 'string') return entry ? { name: entry, label: entry, turns: null } : null;
    if (!isPlain(entry)) return null;
    const name = str(entry.name) || str(entry.kind);
    if (!name) return null;
    const turns = entry.turns ?? entry.rounds;
    return { name, label: str(entry.label) || name, turns: Number.isFinite(num(turns, NaN)) ? num(turns) : null };
}

/** Where an action with this scope is aimed: an enemy, an ally, the actor, or nobody to choose. */
function aimOf(scope) {
    if (scope === 'self') return 'self';
    if (scope === 'ally') return 'ally';
    if (scope === 'all' || scope === 'allies') return 'none';
    return 'enemy';
}

const pct = value => (value === null || value === undefined || !Number.isFinite(num(value, NaN)) ? '' : ` ${Math.round(num(value))}%`);

/** "Hit 63% · 8–10 dmg · Crit 12%" parts for an attack preview. */
function previewParts(preview) {
    const low = Math.round(num(preview.low));
    const high = Math.round(num(preview.high));
    return [
        ['hit', `Hit ${tidy(preview.hit)}%`],
        ['damage', `${low === high ? low : `${low}–${high}`} dmg`],
        ['crit', `Crit ${tidy(preview.crit)}%`],
    ];
}

// --- the widget ------------------------------------------------------------------------------

function render(el, input, api) {
    const doc = docOf(el);
    ensureStyles(doc);
    const root = h(doc, 'div', 'rpg-bb');
    root.setAttribute('role', 'region');
    const head = h(doc, 'div', 'rpg-bb-head');
    const orderBox = h(doc, 'div', 'rpg-bb-order-box');
    const sides = h(doc, 'div', 'rpg-bb-sides');
    const panel = h(doc, 'div', 'rpg-bb-panel');
    const logBox = h(doc, 'section', 'rpg-bb-log-box');
    const logTitle = h(doc, 'h3', 'rpg-bb-log-title');
    logTitle.append(icon(doc, 'fa-scroll'), h(doc, 'span', '', 'Log'));
    // The log element stays for the board's life: a node taken out of the page loses its scroll.
    const log = h(doc, 'ol', 'rpg-bb-log');
    log.setAttribute('aria-label', 'Fight log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('tabindex', '0');
    logBox.append(logTitle, log);
    const empty = h(doc, 'p', 'rpg-bb-empty', 'No fight under way.');
    root.append(head, orderBox, sides, panel, logBox);
    el.appendChild(root);

    // Clicks and keys are handled once on the root (nothing to unhook when the inside is redrawn):
    // each control's action is kept here, by node.
    let actionsOf = new WeakMap();
    let keyed = new Map();
    const portraits = new Map();   // combatant id → { slot, handle } drawn with ss.portrait
    let p = resolveProps(props, prepare(input));
    let ui = { key: null, menu: null, pick: null };
    let pending = false;
    let alive = true;
    let first = true;

    const canCommand = () => typeof api?.command === 'function';

    function control(node, key, fn) {
        actionsOf.set(node, fn);
        if (key) keyed.set(key, node);
        return node;
    }

    function button(className, label, { key = '', act: kind = '', iconName = '', disabled = false, onClick = null } = {}) {
        const node = h(doc, 'button', className);
        node.setAttribute('type', 'button');
        if (kind) node.setAttribute('data-act', kind);
        if (iconName) node.append(icon(doc, iconName));
        node.append(h(doc, 'span', 'rpg-bb-label', label));
        node.disabled = Boolean(disabled || pending);
        if (node.disabled) node.setAttribute('aria-disabled', 'true');
        if (onClick) control(node, key, onClick);
        return node;
    }

    function onClick(event) {
        for (let node = event.target; node && node !== root.parentNode; node = node.parentNode) {
            const fn = actionsOf.get(node);
            if (fn) {
                if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') return;
                fn(event);
                return;
            }
            if (node === root) return;
        }
    }

    function onKey(event) {
        if (event.key === 'Escape' && (ui.pick || ui.menu)) {
            event.preventDefault?.();
            cancel();
            return;
        }
        // A target card is a role="button" list item: Enter and Space press it.
        if ((event.key === 'Enter' || event.key === ' ') && event.target?.tagName !== 'BUTTON') {
            const fn = actionsOf.get(event.target);
            if (fn) {
                event.preventDefault?.();
                fn(event);
            }
        }
    }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);

    // --- commands --------------------------------------------------------------------------

    function settle() {
        if (!alive || !pending) return;
        pending = false;
        draw();
    }

    /** One command; the board waits (buttons off) until it is answered or new props arrive. */
    function send(type, payload) {
        if (pending || !canCommand()) return;
        pending = true;
        ui = { ...ui, menu: null, pick: null };
        draw();
        let result;
        try {
            result = api.command(type, payload);
        } catch {
            settle();   // the host reports its own failures
            return;
        }
        if (result && typeof result.then === 'function') result.then(settle, settle);
        else settle();
    }

    // Which fight, and which moment of it, the board showed when the choice was made (combat.act
    // refuses an action meant for another fight or for a turn already played: a stale board, a
    // second window, a double click).
    const shown = () => ({
        ...(typeof p.id === 'string' && p.id ? { session: p.id } : {}),
        ...(Number.isInteger(p.logLength) && p.logLength > 0 ? { logLength: p.logLength } : {}),
        ...(typeof p.board === 'string' && p.board ? { board: p.board } : {}),
    });
    const act = action => send('combat.act', { action, ...shown() });

    function cancel() {
        ui = { ...ui, menu: null, pick: null };
        draw();
    }

    const byId = () => new Map(list(p.combatants).filter(isPlain).map(c => [c.id, c]));

    /** Start an action: aim it, or send it straight away when there is nothing to choose (v1). */
    function choose({ type, skill = null, item = null, aim, label }) {
        const actions = p.actions ?? {};
        const actor = actions.actor ?? p.turn?.actor ?? null;
        const payload = { type, ...(skill ? { skill } : {}), ...(item ? { item } : {}) };
        if (aim === 'none') return act(payload);
        if (aim === 'self') return act(actor ? { ...payload, target: actor } : payload);
        const units = byId();
        let ids = list(aim === 'ally' ? actions.targets?.allies : actions.targets?.enemies).filter(id => units.has(id) && !units.get(id).gone);
        if (type === 'parley') {
            const talkers = ids.filter(id => units.get(id)?.talks === true);
            if (talkers.length) ids = talkers;
        }
        if (!ids.length) return undefined;
        if (ids.length === 1) return act({ ...payload, target: ids[0] });
        ui = { ...ui, menu: null, pick: { type, skill, item, side: aim, ids, label } };
        return draw();
    }

    function pickTarget(id) {
        const pick = ui.pick;
        if (!pick || !pick.ids.includes(id)) return;
        act({ type: pick.type, ...(pick.skill ? { skill: pick.skill } : {}), ...(pick.item ? { item: pick.item } : {}), target: id });
    }

    // --- drawing ---------------------------------------------------------------------------

    function meter(pool, value, name) {
        const cur = Math.max(0, Math.round(num(value?.cur)));
        const max = Math.max(0, Math.round(num(value?.max)));
        const ratio = max > 0 ? clamp(cur / max, 0, 1) : 0;
        const node = h(doc, 'div', 'rpg-bb-meter');
        node.setAttribute('data-pool', pool);
        node.setAttribute('role', 'meter');
        node.setAttribute('aria-label', `${name} ${pool.toUpperCase()}`);
        node.setAttribute('aria-valuemin', '0');
        node.setAttribute('aria-valuemax', String(max));
        node.setAttribute('aria-valuenow', String(Math.min(cur, max)));
        node.setAttribute('aria-valuetext', `${cur} of ${max}`);
        if (pool === 'hp' && max > 0 && ratio <= 0.25) node.classList.add('rpg-bb-low');
        const label = h(doc, 'span', 'rpg-bb-meter-name', pool.toUpperCase());
        const track = h(doc, 'span', 'rpg-bb-meter-track');
        track.style.setProperty('--rpg-bb-ratio', String(Math.round(ratio * 10000) / 10000));
        track.append(h(doc, 'span', 'rpg-bb-meter-fill'));
        const shown = h(doc, 'span', 'rpg-bb-meter-value', `${cur}/${max}`);
        label.setAttribute('aria-hidden', 'true');
        shown.setAttribute('aria-hidden', 'true');
        node.append(label, track, shown);
        return node;
    }

    function conditionList(conditions) {
        const items = list(conditions).map(conditionOf).filter(Boolean);
        if (!items.length) return null;
        const node = h(doc, 'ul', 'rpg-bb-conditions');
        node.setAttribute('aria-label', 'Conditions');
        for (const cond of items) {
            const kind = slug(cond.name);
            const li = h(doc, 'li', `rpg-bb-cond${HELPFUL.has(kind) || HELPFUL.has(slug(cond.label)) ? ' rpg-bb-helpful' : ''}`);
            if (kind) li.setAttribute('data-kind', kind);
            li.append(h(doc, 'span', 'rpg-bb-cond-label', cond.label));
            let spoken = cond.label;
            if (cond.turns !== null) {
                li.append(h(doc, 'span', 'rpg-bb-cond-turns', String(cond.turns)));
                spoken = `${cond.label}: ${cond.turns} ${cond.turns === 1 ? 'turn' : 'turns'} left`;
            }
            li.setAttribute('aria-label', spoken);
            li.setAttribute('title', spoken);
            node.append(li);
        }
        return node;
    }

    /** The picture: Story Block's ss.portrait when the host lends it, else the name's initials. */
    function portraitOf(unit, seen) {
        const widget = findWidget(api?.widgets, 'ss.portrait');
        if (!widget) {
            const node = h(doc, 'span', 'rpg-bb-portrait rpg-bb-initials', initials(unit.name));
            node.setAttribute('aria-hidden', 'true');
            return node;
        }
        const given = p.portraits ?? {};
        const src = [given[unit.id], given[unit.name], unit.portrait].find(value => typeof value === 'string' && value) ?? '';
        const portraitProps = { src, name: str(unit.name), frame: 'circle', size: 'sm', tone: unit.side === 'enemy' ? 'bad' : 'accent' };
        seen.add(unit.id);
        let entry = portraits.get(unit.id);
        try {
            if (entry) entry.handle?.update?.(portraitProps);
            else {
                const slot = h(doc, 'span', 'rpg-bb-portrait');
                entry = { slot, handle: widget.render(slot, portraitProps, {}) ?? null };
                portraits.set(unit.id, entry);
            }
        } catch {
            entry = entry ?? { slot: h(doc, 'span', 'rpg-bb-portrait rpg-bb-initials', initials(unit.name)), handle: null };
            portraits.set(unit.id, entry);
        }
        return entry.slot;
    }

    function dropPortraits(seen) {
        for (const [id, entry] of portraits) {
            if (seen.has(id)) continue;
            try { entry.handle?.destroy?.(); } catch { /* a portrait's cleanup never breaks the board */ }
            portraits.delete(id);
        }
    }

    function card(unit, { turnId, aimed, seen }) {
        const isEnemy = unit.side === 'enemy';
        const pick = ui.pick;
        const pickable = Boolean(pick && pick.ids.includes(unit.id) && !unit.gone && !pending);
        const node = h(doc, 'li', 'rpg-bb-card');
        node.setAttribute('data-side', isEnemy ? 'enemy' : 'party');
        node.setAttribute('data-id', str(unit.id).slice(0, 64));
        if (unit.id === turnId) {
            node.classList.add('rpg-bb-turn');
            node.setAttribute('aria-current', 'true');
        }
        if (unit.gone) node.classList.add('rpg-bb-gone');
        if (unit.boss) node.classList.add('rpg-bb-boss');

        const tags = h(doc, 'span', 'rpg-bb-tags');
        const tag = (text, extra = '') => tags.append(h(doc, 'span', `rpg-bb-tag${extra}`, text));
        if (num(unit.level, 0) >= 1) tag(levelTag(Math.round(num(unit.level)), termRules(p.terms)));
        if (isEnemy && str(unit.threat)) tag(str(unit.threat));
        if (unit.boss) tag('boss', ' rpg-bb-boss');
        if (unit.fresh) tag('new');
        if (!isEnemy && unit.controller === 'auto') tag('auto');
        if (unit.gone) tag(str(unit.gone), ' rpg-bb-gone-tag');
        const title = h(doc, 'div', 'rpg-bb-card-title');
        title.append(h(doc, 'span', 'rpg-bb-name', str(unit.name)), tags);
        const cardHead = h(doc, 'div', 'rpg-bb-card-head');
        cardHead.append(portraitOf(unit, seen), title);
        node.append(cardHead, meter('hp', unit.hp, str(unit.name)));
        if (!isEnemy && unit.mp) node.append(meter('mp', unit.mp, str(unit.name)));
        if (!isEnemy && unit.sp) node.append(meter('sp', unit.sp, str(unit.name)));
        const preview = pickable && isEnemy ? aimed?.[unit.id] : null;
        if (isPlain(preview)) {
            const line = h(doc, 'div', 'rpg-bb-preview');
            line.setAttribute('role', 'note');
            for (const [part, text] of previewParts(preview)) {
                const span = h(doc, 'span', 'rpg-bb-preview-part', text);
                span.setAttribute('data-part', part);
                line.append(span);
            }
            node.append(line);
        }
        const conds = conditionList(unit.conditions);
        if (conds) node.append(conds);
        if (pickable) {
            // The whole card is the target button: big enough for a thumb, and it is what the eye is on.
            node.classList.add('rpg-bb-pickable');
            node.setAttribute('role', 'button');
            node.setAttribute('tabindex', '0');
            node.setAttribute('aria-label', `Target ${str(unit.name)}`);
            control(node, `target:${unit.id}`, () => pickTarget(unit.id));
        }
        return node;
    }

    function drawHead() {
        const parts = [h(doc, 'span', 'rpg-bb-round', `Round ${Math.max(1, Math.round(num(p.round, 1)))}`)];
        if (str(p.place)) parts.push(h(doc, 'span', 'rpg-bb-place', p.place));
        if (p.stakes === 'death') parts.push(h(doc, 'span', 'rpg-bb-tag rpg-bb-death', 'to the death'));
        head.replaceChildren(...parts);
    }

    function drawOrder(units, turnId) {
        const ids = list(p.order).filter(id => units.has(id));
        if (!ids.length) {
            orderBox.replaceChildren();
            orderBox.hidden = true;
            return;
        }
        orderBox.hidden = false;
        const active = p.status === 'active';
        const timeline = p.turns === 'timeline';
        let current = Number.isInteger(p.turnIndex) && ids[p.turnIndex] !== undefined ? p.turnIndex : ids.indexOf(turnId);
        if (!active) current = -1;
        const strip = h(doc, 'ol', 'rpg-bb-order');
        strip.setAttribute('aria-label', timeline ? 'Next turns' : `Turn order, round ${Math.max(1, Math.round(num(p.round, 1)))}`);
        ids.forEach((id, index) => {
            const unit = units.get(id);
            const item = h(doc, 'li', 'rpg-bb-order-item', str(unit.name));
            item.setAttribute('data-side', unit.side === 'enemy' ? 'enemy' : 'party');
            if (index === current) {
                item.classList.add('rpg-bb-current');
                item.setAttribute('aria-current', 'step');
            } else if (!timeline && current >= 0 && index < current) item.classList.add('rpg-bb-done');
            if (unit.gone) item.classList.add('rpg-bb-gone');
            strip.append(item);
        });
        const title = h(doc, 'h3', 'rpg-bb-order-title');
        title.append(icon(doc, 'fa-list-ol'), h(doc, 'span', '', timeline ? 'Next turns' : 'Turn order'));
        orderBox.replaceChildren(title, strip);
    }

    function drawSides(units, turnId) {
        const pick = ui.pick;
        const actions = p.actions ?? {};
        const aimed = pick?.side === 'enemy'
            ? (pick.type === 'attack' ? actions.previews?.attack : pick.type === 'skill' ? actions.previews?.skills?.[pick.skill] : null)
            : null;
        const seen = new Set();
        const side = (key, title, iconName, members) => {
            const box = h(doc, 'section', 'rpg-bb-side');
            box.setAttribute('data-side', key);
            if (pick && (pick.side === 'enemy' ? 'enemy' : 'party') === key) box.classList.add('rpg-bb-picking');
            const heading = h(doc, 'h3', 'rpg-bb-side-title');
            heading.append(icon(doc, iconName), h(doc, 'span', '', title));
            if (key === 'enemy') heading.append(h(doc, 'span', 'rpg-bb-count', String(members.filter(unit => !unit.gone).length)));
            const cards = h(doc, 'ul', 'rpg-bb-cards');
            cards.setAttribute('aria-label', title);
            for (const unit of members) cards.append(card(unit, { turnId, aimed: isPlain(aimed) ? aimed : null, seen }));
            box.append(heading, cards);
            return box;
        };
        const all = [...units.values()];
        sides.replaceChildren(
            side('enemy', 'Enemies', 'fa-skull', all.filter(unit => unit.side === 'enemy')),
            side('party', 'Party', 'fa-users', all.filter(unit => unit.side !== 'enemy')),
        );
        dropPortraits(seen);
    }

    function skillEntry(skill) {
        const usable = skill.usable !== false;
        const meta = [];
        if (num(skill.cost, 0) > 0) meta.push(`${Math.round(num(skill.cost))} ${str(skill.pool).toUpperCase() || 'MP'}`);
        if (num(skill.cooldown, 0) > 0) meta.push(`cooldown ${Math.round(num(skill.cooldown))}`);
        if (TARGET_LABELS[skill.target]) meta.push(TARGET_LABELS[skill.target]);
        let reason = '';
        if (!usable) {
            const left = Math.round(num(skill.cooldownLeft, 0));
            reason = skill.reason === 'cooldown' && left > 0 ? `Cooldown: ${left} ${left === 1 ? 'round' : 'rounds'}` : REASON_LABELS[skill.reason] ?? 'Not usable now';
        }
        return entry({
            key: `skill:${skill.name}`, iconName: TYPE_ICONS[skill.type] ?? 'fa-wand-sparkles', name: skill.name,
            tag: num(skill.mastery, 0) > 1 ? `Lv ${Math.round(num(skill.mastery))}` : '', meta, reason, usable,
            onClick: () => choose({ type: 'skill', skill: skill.name, aim: aimOf(skill.target), label: str(skill.name) }),
        });
    }

    function itemEntry(item) {
        const meta = [`×${Math.round(num(item.qty, 1))}`];
        if (TARGET_LABELS[item.target]) meta.push(TARGET_LABELS[item.target]);
        return entry({
            key: `item:${item.name}`, iconName: 'fa-flask', name: item.name, tag: '', meta, reason: '', usable: true,
            onClick: () => choose({ type: 'item', item: item.name, aim: aimOf(item.target), label: str(item.name) }),
        });
    }

    function entry({ key, iconName, name, tag, meta, reason, usable, onClick }) {
        const node = h(doc, 'button', `rpg-bb-entry${usable ? '' : ' rpg-bb-unusable'}`);
        node.setAttribute('type', 'button');
        const top = h(doc, 'span', 'rpg-bb-entry-head');
        top.append(icon(doc, iconName), h(doc, 'span', 'rpg-bb-entry-name', str(name)));
        if (tag) top.append(h(doc, 'span', 'rpg-bb-tag', tag));
        node.append(top);
        if (meta.length) node.append(h(doc, 'span', 'rpg-bb-entry-meta', meta.join(' · ')));
        if (reason) node.append(h(doc, 'span', 'rpg-bb-entry-reason', reason));
        node.disabled = !usable || pending;
        if (node.disabled) node.setAttribute('aria-disabled', 'true');
        return control(node, key, onClick);
    }

    function drawActions(units) {
        const actions = p.actions ?? {};
        const actorId = actions.actor ?? p.turn?.actor ?? null;
        const actor = units.get(actorId) ?? null;
        const name = str(actor?.name) || str(p.turn?.name);
        const bar = h(doc, 'div', 'rpg-bb-actions');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', `Actions for ${name}`);
        bar.append(h(doc, 'div', 'rpg-bb-actor', `${name}’s turn`));
        const pick = ui.pick;
        if (pick) {
            const row = h(doc, 'div', 'rpg-bb-picking');
            const text = h(doc, 'span', 'rpg-bb-picking-text', `${pick.label}: tap ${pick.side === 'ally' ? 'an ally' : 'an enemy'}.`);
            text.setAttribute('role', 'status');
            row.append(text, button('rpg-bb-cancel', 'Cancel', { key: 'cancel', iconName: 'fa-xmark', onClick: cancel }));
            bar.append(row);
            return bar;
        }
        const skills = list(actions.skills).filter(isPlain);
        const items = list(actions.items).filter(item => isPlain(item) && num(item.qty, 1) > 0);
        const enemies = list(actions.targets?.enemies);
        if (ui.menu === 'skill' || ui.menu === 'item') {
            const isSkill = ui.menu === 'skill';
            const menu = h(doc, 'div', `rpg-bb-menu rpg-bb-menu-${ui.menu}`);
            const menuHead = h(doc, 'div', 'rpg-bb-menu-head');
            const menuTitle = h(doc, 'h3', 'rpg-bb-menu-title');
            menuTitle.append(icon(doc, isSkill ? 'fa-wand-sparkles' : 'fa-flask'), h(doc, 'span', '', isSkill ? 'Skills' : 'Items'));
            menuHead.append(menuTitle, button('rpg-bb-cancel', 'Close', { key: 'close', iconName: 'fa-xmark', onClick: cancel }));
            const entries = isSkill ? skills.map(skillEntry) : items.map(itemEntry);
            const body = entries.length ? h(doc, 'div', 'rpg-bb-menu-list') : h(doc, 'p', 'rpg-bb-hint', isSkill ? 'No skills.' : 'No items.');
            body.append(...entries);
            menu.append(menuHead, body);
            bar.append(menu);
        }
        const openMenu = menu => {
            ui = { ...ui, menu: ui.menu === menu ? null : menu, pick: null };
            draw();
        };
        const grid = h(doc, 'div', 'rpg-bb-grid');
        const skillButton = button('rpg-bb-act', 'Skill', { key: 'act:skill', act: 'skill', iconName: 'fa-wand-sparkles', disabled: !skills.length, onClick: () => openMenu('skill') });
        skillButton.setAttribute('aria-expanded', String(ui.menu === 'skill'));
        const itemButton = button('rpg-bb-act', 'Item', { key: 'act:item', act: 'item', iconName: 'fa-flask', disabled: !items.length, onClick: () => openMenu('item') });
        itemButton.setAttribute('aria-expanded', String(ui.menu === 'item'));
        const auto = button('rpg-bb-act', 'Auto', { key: 'act:auto', act: 'auto', iconName: 'fa-robot', onClick: () => act({ type: 'auto' }) });
        auto.setAttribute('title', 'Fight the rest on auto');
        grid.append(
            button('rpg-bb-act', 'Attack', { key: 'act:attack', act: 'attack', iconName: 'fa-hand-fist', disabled: !enemies.length, onClick: () => choose({ type: 'attack', aim: 'enemy', label: 'Attack' }) }),
            skillButton,
            itemButton,
            button('rpg-bb-act', 'Defend', { key: 'act:defend', act: 'defend', iconName: 'fa-shield-halved', onClick: () => act({ type: 'defend' }) }),
            button('rpg-bb-act', `Parley${pct(actions.parleyChance)}`, { key: 'act:parley', act: 'parley', iconName: 'fa-comments', disabled: !actions.canParley, onClick: () => choose({ type: 'parley', aim: 'enemy', label: 'Parley' }) }),
            button('rpg-bb-act', `Flee${pct(actions.fleeChance)}`, { key: 'act:flee', act: 'flee', iconName: 'fa-person-running', disabled: actions.canFlee === false, onClick: () => act({ type: 'flee' }) }),
            auto,
        );
        bar.append(grid);
        return bar;
    }

    function drawResult(units) {
        const outcome = OUTCOME_TITLES[p.status] ? p.status : 'won';
        const result = isPlain(p.result) ? p.result : {};
        const box = h(doc, 'section', 'rpg-bb-result');
        box.setAttribute('data-outcome', outcome);
        box.setAttribute('role', 'status');
        box.append(h(doc, 'h3', 'rpg-bb-outcome', OUTCOME_TITLES[outcome]));
        const rounds = Math.max(1, Math.round(num(result.rounds, num(p.round, 1))));
        box.append(h(doc, 'p', 'rpg-bb-hint', `${rounds} ${rounds === 1 ? 'round' : 'rounds'}${p.stakes === 'death' ? ' · to the death' : ''}`));

        // XP per member: [{ name, amount }] from combat.board, or { [member id]: n } named from the sides.
        const xpRows = Array.isArray(result.xp)
            ? result.xp.filter(isPlain).map(row => [str(row.name), Math.round(num(row.amount))])
            : isPlain(result.xp) ? Object.entries(result.xp).map(([id, amount]) => [str(units.get(id)?.name) || id, Math.round(num(amount))]) : [];
        const gains = xpRows.filter(([name, amount]) => name && amount > 0);
        if (gains.length) {
            const dl = h(doc, 'dl', 'rpg-bb-gains');
            dl.setAttribute('aria-label', 'Experience');
            for (const [name, amount] of gains) dl.append(h(doc, 'dt', '', name), h(doc, 'dd', '', `+${amount} ${xpWord(p.terms)}`));
            box.append(dl);
        }

        const loot = isPlain(result.loot) ? result.loot : {};
        const money = Math.max(0, Math.round(num(loot.money)));
        const lootItems = list(loot.items).filter(item => isPlain(item) && str(item.name));
        if (money > 0 || lootItems.length) {
            const ul = h(doc, 'ul', 'rpg-bb-loot');
            ul.setAttribute('aria-label', 'Loot');
            if (money > 0) {
                const li = h(doc, 'li', 'rpg-bb-loot-item');
                li.setAttribute('data-kind', 'money');
                li.append(icon(doc, 'fa-coins'), h(doc, 'span', 'rpg-bb-loot-name', `${money} ${str(result.currency) || str(p.currency) || 'gold'}`));
                ul.append(li);
            }
            for (const item of lootItems) {
                const li = h(doc, 'li', 'rpg-bb-loot-item');
                const rarity = slug(item.rarity) || 'common';
                li.setAttribute('data-rarity', rarity);
                li.append(h(doc, 'span', 'rpg-bb-loot-name', str(item.name)));
                if (num(item.qty, 1) > 1) li.append(h(doc, 'span', 'rpg-bb-tag', `×${Math.round(num(item.qty))}`));
                if (rarity !== 'common') li.append(h(doc, 'span', 'rpg-bb-tag', rarity));
                ul.append(li);
            }
            box.append(ul);
        }
        const defeated = list(result.defeated).map(str).filter(Boolean);
        if (defeated.length) box.append(h(doc, 'p', 'rpg-bb-hint rpg-bb-defeated', `Defeated: ${defeated.join(', ')}`));
        if (canCommand()) {
            box.append(
                h(doc, 'p', 'rpg-bb-hint', 'Finish settles it: the party’s HP, XP and the loot, and the next reply tells the fight.'),
                button('rpg-bb-finish', 'Finish', { key: 'finish', iconName: 'fa-flag-checkered', onClick: () => send('combat.end', typeof p.id === 'string' && p.id ? { session: p.id } : {}) }),
            );
        }
        return box;
    }

    function drawLog() {
        const lines = list(p.log).filter(isPlain).slice(-clamp(Math.round(num(p.logLines, LOG_LINES)), 1, MAX_LOG_LINES));
        const height = log.scrollHeight;
        const measurable = Number.isFinite(height) && height > 0 && Number.isFinite(log.clientHeight);
        // At the bottom (or drawn for the first time) the log follows the fight; scrolled up, it stays put.
        const follow = first || (measurable && log.scrollTop + log.clientHeight >= height - 8);
        const kept = log.scrollTop;
        log.replaceChildren(...(lines.length ? lines.map(entry => {
            const li = h(doc, 'li', `rpg-bb-log-line${entry.important ? ' rpg-bb-important' : ''}`);
            const kind = slug(entry.kind);
            if (kind) li.setAttribute('data-kind', kind);
            const round = h(doc, 'span', 'rpg-bb-log-round', `R${Math.max(1, Math.round(num(entry.round, 1)))}`);
            round.setAttribute('aria-hidden', 'true');
            li.append(round, h(doc, 'span', 'rpg-bb-log-text', str(entry.text)));
            return li;
        }) : [h(doc, 'li', 'rpg-bb-log-line rpg-bb-hint', 'The fight begins.')]));
        if (follow && Number.isFinite(log.scrollHeight)) log.scrollTop = log.scrollHeight;
        else log.scrollTop = kept;
    }

    function draw() {
        if (!alive) return;
        const focused = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement : null;
        let focusKey = null;
        for (const [key, node] of keyed) if (node === focused) focusKey = key;
        actionsOf = new WeakMap();
        keyed = new Map();

        const units = byId();
        root.setAttribute('aria-label', str(p.label) || 'Battle');
        const hasFight = units.size > 0;
        for (const node of [head, orderBox, sides, panel, logBox]) node.hidden = !hasFight;
        if (hasFight) empty.remove();
        else if (empty.parentNode !== root) root.append(empty);
        root.setAttribute('data-status', hasFight ? slug(p.status) || 'active' : 'none');
        root.classList.toggle('rpg-bb-pending', pending);
        root.classList.toggle('rpg-bb-picking', Boolean(ui.pick));
        if (!hasFight) {
            for (const node of [head, orderBox, sides, panel]) node.replaceChildren();
            log.replaceChildren();
            dropPortraits(new Set());
            return;
        }
        const active = p.status === 'active';
        const actorId = active ? (p.actions?.actor ?? p.turn?.actor ?? null) : null;
        drawHead();
        drawOrder(units, actorId);
        drawSides(units, actorId);
        if (!active) panel.replaceChildren(drawResult(units));
        else if (!actorId || !units.has(actorId)) panel.replaceChildren(h(doc, 'p', 'rpg-bb-hint', 'Waiting for the next turn…'));
        else if (!canCommand()) panel.replaceChildren();
        else panel.replaceChildren(drawActions(units));
        drawLog();
        first = false;
        if (focusKey) keyed.get(focusKey)?.focus?.();
    }

    /** What a new view must match for the reader's open list or picking to carry over. */
    const keyOf = () => [p.id, typeof p.board === 'string' ? p.board : '', num(p.logLength, list(p.log).length), p.actions?.actor ?? p.turn?.actor ?? '', p.status].join('|');

    function update(next) {
        if (!alive) return;
        p = resolveProps(props, prepare(next));
        pending = false;
        const key = keyOf();
        if (key !== ui.key) ui = { key, menu: null, pick: null };
        draw();
    }

    ui.key = keyOf();
    draw();

    return {
        update,
        destroy() {
            if (!alive) return;
            alive = false;
            root.removeEventListener('click', onClick);
            root.removeEventListener('keydown', onKey);
            dropPortraits(new Set());
            actionsOf = new WeakMap();
            keyed.clear();
            root.remove();
        },
    };
}

/** The widget definition (WIDGETS.md): props, primary, render, validate. */
export const battleBoard = Object.freeze({
    props,
    primary: 'combatants',
    render(el, input, api) {
        return render(el, input, api);
    },
    validate: input => propProblems(props, prepare(input)),
});
