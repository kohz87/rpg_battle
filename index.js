// RPG Battle: SillyTavern glue.
//
// Everything that touches SillyTavern or Story Block lives here; the rules, the fight and the
// sheets are pure modules under src/. The party is one Story Block block "kept by an
// extension" (0.4: your character first, `## Ren (you)`, then the companions): the model reads
// it every reply and never writes it; this file writes it, with Story Block's setBlockText,
// into the latest reply (so deleting that reply rolls it back). A fight is stored in the chat's metadata as its setup and actions and
// replayed with its seed; its result reaches the story once, through the generate interceptor.
//
// Between fights the story itself moves the numbers. After each reply one pipeline
// (afterReply) takes the sheets as they were before that reply, heals them by the story time
// it moved on, applies the reply's hidden <Wounds>, and writes the result into that reply
// once, so a swipe or a continue recomputes it instead of adding to it. A reply's
// <Encounter> (or a fight Story Director planned) is offered as a fight, never started; its
// <Joins>, <Leaves>, <Learned>, <XP> and <Rest> (and the opening message's), Story Director's
// finished quests, a fallen companion and a rename are offers too (src/offers.js), applied
// only on Accept. The reader gets no free fight, rest, skill or companion: the story brings
// them. Two tabs: Party, always there, and Battle, only while there is a battle.
//
// Levels and XP wear the reader's own words (settings `terms`, merged into rules as
// `rules.terms`, see src/terms.js): the blocks, the tab, the hand-off and the enemy power
// picker all speak them, and the Character block's fields are registered under them.
//
// A foe neither bestiary knows is made up when its fight starts (src/templates.js), and, with
// the flavour setting on, dressed in the story's words by one short model call per new
// creature (src/flavour.js) before the first turn. It is kept in the chat's own bestiary, so
// the same name is the same creature for the rest of the story. The model never writes a
// number there either: it describes, and code maps the words onto the template.
//
// With the other Story Suite extensions installed (src/suite.js, docs/STORY_SUITE.md), RPG
// Battle announces itself as the owner of stats and rolls and the fallback for items (switched
// off, with enabled: false), and shares its party (api.members()) and, for Story Suite's
// overlay, its settings panel and api.manage (the Source of truth choices and the switch). The
// reader's source-of-truth choices decide whether Story Block's Character Sheet is pointed out
// as a second HP; alone, nothing changes.

import { DEFAULT_RULES, checkModifiers, makeRules, suggestRank } from './src/rules.js';
import { hashSeed, makeRng } from './src/rng.js';
import { DEFAULT_SKILLS, findSkill, resolveSkills, skillFromTemplate } from './src/skills.js';
import { DEFAULT_BESTIARY, findCreature } from './src/enemies.js';
import { cleanCreature, combinedBestiary, creaturesToMake, generateCreature, storeCreatures } from './src/templates.js';
import { applyFlavour, flavourPrompt, parseFlavour, sceneText } from './src/flavour.js';
import { act, availableActions, replay, startFight, summarize } from './src/combat.js';
import { applyResult, formatPartyBlock, learnSkill, newSheet, readSheets, setSkillActive, spendPoints } from './src/sheet.js';
import { addLoot, consumables, formatGearEntry, formatMoney, gearSummary, parseGearEntry, parseInventory, useItems } from './src/items.js';
import { buildHandoff } from './src/handoff.js';
import { combatantFromSheet, editCompanion, enemiesFromRows, engagements, newCompanion, remapIds } from './src/party.js';
import { recoverOverTime, restAfter, useItemOutside } from './src/recovery.js';
import { STORY_INSTRUCTION, applyWounds, describeWound, findTarget, parseEncounter, parseWounds, resolveThreats } from './src/story.js';
import { questOffers, storyOffers } from './src/offers.js';
import { awardParty, settleCompanions } from './src/growth.js';
import { guessFocus } from './src/builds.js';
import { fallbackKit, kitPrompt, kitTemplate, namedKit, parseKit, usableKit } from './src/kit.js';
import { cleanParty, exportParty } from './src/partyfile.js';
import { renderBattleTab } from './src/ui/tab.js';
import { renderSettings } from './src/ui/settings.js';
import { DEFAULT_TERMS, levelText, maxLevel, termsOf } from './src/terms.js';
import { storySuite } from './src/suite.js';
import { announcement, manageApi, partyMembers, sheetNotice, sources, suiteOverlay, suiteSignature, tokenEstimate, truthChoices } from './src/handshake.js';

const VERSION = '0.4.0';
const SETTINGS_KEY = 'rpgBattle';
// Two tabs: Party, always there while RPG Battle is on, and Battle, only while there is a battle.
const TAB_ID = 'rpg-battle';
const PARTY_TAB_ID = 'rpg-party';
const NPC_SUITE_ID = 'npc-state-delta';
const PROMPT_KEY = 'rpg_battle';
// The story instruction (<Wounds>, <Encounter>) has its own key: the hand-off comes and goes
// with one reply, the instruction stays on.
const RULES_PROMPT_KEY = 'rpg_battle_rules';
// Transport-only tags: Story Block moves them into its hidden envelope, out of the narration.
const WOUNDS_TAG = 'Wounds';
const ENCOUNTER_TAG = 'Encounter';
const JOINS_TAG = 'Joins';
const LEAVES_TAG = 'Leaves';
const LEARNED_TAG = 'Learned';
const XP_TAG = 'XP';
const REST_TAG = 'Rest';
const TRANSPORT_TAGS = [
    ['rpg-wounds', WOUNDS_TAG], ['rpg-encounter', ENCOUNTER_TAG], ['rpg-joins', JOINS_TAG],
    ['rpg-leaves', LEAVES_TAG], ['rpg-learned', LEARNED_TAG], ['rpg-xp', XP_TAG], ['rpg-rest', REST_TAG],
];
// Story Block's own Character Sheet block (a template of its own), which keeps a second HP.
const STORY_SHEET_TEMPLATE = 'character-sheet';
// How many offers put away (Not now, or taken) are remembered per chat; the opening message's
// are kept apart, so a long story never offers its start again.
const DISMISSED_KEPT = 60;
const OPENING_KEPT = 60;
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const MIN_STORY_BLOCK_VERSION = [0, 7, 0];
// Kept blocks without a sidebar tab (`tab: false`).
const NO_TAB_STORY_BLOCK = [0, 9, 1];
// Made-up creatures: at most this many flavour calls before one fight (the rest stay template
// creatures), the most a chat's bestiary keeps, and the recent story the call reads.
const FLAVOUR_PER_FIGHT = 4;
const BESTIARY_KEPT = 200;
const SCENE_MESSAGES = 6;
const SCENE_WORDS = 300;
// The condition a fight lost to the death leaves on your sheet: game over until Start over.
const DEAD = 'dead';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // The kept block with your character and the companions (0.4: one block).
    partyTag: 'Party',
    // An older chat's separate Character block: read (never written) until the Party block
    // has your section. Not in the settings panel any more.
    characterTag: 'Character',
    inventoryTag: 'Inventory',
    // Skills a member fights with (3–12); more are kept, set aside (rules.character.activeSkills).
    activeSkills: DEFAULT_RULES.character.activeSkills,
    // Companions on auto spend the points a level gives them in their build's proportions.
    autoSpend: true,
    // Sent for you by "Return to story", so the narration comes straight away.
    returnMessage: '*(The fight is over.)*',
    currency: DEFAULT_RULES.currency,
    // HP and MP come back as story time passes (needs Story Director's clock).
    recoverWithTime: true,
    // What the reader's world calls levels and XP, tier titles and the level cap (src/terms.js).
    terms: DEFAULT_TERMS,
    // Made-up creatures get the story's words from one call each, on the chat's model or a
    // connection profile; `timeoutSeconds` is the longest a fight start waits for all of them.
    flavour: { enabled: true, model: { source: 'chat' }, maxTokens: 400, timeoutSeconds: 30 },
    // How many worn pieces and accessories count in a fight (rules.gear).
    gear: { worn: DEFAULT_RULES.gear.worn, accessories: DEFAULT_RULES.gear.accessories },
    // The reader's rules.json, merged over the defaults (null: the defaults).
    rules: null,
    // Story Suite: who the story follows per shared area, 'auto' | 'mine' | 'theirs' (src/handshake.js).
    sourceOfTruth: truthChoices(null),
});

// What the model is told about the kept Party block, under Story Block's 300-character limit.
// The numbers alone do not say how to play someone at a fifth of their HP, so the note points
// at the State lines (narrative.js) and makes them binding. The scene board's PC card has a
// Visible Condition the model writes itself; State is the source, so the note ties the two
// together rather than let them disagree. Story Block does not fill in placeholders here,
// hence "(you)" rather than a name.
const PARTY_NOTE = 'Your character ("(you)") and companions as the game knows them. Portray each exactly as their State line says (badly hurt: bleeding, slow; down: unconscious or unable to fight), never contradicting it; the scene\'s Visible Condition must agree. HP, MP and conditions change only through RPG Battle.';

let registered = false;
let uiRetry = null;
let settingsPanel = null;
// What the Battle tab shows when it is not dictated by the chat (the setup, a result), and
// what the Party tab shows beside the cards (spend, learn, a companion joining, items).
let screen = { chatId: null, mode: null };
let partyScreen = { chatId: null, mode: null };
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
        flavour: { ...DEFAULT_SETTINGS.flavour, ...(saved.flavour && typeof saved.flavour === 'object' ? saved.flavour : {}) },
        gear: { ...DEFAULT_SETTINGS.gear, ...(saved.gear && typeof saved.gear === 'object' ? saved.gear : {}) },
        sourceOfTruth: truthChoices(saved.sourceOfTruth),
    };
    return store[SETTINGS_KEY];
}

const activeSkillsSetting = value => Math.min(12, Math.max(3, Math.round(Number(value)) || DEFAULT_RULES.character.activeSkills));

function rules() {
    const own = settings();
    const custom = own.rules ?? {};
    return makeRules({
        ...custom,
        character: { ...(custom.character ?? {}), activeSkills: activeSkillsSetting(own.activeSkills) },
        currency: own.currency, terms: own.terms, gear: own.gear,
    });
}

// Per-chat state: { fight: { setup, actions } | null, pending: { handoff, fightId, attachedTo } | null,
// last: the last result for the tab, skills: skills this story taught (by hand),
// uses: { [memberId]: { [skill]: n } } fight uses toward the next mastery, which the sheet text does not carry,
// recovered: { index, text } the last story-time recovery,
// story: { index, signature, applied, undone, written } the last reply's story wounds (signature: a hash
// of its <Wounds> text; written: hashes of the sheet texts the pipeline wrote into it),
// dismissed: ['index:encounter text'] encounter offers the reader said Not now to,
// bestiary: [creature] the creatures made up in this story (src/templates.js), cleaned when stored,
// npcLinks: { [memberId]: npcId } the NPC State Delta NPC a companion was added from,
// done: ['0:kind:line'] the opening message's offers taken or put away,
// fallen: [{ memberId, name }] companions who fell in a fight to the death, to remove or keep }.
function chatState(ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return { fight: null, pending: null, story: null, dismissed: [], bestiary: [], skills: [], uses: {}, npcLinks: {}, done: [], fallen: [] };
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
        bestiary: Array.isArray(state.bestiary) ? state.bestiary.filter(entry => entry && typeof entry === 'object' && entry.name) : [],
        npcLinks: state.npcLinks && typeof state.npcLinks === 'object' ? state.npcLinks : {},
        done: Array.isArray(state.done) ? state.done : [],
        fallen: Array.isArray(state.fallen) ? state.fallen.filter(entry => entry && entry.memberId) : [],
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

// The bestiary a name is looked up in: this story's made-up creatures, then the shipped ones.
function fightBestiary(ctx = context()) {
    return combinedBestiary(chatState(ctx).bestiary, DEFAULT_BESTIARY);
}

// ---------------------------------------------------------------------------
// The sheets

function blockText(tag) {
    return storyBlock()?.getBlock?.(tag)?.text ?? '';
}

/**
 * The sheets as the kept blocks hold them now, or before message `beforeIndex`: the Party
 * block, and an older chat's Character block while the Party block has no "(you)" section
 * (src/sheet.js readSheets). { pc, members, legacy }; companions carry the NPC State Delta id
 * they were added from (chat state `npcLinks`), when they have one.
 */
function sheetsAt(sb = storyBlock(), { beforeIndex = null } = {}) {
    const own = settings();
    if (!sb) return { pc: null, members: [], legacy: false };
    const party = sb.getBlock?.(own.partyTag, { beforeIndex }) ?? null;
    const character = own.characterTag && own.characterTag !== own.partyTag ? sb.getBlock?.(own.characterTag, { beforeIndex }) ?? null : null;
    const read = readSheets({
        party: party?.text ?? '',
        character: character?.text ?? '',
        partyIndex: party?.messageIndex ?? null,
        characterIndex: character?.messageIndex ?? null,
    }, rules());
    const links = chatState().npcLinks;
    return { ...read, members: read.members.map(member => (links[member.id] ? { ...member, npcId: links[member.id] } : member)) };
}

function currentSheets() {
    return sheetsAt();
}

function currentSheet() {
    return currentSheets().pc;
}

function currentParty() {
    return currentSheets().members;
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

/** The one Party block: your section, then the companions (an older Character block is left as it was). */
async function writeSheets(pc, members) {
    await writeBlock(settings().partyTag, formatPartyBlock(pc, members ?? [], rules()));
}

async function writeSheet(sheet) {
    await writeSheets(sheet, currentParty());
}

async function writeParty(members) {
    await writeSheets(currentSheet(), members);
}

// The Party block written again in the current terms, so the model reads the new words from
// the next reply on rather than after the next change to a sheet. Quiet: with no chat or no
// reply yet there is nothing to rewrite.
async function rewriteSheets() {
    try {
        if (chatState().fight) return;
        const { pc, members } = currentSheets();
        if (pc || members.length) await writeSheets(pc, members);
    } catch (error) {
        console.warn('[RPG Battle] the sheets could not be rewritten in the new terms', error);
    }
}

// An older chat keeps your sheet in the Character block, which is no longer kept (nor shown to
// the model): once its chat is open, the two are written as the one Party block, into the
// latest reply. Not during a fight (it owns the sheets), and once per chat and state.
let migration = { key: '', timer: null };

function scheduleMigration() {
    if (migration.timer) return;
    migration.timer = setTimeout(() => {
        migration.timer = null;
        void migrateLegacy();
    }, 0);
}

async function migrateLegacy() {
    try {
        const ctx = context();
        const own = settings(ctx);
        if (!own.enabled || !storyBlock() || chatState(ctx).fight || latestAssistantIndex(ctx?.chat ?? []) < 0) return;
        const { pc, members, legacy } = currentSheets();
        if (!legacy || !pc) return;
        const key = `${chatIdOf(ctx)}:${(ctx?.chat ?? []).length}`;
        if (migration.key === key) return;
        migration.key = key;
        await writeSheets(pc, members);
        console.info('[RPG Battle] the Character and Party blocks are now one Party block.');
    } catch (error) {
        console.warn('[RPG Battle] the older Character block could not be merged into the Party block', error);
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

/**
 * The setup's rows with their power settled: a row's level (picked in the reader's terms, or a
 * story threat resolved) wins; else its rank; else a creature either bestiary knows keeps its
 * own, and anything else gets the fair rank for the party. `makeAt` is the level a creature
 * made up for the row is made at.
 */
function rankedRows(rows, sheet, r, bestiary) {
    const fair = suggestRank(sheet.level, r);
    return (rows ?? []).map(row => {
        const level = Number(row.level) >= 1 ? Math.round(Number(row.level)) : null;
        const rank = level ? null : row.rank || (findCreature(bestiary, row.name) ? null : fair);
        return { ...row, level, rank, makeAt: level ?? r.ranks[rank ?? fair]?.level ?? sheet.level };
    });
}

function startNewFight({ rows, stakes }, { fresh = [] } = {}) {
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
    // A blank power: a creature either bestiary knows keeps its own power, anything else is a
    // fair fight for the party. A row picked in the reader's terms carries a level instead
    // (interpolated on the rank table by projectEnemy).
    const bestiary = fightBestiary(ctx);
    const ranked = rankedRows(rows, sheet, r, bestiary);
    const made = new Set(fresh.map(name => name.toLowerCase()));
    const all = enemiesFromRows(ranked, { bestiary, library: library(), rules: r, rng: makeRng(`${seed}:enemies`) })
        // A creature made up for this very fight wears a "new" tag on its card.
        .map(enemy => (enemy.generated && made.has(String(findCreature(bestiary, enemy.name)?.name ?? '').toLowerCase()) ? { ...enemy, fresh: true } : enemy));
    if (!all.length) throw new Error('Name at least one enemy.');
    // Engagements after the first ("then:") join as waves once the field is clear: one battle,
    // HP and MP as they stand, one result.
    const { enemies, waves } = engagements(all);
    const setup = { id, seed, party, enemies, ...(waves.length ? { waves } : {}), stakes: stakes === 'death' ? 'death' : 'normal' };
    // Validate by starting it once; the stored form is the setup and the actions.
    startFight({ ...setup, rules: r });
    saveChatState({ fight: { setup, actions: [] } });
    screen = { chatId: chatIdOf(ctx), mode: 'fight' };
}

// ---------------------------------------------------------------------------
// Made-up creatures (DESIGN §7.4)

function connectionProfiles() {
    const service = context()?.ConnectionManagerRequestService;
    try {
        return service?.getSupportedProfiles ? service.getSupportedProfiles().map(profile => ({ id: profile.id, name: profile.name })) : null;
    } catch {
        // Connection Manager switched off.
        return null;
    }
}

// One call on the chosen model: a connection profile (its own API and model) or the chat's own,
// as Story Director makes its calls.
async function sendToModel(messages, model, maxTokens) {
    const ctx = context();
    if (model?.source === 'profile' && model.profileId) {
        const service = ctx?.ConnectionManagerRequestService;
        if (!service?.sendRequest) throw new Error('Connection Manager is not available.');
        const result = await service.sendRequest(model.profileId, messages, maxTokens);
        return typeof result === 'string' ? result : String(result?.content ?? '');
    }
    if (typeof ctx?.generateRaw !== 'function') throw new Error('This SillyTavern cannot run a raw generation.');
    return String(await ctx.generateRaw({ systemPrompt: messages[0].content, prompt: messages[1].content, responseLength: maxTokens }) ?? '');
}

/** A promise that gives up after `ms` (the call itself runs on; its answer is then ignored). */
function withTimeout(promise, ms) {
    let timer = null;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), Math.max(0, ms)); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** A power as the reader reads it: their terms, or "Level 6 (rank D)" with the plain ones. */
function powerText(level, r) {
    const terms = termsOf(r);
    if (terms.custom) return levelText(level, r);
    const rank = Object.entries(r.ranks).filter(([, row]) => row.level <= level).map(([name]) => name).at(-1) ?? 'F';
    return `Level ${level} (rank ${rank})`;
}

function recentScene(ctx = context()) {
    const chat = (ctx?.chat ?? []).filter(message => message && !message.is_system).slice(-SCENE_MESSAGES);
    return sceneText(chat.map(message => ({ name: message.name || (message.is_user ? 'User' : 'Narrator'), text: message.mes })), SCENE_WORDS);
}

/**
 * The flavour for some creatures, within one deadline for all of them: on a connection
 * profile the calls go out together; on the chat's own model one after another (its
 * connection is the story's, and not every backend takes two at once). A creature whose call
 * fails, times out or says nothing usable stays the template creature; a console note says why.
 */
async function flavourAll(entries, { sheet, r }) {
    const own = settings().flavour;
    const deadline = Date.now() + Math.max(5, Number(own.timeoutSeconds) || 30) * 1000;
    const scene = recentScene();
    const party = powerText(sheet.level, r);
    const maxTokens = Math.max(100, Math.min(2000, Number(own.maxTokens) || 400));
    const one = async entry => {
        const left = deadline - Date.now();
        if (left <= 0) {
            console.info(`[RPG Battle] no time left to flavour ${entry.name}; it stays a template ${entry.template}.`);
            return entry;
        }
        try {
            const messages = flavourPrompt(entry, { power: powerText(entry.level, r), party, scene });
            const answer = await withTimeout(sendToModel(messages, own.model, maxTokens), left);
            const flavoured = applyFlavour(entry, parseFlavour(answer), { rules: r });
            if (!flavoured.flavoured) console.info(`[RPG Battle] the flavour for ${entry.name} had nothing usable; it stays a template ${entry.template}.`);
            return flavoured;
        } catch (error) {
            console.info(`[RPG Battle] ${entry.name} stays a template ${entry.template}: the flavour call failed (${error instanceof Error ? error.message : String(error)}).`);
            return entry;
        }
    };
    if (own.model?.source === 'profile' && own.model.profileId) return Promise.all(entries.map(one));
    const out = [];
    for (const entry of entries) out.push(await one(entry));
    return out;
}

let preparing = false;

/**
 * Before a fight: every name neither bestiary knows is made up from its template, flavoured
 * (the first FLAVOUR_PER_FIGHT, with the setting on) and kept in the chat's bestiary. The
 * names made, for the cards' "new" tag.
 */
async function prepareFoes(rows) {
    const ctx = context();
    const sheet = currentSheet();
    if (!sheet) throw new Error('Make your character first.');
    const r = rules();
    const state = chatState(ctx);
    const ranked = rankedRows(rows, sheet, r, fightBestiary(ctx)).map(row => ({ ...row, level: row.makeAt }));
    const made = creaturesToMake(ranked, { chatBestiary: state.bestiary, defaults: DEFAULT_BESTIARY, rules: r, seed: String(chatIdOf(ctx) ?? '') });
    if (!made.length) return [];
    let ready = made;
    const own = settings(ctx);
    if (own.flavour.enabled) {
        const names = made.slice(0, FLAVOUR_PER_FIGHT).map(entry => entry.name);
        screen = { ...screen, preparing: names };
        storyBlock()?.refresh?.();
        const toast = notify('info', `Preparing foes: ${names.join(', ')}…`, { timeOut: 0, extendedTimeOut: 0 });
        try {
            const flavoured = await flavourAll(made.slice(0, FLAVOUR_PER_FIGHT), { sheet, r });
            ready = [...flavoured, ...made.slice(FLAVOUR_PER_FIGHT)];
        } finally {
            if (toast) globalThis.toastr?.clear?.(toast);
            screen = { ...screen, preparing: null };
        }
    }
    saveChatState({ bestiary: storeCreatures(chatState().bestiary, ready.map(entry => cleanCreature(entry, r)), BESTIARY_KEPT) });
    return ready.map(entry => entry.name);
}

async function prepareAndStart(setup) {
    if (preparing) return false;
    preparing = true;
    try {
        const fresh = await prepareFoes(setup?.rows ?? []);
        // The reader may have left the setup (or the chat) while the calls ran.
        if (screen.mode !== 'setup' || screen.chatId !== chatIdOf(context())) return false;
        startNewFight(setup, { fresh });
        return true;
    } finally {
        preparing = false;
    }
}

/** A creature of the chat's bestiary made again: the template at its level with a new seed, flavoured. */
async function regenerateCreature(name) {
    const r = rules();
    const sheet = currentSheet();
    const state = chatState();
    const old = state.bestiary.find(entry => entry.name === name);
    if (!old) throw new Error(`${name} is not in this story's bestiary.`);
    let entry = generateCreature({ name: old.name, level: old.level, role: null }, { rules: r, seed: `${chatIdOf(context())}:${Date.now()}` });
    if (settings().flavour.enabled && sheet) {
        const toast = notify('info', `Preparing ${entry.name}…`, { timeOut: 0, extendedTimeOut: 0 });
        try {
            [entry] = await flavourAll([entry], { sheet, r });
        } finally {
            if (toast) globalThis.toastr?.clear?.(toast);
        }
    }
    saveChatState({ bestiary: storeCreatures(chatState().bestiary, [cleanCreature(entry, r)], BESTIARY_KEPT) });
    notify('success', `${entry.name} is made anew.`);
}

function forgetCreature(name) {
    saveChatState({ bestiary: chatState().bestiary.filter(entry => entry.name !== name) });
}

function exportBestiary() {
    const list = chatState().bestiary;
    if (!list.length) throw new Error('This story has no creatures of its own yet.');
    const blob = new Blob([JSON.stringify({ rpgBattleBestiary: 1, creatures: list }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'rpg-battle-bestiary.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// An imported file is the reader's, but it is still cleaned like anything stored: known words
// only, and every number worked out again from them.
function importBestiary(text) {
    let data;
    try {
        data = JSON.parse(String(text ?? ''));
    } catch {
        throw new Error('That file is not JSON.');
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.creatures) ? data.creatures : [];
    const r = rules();
    const clean = list.map(entry => cleanCreature(entry, r)).filter(Boolean);
    if (!clean.length) throw new Error('No creatures in that file.');
    saveChatState({ bestiary: storeCreatures(chatState().bestiary, clean, BESTIARY_KEPT) });
    notify('success', `${clean.length} ${clean.length === 1 ? 'creature' : 'creatures'} imported.`);
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
        let pc = sheet;
        if (sheet) {
            const applied = applyResult({ ...sheet, uses: uses.pc ?? {} }, 'pc', result, r);
            report.levelsGained = applied.levelsGained;
            report.pointsGained = applied.pointsGained;
            report.levelsReached = applied.levelsGained ? applied.sheet.level : 0;
            uses.pc = applied.sheet.uses ?? {};
            pc = applied.sheet;
            // Lost to the death: the story of this character ends. The sheet says so (the State
            // line reads "dead"), so a swipe or a deleted reply takes it back with the rest.
            if (fight.stakes === 'death' && result.outcome === 'defeat') pc = { ...pc, hp: { ...pc.hp, cur: 0 }, conditions: [{ name: DEAD, rounds: null }] };
        }
        const raised = currentParty().map(member => {
            const applied = applyResult({ ...member.sheet, uses: uses[member.id] ?? {} }, member.id, result, r);
            uses[member.id] = applied.sheet.uses ?? {};
            return { ...member, sheet: applied.sheet };
        });
        // Companions on auto spend what a level gave them, by build (the setting allowing).
        const members = settleCompanions(raised, { autoSpend: own.autoSpend !== false, rules: r });
        if (pc || members.length) await writeSheets(pc, members);
        // A companion at 0 HP when a fight to the death ends fell: offered for removal afterwards.
        if (fight.stakes === 'death') {
            const fell = result.party.filter(entry => entry.memberId !== 'pc' && (entry.down || entry.hp?.cur <= 0)).map(entry => members.find(member => member.id === entry.memberId)).filter(Boolean);
            if (fell.length) saveChatState({ fallen: [...chatState().fallen.filter(entry => !fell.some(member => member.id === entry.memberId)), ...fell.map(member => ({ memberId: member.id, name: member.name }))] });
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
    const { pc: before, members, legacy } = sheetsAt(sb, { beforeIndex: index });
    let pc = before;
    let party = members;
    let note = '';
    // What story time gave each member in this reply, so a <Rest> accepted for it adds only the rest.
    const gains = {};
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
                gains.pc = { hp: mine.hp, mp: mine.mp };
                for (const { member, recovery } of theirs) gains[member.id] = { hp: recovery.hp, mp: recovery.mp };
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
    return { before, members, pc, party, note, gains, applied, legacy, signature: wounds.signature };
}

/**
 * Writes a plan into reply `index`, once, and only what differs. A Party block already in
 * that reply that the pipeline did not write (a fight, a rest or an item since) is left alone
 * and nothing is written: recomputing from the sheets before the reply would throw that away.
 * An older chat's sheets (your sheet still in the Character block) are written as the one
 * Party block even when nothing changed. { ok, written: { party } } with the hash of what the
 * reply now holds from us.
 */
async function writePlan(sb, index, plan, story) {
    const own = settings();
    const r = rules();
    const ours = story?.index === index ? story.written ?? {} : {};
    const has = plan.pc || plan.party.length;
    const before = plan.before || plan.members.length ? formatPartyBlock(plan.before, plan.members, r) : null;
    const next = has ? formatPartyBlock(plan.pc, plan.party, r) : null;
    const current = blockAt(sb, index, own.partyTag);
    if (current !== null && textHash(current) !== ours.party) return { ok: false, written: {} };
    const written = { party: null };
    if (next !== null) {
        const changed = current !== null ? current !== next.trim() : next !== before || Boolean(plan.legacy);
        if (changed) await sb.setBlockText(index, own.partyTag, next);
        if (changed || current !== null) written.party = textHash(next);
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
            recovered: plan.note ? { index, text: plan.note, gains: plan.gains } : state.recovered?.index === index ? null : state.recovered,
            story: { index, signature, applied: undone ? state.story.applied : plan.applied, undone, written: result.written },
        });
        if (plan.applied.length) toastWounds(plan.applied);
    }
    if (!narrating) toastEncounter(sb, index);
    toastOffers(currentOffers().filter(offer => offer.index === index));
    sb.refresh?.();
}

/** Whether the latest story wounds can still be undone: that reply's sheets are still ours. */
function canUndoStory(ctx = context(), state = chatState(ctx)) {
    const story = state.story;
    const sb = storyBlock();
    if (!sb || !story || story.undone || !story.applied?.length || state.fight) return false;
    if (story.index !== latestAssistantIndex(ctx?.chat ?? [])) return false;
    if (woundsAt(sb, story.index).signature !== story.signature) return false;
    const hash = story.written?.party;
    const current = blockAt(sb, story.index, settings(ctx).partyTag);
    return current === null ? !hash : textHash(current) === hash;
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

/**
 * An <Encounter> as setup rows: names looked up in this story's creatures and the shipped
 * ones, and a threat word ("weak", "deadly") turned into a level from the Character's.
 */
function encounterRows(text) {
    const r = rules();
    const rows = parseEncounter(text, fightBestiary(), r);
    return resolveThreats(rows, currentSheet()?.level ?? 1, r);
}

function toastEncounter(sb, index) {
    if (!currentSheet()) return;
    const text = blockAt(sb, index, ENCOUNTER_TAG) ?? '';
    const rows = text ? encounterRows(text) : [];
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
    // No fight without a living character to fight it.
    const pc = currentSheet();
    if (!pc || isDead(pc)) return null;
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
        const rows = encounterRows(candidate.text);
        if (rows.length) return { ...candidate, rows, key };
    }
    return null;
}

// Fight? opens the setup with the story's foes filled in; the reader still confirms them.
function fightEncounter(rows, offerKey = encounterOffer()?.key ?? null) {
    const sheet = currentSheet();
    if (sheet && sheet.hp.cur <= 0) {
        notify('warning', `${sheet.name} is down: heal them first (an item, or a rest in the story).`);
        return;
    }
    screen = { chatId: chatIdOf(context()), mode: 'setup', prefill: Array.isArray(rows) ? rows : [], offerKey };
    storyBlock()?.refresh?.();
    showBattleTab();
}

// The Battle tab comes and goes with the battle; when a toast's Fight? opens the setup, its tab
// is brought forward (Story Block has no call for that, so its tab button is pressed, if found).
function showBattleTab() {
    setTimeout(() => {
        try {
            globalThis.document?.querySelector?.(`[data-tab-id="ext:${TAB_ID}"]`)?.click?.();
        } catch {
            // Only a convenience: the Battle tab is there either way.
        }
    }, 80);
}

function dismissEncounter(key) {
    if (!key) return;
    const dismissed = chatState().dismissed.filter(entry => entry !== key);
    saveChatState({ dismissed: [...dismissed, key].slice(-DISMISSED_KEPT) });
}

// ---------------------------------------------------------------------------
// The party's story: offers from the hidden blocks, Story Director's quests, and the rest

/** NPC State Delta's suite api while it shares one (1.2.2: npcProfiles, openDossier), else null. */
function npcApi() {
    try {
        return storySuite().api(NPC_SUITE_ID) ?? null;
    } catch {
        return null;
    }
}

/** NPC State Delta's profiles of this chat's NPCs ([{ id, name, aliases, present, role, summary }]); [] without it. */
function npcProfiles() {
    const api = npcApi();
    if (typeof api?.npcProfiles !== 'function') return [];
    try {
        const list = api.npcProfiles();
        return Array.isArray(list) ? list.filter(entry => entry && entry.id && String(entry.name ?? '').trim()) : [];
    } catch (error) {
        console.warn('[RPG Battle] NPC State Delta\'s profiles could not be read', error);
        return [];
    }
}

/** The NPC profile a companion's name means (its name, first name or an alias), or null. */
function profileFor(name, profiles = npcProfiles()) {
    const targets = profiles.flatMap(profile => [{ ...profile, name: profile.name }, ...(profile.aliases ?? []).map(alias => ({ ...profile, name: alias, alias: true }))]);
    const found = findTarget(targets, name);
    return found ? profiles.find(profile => profile.id === found.id) ?? null : null;
}

/** Story Director 0.8.2's quests finished in reply `index` ([{ id, name, difficulty, … }]); [] without it. */
function questsDoneAt(index) {
    const api = globalThis.StoryDirector;
    if (typeof api?.questsDoneAt !== 'function') return [];
    try {
        const list = api.questsDoneAt(index);
        return Array.isArray(list) ? list : [];
    } catch (error) {
        console.warn('[RPG Battle] Story Director\'s finished quests could not be read', error);
        return [];
    }
}

/** One message's hidden party blocks, as text ('' for each it lacks). */
function partyBlocksAt(sb, index) {
    return {
        joins: blockAt(sb, index, JOINS_TAG) ?? '',
        leaves: blockAt(sb, index, LEAVES_TAG) ?? '',
        learned: blockAt(sb, index, LEARNED_TAG) ?? '',
        xp: blockAt(sb, index, XP_TAG) ?? '',
        rest: blockAt(sb, index, REST_TAG) ?? '',
    };
}

// Your persona as last seen in this chat: a switch to another name offers to rename a
// character who still carries the old one (once per switch).
let personaSeen = { chatId: null, name: '' };
let personaRename = null;

function watchPersona(ctx, pc) {
    const chatId = chatIdOf(ctx);
    const now = personaName(ctx);
    if (personaSeen.chatId !== chatId) {
        personaSeen = { chatId, name: now };
        personaRename = null;
        return;
    }
    if (now === personaSeen.name) return;
    if (pc && now && pc.name === personaSeen.name) personaRename = { from: pc.name, to: now, key: `persona:${pc.name}>${now}` };
    personaSeen = { chatId, name: now };
}

/**
 * Everything the story offers the party now, put-away ones left out: the latest reply's hidden
 * blocks and Story Director's quests done in it, the opening message's (kept until taken or put
 * away), companions who fell in a fight to the death, a persona renamed, an NPC renamed in NPC
 * State Delta. Each { key, kind, text, accept, note?, confirm?, data, index, opening? }. None
 * during a fight.
 */
function currentOffers(ctx = context(), state = chatState(ctx)) {
    const sb = storyBlock();
    const own = settings(ctx);
    if (!sb || !own.enabled || state.fight) return [];
    const chat = ctx?.chat ?? [];
    const { pc, members } = currentSheets();
    const r = rules();
    const lib = library(ctx);
    const persona = personaName(ctx);
    const latest = latestAssistantIndex(chat);
    const waiting = Boolean(state.pending) && (state.pending.attachedTo === null || state.pending.attachedTo === undefined);
    const offers = [];
    const from = (index, opening) => storyOffers({
        index, texts: partyBlocksAt(sb, index), pc, members, persona, rules: r, library: lib, opening,
        narrating: state.pending?.attachedTo === index, pending: waiting,
    }).map(offer => ({ ...offer, index, ...(opening ? { opening: true } : {}) }));
    if (isAssistant(chat[0]) && latest !== 0) offers.push(...from(0, true));
    if (latest >= 0) {
        offers.push(...from(latest, latest === 0));
        offers.push(...questOffers({ index: latest, quests: questsDoneAt(latest), pc, rules: r }).map(offer => ({ ...offer, index: latest })));
    }
    for (const entry of state.fallen) {
        const member = members.find(other => other.id === entry.memberId);
        if (member) offers.push({ key: `fallen:${member.id}`, kind: 'fallen', text: `${member.name} fell. Remove from the party?`, accept: 'Remove', confirm: true, data: { memberId: member.id }, index: -1 });
    }
    watchPersona(ctx, pc);
    if (personaRename && pc && pc.name === personaRename.from) {
        offers.push({ key: personaRename.key, kind: 'rename', text: `Rename ${pc.name} to ${personaRename.to}?`, accept: 'Rename', data: { memberId: 'pc', name: personaRename.to }, index: -1 });
    }
    // A companion added from an NPC follows a rename there, when the reader agrees.
    const profiles = Object.keys(state.npcLinks).length ? npcProfiles() : [];
    for (const member of members) {
        const profile = member.npcId ? profiles.find(entry => entry.id === member.npcId) : null;
        if (profile && profile.name.trim() && profile.name.trim() !== member.name && !(profile.aliases ?? []).includes(member.name)) {
            offers.push({ key: `npc:${profile.id}:${profile.name}`, kind: 'rename', text: `${member.name} is ${profile.name.trim()} in NPC State Delta now. Rename?`, accept: 'Rename', data: { memberId: member.id, name: profile.name.trim() }, index: -1 });
        }
    }
    const away = new Set([...state.dismissed, ...state.done]);
    const seen = new Set();
    return offers.filter(offer => !away.has(offer.key) && !seen.has(offer.key) && seen.add(offer.key));
}

/** An offer taken or put away: the opening message's are kept apart, so they are never offered again. */
function putAway(offer) {
    if (!offer) return;
    const state = chatState();
    if (offer.kind === 'fallen') {
        saveChatState({ fallen: state.fallen.filter(entry => entry.memberId !== offer.data.memberId) });
        return;
    }
    if (offer.opening) saveChatState({ done: [...state.done.filter(key => key !== offer.key), offer.key].slice(-OPENING_KEPT) });
    else saveChatState({ dismissed: [...state.dismissed.filter(key => key !== offer.key), offer.key].slice(-DISMISSED_KEPT) });
}

function offerByKey(key) {
    return currentOffers().find(offer => offer.key === key) ?? null;
}

/** Accept: what each offer does. Joins and Learned open their forms, prefilled; the rest apply now. */
async function acceptOffer(key) {
    const offer = offerByKey(key);
    if (!offer) throw new Error('That offer is no longer there.');
    const r = rules();
    const own = settings();
    const chatId = chatIdOf(context());
    const { pc, members } = currentSheets();
    switch (offer.kind) {
        case 'joins': {
            // With NPC State Delta, the NPC of that name refines the guess and keeps the link.
            const profile = profileFor(offer.data.name);
            const role = offer.data.role || profile?.role || '';
            const prefill = {
                name: offer.data.name, role, level: offer.data.level,
                focus: offer.data.focus?.length ? offer.data.focus : guessFocus(role, profile?.summary ?? ''),
                npcId: profile?.id ?? null, summary: profile?.summary ?? '',
            };
            partyScreen = { chatId, mode: 'companion', prefill, offerKey: offer.key, kit: null };
            void generateKit({ ...prefill, skills: offer.data.skills });
            return;
        }
        case 'learned':
            partyScreen = { chatId, mode: 'learn', memberId: offer.data.memberId, prefill: offer.data.prefill, offerKey: offer.key };
            return;
        case 'leaves':
        case 'fallen': {
            const leaving = members.find(member => member.id === offer.data.memberId);
            await writeSheets(pc, members.filter(member => member.id !== offer.data.memberId));
            forgetMember(offer.data.memberId);
            putAway(offer);
            if (leaving) notify('info', `${leaving.name} leaves the party.`);
            return;
        }
        case 'xp':
        case 'quest': {
            const out = awardParty({ pc, members }, offer.data.share, { autoSpend: own.autoSpend !== false, rules: r });
            await writeSheets(out.pc, out.members);
            putAway(offer);
            const ups = out.gains.filter(gain => gain.levelsGained).map(gain => `${gain.name} reaches ${levelText((gain.memberId === 'pc' ? out.pc : out.members.find(member => member.id === gain.memberId)?.sheet)?.level ?? 1, r)}`);
            notify('success', `Awarded.${ups.length ? ` ${ups.join('; ')}.` : ''}`);
            return;
        }
        case 'rest': {
            const state = chatState();
            const gains = state.recovered?.index === offer.index ? state.recovered.gains ?? {} : {};
            const gear = currentItems().filter(item => item.equipped);
            const rested = pc ? restAfter(pc, offer.data.kind, { gear, rules: r, already: gains.pc }) : null;
            await writeSheets(rested, members.map(member => ({ ...member, sheet: restAfter(member.sheet, offer.data.kind, { gear: member.gear ?? [], rules: r, already: gains[member.id] }) })));
            putAway(offer);
            notify('success', offer.data.kind === 'long' ? 'The party is fully rested.' : 'The party catches its breath.');
            return;
        }
        case 'rename': {
            if (offer.data.memberId === 'pc') {
                if (members.some(member => member.name.toLowerCase() === offer.data.name.toLowerCase())) throw new Error(`A companion is already called ${offer.data.name}.`);
                await writeSheets({ ...pc, name: offer.data.name }, members);
            } else {
                await renameCompanion(offer.data.memberId, { name: offer.data.name });
            }
            putAway(offer);
            return;
        }
        default:
            throw new Error('RPG Battle does not know that offer.');
    }
}

/** A companion gone: what the chat keeps by their id goes with them. */
function forgetMember(memberId) {
    const state = chatState();
    const npcLinks = { ...state.npcLinks };
    delete npcLinks[memberId];
    const uses = { ...state.uses };
    delete uses[memberId];
    saveChatState({ npcLinks, uses, fallen: state.fallen.filter(entry => entry.memberId !== memberId) });
}

// A companion's id follows their name, so a rename moves what the chat keeps by id (mastery
// progress, the NPC link) to the new id; sheet, skills and gear go along in the block itself.
async function renameCompanion(memberId, changes) {
    const { pc, members } = currentSheets();
    const before = members.find(member => member.id === memberId);
    const edited = editCompanion(members, memberId, changes ?? {}, { pcName: pc?.name ?? '' });
    await writeSheets(pc, edited.members);
    const state = chatState();
    if (Object.entries(edited.idMap).some(([from, to]) => from !== to)) saveChatState({ uses: remapIds(state.uses, edited.idMap), npcLinks: remapIds(state.npcLinks, edited.idMap) });
    const after = edited.members.find(member => member.id === edited.idMap[memberId]);
    if (before && after && before.name !== after.name) notify('success', `${before.name} is now ${after.name}.`);
}

/** Toasts for new offers, with their Accept button; the Party tab lists them too. */
function toastOffers(offers) {
    for (const offer of (offers ?? []).filter(entry => !entry.confirm).slice(0, 4)) {
        const html = `${escapeHtml(offer.text)}<div class="rpg-battle-toast-actions"><button type="button" class="menu_button rpg-battle-toast-accept">${escapeHtml(offer.accept)}</button></div>`;
        const toast = notify('info', html, { escapeHtml: false, timeOut: 15000, extendedTimeOut: 6000, closeButton: true });
        bindToastButton(toast, '.rpg-battle-toast-accept', () => void guarded(() => acceptOffer(offer.key)));
    }
}

// The opening message's offers are toasted once per chat opened (the Party tab keeps them).
const openingToasted = new Set();

function toastOpening() {
    const chatId = chatIdOf(context());
    if (!chatId || openingToasted.has(chatId)) return;
    openingToasted.add(chatId);
    toastOffers(currentOffers().filter(offer => offer.opening));
}

// ---------------------------------------------------------------------------
// A companion's starting kit (src/kit.js): their skills in words from one call, or the library's

let kitRun = 0;

/**
 * The skills shown in the Add companion form: the ones a <Joins> hint names; else, with the
 * flavour setting on, two or three from one words-only call (the Monsters model and deadline);
 * else, or when that fails or says too little, library skills fitting the focus and role.
 * Written into the companion screen when ready, unless the reader has moved on.
 */
async function generateKit(who) {
    const own = settings();
    const r = rules();
    const run = ++kitRun;
    const key = `kit-${run}`;
    const chatId = chatIdOf(context());
    const set = kit => {
        if (partyScreen.mode !== 'companion' || partyScreen.chatId !== chatId || run !== kitRun) return;
        partyScreen = { ...partyScreen, kit };
        storyBlock()?.refresh?.();
    };
    set({ key, status: 'working', skills: [] });
    let skills = null;
    let note = '';
    if (who?.skills?.length) {
        skills = namedKit(who.skills, library());
        note = 'Named by the story. Code sets every number for their level.';
    } else if (own.flavour.enabled) {
        try {
            const messages = kitPrompt({ ...who, level: powerText(Math.max(1, Number(who?.level) || 1), r) });
            const maxTokens = Math.max(100, Math.min(2000, Number(own.flavour.maxTokens) || 400));
            const answer = await withTimeout(sendToModel(messages, own.flavour.model, maxTokens), Math.max(5, Number(own.flavour.timeoutSeconds) || 30) * 1000);
            const parsed = parseKit(answer);
            if (usableKit(parsed)) {
                skills = parsed;
                note = 'From who they are, in the model\'s words. Code sets every number for their level.';
            } else {
                console.info(`[RPG Battle] the skills for ${who?.name ?? 'a companion'} had too little usable; library skills instead.`);
            }
        } catch (error) {
            console.info(`[RPG Battle] the skills for ${who?.name ?? 'a companion'} could not be generated (${error instanceof Error ? error.message : String(error)}); library skills instead.`);
        }
    }
    if (!skills) {
        skills = fallbackKit({ focus: who?.focus ?? [], level: who?.level ?? 1, role: who?.role ?? '' }, DEFAULT_SKILLS, r);
        note = 'Library skills that fit their focus and role.';
    }
    set({ key, status: 'ready', skills, note });
}

// ---------------------------------------------------------------------------
// Story Block's own Character Sheet (DESIGN §8.6)

/** Story Block's stored blocks made from its Character Sheet template. */
function storySheetBlocks(ctx = context()) {
    const list = ctx?.extensionSettings?.storyBlock?.blocks;
    return Array.isArray(list) ? list.filter(block => block && block.template === STORY_SHEET_TEMPLATE) : [];
}

/** Whether Story Block's Character Sheet is on, read from its stored settings (a Story Block outside the suite). */
function storySheetOn(ctx = context()) {
    if (Array.isArray(ctx?.extensionSettings?.storyBlock?.blocks)) return storySheetBlocks(ctx).some(block => block.enabled);
    // Before Story Block has stored its list: its own summary (no template there, so by the template's id).
    try {
        return (storyBlock()?.listBlocks?.() ?? []).some(block => block.id === STORY_SHEET_TEMPLATE && block.enabled);
    } catch {
        return false;
    }
}

/**
 * Whether to point out Story Block's Character Sheet: on beside RPG Battle's sheet while RPG
 * Battle is the source of truth for stats. Story Block in the suite says so by offering
 * 'stats'; an older one is read from its settings, as before.
 */
function sheetConflict(ctx = context()) {
    const own = settings(ctx);
    if (!own.enabled) return false;
    try {
        return sheetNotice({ suite: storySuite(), choice: own.sourceOfTruth.stats, storySheetOn: () => storySheetOn(ctx) });
    } catch (error) {
        console.warn('[RPG Battle] the Story Suite could not be read', error);
        return storySheetOn(ctx);
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
// Story Suite (docs/STORY_SUITE.md)

// api.members(): the kept sheets parsed again only when their text or the terms change, so
// another extension may ask on every refresh.
let membersMemo = { key: null, list: Object.freeze([]) };

function suiteMembers() {
    try {
        const own = settings();
        if (!own.enabled) return [];
        const key = JSON.stringify([blockText(own.partyTag), blockText(own.characterTag), own.terms, own.rules]);
        if (membersMemo.key !== key) {
            const r = rules();
            const { pc, members } = currentSheets();
            membersMemo = { key, list: partyMembers(pc, members, r) };
        }
        return membersMemo.list;
    } catch (error) {
        console.warn('[RPG Battle] the party could not be shared', error);
        return [];
    }
}

// api.manage: Story Suite's overlay changes the Source of truth choices and the switch exactly
// as the panel's own controls do (applySettings), and the panel shows what it changed.
const SUITE_MANAGE = manageApi({
    choices: () => settings().sourceOfTruth,
    choose: (area, choice) => {
        applySettings({ ...settings(), sourceOfTruth: { ...settings().sourceOfTruth, [area]: choice } });
        settingsPanel?.update?.(settings());
        settingsPanel?.setTruth?.(area, choice);
    },
    // The next ordinary reply: the waiting hand-off, else the story instruction when it would go.
    tokens: () => {
        const own = settings();
        if (!own.enabled) return tokenEstimate();
        const state = chatState();
        const pc = currentSheet();
        const asks = Boolean(pc) && !isDead(pc) && !state.fight;
        return tokenEstimate({ handoff: state.pending?.handoff ?? '', instruction: asks ? STORY_INSTRUCTION : '' });
    },
    enabled: () => settings().enabled,
    enable: on => {
        applySettings({ ...settings(), enabled: on });
        settingsPanel?.update?.(settings());
        settingsPanel?.setEnabled?.(on);
    },
});

const SUITE_API = Object.freeze({ version: VERSION, members: () => suiteMembers(), manage: SUITE_MANAGE });

/** Announced on load and again whenever the switch changes: switched off, with enabled: false. */
function announceToSuite() {
    try {
        storySuite().announce(announcement({ version: VERSION, api: SUITE_API, enabled: settings().enabled }));
    } catch (error) {
        console.warn('[RPG Battle] could not announce to the Story Suite', error);
    }
}

/** Opens Story Suite's overlay on RPG Battle's tab, or null while it cannot be offered. */
function suiteOpener() {
    try {
        return suiteOverlay(storySuite());
    } catch {
        return null;
    }
}

function openStorySuite() {
    try {
        suiteOpener()?.();
    } catch (error) {
        console.warn('[RPG Battle] could not open Story Suite', error);
    }
}

function currentSources() {
    try {
        return sources(storySuite(), settings().sourceOfTruth);
    } catch {
        return null;
    }
}

function refreshSuiteViews() {
    settingsPanel?.setSheetConflict?.(sheetConflict());
    settingsPanel?.setSources?.(currentSources());
    settingsPanel?.setSuiteLink?.(Boolean(suiteOpener()));
    storyBlock()?.refresh?.();
}

// One listener for the life of the page. Story Block announces again when its blocks change,
// possibly from inside its own refresh: an announcement that changes nothing is ignored, and
// the redraw waits for the next tick rather than refreshing Story Block from within itself.
// Whether Story Suite's overlay can be opened counts too (Story Block shares openSuite).
let suiteWatched = false;
let suiteSeen = '';
let suiteRedraw = null;

const suiteKey = suite => `${suiteSignature(suite)}|${suiteOverlay(suite) ? 'overlay' : ''}`;

function watchSuite() {
    if (suiteWatched) return;
    suiteWatched = true;
    try {
        const suite = storySuite();
        suiteSeen = suiteKey(suite);
        suite.onChange(() => {
            const seen = suiteKey(storySuite());
            if (seen === suiteSeen) return;
            suiteSeen = seen;
            if (suiteRedraw) return;
            suiteRedraw = setTimeout(() => {
                suiteRedraw = null;
                refreshSuiteViews();
            }, 0);
        });
    } catch (error) {
        console.warn('[RPG Battle] could not watch the Story Suite', error);
    }
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
        const pc = own.enabled ? currentSheet() : null;
        const asks = Boolean(pc) && !isDead(pc) && !handoff && !chatState(ctx).fight;
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
// The Party and Battle tabs

/** The SillyTavern persona's name (the reader's PC), trimmed; '' without one. A new character starts with it. */
function personaName(ctx = context()) {
    return String(ctx?.name1 ?? '').trim();
}

const isDead = sheet => Boolean(sheet?.conditions?.some(condition => String(condition?.name ?? '').toLowerCase() === DEAD));

/**
 * Whether there is a battle, so the Battle tab is there: a fight the story offers (Fight? /
 * Not now), the setup opened from it, the fight, or its result until it goes back to the story.
 */
function battleOn(ctx = context(), state = chatState(ctx)) {
    if (!settings(ctx).enabled) return false;
    if (state.fight) return true;
    if (screen.chatId === chatIdOf(ctx) && (screen.mode === 'setup' || screen.mode === 'result')) return true;
    return Boolean(encounterOffer(ctx, state));
}

/** The Battle tab: the offer, the setup, the fight, the result. */
function battleView() {
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
    if (screen.mode === 'setup' && sheet) {
        // Autocomplete offers this story's creatures first; `known` (names and aliases) is what
        // the setup checks to tag a name as new, made up when the fight starts.
        const bestiary = fightBestiary(ctx);
        return {
            mode: 'setup',
            bestiary: [...new Set(bestiary.map(entry => entry.name))],
            known: bestiary.flatMap(entry => [entry.name, ...(entry.aliases ?? [])]),
            suggestedRank: suggestRank(sheet.level, r),
            prefill: screen.prefill ?? null,
            preparing: screen.preparing ?? null,
            rules: r,
        };
    }
    const offer = encounterOffer(ctx, state);
    return { mode: 'offer', encounter: offer ? { text: offer.text, label: offer.label, rows: offer.rows } : null, pending: state.pending?.handoff ?? null, rules: r };
}

/** A member's card data beyond the sheet: resolved skills, capped gear, the dossier link. */
function cardMember(member, r, lib, npc) {
    const linked = member.npcId ?? null;
    return {
        ...member,
        skills: resolveSkills(member.sheet.skills, lib, member.sheet.level, r).map((skill, index) => ({ ...skill, aside: Boolean(member.sheet.skills[index]?.aside) })),
        gearSummary: gearSummary(member.gear ?? [], member.sheet.level, r),
        dossier: Boolean(linked && typeof npc?.openDossier === 'function'),
    };
}

/** The Party tab: creation, the cards with what the story offers, and the forms the offers open. */
function partyView() {
    const ctx = context();
    const chatId = chatIdOf(ctx);
    if (partyScreen.chatId !== chatId) partyScreen = { chatId, mode: null };
    const r = rules();
    const state = chatState(ctx);
    const { pc: sheet, members } = currentSheets();
    const importing = pendingImport?.chatId === chatId ? { summary: pendingImport.summary, note: pendingImport.note } : null;
    if (!sheet) return { mode: 'create', persona: personaName(ctx), importing, rules: r };
    const lib = library(ctx);
    if (partyScreen.mode === 'spend') {
        const who = partyScreen.memberId && partyScreen.memberId !== 'pc' ? members.find(member => member.id === partyScreen.memberId) : null;
        if (who || partyScreen.memberId === 'pc' || !partyScreen.memberId) return { mode: 'spend', sheet: who ? who.sheet : sheet, memberId: who ? who.id : 'pc', rules: r };
    }
    if (partyScreen.mode === 'learn') {
        const who = partyScreen.memberId && partyScreen.memberId !== 'pc' ? members.find(member => member.id === partyScreen.memberId) : null;
        if (who || partyScreen.memberId === 'pc') return { mode: 'learn', sheet: who ? who.sheet : sheet, memberId: who ? who.id : 'pc', library: lib, prefill: partyScreen.prefill ?? null, rules: r };
    }
    if (partyScreen.mode === 'items') return { mode: 'items', sheet, party: members, items: consumables(currentItems()), rules: r };
    if (partyScreen.mode === 'companion') {
        return {
            mode: 'companion', level: sheet.level, maxLevel: Math.min(maxLevel(r), Math.max(20, sheet.level + 10)),
            prefill: partyScreen.prefill ?? null, kit: partyScreen.kit ?? null, npcs: npcProfiles(), rules: r,
        };
    }
    // The last automatic recovery, while it is the latest reply's.
    const recovered = state.recovered && state.recovered.index === (ctx?.chat?.length ?? 0) - 1 ? state.recovered.text : '';
    // The latest reply's story wounds, while they stand.
    const story = state.story && !state.story.undone && state.story.applied?.length && state.story.index === latestAssistantIndex(ctx?.chat ?? [])
        ? { lines: state.story.applied.map(describeWound), canUndo: canUndoStory(ctx, state) }
        : null;
    const npc = npcApi();
    const items = currentItems();
    return {
        mode: 'idle', chatId, sheet, checks: checkModifiers(sheet.stats, r),
        skills: resolveSkills(sheet.skills, lib, sheet.level, r).map((skill, index) => ({ ...skill, aside: Boolean(sheet.skills[index]?.aside) })),
        party: members.map(member => cardMember(member, r, lib, npc)),
        rules: r,
        gear: gearSummary(items, sheet.level, r),
        // Your Inventory's equipment, to give a companion.
        giveable: items.filter(item => item.slot && item.qty > 0).map(item => ({ name: item.name, slot: item.slot, rarity: item.rarity, stats: item.stats })),
        autoSpend: settings(ctx).autoSpend !== false,
        gameOver: isDead(sheet) ? { name: sheet.name } : null,
        importing,
        pending: state.pending?.handoff ?? null,
        offers: currentOffers(ctx, state).map(({ key, kind, text, accept, note, confirm }) => ({ key, kind, text, accept, note, confirm })),
        recovered,
        story,
        sheetConflict: sheetConflict(ctx),
        // This story's own creatures, for the Bestiary fold.
        bestiary: state.bestiary.map(entry => ({
            name: entry.name,
            power: powerText(entry.level, r),
            role: entry.role,
            template: entry.template,
            traits: (entry.traits ?? []).filter(trait => trait !== 'leader'),
            look: entry.look ?? '',
            flavoured: Boolean(entry.flavoured),
        })),
    };
}

function go(mode, extra = {}) {
    screen = { chatId: chatIdOf(context()), mode, ...extra };
    storyBlock()?.refresh?.();
}

function goParty(mode, extra = {}) {
    partyScreen = { chatId: chatIdOf(context()), mode, ...extra };
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

/** An offer the open form came from is spent once the form is done. */
function spendScreenOffer() {
    const offer = partyScreen.offerKey ? offerByKey(partyScreen.offerKey) : null;
    if (offer) putAway(offer);
}

// ---------------------------------------------------------------------------
// The party as a file (src/partyfile.js)

let pendingImport = null;

function exportPartyFile() {
    const { pc, members } = currentSheets();
    if (!pc && !members.length) throw new Error('There is no party to save yet.');
    const data = exportParty({ pc, members, yourGear: currentItems().filter(item => item.equipped && item.slot), skills: chatState().skills });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `rpg-battle-party${pc ? `-${pc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// A file is read and cleaned first; nothing changes until the reader confirms what it holds.
function readPartyFile(text) {
    let data;
    try {
        data = JSON.parse(String(text ?? ''));
    } catch {
        throw new Error('That file is not JSON.');
    }
    const r = rules();
    const party = cleanParty(data, r, DEFAULT_SKILLS);
    const count = party.members.length;
    const who = [party.pc ? `${party.pc.name} (${levelText(party.pc.level, r)})` : 'no character', count ? `${count} ${count === 1 ? 'companion' : 'companions'}` : ''].filter(Boolean).join(' and ');
    const inventory = parseInventory(blockText(settings().inventoryTag)).items;
    const newGear = party.yourGear.filter(item => !inventory.some(row => row.name.toLowerCase() === item.name.toLowerCase()));
    pendingImport = {
        chatId: chatIdOf(context()),
        party,
        newGear,
        summary: `Load ${who} into this chat? It replaces the party here.`,
        note: newGear.length ? `Your gear in the file goes into the Inventory (not equipped): ${newGear.map(item => item.name).join(', ')}.` : '',
    };
}

async function confirmImport() {
    const loading = pendingImport;
    pendingImport = null;
    if (!loading || loading.chatId !== chatIdOf(context())) return;
    const { party, newGear } = loading;
    await writeSheets(party.pc, party.members);
    const own = settings();
    if (newGear.length) {
        const inventory = blockText(own.inventoryTag);
        await writeBlock(own.inventoryTag, addLoot(inventory, { items: newGear.map(item => ({ name: item.name, qty: 1, rarity: item.rarity, slot: item.slot, stats: item.stats, tags: item.tags, kind: 'equipment' })) }, rules().currency));
    }
    const state = chatState();
    const names = new Set(party.skills.map(skill => skill.name.toLowerCase()));
    saveChatState({ skills: [...state.skills.filter(skill => !names.has(skill.name.toLowerCase())), ...party.skills], uses: {}, npcLinks: {}, fallen: [] });
    partyScreen = { chatId: chatIdOf(context()), mode: null };
    notify('success', 'The party is loaded.');
}

// ---------------------------------------------------------------------------
// Give and take back: your Inventory's equipment onto a companion, and back

async function giveItem(memberId, name) {
    const own = settings();
    const { pc, members } = currentSheets();
    const member = members.find(entry => entry.id === memberId);
    if (!member) throw new Error('That companion is not in the party.');
    const item = currentItems().find(entry => entry.name === name && entry.slot && entry.qty > 0);
    if (!item) throw new Error(`There is no ${name} in your Inventory.`);
    // The row's own words, read again as an Equipped entry: worn by them, capped by rarity at their level.
    const worn = parseGearEntry(formatGearEntry({ ...item, equipped: true }));
    await writeSheets(pc, members.map(entry => (entry.id === memberId ? { ...entry, gear: [...(entry.gear ?? []), worn] } : entry)));
    await writeBlock(own.inventoryTag, useItems(blockText(own.inventoryTag), { [item.name]: 1 }));
    notify('success', `${member.name} takes the ${item.name}.`);
}

async function takeBack(memberId, name) {
    const own = settings();
    const { pc, members } = currentSheets();
    const member = members.find(entry => entry.id === memberId);
    const index = member?.gear?.findIndex(item => item.name === name) ?? -1;
    if (!member || index < 0) throw new Error(`${member?.name ?? 'They'} do not carry ${name}.`);
    const item = member.gear[index];
    await writeSheets(pc, members.map(entry => (entry.id === memberId ? { ...entry, gear: entry.gear.filter((_, at) => at !== index) } : entry)));
    const inventory = blockText(own.inventoryTag);
    await writeBlock(own.inventoryTag, addLoot(inventory, { items: [{ name: item.name, qty: 1, rarity: item.rarity, slot: item.slot, stats: item.stats, tags: item.tags, kind: 'equipment' }] }, rules().currency));
    notify('success', `The ${item.name} is back in your Inventory.`);
}

/** A member's sheet changed, written back: 'pc' or a companion's id. */
async function writeMember(memberId, change) {
    const { pc, members } = currentSheets();
    if (memberId === 'pc' || !memberId) {
        if (!pc) throw new Error('Make your character first.');
        await writeSheets(change(pc), members);
        return;
    }
    if (!members.some(member => member.id === memberId)) throw new Error('That companion is not in the party.');
    await writeSheets(pc, members.map(member => (member.id === memberId ? { ...member, sheet: change(member.sheet) } : member)));
}

const handlers = {
    onCreate: input => void guarded(async () => {
        // The tab sends the stats as totals; a new sheet takes the points spent on top of the start.
        // No skills: they come from the story (the opening message, a later <Learned>).
        const r = rules();
        const allocation = Object.fromEntries(Object.entries(input.stats ?? {}).map(([stat, value]) => [stat, Math.max(0, Number(value) - r.character.startStat)]));
        const sheet = newSheet({ name: input.name, stats: allocation, skills: [] }, r);
        await writeSheet(sheet);
        partyScreen = { chatId: chatIdOf(context()), mode: null };
        saveChatState({ uses: { ...chatState().uses, pc: {} } });
        notify('success', `${sheet.name} is ready.`);
        // What the story's opening holds for the new character comes now.
        toastOffers(currentOffers().filter(offer => offer.opening && offer.data?.memberId === 'pc'));
    }),
    onSpend: memberId => goParty('spend', { memberId: memberId ?? 'pc' }),
    onConfirmSpend: (allocation, memberId = 'pc') => void guarded(async () => {
        await writeMember(memberId, sheet => spendPoints(sheet, allocation, rules()));
        partyScreen = { chatId: chatIdOf(context()), mode: null };
    }),
    onSetSkillActive: (memberId, name, active) => void guarded(() => writeMember(memberId, sheet => setSkillActive(sheet, name, active, rules()))),
    onConfirmLearn: ({ name, fromLibrary = false, template = null, setAside = null, memberId = 'pc' }) => void guarded(async () => {
        const r = rules();
        const skillName = String(name ?? '').trim();
        if (!skillName) throw new Error('Give the skill a name.');
        const { pc, members } = currentSheets();
        const sheet = memberId === 'pc' ? pc : members.find(member => member.id === memberId)?.sheet;
        if (!sheet) throw new Error('That member is not in the party.');
        const found = findSkill(library(), skillName);
        // The opening message's skills are theirs from the start (the card says so).
        const free = Boolean(partyScreen.prefill?.free);
        if (found && !free) {
            const missing = Object.entries(found.requires ?? {}).filter(([stat, need]) => (Number(sheet.stats?.[stat]) || 0) < need);
            if (missing.length) throw new Error(`${sheet.name} cannot learn ${found.name} yet: it needs ${missing.map(([stat, need]) => `${stat} ${need}`).join(', ')}.`);
        }
        if (!found && !fromLibrary && template) {
            // A story-taught skill: kept with this chat, so its numbers survive a reload.
            const custom = skillFromTemplate({ name: skillName, ...template }, sheet.level, r);
            saveChatState({ skills: [...chatState().skills.filter(skill => skill.name.toLowerCase() !== skillName.toLowerCase()), custom] });
        } else if (!found) {
            throw new Error(`"${skillName}" is not in the skill library.`);
        }
        await writeMember(memberId, current => learnSkill(current, found?.name ?? skillName, { rules: r, setAside }));
        spendScreenOffer();
        partyScreen = { chatId: chatIdOf(context()), mode: null };
    }),
    onItems: () => goParty('items'),
    onUseItem: ({ name, target = 'pc' }) => void guarded(async () => {
        const own = settings();
        const item = consumables(currentItems()).find(entry => entry.name === name);
        if (!item) throw new Error(`There is no ${name} left.`);
        const { pc, members } = currentSheets();
        const sheet = target === 'pc' ? pc : members.find(entry => entry.id === target)?.sheet;
        if (!sheet) throw new Error('That companion is not in the party.');
        const outcome = useItemOutside(sheet, item);
        if (!outcome.used) {
            notify('info', outcome.message);
            return;
        }
        await writeMember(target, () => outcome.sheet);
        await writeBlock(own.inventoryTag, useItems(blockText(own.inventoryTag), { [item.name]: 1 }));
        notify('success', outcome.message);
    }),
    onGenerateKit: who => void generateKit({ ...(who ?? {}), skills: [] }),
    onAddCompanion: input => void guarded(async () => {
        const r = rules();
        const { members } = currentSheets();
        const level = Math.max(1, Math.min(maxLevel(r), Math.round(Number(input.level) || 1)));
        // The kit's skills: library ones by name; the rest built from their template at the
        // companion's level and kept with this chat, like any story-taught skill.
        const specs = (input.skills ?? []).filter(spec => spec && String(spec.name ?? '').trim()).slice(0, r.character.starterSkills);
        const custom = specs.filter(spec => !findSkill(library(), spec.name)).map(spec => skillFromTemplate(kitTemplate(spec), level, r));
        if (custom.length) {
            const names = new Set(custom.map(skill => skill.name.toLowerCase()));
            saveChatState({ skills: [...chatState().skills.filter(skill => !names.has(skill.name.toLowerCase())), ...custom] });
        }
        const member = newCompanion({ ...input, level, skills: specs.map(spec => findSkill(library(), spec.name)?.name ?? spec.name) }, { rules: r, existing: members });
        await writeParty([...members, member]);
        // The NPC they were added from stays linked, by the id their name gives in the block.
        const added = currentParty().find(entry => entry.name === member.name);
        if (input.npcId && added) saveChatState({ npcLinks: { ...chatState().npcLinks, [added.id]: String(input.npcId) } });
        spendScreenOffer();
        partyScreen = { chatId: chatIdOf(context()), mode: null };
        notify('success', `${member.name} joins the party.`);
    }),
    onSetControl: (memberId, control) => void guarded(async () => {
        const { pc, members } = currentSheets();
        await writeSheets(pc, members.map(member => (member.id === memberId ? { ...member, control: control === 'command' ? 'command' : 'auto' } : member)));
    }),
    onEditCompanion: (memberId, changes) => void guarded(() => renameCompanion(memberId, changes)),
    onRemoveCompanion: memberId => void guarded(async () => {
        const { pc, members } = currentSheets();
        const leaving = members.find(member => member.id === memberId);
        await writeSheets(pc, members.filter(member => member.id !== memberId));
        forgetMember(memberId);
        if (leaving) notify('info', `${leaving.name} leaves the party.`);
    }),
    onGiveItem: (memberId, name) => void guarded(() => giveItem(memberId, name)),
    onTakeBack: (memberId, name) => void guarded(() => takeBack(memberId, name)),
    onOpenDossier: memberId => void guarded(async () => {
        const member = currentParty().find(entry => entry.id === memberId);
        const api = npcApi();
        if (!member?.npcId || typeof api?.openDossier !== 'function') return;
        if (api.openDossier(member.npcId) === false) notify('info', `NPC State Delta has no dossier for ${member.name} now (gone or archived).`);
    }),
    onStartOver: ({ keepCompanions = false } = {}) => void guarded(async () => {
        // Nothing carried over: your sheet goes, and the companions unless kept.
        const { members } = currentSheets();
        await writeSheets(null, keepCompanions ? members : []);
        const state = chatState();
        const { pc: _, ...uses } = state.uses;
        saveChatState(keepCompanions ? { uses } : { uses: {}, npcLinks: {}, fallen: [] });
        partyScreen = { chatId: chatIdOf(context()), mode: null };
        notify('info', 'Make a new character.');
    }),
    onExportParty: () => void guarded(async () => exportPartyFile()),
    onImportParty: text => void guarded(async () => readPartyFile(text)),
    onConfirmImport: () => void guarded(confirmImport),
    onCancelImport: () => {
        pendingImport = null;
        storyBlock()?.refresh?.();
    },
    onAcceptOffer: key => void guarded(() => acceptOffer(key)),
    onDismissOffer: key => {
        putAway(offerByKey(key));
        storyBlock()?.refresh?.();
    },
    onBack: () => {
        // The Party tab's forms go back to the cards; the Battle tab's setup to its offer.
        if (partyScreen.mode) goParty(null);
        else go(null);
    },
    onStart: setup => void guarded(async () => {
        const offerKey = screen.offerKey ?? null;
        // New names are made up (and flavoured) first; the fight starts once they are ready.
        const started = await prepareAndStart(setup);
        // A fight the story offered is now being fought: the offer is spent.
        if (started) dismissEncounter(offerKey);
    }),
    onRegenerateCreature: name => void guarded(() => regenerateCreature(name)),
    onForgetCreature: name => void guarded(async () => {
        forgetCreature(name);
        notify('info', `${name} is forgotten; the name will be made up anew next time.`);
    }),
    onExportBestiary: () => void guarded(async () => exportBestiary()),
    onImportBestiary: text => void guarded(async () => importBestiary(text)),
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

// The Party tab's form buttons share these handlers; Back on a Party form goes back to the cards.
const partyHandlers = { ...handlers, onBack: () => goParty(null) };
const battleHandlers = { ...handlers, onBack: () => go(null) };

function baseKey(ctx, state) {
    const chat = ctx?.chat ?? [];
    return [chatIdOf(ctx), chat.length, String(chat.at(-1)?.mes ?? '').length, String(chat[0]?.mes ?? '').length, JSON.stringify(settings()), state.pending?.fightId ?? ''];
}

function battleKey() {
    const ctx = context();
    const state = chatState(ctx);
    return [...baseKey(ctx, state), screen.mode, JSON.stringify(screen.prefill ?? null), fightKey(state.fight), state.dismissed.length,
        encounterOffer(ctx, state)?.key ?? '', JSON.stringify(screen.preparing ?? null), state.bestiary.length].join('|');
}

function partyKey() {
    const ctx = context();
    const state = chatState(ctx);
    const story = state.story ? `${state.story.index}:${state.story.signature}:${state.story.undone}:${state.story.applied?.length ?? 0}:${canUndoStory(ctx, state)}` : '';
    return [...baseKey(ctx, state), JSON.stringify(partyScreen), state.recovered?.text ?? '', story, state.dismissed.length, state.done.length, state.fallen.length,
        currentOffers(ctx, state).map(offer => offer.key).join(','), sheetConflict(ctx), personaName(ctx), JSON.stringify(state.npcLinks), JSON.stringify(pendingImport?.summary ?? null),
        state.bestiary.map(entry => `${entry.name}:${entry.level}:${entry.flavoured}:${String(entry.look ?? '').length}`).join(','), npcProfiles().length].join('|');
}

function renderParty(pane) {
    if (currentSheets().legacy) scheduleMigration();
    renderBattleTab(pane, partyView(), partyHandlers);
    settingsPanel?.setSheetConflict?.(sheetConflict());
}

function renderBattle(pane) {
    renderBattleTab(pane, battleView(), battleHandlers);
}

// ---------------------------------------------------------------------------
// Registration

function registerKeptBlocks(sb) {
    const own = settings();
    const party = {
        id: 'rpg-party',
        tag: own.partyTag,
        name: 'Party',
        icon: '👥',
        kept: true,
        owner: 'RPG Battle',
        format: 'text',
        display: 'plain',
        promptNote: PARTY_NOTE,
        diceModifier: `Modifier: the matching stat's bonus from the Checks line of your "(you)" section of the <${own.partyTag}> block (for example CHA +1); do not guess one.`,
    };
    // Story Block 0.9.1 keeps a block without a sidebar tab of its own: RPG Battle's Party tab
    // already shows the party. An older Story Block gives it a tab too, as before.
    if (versionAtLeast(sb.version, NO_TAB_STORY_BLOCK)) party.tab = false;
    const results = [sb.registerBlock(party)];
    // An older chat's Character block: no longer kept (not shown to the model, no tab, never
    // written), only read until the chat's Party block has your section. Registered as
    // transport so Story Block still hides its old copies and getBlock still finds them.
    if (own.characterTag && own.characterTag !== own.partyTag) results.push(sb.registerBlock({ id: 'rpg-character', tag: own.characterTag, name: 'Character (older chats)' }));
    // The model's hidden blocks: transport only, so Story Block hides them in its envelope (out
    // of the narration and the prompt's history) and RPG Battle reads them.
    for (const [id, tag] of TRANSPORT_TAGS) results.push(sb.registerBlock({ id, tag, name: tag }));
    for (const result of results) if (result && result.ok === false) console.warn('[RPG Battle] block not registered:', result.error);
}

function registerWithStoryBlock() {
    if (registered) return true;
    const sb = storyBlock();
    if (!sb) return false;
    registerKeptBlocks(sb);
    // The party, always there while RPG Battle is on: the cards, what the story offers them.
    sb.registerTab({
        id: PARTY_TAB_ID,
        label: 'Party',
        icon: '👥',
        order: 79,
        isAvailable: () => settings().enabled,
        key: partyKey,
        badge: () => currentOffers().length,
        render: pane => renderParty(pane),
    });
    // The battle, only while there is one: Story Block asks isAvailable on every refresh, so the
    // tab appears with the story's offer and goes once the result is back with the story.
    sb.registerTab({
        id: TAB_ID,
        label: 'Battle',
        icon: '⚔️',
        order: 80,
        isAvailable: () => battleOn(),
        key: battleKey,
        badge: () => (currentFight() || encounterOffer() ? 1 : 0),
        render: pane => renderBattle(pane),
    });
    sb.onReply?.(payload => void afterReply(payload));
    // Story Block's settings can change under us (its Character Sheet switched on or off).
    sb.onUpdate?.(() => {
        settingsPanel?.setSheetConflict?.(sheetConflict());
        // A chat opened (or changed) may still keep your sheet in the older Character block.
        scheduleMigration();
        // The opening message's offers, once per chat opened.
        setTimeout(() => { try { toastOpening(); } catch (error) { console.warn('[RPG Battle] the opening message could not be read', error); } }, 0);
    });
    registered = true;
    return true;
}

/**
 * Saves the panel's settings (or the same change from Story Suite's overlay) and applies it:
 * the announcement when the switch changes, the kept blocks when the terms do, the notice, who
 * the story follows, and the tab.
 */
function applySettings(next) {
    const ctx = context();
    if (!ctx?.extensionSettings) return;
    const blocksKey = () => JSON.stringify([termsOf(rules()), settings(ctx).partyTag, settings(ctx).characterTag]);
    const termsBefore = JSON.stringify(termsOf(rules()));
    const blocksBefore = blocksKey();
    const enabledBefore = settings(ctx).enabled;
    const activeBefore = settings(ctx).activeSkills;
    ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next };
    ctx.saveSettingsDebounced?.();
    if (settings(ctx).enabled !== enabledBefore) announceToSuite();
    // New terms, tags or the tab switch: Story Block replaces a block registered again under its
    // id. The sheets are written again for new words or a new skill cap.
    const sb = storyBlock();
    if (registered && sb && blocksKey() !== blocksBefore) registerKeptBlocks(sb);
    if (registered && sb && (JSON.stringify(termsOf(rules())) !== termsBefore || settings(ctx).activeSkills !== activeBefore)) void rewriteSheets();
    settingsPanel?.setSheetConflict?.(sheetConflict(ctx));
    settingsPanel?.setSources?.(currentSources());
    storyBlock()?.refresh?.();
}

// The Story Suite look of the settings panels (src/suite.css, identical in the four extensions):
// loaded once per page, by whichever extension comes first.
function loadSuiteCss(documentRef) {
    try {
        if (documentRef.getElementById?.('story-suite-css')) return;
        const link = documentRef.createElement('link');
        link.id = 'story-suite-css';
        link.rel = 'stylesheet';
        link.href = new URL('./src/suite.css', import.meta.url).href;
        documentRef.head?.appendChild(link);
    } catch (error) {
        console.warn('[RPG Battle] the Story Suite styles could not be loaded', error);
    }
}

function addSettingsPanel(documentRef) {
    loadSuiteCss(documentRef);
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
        sources: currentSources(),
        profiles: connectionProfiles(),
        suiteLink: Boolean(suiteOpener()),
        onOpenSuite: () => openStorySuite(),
        onDisableSheet: () => disableStorySheet(),
        onChange: next => applySettings(next),
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
    // Before the UI, so an extension that loads later finds RPG Battle already announced.
    announceToSuite();
    watchSuite();
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
