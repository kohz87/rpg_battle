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
