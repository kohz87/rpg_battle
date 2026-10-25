// Story Director v2, part screens: behind the scenes on the Director screen, widget
// `story-director.behind` (bound to `director.behind`).
//
// Hidden (reveal.js: the setting on and this chat not revealed): a count and Reveal, and nothing of the
// agendas, planned beats, clocks or secrets is put into the page. Revealed: a Hide bar, then each kind
// as the Director screen draws the others (open threads, the closed ones folded), secrets by name only,
// and the problems about them. With the setting off it is shown as part of the screen, with no bar.

import { BEHIND_KINDS, reveal as pageReveal } from './reveal.js';
import { button, maker, plural, spaced } from './dom.js';

export const BEHIND_WIDGET = 'story-director.behind';

const META = [['now', 'At'], ['then', 'Next'], ['on', 'On'], ['due', 'Due'], ['place', 'Where'], ['reach', 'Reaches you']];

function render(el, props, _api, reveal) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('div', 'sd-behind');
    el.replaceChildren(root);
    let value = props?.value ?? null;

    const threadItem = (thread, kind) => {
        const item = make('li', 'sd-thread', undefined, { 'data-thread': thread.id });
        item.append(make('span', 'sd-key', thread.key));
        if (kind === 'secret') return item;
        if (thread.ended?.outcome) item.append(' ', make('span', 'ss-pill sd-outcome', thread.ended.outcome));
        if (thread.summary) item.append(' ', make('p', 'sd-line', thread.summary));
        const meta = make('p', 'sd-meta');
        for (const [name, label] of META) {
            if (!thread.fields?.[name]) continue;
            if (meta.childNodes.length) meta.append(' ');
            meta.append(make('span', '', `${label}: ${thread.fields[name]}`));
        }
        if (meta.childNodes.length) item.append(' ', meta);
        return item;
    };

    function draw() {
        const data = value && typeof value === 'object' ? value : { kinds: [], problems: [], open: 0, total: 0 };
        const guard = reveal.guard();
        const hidden = guard && !reveal.revealed();
        const parts = [];
        if (hidden) {
            const lock = make('section', 'sd-kind sd-lock', undefined, { 'data-kind': 'behind' });
            const text = make('div', 'sd-lock-text');
            const facts = [plural(data.open ?? 0, 'open thread'), data.problems?.length ? plural(data.problems.length, 'problem') : ''].filter(Boolean).join(' · ');
            text.append(...spaced([
                make('h4', 'sd-h', 'Behind the scenes'),
                make('p', 'sd-line', 'Agendas, planned beats, clocks and secrets stay hidden so the story can still surprise you.'),
                make('p', 'sd-meta sd-lock-counts', facts),
            ]));
            lock.append(make('i', 'fa-solid fa-eye-slash sd-lock-icon', undefined, { 'aria-hidden': 'true' }), text);
            const actions = make('div', 'sd-actions');
            actions.append(button(make, 'Reveal', 'sd-reveal', 'fa-eye', () => reveal.set(true)));
            lock.append(actions);
            parts.push(lock);
            root.replaceChildren(...spaced(parts));
            return;
        }
        if (guard) {
            const bar = make('div', 'sd-unlocked');
            bar.append(make('span', 'sd-line', 'Behind the scenes is showing.'), button(make, 'Hide', 'ss-button-quiet sd-hide', 'fa-eye-slash', () => reveal.set(false)));
            parts.push(bar);
        }
        for (const [kind, title] of BEHIND_KINDS) {
            const group = (data.kinds ?? []).find(entry => entry.kind === kind);
            if (!group) continue;
            const section = make('section', 'sd-kind ss-glass', undefined, { 'data-kind': kind });
            const head = make('h4', 'sd-h', title);
            if (group.open.length) head.append(' ', make('small', '', String(group.open.length)));
            const list = make('ul', 'sd-list sd-threads');
            for (const thread of group.open) list.append(threadItem(thread, kind));
            section.append(head, ' ', list);
            if (group.closed.length) {
                const fold = make('details', 'sd-closed');
                const summary = make('summary', '', 'Closed ');
                summary.append(make('small', '', String(group.closed.length)));
                const closed = make('ul', 'sd-list sd-threads');
                for (const thread of group.closed) closed.append(threadItem(thread, kind));
                fold.append(summary, ' ', closed);
                section.append(' ', fold);
            }
            parts.push(section);
        }
        if (data.problems?.length) {
            const section = make('section', 'sd-kind ss-glass sd-problems-box', undefined, { 'data-kind': 'behind-problems' });
            section.append(make('h4', 'sd-h', 'Problems behind the scenes'));
            const list = make('ol', 'sd-list sd-problems');
            for (const problem of data.problems) {
                const item = make('li', 'sd-problem', undefined, { 'data-kind': problem.kind });
                item.append(make('span', 'ss-pill', problem.kind), ` ${problem.text}`);
                list.append(item);
            }
            section.append(' ', list);
            parts.push(section);
        }
        root.replaceChildren(...spaced(parts));
    }

    const off = reveal.subscribe(draw);
    draw();
    return {
        update(next) {
            value = next?.value ?? null;
            draw();
        },
        destroy() {
            off?.();
            root.remove();
        },
    };
}

/** The widget definition; `reveal` (tests): the reveal choice (the page's by default). */
export function createBehindWidget({ reveal = pageReveal } = {}) {
    return Object.freeze({
        props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
        primary: 'value',
        validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.behind data.'] : []),
        render: (el, props, api) => render(el, props, api, reveal),
    });
}

export const behindWidget = createBehindWidget();
