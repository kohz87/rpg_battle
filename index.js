// RPG Battle: SillyTavern glue.
//
// Everything that touches SillyTavern or Story Block lives here; the rules, the fight and the
// sheets are pure modules under src/. The Character and Party sheets are Story Block blocks
// "kept by an extension": the model reads them every reply and never writes them; this file
// writes them, with Story Block's setBlockText, into the latest reply (so deleting that reply
// rolls them back). A fight is stored in the chat's metadata as its setup and actions and
// replayed with its seed; its result reaches the story once, through the generate interceptor.
//
// Between fights the story itself moves the numbers. After each reply one pipeline
// (afterReply) takes the sheets as they were before that reply, heals them by the story time
// it moved on, applies the reply's hidden <Wounds>, and writes the result into that reply
// once, so a swipe or a continue recomputes it instead of adding to it. A reply's
// <Encounter> (or a fight Story Director planned) is offered as a fight, never started.
//
// Levels and XP wear the reader's own words (settings `terms`, merged into rules as
// `rules.terms`, see src/terms.js): the blocks, the tab, the hand-off and the enemy power
// picker all speak them, and the Character block's fields are registered under them.

import { DEFAULT_RULES, checkModifiers, makeRules, suggestRank } from './src/rules.js';
import { hashSeed, makeRng } from './src/rng.js';
import { DEFAULT_SKILLS, PRESETS, findSkill, resolveSkills, skillFromTemplate } from './src/skills.js';
import { DEFAULT_BESTIARY, findCreature } from './src/enemies.js';
import { act, availableActions, replay, startFight, summarize } from './src/combat.js';
import { applyResult, formatCharacter, formatParty, learnSkill, newSheet, parseCharacter, parseParty, spendPoints } from './src/sheet.js';
import { addLoot, consumables, formatMoney, parseInventory, useItems } from './src/items.js';
import { buildHandoff } from './src/handoff.js';
import { combatantFromSheet, editCompanion, enemiesFromRows, newCompanion, remapIds } from './src/party.js';
import { recoverOverTime, rest, useItemOutside } from './src/recovery.js';
import { STORY_INSTRUCTION, applyWounds, describeWound, parseEncounter, parseWounds } from './src/story.js';
import { renderBattleTab } from './src/ui/tab.js';
import { renderSettings } from './src/ui/settings.js';
import { DEFAULT_TERMS, maxLevel, termsOf } from './src/terms.js';

const VERSION = '0.3.0';
const SETTINGS_KEY = 'rpgBattle';
const TAB_ID = 'rpg-battle';
const PROMPT_KEY = 'rpg_battle';
// The story instruction (<Wounds>, <Encounter>) has its own key: the hand-off comes and goes
// with one reply, the instruction stays on.
const RULES_PROMPT_KEY = 'rpg_battle_rules';
// Transport-only tags: Story Block moves them into its hidden envelope, out of the narration.
const WOUNDS_TAG = 'Wounds';
const ENCOUNTER_TAG = 'Encounter';
// Story Block's own Character Sheet block (a template of its own), which keeps a second HP.
const STORY_SHEET_TEMPLATE = 'character-sheet';
// How many dismissed encounter offers are remembered per chat.
const DISMISSED_KEPT = 30;
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
    // HP and MP come back as story time passes (needs Story Director's clock).
    recoverWithTime: true,
    // What the reader's world calls levels and XP, tier titles and the level cap (src/terms.js).
    terms: DEFAULT_TERMS,
    // The reader's rules.json, merged over the defaults (null: the defaults).
    rules: null,
});

// The Character block's fields for Story Block's Fields display, under the reader's terms:
// "Soul Class" (text with tiers, since it reads "III (Lv 24)") and "Soul Growth" as a meter.
function characterFields(r) {
    const terms = termsOf(r);
    return [
        { label: 'Name', type: 'text' },
        { label: terms.levelName, type: terms.tiers ? 'text' : 'number' },
        { label: terms.xpName, type: 'meter', max: 100 },
        { label: 'Points', type: 'number' },
        { label: 'HP', type: 'meter', max: 100 },
        { label: 'MP', type: 'meter', max: 100 },
        ...['STR', 'VIT', 'AGI', 'DEX', 'INT', 'LUK', 'CHA'].map(label => ({ label, type: 'number' })),
        { label: 'Checks', type: 'text' },
        { label: 'State', type: 'text' },
        { label: 'Skills', type: 'text' },
        { label: 'Conditions', type: 'text' },
    ];
}

// What the model is told about each kept block, under Story Block's 300-character limit.
// The numbers alone do not say how to play someone at a fifth of their HP, so the notes
// point at the State line (narrative.js) and make it binding. The scene board's PC card has a
// Visible Condition the model writes itself; State is the source, so the note ties the two
// together rather than let them disagree. Story Block does not fill in placeholders here,
// hence "the character" and "each companion" rather than names.
const CHARACTER_NOTE = 'Your character as the game knows them. Portray the character exactly as the State line says (badly hurt means bleeding and slow; down means unconscious or unable to fight) and never contradict it; the scene\'s Visible Condition must agree. HP, MP and conditions change only through RPG Battle.';
const PARTY_NOTE = 'Companions fighting alongside you, as the game knows them. Portray each companion exactly as their State line says (badly hurt means bleeding and slow; down means unconscious or unable to fight) and never contradict it; HP, MP and conditions change only through RPG Battle.';

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
        terms: { ...DEFAULT_SETTINGS.terms, ...(saved.terms && typeof saved.terms === 'object' ? saved.terms : {}) },
    };
    return store[SETTINGS_KEY];
}

function rules() {
    const own = settings();
    return makeRules({ ...(own.rules ?? {}), currency: own.currency, terms: own.terms });
}

// Per-chat state: { fight: { setup, actions } | null, pending: { handoff, fightId, attachedTo } | null,
// last: the last result for the tab, skills: skills this story taught (by hand),
// uses: { [memberId]: { [skill]: n } } fight uses toward the next mastery, which the sheet text does not carry,
// recovered: { index, text } the last story-time recovery,
// story: { index, signature, applied, undone, written } the last reply's story wounds (signature: a hash
// of its <Wounds> text; written: hashes of the sheet texts the pipeline wrote into it),
// dismissed: ['index:encounter text'] encounter offers the reader said Not now to }.
function chatState(ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return { fight: null, pending: null, story: null, dismissed: [] };
    const state = meta[SETTINGS_KEY] && typeof meta[SETTINGS_KEY] === 'object' ? meta[SETTINGS_KEY] : {};
    return {
        fight: state.fight ?? null,
        pending: state.pending ?? null,
        last: state.last ?? null,
        skills: Array.isArray(state.skills) ? state.skills : [],
        uses: state.uses && typeof state.uses === 'object' ? state.uses : {},
        recovered: state.recovered ?? null,
        story: state.story && typeof state.story === 'object' ? state.story : null,
        dismissed: Array.isArray(state.dismissed) ? state.dismissed : [],
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
    // An empty party is still written, so the last companion leaving is a change the chat keeps.
    await writeBlock(settings().partyTag, formatParty(members, rules()) || 'No companions.');
}

// The Character and Party blocks written again in the current terms, so the model reads the
// new words from the next reply on rather than after the next change to a sheet. Quiet: with
// no chat or no reply yet there is nothing to rewrite.
async function rewriteSheets() {
    try {
        if (chatState().fight) return;
        const sheet = currentSheet();
        if (sheet) await writeSheet(sheet);
        const members = currentParty();
        if (members.length) await writeParty(members);
    } catch (error) {
        console.warn('[RPG Battle] the sheets could not be rewritten in the new terms', error);
    }
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
    // A blank power: a bestiary creature keeps its own rank, anything else is a fair fight for the
    // party. A row picked in the reader's terms carries a level instead (interpolated on the
    // rank table by projectEnemy).
    const fair = suggestRank(sheet.level, r);
    const ranked = (rows ?? []).map(row => {
        const level = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
        return { ...row, level, rank: level ? null : row.rank || (findCreature(DEFAULT_BESTIARY, row.name) ? null : fair) };
    });
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
    const report = { levelsGained: 0, pointsGained: 0, levelsReached: 0 };
    const uses = { ...chatState().uses };
    try {
        if (sheet) {
            const applied = applyResult({ ...sheet, uses: uses.pc ?? {} }, 'pc', result, r);
            report.levelsGained = applied.levelsGained;
            report.pointsGained = applied.pointsGained;
            report.levelsReached = applied.levelsGained ? applied.sheet.level : 0;
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
        rules: r,
    });
    saveChatState({ fight: null, pending: { handoff, fightId: fight.id, attachedTo: null }, last: { fightId: fight.id, result, handoff, ...report }, uses });
    await context()?.saveMetadata?.();
    finishing = null;
    live = { chatId: chatIdOf(context()), key: '', fight: null };
    screen = { chatId: chatIdOf(context()), mode: 'result' };
    storyBlock()?.refresh?.();
}

// ---------------------------------------------------------------------------
// After each reply: story time and story wounds (DESIGN §8.5, §8.6)

function storyClock() {
    const api = globalThis.StoryDirector;
    return api && Number(api.apiVersion) >= 1 && typeof api.timeAt === 'function' ? api : null;
}

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]);
}

const textHash = text => String(hashSeed(String(text ?? '').trim()));

/** A block as RPG Battle's own copy (kept) or the model's (transport) in one message's text, or null. */
function blockAt(sb, index, tag) {
    const found = sb.blockInText?.(context()?.chat?.[index]?.mes ?? '', tag);
    return found ? String(found.text ?? '').trim() : null;
}

/** The reply's <Wounds> text and its signature (empty when it has none). */
function woundsAt(sb, index) {
    const text = blockAt(sb, index, WOUNDS_TAG) ?? '';
    return { text, signature: text ? textHash(text) : '' };
}

/**
 * The sheets as they should stand in reply `index`: the ones before it (so a swipe or a
 * continue starts from the same place), healed by the story time it moved on, then hurt or
 * healed by its <Wounds> when `withWounds`. Recovery comes first: the hours a reply covers
 * mostly come before its last event, and a wound taken at the end of a long march should
 * still show. Nothing is written here.
 */
function planReply(sb, index, { withWounds = true } = {}) {
    const own = settings();
    const r = rules();
    const characterText = sb.getBlock(own.characterTag, { beforeIndex: index })?.text ?? '';
    const before = characterText.trim() ? parseCharacter(characterText, r).sheet : null;
    const partyText = sb.getBlock(own.partyTag, { beforeIndex: index })?.text ?? '';
    const members = partyText.trim() ? parseParty(partyText, r).members : [];
    let pc = before;
    let party = members;
    let note = '';
    const clock = storyClock();
    if (before && clock && own.recoverWithTime) {
        const now = clock.timeAt(index);
        const then = clock.timeAt(index - 1);
        if (now !== null && then !== null && now > then) {
            const hours = (now - then) / 60;
            const gear = parseInventory(sb.getBlock(own.inventoryTag, { beforeIndex: index })?.text ?? '').items.filter(item => item.equipped);
            const mine = recoverOverTime(before, hours, { gear, rules: r });
            const theirs = members.map(member => ({ member, recovery: recoverOverTime(member.sheet, hours, { gear: member.gear ?? [], rules: r }) }));
            if (mine.kind || theirs.some(entry => entry.recovery.kind)) {
                pc = mine.sheet;
                party = theirs.map(({ member, recovery }) => ({ ...member, sheet: recovery.sheet }));
                const span = hours >= 1 ? `${Math.round(hours * 10) / 10} hours` : `${Math.round(hours * 60)} minutes`;
                note = mine.kind === 'long'
                    ? `${span} passed: ${before.name} is fully rested.`
                    : mine.kind ? `${span} passed: ${before.name} recovers ${mine.hp} HP and ${mine.mp} MP.` : `${span} passed: the party recovers.`;
            }
        }
    }
    let applied = [];
    const wounds = woundsAt(sb, index);
    if (withWounds && wounds.text) {
        const result = applyWounds({ pc, members: party }, parseWounds(wounds.text), r);
        ({ pc, applied } = result);
        party = result.members;
    }
    return { before, members, pc, party, note, applied, signature: wounds.signature };
}

/**
 * Writes a plan into reply `index`, once, and only what differs. A sheet already in that
 * reply that the pipeline did not write (a fight, a rest or an item since) is left alone and
 * nothing is written: recomputing from the sheets before the reply would throw that away.
 * { ok, written: { character, party } } with the hashes of what the reply now holds from us.
 */
async function writePlan(sb, index, plan, story) {
    const own = settings();
    const r = rules();
    const ours = story?.index === index ? story.written ?? {} : {};
    const targets = [
        { key: 'character', tag: own.characterTag, before: plan.before ? formatCharacter(plan.before, r) : null, next: plan.pc ? formatCharacter(plan.pc, r) : null },
        { key: 'party', tag: own.partyTag, before: plan.members.length ? formatParty(plan.members, r) : null, next: plan.party.length ? formatParty(plan.party, r) : null },
    ];
    for (const target of targets) {
        target.current = blockAt(sb, index, target.tag);
        if (target.current !== null && textHash(target.current) !== ours[target.key]) return { ok: false, written: {} };
    }
    const written = { character: null, party: null };
    for (const target of targets) {
        if (target.next === null) continue;
        const changed = target.current !== null ? target.current !== target.next.trim() : target.next !== target.before;
        if (changed) await sb.setBlockText(index, target.tag, target.next);
        if (changed || target.current !== null) written[target.key] = textHash(target.next);
    }
    return { ok: true, written };
}

// One after-reply pipeline (Story Block's onReply): recovery, then wounds, written once.
async function afterReply({ messageIndex }) {
    const ctx = context();
    const sb = storyBlock();
    const own = settings(ctx);
    if (!sb || !own.enabled) return;
    const state = chatState(ctx);
    // A fight in progress owns the sheets; the story waits for its result.
    if (state.fight) return;
    const chat = ctx?.chat ?? [];
    const index = Number(messageIndex);
    if (!isAssistant(chat[index])) return;
    // A reply narrating a fight's hand-off: the fight already put its wounds on the sheets.
    const narrating = state.pending?.attachedTo === index;
    const { signature } = woundsAt(sb, index);
    // Undone stays undone for the same <Wounds> text (a continue, or the pipeline run again).
    const undone = Boolean(signature && state.story?.index === index && state.story.undone && state.story.signature === signature);
    const plan = planReply(sb, index, { withWounds: !narrating && !undone });
    let result;
    try {
        result = await writePlan(sb, index, plan, state.story);
    } catch (error) {
        console.error('[RPG Battle] the reply\'s sheets could not be written', error);
        return;
    }
    if (result.ok) {
        saveChatState({
            recovered: plan.note ? { index, text: plan.note } : state.recovered?.index === index ? null : state.recovered,
            story: { index, signature, applied: undone ? state.story.applied : plan.applied, undone, written: result.written },
        });
        if (plan.applied.length) toastWounds(plan.applied);
    }
    if (!narrating) toastEncounter(sb, index);
    sb.refresh?.();
}

/** Whether the latest story wounds can still be undone: that reply's sheets are still ours. */
function canUndoStory(ctx = context(), state = chatState(ctx)) {
    const story = state.story;
    const sb = storyBlock();
    if (!sb || !story || story.undone || !story.applied?.length || state.fight) return false;
    if (story.index !== latestAssistantIndex(ctx?.chat ?? [])) return false;
    if (woundsAt(sb, story.index).signature !== story.signature) return false;
    const own = settings(ctx);
    const written = story.written ?? {};
    return [[own.characterTag, written.character], [own.partyTag, written.party]].every(([tag, hash]) => {
        const current = blockAt(sb, story.index, tag);
        return current === null ? !hash : textHash(current) === hash;
    });
}

// Undo: that reply's sheets as the pipeline would write them without its wounds (story-time
// recovery kept), and the wounds marked undone so a continue does not bring them back.
async function undoStory() {
    const ctx = context();
    const sb = storyBlock();
    const state = chatState(ctx);
    if (!sb || !canUndoStory(ctx, state)) throw new Error('These wounds can no longer be undone: the sheets have changed since.');
    const story = state.story;
    const result = await writePlan(sb, story.index, planReply(sb, story.index, { withWounds: false }), story);
    if (!result.ok) throw new Error('These wounds can no longer be undone: the sheets have changed since.');
    saveChatState({ story: { ...story, undone: true, written: result.written } });
    notify('info', 'The story wounds are undone.');
}

/** A toast's button, wired by hand: toastr gives back the toast (a jQuery object) to find it in. */
function bindToastButton(toast, selector, action) {
    const node = toast?.[0] ?? toast;
    const target = node?.querySelector?.(selector);
    target?.addEventListener?.('click', () => {
        globalThis.toastr?.clear?.(toast);
        action();
    });
}

// The toasts carry HTML for their button, so every word in them is escaped here: names and
// causes come from the model.
function toastWounds(applied) {
    const lines = applied.map(entry => escapeHtml(describeWound(entry)));
    const html = `${lines.join('<br>')}<div class="rpg-battle-toast-actions"><button type="button" class="menu_button rpg-battle-toast-undo">Undo</button></div>`;
    const toast = notify('info', html, { escapeHtml: false, timeOut: 12000, extendedTimeOut: 6000, closeButton: true });
    bindToastButton(toast, '.rpg-battle-toast-undo', () => void guarded(undoStory));
}

function toastEncounter(sb, index) {
    if (!currentSheet()) return;
    const text = blockAt(sb, index, ENCOUNTER_TAG) ?? '';
    const rows = text ? parseEncounter(text, DEFAULT_BESTIARY, rules()) : [];
    if (!rows.length || chatState().dismissed.includes(`${index}:${text}`)) return;
    const html = `A fight is starting: ${escapeHtml(text)}<div class="rpg-battle-toast-actions"><button type="button" class="menu_button rpg-battle-toast-fight">Fight</button></div>`;
    const toast = notify('warning', html, { escapeHtml: false, timeOut: 15000, extendedTimeOut: 6000, closeButton: true });
    bindToastButton(toast, '.rpg-battle-toast-fight', () => fightEncounter(rows, `${index}:${text}`));
}

// ---------------------------------------------------------------------------
// Fights from the story (DESIGN §4.2)

/** Story Director's planned fights at `index` (due first, then soon); [] without it. */
function plannedEncounters(index) {
    const api = globalThis.StoryDirector;
    if (!api || typeof api.encountersAt !== 'function') return [];
    try {
        const list = api.encountersAt(index);
        return Array.isArray(list)
            ? list.filter(entry => entry && typeof entry.encounter === 'string' && entry.encounter.trim() && (entry.status === 'due' || entry.status === 'soon'))
            : [];
    } catch (error) {
        console.warn('[RPG Battle] Story Director\'s encounters could not be read', error);
        return [];
    }
}

/**
 * The fight the story offers now, from the latest reply: its <Encounter>, else Story
 * Director's due or soon fight. { text, label, rows, key } or null. Nothing is offered during
 * a fight or while a result waits to be narrated, nor once dismissed (by reply and text).
 */
function encounterOffer(ctx = context(), state = chatState(ctx)) {
    const sb = storyBlock();
    if (!sb || state.fight || state.pending) return null;
    const index = latestAssistantIndex(ctx?.chat ?? []);
    if (index < 0) return null;
    const candidates = [];
    const written = blockAt(sb, index, ENCOUNTER_TAG);
    if (written) candidates.push({ text: written, label: '' });
    for (const entry of plannedEncounters(index)) {
        const where = entry.place ? ` at ${entry.place}` : '';
        const when = entry.status === 'soon' ? (entry.on ? `, due ${entry.on}` : ', due soon') : '';
        candidates.push({ text: entry.encounter.trim(), label: `Planned by Story Director: ${entry.key ?? entry.id ?? 'a fight'}${where}${when}.` });
    }
    const dismissed = new Set(state.dismissed);
    for (const candidate of candidates) {
        const key = `${index}:${candidate.text}`;
        if (dismissed.has(key)) continue;
        const rows = parseEncounter(candidate.text, DEFAULT_BESTIARY, rules());
        if (rows.length) return { ...candidate, rows, key };
    }
    return null;
}

// Fight? opens the setup with the story's foes filled in; the reader still confirms them.
function fightEncounter(rows, offerKey = encounterOffer()?.key ?? null) {
    const sheet = currentSheet();
    if (sheet && sheet.hp.cur <= 0) {
        notify('warning', `${sheet.name} is down: rest (or heal) first.`);
        return;
    }
    screen = { chatId: chatIdOf(context()), mode: 'setup', prefill: Array.isArray(rows) ? rows : [], offerKey };
    storyBlock()?.refresh?.();
}

function dismissEncounter(key) {
    if (!key) return;
    const dismissed = chatState().dismissed.filter(entry => entry !== key);
    saveChatState({ dismissed: [...dismissed, key].slice(-DISMISSED_KEPT) });
}

// ---------------------------------------------------------------------------
// Story Block's own Character Sheet (DESIGN §8.6)

/** Story Block's stored blocks made from its Character Sheet template. */
function storySheetBlocks(ctx = context()) {
    const list = ctx?.extensionSettings?.storyBlock?.blocks;
    return Array.isArray(list) ? list.filter(block => block && block.template === STORY_SHEET_TEMPLATE) : [];
}

/** Whether Story Block's Character Sheet is on beside RPG Battle's sheet. */
function sheetConflict(ctx = context()) {
    if (!settings(ctx).enabled) return false;
    if (Array.isArray(ctx?.extensionSettings?.storyBlock?.blocks)) return storySheetBlocks(ctx).some(block => block.enabled);
    // Before Story Block has stored its list: its own summary (no template there, so by the template's id).
    try {
        return (storyBlock()?.listBlocks?.() ?? []).some(block => block.id === STORY_SHEET_TEMPLATE && block.enabled);
    } catch {
        return false;
    }
}

// Only when the reader asks: it is their block, and some stories want both.
function disableStorySheet() {
    const ctx = context();
    const blocks = storySheetBlocks(ctx).filter(block => block.enabled);
    for (const block of blocks) block.enabled = false;
    if (blocks.length) {
        ctx.saveSettingsDebounced?.();
        notify('success', 'Story Block\'s Character Sheet is off.');
    }
    settingsPanel?.setSheetConflict?.(sheetConflict(ctx));
    storyBlock()?.refresh?.();
}

// ---------------------------------------------------------------------------
// The hand-off: injected once, into the next reply and its swipes

function setPrompt(text, key = PROMPT_KEY) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    ctx.setExtensionPrompt(key, text, EXTENSION_PROMPT_IN_CHAT, 1, false, EXTENSION_PROMPT_ROLE_SYSTEM);
}

/** The hand-off for the reply being generated ('' when there is none), attaching it once. */
function handoffFor(chat, kind) {
    const { pending } = chatState();
    if (!pending) return '';
    const replacing = (kind.includes('swipe') || kind.includes('regenerate')) && isAssistant(chat.at(-1));
    const replyIndex = replacing ? chat.length - 1 : chat.length;
    if (pending.attachedTo === null || pending.attachedTo === undefined) {
        saveChatState({ pending: { ...pending, attachedTo: replyIndex } });
        return pending.handoff;
    }
    // A swipe of the narrating reply narrates the same result.
    if (pending.attachedTo === replyIndex) return pending.handoff;
    // The story has moved past the narration: the hand-off is spent.
    saveChatState({ pending: null });
    return '';
}

async function onGenerationInterceptor(chat, _contextSize, _abort, type = 'normal') {
    try {
        const kind = String(type ?? 'normal').toLowerCase();
        if (kind === 'quiet' || kind === 'impersonate') {
            // A summary or an impersonation is no story reply: no <Wounds> or <Encounter> asked
            // for, and no fight hand-off either (it waits for the next real reply).
            setPrompt('', RULES_PROMPT_KEY);
            setPrompt('');
            return;
        }
        const ctx = context();
        const own = settings(ctx);
        const handoff = own.enabled ? handoffFor(chat, kind) : '';
        setPrompt(handoff);
        // The story instruction, while there is a sheet to keep in step and no fight under way.
        // Not for the reply that narrates a fight: its wounds were dealt in the fight.
        const asks = own.enabled && !handoff && !chatState(ctx).fight && Boolean(blockText(own.characterTag).trim());
        setPrompt(asks ? STORY_INSTRUCTION : '', RULES_PROMPT_KEY);
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
        return { mode: 'result', result: state.last.result, handoff: state.last.handoff, levelsGained: state.last.levelsGained, pointsGained: state.last.pointsGained, levelsReached: state.last.levelsReached ?? 0, moneyText: money ? formatMoney(money, r.currency) : '', rules: r };
    }
    const sheet = currentSheet();
    if (!sheet) return { mode: 'create', presets: PRESETS, library: DEFAULT_SKILLS.filter(skill => skill.tier === 1), rules: r };
    const skills = resolveSkills(sheet.skills, library(ctx), sheet.level, r);
    if (screen.mode === 'spend') return { mode: 'spend', sheet, rules: r };
    if (screen.mode === 'learn') return { mode: 'learn', sheet, library: library(ctx), rules: r };
    if (screen.mode === 'items') return { mode: 'items', sheet, party: currentParty(), items: consumables(currentItems()), rules: r };
    if (screen.mode === 'companion') return { mode: 'companion', presets: PRESETS, level: sheet.level, maxLevel: Math.min(maxLevel(r), Math.max(20, sheet.level + 10)), rules: r };
    if (screen.mode === 'setup') {
        return { mode: 'setup', bestiary: DEFAULT_BESTIARY.map(entry => entry.name), suggestedRank: suggestRank(sheet.level, r), prefill: screen.prefill ?? null, rules: r };
    }
    // The last automatic recovery, while it is the latest reply's.
    const recovered = state.recovered && state.recovered.index === (ctx?.chat?.length ?? 0) - 1 ? state.recovered.text : '';
    // The latest reply's story wounds, while they stand.
    const story = state.story && !state.story.undone && state.story.applied?.length && state.story.index === latestAssistantIndex(ctx?.chat ?? [])
        ? { lines: state.story.applied.map(describeWound), canUndo: canUndoStory(ctx, state) }
        : null;
    const offer = encounterOffer(ctx, state);
    return {
        mode: 'idle', sheet, checks: checkModifiers(sheet.stats, r), skills, party: currentParty(), rules: r,
        pending: state.pending?.handoff ?? null,
        recovered,
        story,
        encounter: offer ? { text: offer.text, label: offer.label, rows: offer.rows } : null,
        sheetConflict: sheetConflict(ctx),
    };
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
    onRest: kind => void guarded(async () => {
        const r = rules();
        const sheet = currentSheet();
        if (!sheet) return;
        const length = kind === 'short' ? 'short' : 'long';
        const rested = rest(sheet, length, { gear: currentItems().filter(item => item.equipped), rules: r });
        await writeSheet(rested);
        const members = currentParty();
        if (members.length) await writeParty(members.map(member => ({ ...member, sheet: rest(member.sheet, length, { gear: member.gear ?? [], rules: r }) })));
        notify('success', length === 'long' ? `${sheet.name} is fully rested.` : `${sheet.name} catches their breath: HP ${rested.hp.cur}/${rested.hp.max}, MP ${rested.mp.cur}/${rested.mp.max}.`);
    }),
    onItems: () => go('items'),
    onUseItem: ({ name, target = 'pc' }) => void guarded(async () => {
        const own = settings();
        const item = consumables(currentItems()).find(entry => entry.name === name);
        if (!item) throw new Error(`There is no ${name} left.`);
        let outcome;
        if (target === 'pc') {
            outcome = useItemOutside(currentSheet(), item);
            if (outcome.used) await writeSheet(outcome.sheet);
        } else {
            const members = currentParty();
            const member = members.find(entry => entry.id === target);
            if (!member) throw new Error('That companion is not in the party.');
            outcome = useItemOutside(member.sheet, item);
            if (outcome.used) await writeParty(members.map(entry => (entry.id === target ? { ...entry, sheet: outcome.sheet } : entry)));
        }
        if (!outcome.used) {
            notify('info', outcome.message);
            return;
        }
        await writeBlock(own.inventoryTag, useItems(blockText(own.inventoryTag), { [item.name]: 1 }));
        notify('success', outcome.message);
    }),
    onCompanion: () => go('companion'),
    onAddCompanion: input => void guarded(async () => {
        const r = rules();
        const members = currentParty();
        const preset = PRESETS.find(entry => entry.id === input.presetId);
        const member = newCompanion({ ...input, preset }, { rules: r, existing: members });
        await writeParty([...members, member]);
        screen = { chatId: chatIdOf(context()), mode: null };
        notify('success', `${member.name} joins the party.`);
    }),
    onSetControl: (memberId, control) => void guarded(async () => {
        const members = currentParty();
        await writeParty(members.map(member => (member.id === memberId ? { ...member, control: control === 'command' ? 'command' : 'auto' } : member)));
    }),
    onEditCompanion: (memberId, changes) => void guarded(async () => {
        // A companion's id follows their name, so a rename moves what the chat keeps by id
        // (mastery progress) to the new id; sheet, skills and gear go along in the block itself.
        const members = currentParty();
        const before = members.find(member => member.id === memberId);
        const edited = editCompanion(members, memberId, changes ?? {}, { pcName: currentSheet()?.name ?? '' });
        await writeParty(edited.members);
        const uses = chatState().uses;
        if (Object.entries(edited.idMap).some(([from, to]) => from !== to && from in uses)) saveChatState({ uses: remapIds(uses, edited.idMap) });
        const after = edited.members.find(member => member.id === edited.idMap[memberId]);
        if (before && after && before.name !== after.name) notify('success', `${before.name} is now ${after.name}.`);
    }),
    onRemoveCompanion: memberId => void guarded(async () => {
        const members = currentParty();
        const leaving = members.find(member => member.id === memberId);
        await writeParty(members.filter(member => member.id !== memberId));
        if (leaving) notify('info', `${leaving.name} leaves the party.`);
    }),
    onBack: () => go(null),
    onStart: setup => void guarded(async () => {
        const offerKey = screen.offerKey ?? null;
        startNewFight(setup);
        // A fight the story offered is now being fought: the offer is spent.
        dismissEncounter(offerKey);
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
    onUndoStory: () => void guarded(undoStory),
    onFightEncounter: rows => fightEncounter(rows),
    onDismissEncounter: () => {
        dismissEncounter(encounterOffer()?.key);
        storyBlock()?.refresh?.();
    },
    onDisableStorySheet: () => disableStorySheet(),
};

function tabKey() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    const state = chatState(ctx);
    const last = chat.at(-1);
    const story = state.story ? `${state.story.index}:${state.story.signature}:${state.story.undone}:${state.story.applied?.length ?? 0}:${canUndoStory(ctx, state)}` : '';
    return [
        chatIdOf(ctx), chat.length, String(last?.mes ?? '').length, screen.mode, JSON.stringify(screen.prefill ?? null),
        fightKey(state.fight), state.pending?.fightId ?? '', state.recovered?.text ?? '', story,
        state.dismissed.length, encounterOffer(ctx, state)?.key ?? '', sheetConflict(ctx), JSON.stringify(settings()),
    ].join('|');
}

function renderTab(pane) {
    const view = viewFor();
    renderBattleTab(pane, view, handlers);
    settingsPanel?.setSheetConflict?.(sheetConflict());
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
            fields: characterFields(rules()),
            promptNote: CHARACTER_NOTE,
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
            promptNote: PARTY_NOTE,
        }),
    ];
    // The model's <Wounds> and <Encounter>: transport only, so Story Block hides them in its
    // envelope (out of the narration and the prompt's history) and RPG Battle reads them.
    results.push(
        sb.registerBlock({ id: 'rpg-wounds', tag: WOUNDS_TAG, name: 'Wounds' }),
        sb.registerBlock({ id: 'rpg-encounter', tag: ENCOUNTER_TAG, name: 'Encounter' }),
    );
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
    sb.onReply?.(payload => void afterReply(payload));
    // Story Block's settings can change under us (its Character Sheet switched on or off).
    sb.onUpdate?.(() => settingsPanel?.setSheetConflict?.(sheetConflict()));
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
        sheetConflict: sheetConflict(),
        onDisableSheet: () => disableStorySheet(),
        onChange: next => {
            const ctx = context();
            const termsBefore = JSON.stringify(termsOf(rules()));
            ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next };
            ctx.saveSettingsDebounced?.();
            // New terms rename the Character block's fields; Story Block replaces a block
            // registered again under its id.
            const sb = storyBlock();
            if (registered && sb && JSON.stringify(termsOf(rules())) !== termsBefore) {
                registerKeptBlocks(sb);
                void rewriteSheets();
            }
            settingsPanel?.setSheetConflict?.(sheetConflict(ctx));
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
            setPrompt('', RULES_PROMPT_KEY);
        });
    }
    console.info(`[RPG Battle] v${VERSION} loaded.`);
}

init();
