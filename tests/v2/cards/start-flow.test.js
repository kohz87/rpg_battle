// The start card, end to end on Story Block's real host (the vendored runtime and UI host, tests/vendor/story-block): a chat
// with only the greeting, the card under it, Create opening the wizard (a dialog-only screen) with the persona's draft, the
// card gone once the character exists; and Skip setting the card aside so the replies the party part held back are written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../vendor/story-block/src/v2/runtime.js';
import { mountUi } from '../../vendor/story-block/src/v2/ui-host.js';
import { createFakeContext } from '../../vendor/story-block/testkit/index.js';
import { MODULE_ID, createModule } from '../../../src/v2/module.js';
import { CREATE_SCREEN_ID } from '../../../src/v2/creation/index.js';
import { START_CARD_ID } from '../../../src/v2/creation/start-card.js';
import { installDom } from '../screens/helpers/dom.js';

const CARD = `${MODULE_ID}/${START_CARD_ID}`;

// The persona the wizard's draft reads (SillyTavern's context), for the length of `fn`.
async function withPersona(fn) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'SillyTavern');
    globalThis.SillyTavern = { getContext: () => ({ name1: 'Ren', powerUserSettings: { persona_description: 'A ferryman from Bluewatch.' } }) };
    try { return await fn(); } finally {
        if (saved) Object.defineProperty(globalThis, 'SillyTavern', saved);
        else delete globalThis.SillyTavern;
    }
}

// A greeting-only chat with the host UI over it and the start card drawn under message 0.
async function greetingChat() {
    const doc = installDom();
    const st = createFakeContext({});
    st.notices = [];
    let ui = null;
    const module = createModule({ settings: () => ({}) });
    const runtime = createRuntime({ ctx: st.ctx, modules: [module], onRegister: () => ui?.syncScreens(), notify: (reason, moduleId) => st.notices.push({ reason, moduleId }) });
    ui = mountUi({ runtime, ctx: st.ctx, doc });
    runtime.turn.install({ globalName: null });
    st.interceptor = runtime.turn.interceptor;
    runtime.markReady();
    await runtime.turn.onChatChanged();
    const mes = doc.createElement('div');
    mes.className = 'mes';
    mes.setAttribute('mesid', '0');
    doc.body.appendChild(mes);
    ui.mounts.card.refresh(0, { force: true });
    const card = () => mes.querySelector(`[data-ss-reply-card="${CARD}"]`);
    const act = id => card().querySelector(`button[data-action="${id}"]`);
    return { doc, st, ui, runtime, card, act, close: () => runtime.turn.uninstall({ globalName: null }) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('greeting only: the start card is under the greeting with working buttons; Create opens the wizard; the card goes once the character exists', async () => {
    await withPersona(async () => {
        const chat = await greetingChat();
        try {
            assert.ok(chat.card(), 'the start card is drawn under the greeting');
            assert.ok(!chat.act('create').disabled && !chat.act('skip').disabled, 'the greeting is the newest reply, so its card can act');
            assert.equal(chat.ui.mounts.screen.isOpen(), false);

            chat.act('create').click();
            const wizard = chat.ui.mounts.dialog.current();
            assert.ok(wizard, 'Create opened a dialog');
            assert.equal(wizard.screenId, CREATE_SCREEN_ID);
            assert.equal(chat.ui.mounts.screen.isOpen(), false, 'not the Party screen');
            assert.equal(wizard.draft.name, 'Ren', 'the wizard starts from the persona');
            assert.equal(wizard.draft.background, 'A ferryman from Bluewatch.');

            // Finish it: the last step sends the draft as creation.finish.
            Object.assign(wizard.draft, { race: 'rpg-battle/elf', talents: ['rpg-battle/keen-eyes'], points: { STR: 4, DEX: 5, AGI: 0, VIT: 0, INT: 0, LUK: 0, CHA: 0 } });
            while (wizard.step() < wizard.stepCount() - 1) wizard.next();
            const done = await wizard.submit();
            assert.equal(done?.ok, true, done?.message);
            await settle();
            assert.equal(chat.runtime.sdk.query('party.pc')?.name, 'Ren');
            assert.equal(chat.card(), null, 'the card is gone once a character exists');

            const sent = await chat.st.generate('normal', { reply: 'The story begins in earnest.' });
            assert.notEqual(sent.aborted, true, 'replies are written');
            assert.deepEqual(chat.st.notices, []);
        } finally { chat.close(); }
    });
});

test('greeting only: Skip sets the card aside and lets the replies generate with no character', async () => {
    const chat = await greetingChat();
    try {
        const held = await chat.st.send('Hello?', { reply: 'This reply must not be written.' });
        assert.equal(held.aborted, true, 'before Skip every reply is held back');
        assert.equal(chat.st.notices.length, 1);

        assert.ok(chat.card(), 'the card is under the greeting');
        chat.act('skip').click();
        await settle();
        assert.equal(chat.runtime.sdk.query('party.pc'), null, 'no character was made');
        assert.equal(chat.card(), null, 'the card is set aside');

        const before = chat.st.ctx.chat.length;
        const sent = await chat.st.generate('normal', { reply: 'The ferry bell rings.' });
        assert.notEqual(sent.aborted, true, 'a reply is written after Skip');
        assert.equal(chat.st.ctx.chat.length, before + 1);
        assert.equal(chat.st.ctx.chat.at(-1).mes, 'The ferry bell rings.');
        assert.equal(chat.st.notices.length, 1, 'nothing more was held back');
    } finally { chat.close(); }
});

test('greeting only: an import from the wizard\'s Start step closes the wizard the card opened and says the character is ready', async () => {
    const toasts = [];
    const savedToastr = globalThis.toastr;
    const savedSb = globalThis.StoryBlock;
    globalThis.toastr = { success: (text, title) => toasts.push({ title, text }) };
    try {
        await withPersona(async () => {
            const chat = await greetingChat();
            try {
                globalThis.StoryBlock = { sdk: chat.runtime.sdk };   // the widget api of this host has no dialog: the global sdk has
                chat.act('create').click();
                const wizard = chat.ui.mounts.dialog.current();
                assert.equal(wizard.screenId, CREATE_SCREEN_ID, 'the card opened the wizard (not openCreation)');
                const file = { rpgBattleCharacter: 1, name: 'Ren of Elsewhere', role: 'rogue', level: 1, xp: 0, points: 0,
                    stats: { STR: 5, VIT: 5, AGI: 5, DEX: 5, INT: 5, LUK: 5, CHA: 5 }, skills: [], custom: [], items: [], purse: 0 };
                const input = wizard.el.querySelector('input.rpg-import-file');
                input.files = [{ name: 'ren.json', size: 200, text: async () => JSON.stringify(file) }];
                input.dispatch('change');
                for (let i = 0; i < 20 && wizard.isOpen(); i += 1) await settle();
                assert.equal(wizard.isOpen(), false, 'the import closed its own dialog');
                assert.equal(chat.ui.mounts.dialog.current(), null);
                assert.equal(chat.runtime.sdk.query('party.pc')?.name, 'Ren', 'the character is the persona\'s');
                assert.equal(toasts.length, 1, 'one toast');
                assert.equal(toasts[0].title, 'Ren is ready');
                assert.match(toasts[0].text, /See them on the Party screen\./);
                assert.equal(chat.card(), null, 'the start card is gone');
            } finally { chat.close(); }
        });
    } finally {
        if (savedToastr === undefined) delete globalThis.toastr;
        else globalThis.toastr = savedToastr;
        if (savedSb === undefined) delete globalThis.StoryBlock;
        else globalThis.StoryBlock = savedSb;
    }
});

test('greeting only: a persona switched after the card was drawn is the one the wizard shows when Create is tapped', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'SillyTavern');
    const persona = { name: 'Ren', description: 'A ferryman from Bluewatch.' };
    globalThis.SillyTavern = { getContext: () => ({ name1: persona.name, powerUserSettings: { persona_description: persona.description } }) };
    try {
        const chat = await greetingChat();
        try {
            persona.name = 'Mara';
            persona.description = 'A cartographer from the north.';
            chat.act('create').click();
            const wizard = chat.ui.mounts.dialog.current();
            assert.equal(wizard.screenId, CREATE_SCREEN_ID);
            assert.equal(wizard.draft.name, 'Mara', 'the persona of the tap, not of the scan');
            assert.equal(wizard.draft.background, 'A cartographer from the north.');
            assert.deepEqual(Object.keys(wizard.draft).sort(), ['background', 'name', 'points', 'portrait', 'preset', 'race', 'talents'], 'the whole starting draft');
            assert.match(wizard.el.querySelector('.cc-start')?.textContent ?? '', /ready-made|Import/, 'the Start step is drawn');
            // The review ("You") step reads the same draft.
            wizard.goTo(wizard.stepCount() - 1);
            assert.match(wizard.el.textContent, /Mara/);
            assert.doesNotMatch(wizard.el.textContent, /Ren/);
        } finally { chat.close(); }
    } finally {
        if (saved) Object.defineProperty(globalThis, 'SillyTavern', saved);
        else delete globalThis.SillyTavern;
    }
});
