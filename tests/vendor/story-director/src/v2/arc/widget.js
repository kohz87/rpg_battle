// Story Director v2, part **arc**: the arc panel, widget `story-director.arc` (MODULES §F9), on the
// Director screen. Its buttons are the reader's controls for planning (Plan arc, End arc, Accept,
// Discard, Plan again), not story actions (F95/F96 cover those). An arc accepted by itself (setting
// `arc.autoAccept`) gets a quiet note with OK, which names nothing of it while behind the scenes is hidden.
//
// It shows the current arc (its name, what it is about, how many of its beats have played) and the
// buttons; a plan waiting for review as text the reader may edit, with what code left out or changed;
// "Planning…" with Cancel while the planner is asked; and the last error. Behind the scenes hidden
// (screens/reveal.js): nothing planned is put into the page, only "An arc is in progress (2 of 5 beats
// played)" or "A new arc plan is waiting" with Accept without reading, Review (reveals) and Discard.
// On a Story Block without `sdk.callModel` it says plainly which Story Block arc planning needs, and shows
// no buttons. Bound to `director.arc` (props.value); the panel's own state (busy, the waiting plan, the
// error) comes from the controller (controller.js), and the panel draws itself again when that changes.

import { button, maker, spaced } from '../screens/dom.js';
import { FEATURE } from './domain.js';
import { REASON_TEXT } from './plan.js';
import { arcController } from './controller.js';

export const ARC_WIDGET = 'story-director.arc';

// What the reader typed into a waiting plan survives the panel drawing itself again (this page only).
const edits = new Map();

function render(el, props, api, controller) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('section', 'sd-kind sd-arc ss-listcard ss-glass', undefined, { 'data-kind': 'arc', 'aria-label': 'Arc' });
    el.replaceChildren(root);
    let value = props?.value ?? null;

    function draw() {
        const status = controller.status();
        const arc = value && typeof value === 'object' ? value : status.arc ?? {};
        const current = arc?.current ?? null;
        const parts = [make('h4', 'ss-section-label', 'Arc')];
        if (!status.available) {
            parts.push(make('p', 'sd-arc-needs', status.needs));
            root.replaceChildren(...spaced(parts));
            return;
        }
        const draft = status.draft;
        const beats = current?.beats?.total ? `${current.beats.done} of ${current.beats.total} beats played` : '';
        if (status.busy) {
            parts.push(make('p', 'sd-arc-desc', 'Planning the next arc… this can take a minute.', { role: 'status' }));
            parts.push(row(button(make, 'Cancel', 'ss-button-quiet sd-arc-cancel', 'fa-xmark', () => controller.cancel())));
        } else if (draft && status.hidden) {
            parts.push(make('p', 'sd-arc-desc', 'A new arc plan is waiting.'));
            parts.push(row(
                button(make, 'Accept without reading', 'sd-arc-accept', 'fa-check', () => void controller.accept(draft.text)),
                button(make, 'Review', 'sd-arc-review', 'fa-eye', () => controller.reveal?.(true)),
                button(make, 'Discard', 'ss-button-quiet sd-arc-discard', 'fa-xmark', () => controller.discard()),
            ));
        } else if (draft) {
            const why = REASON_TEXT[draft.reason] ?? '';
            parts.push(make('p', 'sd-arc-desc', `New plan${why ? ` (planned because ${why})` : ''}: edit it if you like, then accept.`));
            if (draft.noteUsed) parts.push(make('p', 'sd-arc-note', 'Your Director\'s note shaped this plan; once it is accepted the note is not used again until you change it.'));
            const area = make('textarea', 'ss-input ss-text sd-arc-text', undefined, { rows: '9', spellcheck: 'false', 'aria-label': 'New arc plan' });
            const key = draft.text;
            area.value = edits.has(key) ? edits.get(key) : draft.text;
            area.addEventListener('input', () => edits.set(key, area.value));
            parts.push(area);
            const findings = Array.isArray(draft.findings) ? draft.findings.filter(entry => entry?.text) : [];
            if (findings.length) {
                const list = make('ul', 'sd-list sd-arc-findings', undefined, { 'aria-label': 'What code changed' });
                for (const entry of findings) list.append(make('li', `sd-arc-finding sd-${entry.severity === 'warn' ? 'warn' : 'info'}`, entry.text));
                parts.push(list);
            }
            parts.push(row(
                button(make, 'Accept', 'sd-arc-accept', 'fa-check', () => {
                    const text = area.value;
                    edits.delete(key);
                    void controller.accept(text);
                }),
                button(make, 'Discard', 'ss-button-quiet sd-arc-discard', 'fa-xmark', () => {
                    edits.delete(key);
                    controller.discard();
                }),
                button(make, 'Plan again', 'ss-button-quiet sd-arc-replan', 'fa-rotate', () => {
                    edits.delete(key);
                    void controller.plan({ reason: 'manual' });
                }),
            ));
        } else {
            // Accepted by itself (arc.autoAccept): a quiet note, naming nothing while behind the scenes is hidden.
            if (status.began && current?.active) {
                const note = make('p', 'sd-arc-note sd-arc-began', status.hidden ? 'A new arc began by itself (accepted without review).' : 'This arc began by itself (accepted without review).', { role: 'status' });
                note.append(' ', button(make, 'OK', 'ss-button-quiet sd-arc-seen', 'fa-check', () => controller.seen?.()));
                parts.push(note);
            }
            if (!current) parts.push(make('p', 'sd-arc-desc sd-arc-none', 'No arc planned yet.'));
            else if (status.hidden) {
                parts.push(make('p', 'sd-arc-desc', current.active ? `An arc is in progress${beats ? ` (${beats})` : ''}.` : 'The last arc has ended.'));
            } else {
                const head = make('p', 'sd-arc-head');
                head.append(make('span', 'sd-key', current.key));
                if (beats) head.append(' ', make('small', 'sd-arc-beats', `· ${beats}`));
                if (!current.active) head.append(' ', make('span', 'ss-pill sd-outcome', 'ended'));
                parts.push(head);
                if (current.desc) parts.push(make('p', 'sd-line', current.desc));
            }
            const buttons = [button(make, current?.active ? 'Plan next arc' : 'Plan arc', 'sd-arc-plan', 'fa-wand-magic-sparkles', () => void controller.plan({ reason: 'manual' }))];
            if (current?.active) buttons.push(button(make, 'End arc', 'ss-button-quiet sd-arc-end', 'fa-flag-checkered', () => void controller.end()));
            parts.push(row(...buttons));
        }
        if (status.error) parts.push(make('p', 'sd-reason sd-arc-error', status.error, { role: 'alert' }));
        root.replaceChildren(...spaced(parts));
    }

    function row(...buttons) {
        const node = make('div', 'sd-actions sd-arc-actions');
        node.append(...buttons);
        return node;
    }

    const off = controller.subscribe(draw);
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

/** The widget definition; `controller` (tests): the planner it drives (the page's by default). */
export function createArcWidget({ controller = null } = {}) {
    return Object.freeze({
        props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
        primary: 'value',
        feature: FEATURE,
        validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.arc data.'] : []),
        render: (el, props, api) => render(el, props, api, controller ?? arcController()),
    });
}

export const arcWidget = createArcWidget();
