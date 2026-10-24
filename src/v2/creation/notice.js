// RPG Battle v2, the words said once a character is made ("<Name> is ready"), shared by the two ways the wizard
// finishes: Create (open.js, the dialog's onDone) and an import from the Start step (the import widget, which works
// however the wizard was opened: open.js's openCreation, or Story Block's start card). A result is told once.

/**
 * The words said once a character is made: { title, text }. title is "<Name> is ready"; text is the
 * command's own summary (race, talents, skills; or where an imported one comes from) and where to see
 * them. Plain text: the toast shows it as text.
 */
export function createdNotice(result, draft = {}) {
    const flat = (value, max) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
    const name = flat(draft?.name, 80) || 'Your character';
    const summary = flat(result?.receipt?.summary ?? result?.summary, 300);
    return { title: `${name} is ready`, text: `${summary ? `${summary} ` : ''}See them on the Party screen.` };
}

const told = new WeakSet();

/** Whether this command result was already told (an import's event reaches both the widget and openCreation). */
export const wasTold = result => result !== null && typeof result === 'object' && told.has(result);

// The toast: SillyTavern's toastr where there is one; a host or test may pass `notify(title, text)` instead.
export function showCreated(result, draft, notify) {
    if (result !== null && typeof result === 'object') {
        if (told.has(result)) return undefined;
        told.add(result);
    }
    const { title, text } = createdNotice(result, draft);
    try {
        if (typeof notify === 'function') return notify(title, text);
        globalThis.toastr?.success?.(text, title, { timeOut: 6000, escapeHtml: true });
    } catch { /* a toast that fails changes nothing: the character is made */ }
    return undefined;
}
