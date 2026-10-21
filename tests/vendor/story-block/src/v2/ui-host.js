// Story Block v2's page furniture in SillyTavern (index.js calls mountUi once): everything a reader
// clicks that is not a module's own screen.
//
// * The Story Suite bar, just above the message box: Story (the tab panel), Game view (when a module
//   offers full-screen screens), Settings (the Story Suite overlay), and the notice a canGenerate hook
//   leaves when it held a reply back (MODULES §F12).
// * The tab panel: the tab host (src/v2/host-ui.js) with every module tab and every `tab` screen, a
//   side sheet on wide screens and a bottom sheet on phones. Redrawn from the head on every change.
// * The Story Block drawer in Extensions: version, modules, the same buttons.
// * The wand menu: Story Suite (the overlay).
// * The five mounts (SPEC §13.4) over the screen registry, drawn by the layout renderer (and the
//   template renderer when it is in this checkout), with the standard and module widgets.
//
// Every text is set with textContent; nothing a module or a pack wrote becomes markup here.

import { createTabHost, openSettingsOverlay } from './host-ui.js';
import { mountQuery } from './sdk.js';
import { createMounts } from './view/mounts/index.js';
import { createScreenRenderer } from './view/render-screen.js';
import { createScreens } from './view/screens.js';
import { CHANGES_CARD_SCREEN_ID, HOME_SCREEN_ID, changesSummary } from './screens/index.js';

const IDS = Object.freeze({ bar: 'story_suite_v2_bar', panel: 'story_suite_v2_panel', drawer: 'story_suite_v2_drawer', menu: 'story_suite_v2_menu' });

function el(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function iconButton(doc, className, iconName, label, title = label) {
    const node = el(doc, 'button', `menu_button ${className}`);
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    const glyph = el(doc, 'i', `fa-solid ${iconName}`);
    glyph.setAttribute('aria-hidden', 'true');
    node.append(glyph, el(doc, 'span', 'story-suite-label', label));
    return node;
}

/** Reader choices for screens and cards: extension_settings.storySuite.{screens, cards}. */
function readerStore(ctx) {
    const root = () => {
        const es = ctx.extensionSettings ?? {};
        if (!es.storySuite || typeof es.storySuite !== 'object') es.storySuite = {};
        return es.storySuite;
    };
    return {
        reader: () => ({ screens: root().screens ?? {}, cards: root().cards ?? {} }),
        saveReader(next) {
            root().screens = next.screens ?? {};
            root().cards = next.cards ?? {};
            ctx.saveSettingsDebounced?.();
        },
    };
}

/**
 * mountUi({ runtime, ctx, doc?, version? }) → { refresh(), blocked(reason, moduleId), clearBlocked(),
 * openPanel(), closePanel(), openSettings(), screens, mounts, renderer, syncScreens() }.
 */
export function mountUi({ runtime, ctx, doc = globalThis.document, version = '' }) {
    const { registry, store, sdk, settings, events } = runtime;
    // A screen asking a query no module answers (an optional module that is not installed, like NSD's
    // npc.portrait) gets null, not a problem line.
    const runAt = mountQuery(registry, () => store.receipts());
    const queryAt = (name, args, state) => (registry.query(name) ? runAt(name, args, state) : null);
    const widgets = () => Object.fromEntries(registry.widgets().map(widget => [widget.name, widget]));
    const renderer = createScreenRenderer({
        queryAt,
        widgets,
        headIndex: () => store.headIndex(),
        sanitize: globalThis.SillyTavern?.libs?.DOMPurify?.sanitize?.bind(globalThis.SillyTavern.libs.DOMPurify) ?? null,
        formatters: () => {
            let currency = null;
            try { currency = sdk.query('inventory.currency'); } catch { currency = null; }
            return currency?.name ? { money: n => `${n} ${currency.name}` } : {};
        },
    });
    const screens = createScreens(readerStore(ctx));
    const extraTabs = [];

    // ---- screens from the modules and the packs ----------------------------------------------
    function syncScreens() {
        const byModule = new Map();
        for (const screen of registry.screens()) {
            const { moduleId, ...def } = screen;
            if (!byModule.has(moduleId)) byModule.set(moduleId, []);
            byModule.get(moduleId).push(def);
        }
        for (const [moduleId, list] of byModule) {
            try { screens.addModule(moduleId, list); } catch (error) { console.warn('[Story Suite]', error?.message ?? error); }
        }
        let packScreens = [];
        try { packScreens = sdk.query('packs.content', { kind: 'screens' }) ?? []; } catch { packScreens = []; }
        const byPack = new Map();
        for (const screen of packScreens) {
            const { pack, ...def } = screen ?? {};
            if (!pack) continue;
            if (!byPack.has(pack)) byPack.set(pack, []);
            byPack.get(pack).push(def);
        }
        for (const [pack, list] of byPack) {
            try { screens.setPack(pack, list); } catch (error) { console.warn('[Story Suite]', error?.message ?? error); }
        }
    }

    const api = Object.freeze({
        command: (type, payload, options) => sdk.command(type, payload, options),
        preview: (type, payload) => sdk.preview(type, payload),
        commit: token => sdk.commit(token),
        query: (name, args) => sdk.query(name, args),
        on: (name, fn) => sdk.on(name, fn),
        rewind: options => sdk.rewind(options),
        substitute: text => sdk.substitute(text),
        dialog: Object.freeze({ open: (screenId, opts) => sdk.dialog.open(screenId, opts) }),
    });
    const carriers = () => (ctx.chat ?? []).map((message, index) => (message && !message.is_user ? index : -1)).filter(index => index >= 0);
    const mounts = createMounts({
        screens,
        render: renderer.render,
        stateAt: index => store.at(index),
        headIndex: () => store.headIndex(),
        query: queryAt,
        changesAt: index => store.changesAt(index),
        opsAt: index => store.opsAt(index),
        summary(screen, { state, before, changes }) {
            if (screen?.id !== CHANGES_CARD_SCREEN_ID) return null;
            let currency = null;
            try { currency = sdk.query('inventory.currency'); } catch { currency = null; }
            return changesSummary({ state, before, changes, currency });
        },
        settings: screenId => {
            const owner = String(screenId ?? '').split('/')[0];
            return sdk.settings(registry.has(owner) ? owner : 'story-block');
        },
        api,
        on: (name, fn) => events.on(name, fn),
        carriers,
        swipeAt: index => ctx.chat?.[index]?.swipe_id ?? 0,
        eventSource: ctx.eventSource,
        eventTypes: ctx.eventTypes ?? ctx.event_types,
        addTab(tab) {
            extraTabs.push(tab);
            return () => {
                const at = extraTabs.indexOf(tab);
                if (at >= 0) extraTabs.splice(at, 1);
            };
        },
        document: doc,
    });
    runtime.setDialog?.((screenId, opts) => mounts.dialog.open(screenId, opts));
    // The tab host sees the module tabs and the tab screens as one list.
    const tabSource = { tabs: () => [...registry.tabs(), ...extraTabs.map(tab => ({ ...tab, moduleId: 'screens' }))] };

    // ---- the panel ---------------------------------------------------------------------------
    let tabHost = null;
    const panel = el(doc, 'div', 'story-suite-sheet');
    panel.id = IDS.panel;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Story');
    const panelHead = el(doc, 'div', 'story-suite-sheet-head');
    panelHead.appendChild(el(doc, 'b', '', 'Story'));
    const panelClose = iconButton(doc, 'story-suite-sheet-close', 'fa-xmark', '', 'Close the story panel');
    panelHead.appendChild(panelClose);
    const panelBody = el(doc, 'div', 'story-suite-sheet-body');
    panel.append(panelHead, panelBody);
    doc.body.appendChild(panel);

    function openPanel() {
        panel.hidden = false;
        doc.body.classList.add('story-suite-sheet-open');
        if (!tabHost) tabHost = createTabHost(panelBody, { registry: tabSource, view: () => sdk.view(), api: sdk, doc });
        else tabHost.refresh();
    }
    function closePanel() {
        panel.hidden = true;
        doc.body.classList.remove('story-suite-sheet-open');
    }
    panelClose.addEventListener('click', closePanel);

    const openSettings = () => openSettingsOverlay({ registry, settings, doc, sdk });

    // ---- the bar above the message box ------------------------------------------------------
    const bar = el(doc, 'div', 'story-suite-bar');
    bar.id = IDS.bar;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Story Suite');
    const storyButton = iconButton(doc, 'story-suite-bar-story', 'fa-book-open', 'Story', 'Open the story panel');
    const gameButton = iconButton(doc, 'story-suite-bar-game', 'fa-expand', 'Game view', 'Open the game view');
    const settingsButton = iconButton(doc, 'story-suite-bar-settings', 'fa-sliders', 'Suite', 'Story Suite settings');
    const notice = el(doc, 'div', 'story-suite-notice');
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    const noticeText = el(doc, 'span', 'story-suite-notice-text');
    const noticeClose = iconButton(doc, 'story-suite-notice-close', 'fa-xmark', '', 'Dismiss');
    notice.append(noticeText, noticeClose);
    bar.append(storyButton, gameButton, settingsButton, notice);
    storyButton.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
    gameButton.addEventListener('click', () => mounts.screen.open(HOME_SCREEN_ID));
    settingsButton.addEventListener('click', openSettings);
    noticeClose.addEventListener('click', () => clearBlocked());
    const placeBar = () => {
        const anchor = doc.querySelector('#send_form');
        if (anchor?.parentNode && bar.nextElementSibling !== anchor && bar.parentNode !== anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
        else if (!bar.parentNode) doc.body.appendChild(bar);
    };
    placeBar();

    // ---- the Extensions drawer and the wand menu -------------------------------------------
    const drawerStatus = el(doc, 'p', 'story-suite-muted');
    function drawer() {
        const host = doc.querySelector('#extensions_settings2') ?? doc.querySelector('#extensions_settings');
        if (!host || doc.querySelector(`#${IDS.drawer}`)) return;
        const root = el(doc, 'div', 'inline-drawer story-suite-drawer');
        root.id = IDS.drawer;
        const toggle = el(doc, 'div', 'inline-drawer-toggle inline-drawer-header');
        toggle.appendChild(el(doc, 'b', '', 'Story Block'));
        toggle.appendChild(el(doc, 'div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
        const content = el(doc, 'div', 'inline-drawer-content');
        const buttons = el(doc, 'div', 'story-suite-drawer-buttons');
        const one = iconButton(doc, '', 'fa-sliders', 'Story Suite settings');
        const two = iconButton(doc, '', 'fa-book-open', 'Story panel');
        one.addEventListener('click', openSettings);
        two.addEventListener('click', openPanel);
        buttons.append(one, two);
        content.append(drawerStatus, buttons);
        root.append(toggle, content);
        host.appendChild(root);
    }
    function menu() {
        const host = doc.querySelector('#extensionsMenu');
        if (!host || doc.querySelector(`#${IDS.menu}`)) return;
        const item = el(doc, 'div', 'list-group-item flex-container flexGap5 interactable');
        item.id = IDS.menu;
        item.tabIndex = 0;
        item.append(el(doc, 'div', 'fa-solid fa-sliders extensionsMenuExtensionButton'), el(doc, 'span', '', 'Story Suite'));
        item.addEventListener('click', openSettings);
        host.appendChild(item);
    }
    drawer();
    menu();

    // ---- the canGenerate notice ------------------------------------------------------------
    function blocked(reason, moduleId) {
        const name = registry.module(moduleId)?.name ?? moduleId ?? 'Story Suite';
        noticeText.textContent = `${name}: ${reason}`;
        notice.hidden = false;
        bar.classList.add('story-suite-bar-blocked');
    }
    function clearBlocked() {
        notice.hidden = true;
        noticeText.textContent = '';
        bar.classList.remove('story-suite-bar-blocked');
    }

    // ---- keeping it all current -------------------------------------------------------------
    function refresh() {
        placeBar();
        drawer();
        menu();
        const modules = sdk.modules();
        drawerStatus.textContent = `Story Block ${version} (v2) · ${modules.map(module => module.name).join(', ')}`;
        gameButton.hidden = screens.list('screen').length === 0;
        mounts.tab.register();
        if (!panel.hidden) tabHost?.refresh();
        mounts.hud.show();
        mounts.screen.update();
    }
    for (const name of ['head', 'committed']) events.on(name, () => { if (!panel.hidden) tabHost?.refresh(); });
    events.on('turn', () => { clearBlocked(); if (!panel.hidden) tabHost?.refresh(); });

    syncScreens();
    refresh();
    mounts.card?.attachAll?.();

    return {
        refresh,
        blocked,
        clearBlocked,
        openPanel,
        closePanel,
        openSettings,
        syncScreens() { syncScreens(); refresh(); mounts.card?.refreshAll?.({ force: true }); },
        screens,
        mounts,
        renderer,
    };
}
