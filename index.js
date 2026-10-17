// RPG Battle: SillyTavern glue.
//
// Everything that touches SillyTavern or Story Block lives here; the rules, the fight and the
// sheets are pure modules under src/. The Character and Party sheets are Story Block blocks
// "kept by an extension": the model reads them every reply and never writes them; this file
// writes them, with Story Block's setBlockText, into the latest reply (so deleting that reply
// rolls them back). A fight is stored in the chat's metadata as its setup and actions and
// replayed with its seed; its result reaches the story once, through the generate interceptor.

import { DEFAULT_RULES, checkModifiers, makeRules, suggestRank } from './src/rules.js';
import { makeRng } from './src/rng.js';
import { DEFAULT_SKILLS, PRESETS, findSkill, resolveSkills, skillFromTemplate } from './src/skills.js';
import { DEFAULT_BESTIARY, findCreature } from './src/enemies.js';
import { act, availableActions, replay, startFight, summarize } from './src/combat.js';
import { applyResult, formatCharacter, formatParty, learnSkill, newSheet, parseCharacter, parseParty, spendPoints } from './src/sheet.js';
import { addLoot, formatMoney, parseInventory, useItems } from './src/items.js';
import { buildHandoff } from './src/handoff.js';
import { combatantFromSheet, enemiesFromRows } from './src/party.js';
import { renderBattleTab } from './src/ui/tab.js';
import { renderSettings } from './src/ui/settings.js';

const VERSION = '0.1.0';
const SETTINGS_KEY = 'rpgBattle';
const TAB_ID = 'rpg-battle';
const PROMPT_KEY = 'rpg_battle';
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const MIN_STORY_BLOCK_VERSION = [0, 7, 0];

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    characterTag: 'Character',
    partyTag: 'Party',
    inventoryTag: 'Inventory',
    // Sent for you by "Return to story", so the narration comes straight away.
    returnMessage: '*(The fight is over.)*',
    currency: DEFAULT_RULES.currency,
    // The reader's rules.json, merged over the defaults (null: the defaults).
    rules: null,
});

const CHARACTER_FIELDS = [
    { label: 'Name', type: 'text' },
    { label: 'Level', type: 'number' },
    { label: 'XP', type: 'meter', max: 100 },
    { label: 'Points', type: 'number' },
    { label: 'HP', type: 'meter', max: 100 },
    { label: 'MP', type: 'meter', max: 100 },
    ...['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(label => ({ label, type: 'number' })),
    { label: 'Checks', type: 'text' },
    { label: 'Skills', type: 'text' },
    { label: 'Conditions', type: 'text' },
];

let registered = false;
let uiRetry = null;
let settingsPanel = null;
// What the Battle tab shows when it is not dictated by the chat (a fight, a result).
let screen = { chatId: null, mode: null };
// The fight being played, replayed from the chat's metadata once per chat.
let live = { chatId: null, key: '', fight: null };

// ---------------------------------------------------------------------------
// SillyTavern and Story Block access

function context() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function versionAtLeast(text, wanted) {
    const parts = String(text ?? '').split('.').map(Number);
    for (let index = 0; index < wanted.length; index++) {
        const have = parts[index] || 0;
        if (have !== wanted[index]) return have > wanted[index];
    }
    return true;
}

function storyBlock() {
    const api = globalThis.StoryBlock;
    return api && Number(api.apiVersion) >= 1 && versionAtLeast(api.version, MIN_STORY_BLOCK_VERSION) ? api : null;
}

function chatIdOf(ctx) {
    try { return ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? null; }
    catch { return ctx?.chatId ?? null; }
}

function chatMeta(ctx = context()) {
    return ctx?.chatMetadata ?? ctx?.chat_metadata ?? null;
}

function notify(level, message, options) {
    return globalThis.toastr?.[level]?.(message, 'RPG Battle', options);
}

function isAssistant(message) {
    return Boolean(message) && !message.is_user && !message.is_system;
}

function latestAssistantIndex(chat) {
    for (let index = chat.length - 1; index >= 0; index--) if (isAssistant(chat[index])) return index;
    return -1;
}

function settings(ctx = context()) {
    const store = ctx?.extensionSettings;
    if (!store) return { ...DEFAULT_SETTINGS };
    const saved = store[SETTINGS_KEY] && typeof store[SETTINGS_KEY] === 'object' ? store[SETTINGS_KEY] : {};
    store[SETTINGS_KEY] = {
        ...DEFAULT_SETTINGS,
        ...saved,
        currency: { ...DEFAULT_SETTINGS.currency, ...(saved.currency && typeof saved.currency === 'object' ? saved.currency : {}) },
    };
    return store[SETTINGS_KEY];
}

function rules() {
    const own = settings();
    return makeRules({ ...(own.rules ?? {}), currency: own.currency });
}

// Per-chat state: { fight: { setup, actions } | null, pending: { handoff, fightId, attachedTo } | null,
// last: the last result for the tab, skills: skills this story taught (by hand),
// uses: { [memberId]: { [skill]: n } } fight uses toward the next mastery, which the sheet text does not carry }.
function chatState(ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return { fight: null, pending: null };
    const state = meta[SETTINGS_KEY] && typeof meta[SETTINGS_KEY] === 'object' ? meta[SETTINGS_KEY] : {};
    return {
        fight: state.fight ?? null,
        pending: state.pending ?? null,
        last: state.last ?? null,
        skills: Array.isArray(state.skills) ? state.skills : [],
        uses: state.uses && typeof state.uses === 'object' ? state.uses : {},
    };
}

function saveChatState(change) {
    const ctx = context();
    const meta = chatMeta(ctx);
    if (!meta) return;
    meta[SETTINGS_KEY] = { ...chatState(ctx), ...change };
    ctx.saveMetadataDebounced?.();
}

// The skill library: the shipped skills and the ones this story taught.
function library(ctx = context()) {
    return [...DEFAULT_SKILLS, ...chatState(ctx).skills];
}

// ---------------------------------------------------------------------------
// The sheets

function blockText(tag) {
    return storyBlock()?.getBlock?.(tag)?.text ?? '';
}

function currentSheet() {
    const text = blockText(settings().characterTag);
    if (!text.trim()) return null;
    return parseCharacter(text, rules()).sheet;
}

function currentParty() {
    const text = blockText(settings().partyTag);
    return text.trim() ? parseParty(text, rules()).members : [];
}

function currentItems() {
    return parseInventory(blockText(settings().inventoryTag)).items;
}

async function writeBlock(tag, text) {
    const ctx = context();
    const sb = storyBlock();
    const target = latestAssistantIndex(ctx?.chat ?? []);
    if (!sb || target < 0) throw new Error('There is no reply to write into yet: start the chat first.');
    await sb.setBlockText(target, tag, text);
}

async function writeSheet(sheet) {
    await writeBlock(settings().characterTag, formatCharacter(sheet, rules()));
}

async function writeParty(members) {
    await writeBlock(settings().partyTag, formatParty(members, rules()));
}

// ---------------------------------------------------------------------------
// Fights

function fightKey(saved) {
    return saved ? `${saved.setup?.id}:${saved.actions?.length ?? 0}` : '';
}

/** The fight being played (replayed from metadata when the chat or its actions changed). */
function currentFight() {
    const ctx = context();
    const saved = chatState(ctx).fight;
    const chatId = chatIdOf(ctx);
    if (!saved) {
        live = { chatId, key: '', fight: null };
        return null;
    }
    const key = fightKey(saved);
    if (live.chatId !== chatId || live.key !== key) {
        try {
            live = { chatId, key, fight: replay({ setup: saved.setup, actions: saved.actions ?? [] }, rules()) };
        } catch (error) {
            console.error('[RPG Battle] could not replay the fight', error);
            saveChatState({ fight: null });
            live = { chatId, key: '', fight: null };
        }
    }
    return live.fight;
}

function startNewFight({ rows, stakes }) {
    const ctx = context();
    const sheet = currentSheet();
    if (!sheet) throw new Error('Make your character first.');
    const r = rules();
    const id = `fight-${Date.now().toString(36)}`;
    const seed = `${chatIdOf(ctx)}:${id}`;
    const items = currentItems();
    const party = [
        combatantFromSheet(sheet, { memberId: 'pc', controller: 'player', gear: items.filter(item => item.equipped), items, library: library(), rules: r }),
        ...currentParty().map(member => combatantFromSheet(member.sheet, {
            memberId: member.id,
            controller: member.control === 'command' ? 'player' : 'auto',
            gear: member.gear ?? [],
            items: [],
            library: library(),
            rules: r,
        })),
    ];
    // A blank rank: a bestiary creature keeps its own, anything else is a fair fight for the party.
    const fair = suggestRank(sheet.level, r);
    const ranked = (rows ?? []).map(row => ({ ...row, rank: row.rank || (findCreature(DEFAULT_BESTIARY, row.name) ? null : fair) }));
    const enemies = enemiesFromRows(ranked, { bestiary: DEFAULT_BESTIARY, library: library(), rules: r, rng: makeRng(`${seed}:enemies`) });
    if (!enemies.length) throw new Error('Name at least one enemy.');
    const setup = { id, seed, party, enemies, stakes: stakes === 'death' ? 'death' : 'normal' };
    // Validate by starting it once; the stored form is the setup and the actions.
    startFight({ ...setup, rules: r });
    saveChatState({ fight: { setup, actions: [] } });
    screen = { chatId: chatIdOf(ctx), mode: 'fight' };
}

async function playAction(action) {
    const fight = currentFight();
    if (!fight) return;
    const saved = chatState().fight;
    const next = act(fight, action, rules());
    saveChatState({ fight: { ...saved, actions: [...(saved.actions ?? []), action] } });
    live = { chatId: chatIdOf(context()), key: fightKey({ setup: saved.setup, actions: [...(saved.actions ?? []), action] }), fight: next };
    if (next.status !== 'active') await finishFight(next);
}

// The end of a fight: the result applied to the sheets and the inventory, and the hand-off
// waiting for the next reply.
let finishing = null;

async function finishFight(fight) {
    // Once per fight, even if a redraw asks again while the writes are under way.
    if (finishing === fight.id) return;
    finishing = fight.id;
    const r = rules();
    const own = settings();
    const result = summarize(fight, r);
    // The fight is over before anything is written: the block writes save the chat, and the
    // saved chat must not hold a fight that is still "active".
    saveChatState({ fight: null });
    const sheet = currentSheet();
    const report = { levelsGained: 0, pointsGained: 0 };
    const uses = { ...chatState().uses };
    try {
        if (sheet) {
            const applied = applyResult({ ...sheet, uses: uses.pc ?? {} }, 'pc', result, r);
            report.levelsGained = applied.levelsGained;
            report.pointsGained = applied.pointsGained;
            uses.pc = applied.sheet.uses ?? {};
            await writeSheet(applied.sheet);
        }
        const members = currentParty();
        if (members.length) {
            await writeParty(members.map(member => {
                const applied = applyResult({ ...member.sheet, uses: uses[member.id] ?? {} }, member.id, result, r);
                uses[member.id] = applied.sheet.uses ?? {};
                return { ...member, sheet: applied.sheet };
            }));
        }
        const inventory = blockText(own.inventoryTag);
        if (inventory.trim() || result.loot?.items?.length || result.loot?.money) {
            let next = useItems(inventory, result.itemsUsed?.pc ?? {});
            if (result.outcome === 'victory') next = addLoot(next, result.loot ?? { items: [], money: 0 }, r.currency);
            if (next !== inventory) await writeBlock(own.inventoryTag, next);
        }
    } catch (error) {
        notify('error', `The result could not be written: ${error instanceof Error ? error.message : String(error)}`);
        console.error('[RPG Battle] writing the result failed', error);
    }
    const handoff = buildHandoff(result, {
        names: Object.fromEntries(fight.combatants.map(entry => [entry.id, entry.name])),
        currency: r.currency,
        stakes: fight.stakes,
        pcName: sheet?.name ?? 'You',
    });
    saveChatState({ fight: null, pending: { handoff, fightId: fight.id, attachedTo: null }, last: { fightId: fight.id, result, handoff, ...report }, uses });
    await context()?.saveMetadata?.();
    finishing = null;
    live = { chatId: chatIdOf(context()), key: '', fight: null };
    screen = { chatId: chatIdOf(context()), mode: 'result' };
    storyBlock()?.refresh?.();
}

// ---------------------------------------------------------------------------
// The hand-off: injected once, into the next reply and its swipes

function setPrompt(text) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    ctx.setExtensionPrompt(PROMPT_KEY, text, EXTENSION_PROMPT_IN_CHAT, 1, false, EXTENSION_PROMPT_ROLE_SYSTEM);
}

async function onGenerationInterceptor(chat, _contextSize, _abort, type = 'normal') {
    try {
        const kind = String(type ?? 'normal').toLowerCase();
        if (kind === 'quiet' || kind === 'impersonate') return;
        const ctx = context();
        const { pending } = chatState(ctx);
        if (!pending || !settings(ctx).enabled) {
            setPrompt('');
            return;
        }
        const replacing = (kind.includes('swipe') || kind.includes('regenerate')) && isAssistant(chat.at(-1));
        const replyIndex = replacing ? chat.length - 1 : chat.length;
        if (pending.attachedTo === null || pending.attachedTo === undefined) {
            saveChatState({ pending: { ...pending, attachedTo: replyIndex } });
            setPrompt(pending.handoff);
        } else if (pending.attachedTo === replyIndex) {
            // A swipe of the narrating reply narrates the same result.
            setPrompt(pending.handoff);
        } else {
            // The story has moved past the narration: the hand-off is spent.
            saveChatState({ pending: null });
            setPrompt('');
        }
    } catch (error) {
        console.error('[RPG Battle] interceptor failed', error);
    }
}

globalThis.rpgBattleInterceptor = onGenerationInterceptor;

function returnToStory() {
    const text = settings().returnMessage;
    const box = document.getElementById('send_textarea');
    const send = document.getElementById('send_but');
    screen = { chatId: chatIdOf(context()), mode: null };
    storyBlock()?.refresh?.();
    if (!box || !send || !text) return;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();
}

// ---------------------------------------------------------------------------
// The Battle tab

function viewFor() {
    const ctx = context();
    const chatId = chatIdOf(ctx);
    if (screen.chatId !== chatId) screen = { chatId, mode: null };
    const r = rules();
    const fight = currentFight();
    if (fight && fight.status !== 'active') {
        // A finished fight still stored (the page closed before its end was saved): record it now,
        // unless its result already is.
        if (chatState(ctx).last?.fightId === fight.id) saveChatState({ fight: null });
        else void finishFight(fight).then(() => storyBlock()?.refresh?.());
    } else if (fight) {
        return { mode: 'fight', fight, actions: availableActions(fight, r), rules: r };
    }
    const state = chatState(ctx);
    if (screen.mode === 'result' && state.last) {
        const money = state.last.result?.loot?.money ?? 0;
        return { mode: 'result', result: state.last.result, handoff: state.last.handoff, levelsGained: state.last.levelsGained, pointsGained: state.last.pointsGained, moneyText: money ? formatMoney(money, r.currency) : '', rules: r };
    }
    const sheet = currentSheet();
    if (!sheet) return { mode: 'create', presets: PRESETS, library: DEFAULT_SKILLS.filter(skill => skill.tier === 1), rules: r };
    const skills = resolveSkills(sheet.skills, library(ctx), sheet.level, r);
    if (screen.mode === 'spend') return { mode: 'spend', sheet, rules: r };
    if (screen.mode === 'learn') return { mode: 'learn', sheet, library: library(ctx), rules: r };
    if (screen.mode === 'setup') {
        return { mode: 'setup', bestiary: DEFAULT_BESTIARY.map(entry => entry.name), suggestedRank: suggestRank(sheet.level, r), rules: r };
    }
    return { mode: 'idle', sheet, checks: checkModifiers(sheet.stats, r), skills, party: currentParty(), rules: r, pending: state.pending?.handoff ?? null };
}

function go(mode) {
    screen = { chatId: chatIdOf(context()), mode };
    storyBlock()?.refresh?.();
}

async function guarded(action) {
    try {
        await action();
    } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error));
        console.error('[RPG Battle]', error);
    }
    storyBlock()?.refresh?.();
}

const handlers = {
    onCreate: input => void guarded(async () => {
        // The tab sends the stats as totals; a new sheet takes the points spent on top of the start.
        const r = rules();
        const allocation = Object.fromEntries(Object.entries(input.stats ?? {}).map(([stat, value]) => [stat, Math.max(0, Number(value) - r.character.startStat)]));
        const sheet = newSheet({ ...input, stats: allocation }, r);
        await writeSheet(sheet);
        screen = { chatId: chatIdOf(context()), mode: null };
        notify('success', `${sheet.name} is ready.`);
    }),
    onSpend: () => go('spend'),
    onConfirmSpend: allocation => void guarded(async () => {
        await writeSheet(spendPoints(currentSheet(), allocation, rules()));
        screen = { chatId: chatIdOf(context()), mode: null };
    }),
    onLearn: () => go('learn'),
    onConfirmLearn: ({ name, fromLibrary = false, template = null }) => void guarded(async () => {
        const sheet = currentSheet();
        const skillName = String(name ?? '').trim();
        if (!skillName) throw new Error('Give the skill a name.');
        if (!fromLibrary && template) {
            // A story-taught skill: kept with this chat, so its numbers survive a reload.
            const custom = skillFromTemplate({ name: skillName, ...template }, sheet.level, rules());
            saveChatState({ skills: [...chatState().skills.filter(skill => skill.name.toLowerCase() !== skillName.toLowerCase()), custom] });
        } else if (!findSkill(library(), skillName)) {
            throw new Error(`"${skillName}" is not in the skill library.`);
        }
        await writeSheet(learnSkill(sheet, skillName));
        screen = { chatId: chatIdOf(context()), mode: null };
    }),
    onSetup: () => {
        const sheet = currentSheet();
        if (sheet && sheet.hp.cur <= 0) {
            notify('warning', `${sheet.name} is down: rest (or heal) first.`);
            return;
        }
        go('setup');
    },
    onRest: () => void guarded(async () => {
        const sheet = currentSheet();
        if (!sheet) return;
        // Full HP and MP; fight conditions (poison and the like) wear off with the rest.
        await writeSheet({ ...sheet, hp: { ...sheet.hp, cur: sheet.hp.max }, mp: { ...sheet.mp, cur: sheet.mp.max }, conditions: [] });
        const members = currentParty();
        if (members.length) {
            await writeParty(members.map(member => ({ ...member, sheet: { ...member.sheet, hp: { ...member.sheet.hp, cur: member.sheet.hp.max }, mp: { ...member.sheet.mp, cur: member.sheet.mp.max }, conditions: [] } })));
        }
        notify('success', `${sheet.name} is rested.`);
    }),
    onBack: () => go(null),
    onStart: setup => void guarded(async () => {
        startNewFight(setup);
    }),
    onAction: action => void guarded(() => playAction(action)),
    onAuto: () => void guarded(() => playAction({ type: 'auto' })),
    onReturn: () => returnToStory(),
    onDiscard: () => {
        saveChatState({ pending: null });
        setPrompt('');
        go(null);
    },
    onDone: () => go(null),
};

function tabKey() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    const state = chatState(ctx);
    const last = chat.at(-1);
    return [chatIdOf(ctx), chat.length, String(last?.mes ?? '').length, screen.mode, fightKey(state.fight), state.pending?.fightId ?? '', JSON.stringify(settings())].join('|');
}

function renderTab(pane) {
    const view = viewFor();
    renderBattleTab(pane, view, handlers);
}

// ---------------------------------------------------------------------------
// Registration

function registerKeptBlocks(sb) {
    const own = settings();
    const results = [
        sb.registerBlock({
            id: 'rpg-character',
            tag: own.characterTag,
            name: 'Character',
            icon: '🛡️',
            kept: true,
            owner: 'RPG Battle',
            format: 'fields',
            display: 'fields',
            fields: CHARACTER_FIELDS,
            promptNote: 'Your character as the game knows them: level, HP and MP, stats and skills. Fights are resolved by RPG Battle; describe what the sheet says.',
            diceModifier: `Modifier: the matching stat's bonus from the <${own.characterTag}> block's Checks line (for example CHA +1); do not guess one.`,
        }),
        sb.registerBlock({
            id: 'rpg-party',
            tag: own.partyTag,
            name: 'Party',
            icon: '👥',
            kept: true,
            owner: 'RPG Battle',
            format: 'text',
            display: 'plain',
            promptNote: 'Companions fighting alongside you, as the game knows them.',
        }),
    ];
    for (const result of results) if (result && result.ok === false) console.warn('[RPG Battle] block not registered:', result.error);
}

function registerWithStoryBlock() {
    if (registered) return true;
    const sb = storyBlock();
    if (!sb) return false;
    registerKeptBlocks(sb);
    sb.registerTab({
        id: TAB_ID,
        label: 'Battle',
        icon: '⚔️',
        order: 80,
        isAvailable: () => settings().enabled,
        key: tabKey,
        badge: () => (currentFight() ? 1 : 0),
        render: pane => renderTab(pane),
    });
    registered = true;
    return true;
}

function addSettingsPanel(documentRef) {
    if (documentRef.querySelector('#rpg_battle_settings')) return true;
    const host = documentRef.querySelector('#extensions_settings2') ?? documentRef.querySelector('#extensions_settings');
    if (!host) return false;
    const wrapper = documentRef.createElement('div');
    wrapper.id = 'rpg_battle_settings';
    host.appendChild(wrapper);
    settingsPanel = renderSettings(wrapper, {
        settings: settings(),
        version: `v${VERSION}`,
        status: storyBlock() ? '' : 'Needs Story Block 0.7 or newer.',
        onChange: next => {
            const ctx = context();
            ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next };
            ctx.saveSettingsDebounced?.();
            storyBlock()?.refresh?.();
        },
    });
    return Boolean(settingsPanel);
}

function ensureUi() {
    const panel = addSettingsPanel(document);
    const linked = registerWithStoryBlock();
    if (panel && linked) {
        if (uiRetry) clearTimeout(uiRetry);
        uiRetry = null;
        return;
    }
    uiRetry = setTimeout(ensureUi, 500);
}

function init() {
    if (!globalThis.SillyTavern?.getContext) {
        setTimeout(init, 100);
        return;
    }
    ensureUi();
    const ctx = context();
    const events = ctx?.event_types ?? ctx?.eventTypes ?? {};
    for (const event of [events.CHAT_CHANGED, events.CHAT_LOADED]) {
        if (event) ctx.eventSource?.on?.(event, () => {
            screen = { chatId: chatIdOf(context()), mode: null };
            live = { chatId: null, key: '', fight: null };
            setPrompt('');
        });
    }
    console.info(`[RPG Battle] v${VERSION} loaded.`);
}

init();
