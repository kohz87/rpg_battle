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
// <Encounter> (or a fight Story Director planned) is offered as a fight, never started, and
// fought as the story wrote it (foes and stakes; the reader takes it or leaves it); its
// <Joins>, <Leaves>, <Learned>, <XP> and <Rest> (and the opening message's), Story Director's
// finished quests, a fallen companion and a rename are offers too (src/offers.js), applied
// only on Accept. The reader gets no free fight, rest, skill or companion: the story brings
// them. Two tabs: Party, always there, and Battle, only while there is a battle.
//
// (0.5) An <Encounter> may be a plan: fights in stages somewhere else each ("then at the
// yard:"). Each stage is a fight of its own, the party carried from one to the next; between
// them the reader goes on or falls back; the plan is kept in chat state, tied to the reply it
// started from like its fights, and its result is written once, when it ends (src/plan.js).
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

import { DEFAULT_RULES, checkModifiers, clampXpRate, makeRules, suggestRank, threatForGap } from './src/rules.js';
import { hashSeed, makeRng } from './src/rng.js';
import { DEFAULT_SKILLS, findSkill, resolveSkills, skillFromTemplate } from './src/skills.js';
import { DEFAULT_BESTIARY, findCreature } from './src/enemies.js';
import { TEMPLATES, classify, cleanCreature, combinedBestiary, creaturesToMake, familyOf, familyTitle, findKin, generateCreature, storeCreatures } from './src/templates.js';
import { applyFlavour, flavourPrompt, parseFlavour, sceneText } from './src/flavour.js';
import { act, availableActions, foeXpWorth, replay, startFight, summarize } from './src/combat.js';
import { applyResult, foldUses, forgetSkill, formatPartyBlock, learnSkill, newSheet, readSheets, setSkillActive, spendPoints } from './src/sheet.js';
import { addLoot, consumables, formatGearEntry, formatMoney, gearSummary, parseGearEntry, parseInventory, useItems } from './src/items.js';
import { NEXT_MOVES_MAX, fallbackMoves, nextMovesPrompt, parseNextMoves } from './src/nextmoves.js';
import { buildHandoff, buildPlanHandoff, fightOrigin, grouped, handoffState, originHolds, settleHandoff } from './src/handoff.js';
import { cleanPlan, newPlan, nextStage, planResult, stageDone, stageId } from './src/plan.js';
import { combatantFromSheet, editCompanion, enemiesFromRows, engagements, newCompanion, npcRenames, remapIds } from './src/party.js';
import { recoverOverTime, restAfter, useItemOutside } from './src/recovery.js';
import { NARRATING_INSTRUCTION, STORY_INSTRUCTION, applyWounds, describeWound, encounterSummary, findTarget, parsePlan, parseStakes, parseWounds, resolveThreats, storyFight } from './src/story.js';
import { liveOffers, questOffers, storyOffers } from './src/offers.js';
import { awardParty, settleCompanions } from './src/growth.js';
import { guessFocus } from './src/builds.js';
import { fallbackKit, kitPrompt, kitTemplate, namedKit, parseKit, usableKit } from './src/kit.js';
import { cleanParty, exportParty } from './src/partyfile.js';
import { renderBattleTab } from './src/ui/tab.js';
import { renderSettings } from './src/ui/settings.js';
import { DEFAULT_TERMS, levelText, maxLevel, termsOf } from './src/terms.js';
import { storySuite } from './src/suite.js';
import { announcement, manageApi, partyMembers, sheetNotice, sources, suiteOverlay, suiteSignature, tokenEstimate, truthChoices } from './src/handshake.js';

const VERSION = '0.5.12';
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
    // (0.5.2) Multiplies all XP: fights, parleys, story awards and quests (rules.xpRate, 0.25–5).
    xpRate: DEFAULT_RULES.xpRate,
    // Sent for you by "Return to story", so the narration comes straight away.
    returnMessage: '*(The fight is over.)*',
    // (0.5.4) After a fight, a few next moves on the result screen (a model call when model
    // calls are on, else written by code); off: only Return to story.
    nextMoves: true,
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
// The fight whose result is being written ({ chatId, fight }), shown meanwhile (finishFight).
let ending = null;
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
        currency: own.currency, terms: own.terms, gear: own.gear, xpRate: clampXpRate(own.xpRate),
    });
}

// Per-chat state: { fight: { setup, actions, origin } | null, plan: a plan of stages under way (src/plan.js) | null,
// pending: { handoff, fightId, attachedTo, origin } | null,
// last: the last result for the tab, skills: skills this story taught (by hand),
// (mastery progress is on the Skills lines since 0.4.1; an older chat's `uses` is read once, see legacyUses),
// recovered: { index, text } the last story-time recovery,
// story: { index, signature, applied, undone, written } the last reply's story wounds (signature: a hash
// of its <Wounds> text; written: hashes of the sheet texts the pipeline wrote into it),
// dismissed: ['index:encounter text'] encounter offers the reader said Not now to (and fought),
// dismissedAt: { [key]: { index, date, swipe } } the reply each was put away on (0.5; gone with it),
// narrated: [{ index, date, swipe }] the replies that narrated a fight's hand-off (0.5),
// bestiary: [creature] the creatures made up in this story (src/templates.js), cleaned when stored,
// npcLinks: { [memberId]: npcId } the NPC State Delta NPC a companion was added from,
// done: ['0:kind:line'] the opening message's offers taken or put away,
// fallen: [{ memberId, name }] companions who fell in a fight to the death, to remove or keep,
// foughtAt: { index, text, origin } the latest reply (a hash of its hidden blocks, and since 0.5 its origin) when the last fight started,
// npcNames: { [npcId]: name } a linked NPC's name in NPC State Delta when last looked at (a change is followed once) }.
function chatState(ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return { fight: null, plan: null, pending: null, story: null, dismissed: [], dismissedAt: {}, narrated: [], bestiary: [], skills: [], npcLinks: {}, done: [], fallen: [], npcNames: {} };
    const state = meta[SETTINGS_KEY] && typeof meta[SETTINGS_KEY] === 'object' ? meta[SETTINGS_KEY] : {};
    // A fight or result from before 0.4.3 has no origin: the reply it started from is taken
    // from foughtAt (index only), so deleting back past it still takes them away.
    // One whose reply is gone (deleted, swiped away) reads as none (settlePending clears it).
    const legacyOrigin = state.foughtAt && Number.isInteger(state.foughtAt.index) ? { index: state.foughtAt.index } : null;
    const withOrigin = value => (value && typeof value === 'object' && !value.origin && legacyOrigin ? { ...value, origin: legacyOrigin } : value ?? null);
    const holding = value => (value && originHolds(value.origin, ctx?.chat ?? []) ? value : null);
    // (0.5) An offer put away or fought belongs to its reply: once that reply is deleted, swiped
    // away or replaced, its key no longer hides the offer of the reply now at that place (an
    // identical reply sent again is a new reply). A key from before 0.5 has no record and stays.
    const stamps = state.dismissedAt && typeof state.dismissedAt === 'object' ? state.dismissedAt : {};
    const standing = key => !stamps[key] || originHolds(stamps[key], ctx?.chat ?? []);
    const dismissed = (Array.isArray(state.dismissed) ? state.dismissed : []).filter(standing);
    // Likewise the reply the last fight started from: a fight rolled back with it never happened.
    const foughtAt = state.foughtAt && typeof state.foughtAt === 'object' && (!state.foughtAt.origin || originHolds(state.foughtAt.origin, ctx?.chat ?? [])) ? state.foughtAt : null;
    return {
        fight: holding(withOrigin(state.fight)),
        // (0.5) A plan under way, between stages too: tied to the reply it started from, like its fights.
        plan: holding(cleanPlan(state.plan)),
        pending: holding(withOrigin(state.pending)),
        // The result screen's record goes back with its fight's reply too (0.5: `origin`).
        last: holding(state.last ?? null),
        skills: Array.isArray(state.skills) ? state.skills : [],
        recovered: state.recovered ?? null,
        story: state.story && typeof state.story === 'object' ? state.story : null,
        dismissed,
        dismissedAt: Object.fromEntries(dismissed.filter(key => stamps[key]).map(key => [key, stamps[key]])),
        // (0.5) The replies that narrated a fight ({ index, date, swipe }): no XP or rest offered from them.
        narrated: Array.isArray(state.narrated) ? state.narrated.filter(entry => entry && Number.isInteger(entry.index)) : [],
        bestiary: Array.isArray(state.bestiary) ? state.bestiary.filter(entry => entry && typeof entry === 'object' && entry.name) : [],
        npcLinks: state.npcLinks && typeof state.npcLinks === 'object' ? state.npcLinks : {},
        done: Array.isArray(state.done) ? state.done : [],
        fallen: Array.isArray(state.fallen) ? state.fallen.filter(entry => entry && entry.memberId) : [],
        foughtAt,
        npcNames: state.npcNames && typeof state.npcNames === 'object' ? state.npcNames : {},
    };
}

/** A fight being fought, or a plan under way (between its stages too): one battle, which owns the sheets. */
const underWay = state => Boolean(state?.fight || state?.plan);

const NARRATED_KEPT = 30;

/**
 * Whether the reply at `index` narrates a fight: it is the one the waiting hand-off is given to,
 * or (0.5) it is still the very reply that narrated one (by place, send date and swipe), even
 * once that hand-off is spent and another fight's came and went.
 */
function narratesAt(state, chat, index) {
    if (state.pending?.attachedTo === index) return true;
    return state.narrated.some(entry => entry.index === index && originHolds(entry, chat));
}

/** The narrated record with the hand-off's reply added once it is in the chat; null when unchanged. */
function noteNarrated(state, chat) {
    const at = state.pending?.attachedTo;
    if (!Number.isInteger(at) || !isAssistant(chat?.[at])) return null;
    const origin = fightOrigin(chat, at);
    if (state.narrated.some(entry => entry.index === origin.index && entry.date === origin.date && entry.swipe === origin.swipe)) return null;
    return [...state.narrated, origin].slice(-NARRATED_KEPT);
}

/** An offer put away (or fought) from the reply at its key's index: its key and that reply's record. */
function awayChange(state, key, list = 'dismissed', kept = DISMISSED_KEPT) {
    const index = Number(String(key ?? '').match(/^(\d+):/)?.[1] ?? NaN);
    const origin = Number.isInteger(index) ? fightOrigin(context()?.chat ?? [], index) : null;
    const keys = [...state[list].filter(entry => entry !== key), key].slice(-kept);
    const change = { [list]: keys };
    if (list === 'dismissed') {
        const stamps = Object.fromEntries(Object.entries({ ...state.dismissedAt, ...(origin ? { [key]: origin } : {}) }).filter(([entry]) => keys.includes(entry)));
        if (!origin) delete stamps[key];
        change.dismissedAt = stamps;
    }
    return change;
}

// Whether a reply that was given the hand-off is being generated (set by the interceptor,
// cleared when a reply arrives or generation ends), so a result is "being narrated" rather
// than "waiting" until its reply is in the chat.
let generating = false;

/** Where the hand-off stands (src/handoff.js): 'none', 'waiting', 'narrating' or 'narrated'. */
function handoffNow(ctx = context(), state = chatState(ctx)) {
    return handoffState(state.pending, ctx?.chat ?? [], { generating });
}

/**
 * The stored hand-off brought up to date with the chat: spent once a reply after the narrating
 * one exists, waiting again when the narrating reply is gone (deleted), and gone, with a fight
 * under way, once the reply the fight started from is gone (0.4.3). True when it changed.
 */
function settlePending(ctx = context()) {
    const meta = chatMeta(ctx);
    const raw = meta?.[SETTINGS_KEY] && typeof meta[SETTINGS_KEY] === 'object' ? meta[SETTINGS_KEY] : {};
    const state = chatState(ctx);
    const { pending, fight, plan } = state;
    // The reply given the hand-off is in: remembered as a narrating reply, past the hand-off itself.
    const narrated = noteNarrated(state, ctx?.chat ?? []);
    // A fight, or a result, whose reply is gone (deleted, swiped away) went back with it (0.4.3):
    // chatState reads it as none; here it is cleared and its screens closed. A plan likewise,
    // between its stages too (0.5).
    const fightGone = Boolean(raw.fight) && !fight;
    const planGone = Boolean(raw.plan) && !plan;
    const resultGone = Boolean(raw.pending) && !pending;
    if (fightGone || planGone || resultGone) {
        live = { chatId: null, key: '', fight: null };
        if (screen.mode === 'fight' || screen.mode === 'result') screen = { chatId: chatIdOf(ctx), mode: null };
    }
    const next = settleHandoff(pending, ctx?.chat ?? [], { generating });
    const pendingChanged = resultGone || JSON.stringify(next ?? null) !== JSON.stringify(pending ?? null);
    if (!fightGone && !planGone && !pendingChanged && !narrated) return false;
    saveChatState({ ...(fightGone ? { fight: null } : {}), ...(planGone ? { plan: null } : {}), ...(pendingChanged ? { pending: next } : {}), ...(narrated ? { narrated } : {}) });
    return true;
}

function saveChatState(change) {
    const ctx = context();
    const meta = chatMeta(ctx);
    if (!meta) return;
    // An older chat's mastery progress stays where it was until the block carries it (legacyUses).
    const old = legacyUses(ctx);
    meta[SETTINGS_KEY] = { ...chatState(ctx), ...(old ? { uses: old } : {}), ...change };
    ctx.saveMetadataDebounced?.();
}

/**
 * An older chat's mastery progress: RPG Battle 0.4.0 kept it in chat metadata (`uses`:
 * { [memberId]: { [skill]: n } }), out of the block, so deleting a reply never took it back.
 * Since 0.4.1 the Skills lines carry it. The old record is only read: sheetsAt folds it into
 * skills whose line gives no progress (src/sheet.js foldUses), and the next write of the Party
 * block carries it, after which it is dropped (dropLegacyUses) and never written again. null
 * when there is none.
 */
function legacyUses(ctx = context()) {
    const uses = chatMeta(ctx)?.[SETTINGS_KEY]?.uses;
    return uses && typeof uses === 'object' && Object.keys(uses).length ? uses : null;
}

function dropLegacyUses(ctx = context()) {
    const state = chatMeta(ctx)?.[SETTINGS_KEY];
    if (!state || !('uses' in state)) return;
    delete state.uses;
    ctx.saveMetadataDebounced?.();
}

// The skill library: the shipped skills and the ones this story taught.
function library(ctx = context()) {
    return [...DEFAULT_SKILLS, ...chatState(ctx).skills];
}

// The bestiary a name is looked up in: this story's made-up creatures, then the shipped ones.
// The story instruction, plus (0.5.1) the creatures this story has already met, newest last, so
// the model writes the same creature by the same name instead of a new one every fight.
const KNOWN_FOES_SHOWN = 8;
function storyInstruction(ctx = context()) {
    const names = [...new Set((chatState(ctx).bestiary ?? []).map(entry => String(entry?.name ?? '').trim()).filter(name => name && !name.includes(':')))].slice(-KNOWN_FOES_SHOWN);
    return names.length ? `${STORY_INSTRUCTION} Foes this story has met (the same creature keeps its name): ${names.join(', ')}.` : STORY_INSTRUCTION;
}

// The names the setup does not tag as new: the bestiary's, and (0.5.1) each row's that names a
// known creature in other words ("Young Wolf" for the Wolf).
function knownNames(bestiary, rows = []) {
    return [...bestiary.flatMap(entry => [entry.name, ...(entry.aliases ?? [])]), ...(rows ?? []).map(row => row?.name).filter(name => name && findCreature(bestiary, name))];
}

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
 * (src/sheet.js readSheets). { pc, members, legacy, folded }; companions carry the NPC State
 * Delta id they were added from (chat state `npcLinks`), when they have one. Mastery progress is
 * the block's; an older chat's, kept in metadata, fills in skills the block gives none
 * (`folded`: some did, so the block should be written again; see legacyUses).
 */
function sheetsAt(sb = storyBlock(), { beforeIndex = null } = {}) {
    const own = settings();
    if (!sb) return { pc: null, members: [], legacy: false, folded: false };
    const party = sb.getBlock?.(own.partyTag, { beforeIndex }) ?? null;
    const character = own.characterTag && own.characterTag !== own.partyTag ? sb.getBlock?.(own.characterTag, { beforeIndex }) ?? null : null;
    const read = readSheets({
        party: party?.text ?? '',
        character: character?.text ?? '',
        partyIndex: party?.messageIndex ?? null,
        characterIndex: character?.messageIndex ?? null,
    }, rules());
    const old = legacyUses();
    const sheets = old ? { ...read, ...foldUses(read, old, rules()) } : { ...read, folded: false };
    const links = chatState().npcLinks;
    return { ...sheets, members: sheets.members.map(member => (links[member.id] ? { ...member, npcId: links[member.id] } : member)) };
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

/**
 * The one Party block: your section, then the companions (an older Character block is left as it
 * was). The sheets come from sheetsAt, so an older chat's mastery progress is in them: once
 * written, the block carries it and the old record goes.
 */
async function writeSheets(pc, members) {
    await writeBlock(settings().partyTag, formatPartyBlock(pc, members ?? [], rules()));
    dropLegacyUses();
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
        if (underWay(chatState())) return;
        const { pc, members } = currentSheets();
        if (pc || members.length) await writeSheets(pc, members);
    } catch (error) {
        console.warn('[RPG Battle] the sheets could not be rewritten in the new terms', error);
    }
}

// An older chat keeps your sheet in the Character block, which is no longer kept (nor shown to
// the model), or its mastery progress in metadata (before 0.4.1): once its chat is open, the
// sheets are written as the one Party block, progress on the Skills lines, into the latest
// reply. Not during a fight (it owns the sheets), and once per chat and state.
let migration = { key: '', timer: null, running: false };

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
        if (!own.enabled || !storyBlock() || underWay(chatState(ctx)) || latestAssistantIndex(ctx?.chat ?? []) < 0) return;
        const { pc, members, legacy, folded } = currentSheets();
        if (!(legacy && pc) && !folded) return;
        const key = `${chatIdOf(ctx)}:${(ctx?.chat ?? []).length}`;
        if (migration.key === key) return;
        migration.key = key;
        migration.running = true;
        await writeSheets(pc, members);
        if (legacy && pc) console.info('[RPG Battle] the Character and Party blocks are now one Party block.');
        if (folded) console.info('[RPG Battle] mastery progress is now on the Party block\'s Skills lines.');
    } catch (error) {
        console.warn('[RPG Battle] the older sheets could not be written as one Party block', error);
    } finally {
        if (migration.running) {
            migration.running = false;
            // A rename looked at meanwhile waited for this write (followNpcRenames).
            scheduleNpcFollow();
        }
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

/**
 * The setup's rows as they will be fought, for the read-only summary: each with its power
 * settled as rankedRows does (a level, or a rank; a creature either bestiary knows without
 * one shows its own), its role (written, the creature's, or the one its template gives a
 * name made up for the fight), and (0.5.2) `xp`, one foe's worth to your character.
 */
function setupRows(rows, sheet, r, bestiary) {
    return rankedRows(rows, sheet, r, bestiary).map(row => {
        const creature = findCreature(bestiary, row.name);
        const kind = creature ? null : classify(row.name);
        const level = row.level ?? (row.rank ? null : Number(creature?.level) >= 1 ? Math.round(Number(creature.level)) : null);
        // (0.5.2) What one of them is worth to you, as the result will count it (a share of your
        // next level by the level gap, boss, the XP rate: combat.foeXpWorth).
        const [foe] = enemiesFromRows([{ ...row, count: 1 }], { bestiary, library: [], rules: r, rng: null });
        // A name to be made up: the relative it will be made as kin of, for the "new" tag.
        const kin = creature ? null : findKin(row.name, { chatBestiary: chatState().bestiary, defaults: DEFAULT_BESTIARY })?.entry?.name ?? null;
        return {
            name: row.name,
            count: row.count,
            level,
            rank: level ? null : row.rank ?? creature?.rank ?? null,
            role: row.role || creature?.role || kind?.role || TEMPLATES[kind?.template]?.role || null,
            boss: Boolean(row.boss),
            // A foe with a level of its own gets the threat its gap to you is (0.5.3).
            ...(row.threat ? { threat: row.threat } : Number(foe?.level) >= 1 ? { threat: threatForGap(foe.level - sheet.level, r) } : {}),
            ...(foe ? { xp: foeXpWorth(foe, sheet.level, r) } : {}),
            ...(kin ? { kin } : {}),
            ...(row.wave ? { wave: row.wave } : {}),
            ...(row.stage ? { stage: row.stage } : {}),
        };
    });
}

/** The party as the sheets have it, as combatants: you (played) and the companions (auto or commanded). */
function partyFromSheets(sheet, r) {
    const items = currentItems();
    return [
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
}

/**
 * A fight's setup from the story's rows: the foes projected with their power settled, the
 * engagements after the first ("then:") as waves, validated by starting it once. The stored
 * form is the setup and the actions.
 */
function fightSetup(rows, { id, party, stakes, fresh = [] }) {
    const ctx = context();
    const sheet = currentSheet();
    const r = rules();
    const seed = `${chatIdOf(ctx)}:${id}`;
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
    // A foe without a threat word shows the one its level gap to you is (0.5.3).
    const graded = all.map(enemy => (enemy.threat || !(Number(enemy.level) >= 1) || !sheet ? enemy : { ...enemy, threat: threatForGap(enemy.level - sheet.level, r) }));
    const { enemies, waves } = engagements(graded);
    const setup = { id, seed, party, enemies, ...(waves.length ? { waves } : {}), stakes: stakes === 'death' ? 'death' : 'normal' };
    startFight({ ...setup, rules: r });
    return setup;
}

/** Where a fight (or a plan) starts: the latest reply, its origin and its offers' stamp. */
function startingPoint() {
    const ctx = context();
    // The latest reply's offers end here: a rest or an award from before the fight is not taken after it.
    const latest = latestAssistantIndex(ctx?.chat ?? []);
    const sb = storyBlock();
    return {
        // The fight belongs to that reply: deleted or swiped away, the fight and its result go too.
        origin: fightOrigin(ctx?.chat ?? [], latest),
        foughtAt: sb && latest >= 0 ? { index: latest, text: replyStamp(sb, latest), origin: fightOrigin(ctx?.chat ?? [], latest) } : null,
    };
}

function startNewFight({ rows, stakes }, { fresh = [] } = {}) {
    const ctx = context();
    const sheet = currentSheet();
    if (!sheet) throw new Error('Make your character first.');
    const id = `fight-${Date.now().toString(36)}`;
    const setup = fightSetup(rows, { id, party: partyFromSheets(sheet, rules()), stakes, fresh });
    const { origin, foughtAt } = startingPoint();
    saveChatState({ fight: { setup, actions: [], origin }, foughtAt });
    screen = { chatId: chatIdOf(ctx), mode: 'fight' };
}

// ---------------------------------------------------------------------------
// Plans: fights in stages (0.5, src/plan.js)

/**
 * A plan begins: stage 1 is fought with the party as the sheets have it. The plan (its stages
 * as the story wrote them, the stakes, the creatures made for it) is kept in the chat's state
 * beside the stage's fight, tied to the same reply, so a reload finds it and a deleted or
 * swiped reply takes it back.
 */
function startPlan({ stages, stakes }, { fresh = [] } = {}) {
    const ctx = context();
    const sheet = currentSheet();
    if (!sheet) throw new Error('Make your character first.');
    const { origin, foughtAt } = startingPoint();
    const plan = newPlan({ id: `plan-${Date.now().toString(36)}`, stakes, stages, fresh, origin });
    const setup = fightSetup(plan.stages[0].rows, { id: stageId(plan.id, 0), party: partyFromSheets(sheet, rules()), stakes: plan.stakes, fresh: plan.fresh });
    saveChatState({ plan, fight: { setup, actions: [], origin }, foughtAt });
    screen = { chatId: chatIdOf(ctx), mode: 'fight' };
}

/** Go on: the next stage, the party as the last one left it (no healing between stages). */
async function goOnPlan() {
    const state = chatState();
    if (state.plan?.status !== 'between' || state.fight) throw new Error('There is no stage to go on to.');
    const plan = nextStage(state.plan);
    const setup = fightSetup(plan.stages[plan.at].rows, { id: stageId(plan.id, plan.at), party: plan.carry ?? [], stakes: plan.stakes, fresh: plan.fresh });
    saveChatState({ plan: { ...plan, carry: null }, fight: { setup, actions: [], origin: plan.origin } });
    screen = { chatId: chatIdOf(context()), mode: 'fight' };
    // Nobody left to command (the fallen stay down): the stage is fought out at once.
    const fight = currentFight();
    if (fight && fight.status !== 'active') await finishFight(fight);
}

/** Fall back: the plan ends between stages; what the cleared stages gave is kept. */
async function fallBackPlan() {
    const state = chatState();
    if (state.plan?.status !== 'between' || state.fight) throw new Error('There is no plan to fall back from.');
    await endPlan(state.plan, 'withdrew');
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

// (0.5.4) The next moves for the result on screen: { fightId, status: 'loading' | 'ready', moves,
// source: 'model' | 'code' }. In memory only; after a reload the code's moves stand in.
let nextMoves = { fightId: null, status: 'idle', moves: [], source: '' };
const NEXT_MOVES_SECONDS = 15;
const NEXT_MOVES_TOKENS = 200;

/** Whether a result gets next moves: the setting on, and not a character's death. */
function wantsNextMoves(result) {
    if (settings().nextMoves === false) return false;
    return !(result?.stakes === 'death' && result?.outcome === 'defeat');
}

/**
 * The next moves for a result just written: the model's when model calls are on and its answer
 * has at least two, else the code's (src/nextmoves.js). The screen shows "loading" meanwhile;
 * a newer result replaces an older one's call, whose answer is then ignored.
 */
async function prepareNextMoves(id, result, handoff) {
    if (!wantsNextMoves(result)) {
        nextMoves = { fightId: id, status: 'ready', moves: [], source: '' };
        return;
    }
    const fallback = fallbackMoves(result);
    const own = settings();
    // The chat's own connection offline: no call to wait for.
    const offline = own.flavour?.model?.source !== 'profile' && context()?.onlineStatus === 'no_connection';
    if (!own.flavour?.enabled || offline) {
        nextMoves = { fightId: id, status: 'ready', moves: fallback, source: 'code' };
        return;
    }
    nextMoves = { fightId: id, status: 'loading', moves: [], source: '' };
    storyBlock()?.refresh?.();
    let moves = [];
    try {
        const messages = nextMovesPrompt({ handoff, scene: recentScene(), pcName: currentSheet()?.name ?? '' });
        moves = parseNextMoves(await withTimeout(sendToModel(messages, own.flavour.model, NEXT_MOVES_TOKENS), NEXT_MOVES_SECONDS * 1000));
        if (moves.length < 2) console.info('[RPG Battle] the next-moves answer had too little to use; the written ones stand in.');
    } catch (error) {
        console.info(`[RPG Battle] the next-moves call failed (${error instanceof Error ? error.message : String(error)}); the written ones stand in.`);
    }
    if (nextMoves.fightId !== id) return;
    nextMoves = moves.length >= 2 ? { fightId: id, status: 'ready', moves: moves.slice(0, NEXT_MOVES_MAX), source: 'model' } : { fightId: id, status: 'ready', moves: fallback, source: 'code' };
    storyBlock()?.refresh?.();
}

/** The next moves the result screen shows for the stored result `last`. */
function nextMovesFor(last) {
    if (!last || !wantsNextMoves(last.result)) return null;
    if (nextMoves.fightId === last.fightId) return { status: nextMoves.status, moves: nextMoves.moves, source: nextMoves.source };
    return { status: 'ready', moves: fallbackMoves(last.result), source: 'code' };
}

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
        // A plan's foes are all made before its first stage, so Go on never waits on a model call.
        if (setup.stages?.length > 1) startPlan(setup, { fresh });
        else startNewFight(setup, { fresh });
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
    // (0.5.2) Kin stays kin: of the relative it was made from while that is still there, else its closest one now.
    const others = state.bestiary.filter(entry => entry.name !== name);
    const kin = (old.kin ? [...others, ...DEFAULT_BESTIARY].find(entry => entry.name === old.kin) : null) ?? findKin(old.name, { chatBestiary: others, defaults: DEFAULT_BESTIARY })?.entry ?? null;
    let entry = generateCreature({ name: old.name, level: old.level, role: null }, { rules: r, seed: `${chatIdOf(context())}:${Date.now()}`, kin });
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
// waiting for the next reply. A plan's stage ends into the plan instead (finishStage).
let finishing = null;

/**
 * A fight's (or a whole plan's) result written once, into the latest reply: the sheets (XP,
 * levels, mastery, HP and MP as it ended), companions' points spent by build, death after a
 * defeat to the death, the fallen, the items used and the loot. The report for the result screen.
 */
async function writeResult(result, stakes) {
    const r = rules();
    const own = settings();
    const sheet = currentSheet();
    const report = { levelsGained: 0, pointsGained: 0, levelsReached: 0, masteryUps: [] };
    // Skills that reached a new mastery, for the result screen: { memberId, name, skill, level }.
    const noteMastery = (memberId, name, applied) => {
        for (const skill of applied.masteryGained) {
            const level = applied.sheet.skills.find(entry => entry.name === skill)?.mastery ?? 2;
            report.masteryUps.push({ memberId, name, skill, level });
        }
    };
    try {
        let pc = sheet;
        // Mastery progress is on the sheets (their Skills lines), so it is written with the rest
        // and a deleted or swiped reply takes it back too.
        if (sheet) {
            const applied = applyResult(sheet, 'pc', result, r);
            report.levelsGained = applied.levelsGained;
            report.pointsGained = applied.pointsGained;
            report.levelsReached = applied.levelsGained ? applied.sheet.level : 0;
            noteMastery('pc', sheet.name, applied);
            pc = applied.sheet;
            // Lost to the death: the story of this character ends. The sheet says so (the State
            // line reads "dead"), so a swipe or a deleted reply takes it back with the rest.
            if (stakes === 'death' && result.outcome === 'defeat') pc = { ...pc, hp: { ...pc.hp, cur: 0 }, conditions: [{ name: DEAD, rounds: null }] };
        }
        const raised = currentParty().map(member => {
            const applied = applyResult(member.sheet, member.id, result, r);
            noteMastery(member.id, member.name, applied);
            return { ...member, sheet: applied.sheet };
        });
        // Companions on auto spend what a level gave them, by build (the setting allowing).
        const members = settleCompanions(raised, { autoSpend: own.autoSpend !== false, rules: r });
        if (pc || members.length) await writeSheets(pc, members);
        // A companion at 0 HP when a fight to the death ends fell: offered for removal afterwards.
        if (stakes === 'death') {
            const fell = result.party.filter(entry => entry.memberId !== 'pc' && (entry.down || entry.hp?.cur <= 0)).map(entry => members.find(member => member.id === entry.memberId)).filter(Boolean);
            if (fell.length) saveChatState({ fallen: [...chatState().fallen.filter(entry => !fell.some(member => member.id === entry.memberId)), ...fell.map(member => ({ memberId: member.id, name: member.name }))] });
        }
        const inventory = blockText(own.inventoryTag);
        if (inventory.trim() || result.loot?.items?.length || result.loot?.money) {
            let next = useItems(inventory, result.itemsUsed?.pc ?? {});
            // Loot only from fights won: a single fight's result has none otherwise, and a
            // plan's holds the loot of the stages it cleared.
            if (result.loot?.items?.length || result.loot?.money) next = addLoot(next, result.loot, r.currency);
            if (next !== inventory) await writeBlock(own.inventoryTag, next);
        }
    } catch (error) {
        notify('error', `The result could not be written: ${error instanceof Error ? error.message : String(error)}`);
        console.error('[RPG Battle] writing the result failed', error);
    }
    return report;
}

/** The result is written and waits for the story: the hand-off stored, the result on screen. */
async function resultReady({ id, result, handoff, origin, report }) {
    logActivity(`Fight ended: ${result?.outcome ?? '?'}${result?.defeated?.length ? ` · foes defeated ${grouped(result.defeated)}` : ''}${result?.fled?.length ? ` · fled ${grouped(result.fled)}` : ''}`);
    saveChatState({ fight: null, plan: null, pending: { handoff, fightId: id, attachedTo: null, origin }, last: { fightId: id, result, handoff, ...report, origin } });
    await context()?.saveMetadata?.();
    finishing = null;
    ending = null;
    live = { chatId: chatIdOf(context()), key: '', fight: null };
    screen = { chatId: chatIdOf(context()), mode: 'result' };
    storyBlock()?.refresh?.();
    void prepareNextMoves(id, result, handoff);
}

async function finishFight(fight) {
    // Once per fight, even if a redraw asks again while the writes are under way.
    if (finishing === fight.id) return;
    const state = chatState();
    if (state.plan && state.plan.status === 'fighting' && stageId(state.plan.id, state.plan.at) === fight.id) {
        await finishStage(fight, state.plan);
        return;
    }
    finishing = fight.id;
    const r = rules();
    const result = summarize(fight, r);
    // The reply the fight started from, before the fight is cleared.
    const origin = state.fight?.origin ?? null;
    // Shown in the Battle tab while the result is written, so the tab does not drop out (and the
    // sidebar jump to another tab) between the fight and its result.
    ending = { chatId: chatIdOf(context()), fight };
    // The fight is over before anything is written: the block writes save the chat, and the
    // saved chat must not hold a fight that is still "active".
    saveChatState({ fight: null });
    const sheet = currentSheet();
    const report = await writeResult(result, fight.stakes);
    const handoff = buildHandoff(result, {
        names: Object.fromEntries(fight.combatants.map(entry => [entry.id, entry.name])),
        currency: r.currency,
        stakes: fight.stakes,
        pcName: sheet?.name ?? 'You',
        rules: r,
    });
    await resultReady({ id: fight.id, result, handoff, origin, report });
}

/**
 * A plan's stage is over: won with a stage to come, the plan waits between stages (Go on or
 * Fall back; nothing written yet); otherwise the plan ends here.
 */
async function finishStage(fight, plan) {
    if (plan.done.some(entry => entry.fightId === fight.id)) {
        saveChatState({ fight: null });
        return;
    }
    const { plan: next, ended } = stageDone(plan, fight, summarize(fight, rules()));
    live = { chatId: chatIdOf(context()), key: '', fight: null };
    if (!ended) {
        saveChatState({ fight: null, plan: next });
        await context()?.saveMetadata?.();
        screen = { chatId: chatIdOf(context()), mode: null };
        storyBlock()?.refresh?.();
        return;
    }
    ending = { chatId: chatIdOf(context()), fight, plan: next };
    await endPlan(next, ended);
}

/**
 * The plan ends ('victory' after the last stage, 'defeat' or 'fled' in a stage, 'withdrew' on
 * Fall back): the stages' results as one (planResult) written once, as a fight's is, and one
 * hand-off saying what happened at each stage and which were never reached.
 */
async function endPlan(plan, outcome) {
    if (finishing === plan.id) return;
    finishing = plan.id;
    const r = rules();
    const result = planResult(plan, outcome);
    // Shown meanwhile: the last stage's fight, or after Fall back the plan as it stood.
    ending = { chatId: chatIdOf(context()), fight: ending?.fight ?? null, plan };
    saveChatState({ fight: null, plan: null });
    const sheet = currentSheet();
    const report = await writeResult(result, plan.stakes);
    const names = Object.fromEntries(result.party.map(entry => [entry.memberId, entry.name]));
    const handoff = buildPlanHandoff(result, { names, currency: r.currency, stakes: plan.stakes, pcName: sheet?.name ?? 'You', rules: r });
    await resultReady({ id: plan.id, result, handoff, origin: plan.origin, report });
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
        if (changed) {
            await sb.setBlockText(index, own.partyTag, next);
            dropLegacyUses();
        }
        if (changed || current !== null) written.party = textHash(next);
    }
    return { ok: true, written };
}

// One after-reply pipeline (Story Block's onReply): recovery, then wounds, written once. Then an
// NPC renamed in NPC State Delta meanwhile is followed (followNpcRenames waits while it runs).
let replying = 0;

async function afterReply(payload) {
    replying += 1;
    try {
        // The reply is here: a hand-off given to an earlier one is spent.
        generating = false;
        settlePending();
        await planAndWriteReply(payload);
    } finally {
        replying -= 1;
    }
    scheduleNpcFollow();
}

async function planAndWriteReply({ messageIndex }) {
    const ctx = context();
    const sb = storyBlock();
    const own = settings(ctx);
    if (!sb || !own.enabled) return;
    const state = chatState(ctx);
    // A fight in progress (or a plan, between its stages too) owns the sheets; the story waits for its result.
    if (underWay(state)) return;
    const chat = ctx?.chat ?? [];
    const index = Number(messageIndex);
    if (!isAssistant(chat[index])) return;
    // A reply narrating a fight's hand-off: the fight already put its wounds on the sheets.
    const narrating = narratesAt(state, chat, index);
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
        if (plan.applied.length) {
            toastWounds(plan.applied);
            logActivity(`Story wounds from reply #${index}: ${plan.applied.map(describeWound).join('; ')}`);
        }
    }
    // (0.5.9) The narrating reply may go on into a new fight, offered when encounterOffer says so.
    if (!narrating || encounterOffer()) toastEncounter(sb, index);
    const fresh = currentOffers().filter(offer => offer.index === index);
    await awardQuests(fresh);
    toastOffers(fresh.filter(offer => offer.kind !== 'quest'));
    sb.refresh?.();
}

/** Whether the latest story wounds can still be undone: that reply's sheets are still ours. */
function canUndoStory(ctx = context(), state = chatState(ctx)) {
    const story = state.story;
    const sb = storyBlock();
    if (!sb || !story || story.undone || !story.applied?.length || underWay(state)) return false;
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
/**
 * An <Encounter> (or a planned fight's text) as code reads it: { rows, stages }. `stages` is
 * [{ place, text }] for a plan (0.5: two or more stages, "then at <place>:"; the rows carry
 * `stage`), else null.
 */
function encounterParts(text) {
    const r = rules();
    const plan = parsePlan(text, fightBestiary(), r);
    const rows = resolveThreats(plan.flatMap(stage => stage.rows), currentSheet()?.level ?? 1, r);
    return { rows, stages: plan.length > 1 ? plan.map(stage => ({ place: stage.place, text: stage.text })) : null };
}

/** The offer line: "A fight is starting: 3 wolf" or, for a plan, "A plan in 3 stages: the gate, …". */
function offerLine(text) {
    const summary = encounterSummary(text);
    return parsePlan(text).length > 1 ? summary : `A fight is starting: ${summary}`;
}

function toastEncounter(sb, index) {
    if (!currentSheet()) return;
    const text = blockAt(sb, index, ENCOUNTER_TAG) ?? '';
    const { rows, stages } = text ? encounterParts(text) : { rows: [], stages: null };
    if (!rows.length || chatState().dismissed.includes(`${index}:${text}`)) return;
    const stakes = parseStakes(text) === 'death' ? ' — to the death' : '';
    const html = `${escapeHtml(offerLine(text))}${stakes}<div class="rpg-battle-toast-actions"><button type="button" class="menu_button rpg-battle-toast-fight">Fight</button></div>`;
    const toast = notify('warning', html, { escapeHtml: false, timeOut: 15000, extendedTimeOut: 6000, closeButton: true });
    bindToastButton(toast, '.rpg-battle-toast-fight', () => fightEncounter({ rows, stages, stakes: parseStakes(text), key: `${index}:${text}` }));
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
 * Director's due or soon fight, its stakes from the same text (`| to the death`).
 * { text, label, rows, stages, stakes, key } or null (`stages`: a plan's places and words, 0.5). Nothing is offered during
 * a fight or while a result waits to be narrated, nor once dismissed (by reply and text).
 */
function encounterOffer(ctx = context(), state = chatState(ctx)) {
    const sb = storyBlock();
    // Not while a result is still to be narrated; once it is, the story moves on.
    if (!sb || underWay(state) || ['waiting', 'narrating'].includes(handoffNow(ctx, state))) return null;
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
        const { rows, stages } = encounterParts(candidate.text);
        if (rows.length) return { ...candidate, rows, stages, stakes: parseStakes(candidate.text), key };
    }
    return null;
}

// Fight? opens the setup: the story's engagement and stakes, to start or put away, never to
// change. `offer` is what code parsed from the story ({ rows, stakes, key }), kept on the
// screen; Start builds the fight from it and nothing else (storyFight).
function fightEncounter(offer) {
    const sheet = currentSheet();
    if (sheet && sheet.hp.cur <= 0) {
        notify('warning', `${sheet.name} is down: heal them first (an item, or a rest in the story).`);
        return;
    }
    if (!offer?.rows?.length) {
        notify('info', 'Fights come from the story.');
        return;
    }
    screen = { chatId: chatIdOf(context()), mode: 'setup', prefill: offer.rows, stages: offer.stages ?? null, stakes: offer.stakes === 'death' ? 'death' : 'normal', offerKey: offer.key ?? null };
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
    saveChatState(awayChange(chatState(), key));
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

/**
 * What tells a reply apart from another written later at the same place (a swipe, or one after a
 * delete): its hidden party blocks, which RPG Battle never rewrites (it does write the Party and
 * Inventory blocks into the reply, so the whole text would not do).
 */
function replyStamp(sb, index) {
    return textHash(JSON.stringify(partyBlocksAt(sb, index)));
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
    if (!sb || !own.enabled || underWay(state)) return [];
    const chat = ctx?.chat ?? [];
    const { pc, members } = currentSheets();
    const r = rules();
    const lib = library(ctx);
    const persona = personaName(ctx);
    const latest = latestAssistantIndex(chat);
    const waiting = handoffNow(ctx, state) === 'waiting';
    const offers = [];
    const from = (index, opening) => storyOffers({
        index, texts: partyBlocksAt(sb, index), pc, members, persona, rules: r, library: lib, opening,
        narrating: narratesAt(state, chat, index), pending: waiting,
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
    // (A companion added from an NPC follows a rename there on its own: followNpcRenames.)
    const away = new Set([...state.dismissed, ...state.done]);
    const seen = new Set();
    // A reply's offers last while it is the latest reply and no fight has started since.
    const foughtSince = Boolean(state.foughtAt && state.foughtAt.index === latest && state.foughtAt.text === replyStamp(sb, latest));
    return liveOffers(offers, { latest, foughtSince }).filter(offer => !away.has(offer.key) && !seen.has(offer.key) && seen.add(offer.key));
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
    else saveChatState(awayChange(state, offer.key));
}

/** An XP award written to the sheets and put away: who reached a new level, in words. */
async function awardOffer(offer, { pc, members, rules: r, autoSpend }) {
    const out = awardParty({ pc, members }, offer.data.share, { autoSpend, rules: r });
    await writeSheets(out.pc, out.members);
    putAway(offer);
    return out.gains.filter(gain => gain.levelsGained).map(gain => `${gain.name} reaches ${levelText((gain.memberId === 'pc' ? out.pc : out.members.find(member => member.id === gain.memberId)?.sheet)?.level ?? 1, r)}`);
}

/**
 * (0.5.7) Quest XP without an Award click: the story closed the quest (Story Director reports
 * it only then) and code sets the XP, so it is written into the latest reply at once and toasted
 * ("Quest done: Sheep-killer (normal) · +10 XP"). Deleting or swiping that reply takes it back
 * with the quest's closing. A key that failed once is not retried, and shows as an offer instead.
 */
const questsAwarding = new Set();
const questsFailed = new Set();

async function awardQuests(offers = currentOffers()) {
    for (const offer of (offers ?? []).filter(entry => entry.kind === 'quest' && !questsAwarding.has(entry.key) && !questsFailed.has(entry.key))) {
        questsAwarding.add(offer.key);
        try {
            const { pc, members } = currentSheets();
            const ups = await awardOffer(offer, { pc, members, rules: rules(), autoSpend: settings().autoSpend !== false });
            notify('success', `${offer.data.done}.${ups.length ? ` ${ups.join('; ')}.` : ''}`);
            logActivity(`Awarded: ${offer.data.done}${ups.length ? ` · ${ups.join('; ')}` : ''}`);
        } catch (error) {
            questsFailed.add(offer.key);
            logActivity(`Quest XP could not be written (${error instanceof Error ? error.message : String(error)}): shown as an offer`);
            console.warn('[RPG Battle] quest XP could not be awarded', error);
        } finally {
            questsAwarding.delete(offer.key);
        }
    }
}

// A quest the story closes later (Story Director's capture call writes its lines after the
// reply) is awarded on the next refresh; the badge asks on every one, so it is scheduled here.
let questsScheduled = false;
function scheduleQuestAwards(offers) {
    if (questsScheduled || !offers.some(offer => offer.kind === 'quest' && !questsFailed.has(offer.key) && !questsAwarding.has(offer.key))) return;
    questsScheduled = true;
    setTimeout(() => {
        questsScheduled = false;
        void awardQuests().then(() => storyBlock()?.refresh?.());
    }, 0);
}

// Offers the reader acts on: quest XP is awarded, not offered (shown only if awarding failed).
const shownOffers = offers => offers.filter(offer => offer.kind !== 'quest' || questsFailed.has(offer.key));

function offerByKey(key) {
    return currentOffers().find(offer => offer.key === key) ?? null;
}

/** Accept: what each offer does. Joins and Learned open their forms, prefilled; the rest apply now. */
async function acceptOffer(key) {
    const offer = offerByKey(key);
    if (!offer) throw new Error('That offer is no longer there.');
    logActivity(`Accepted: ${offer.text}`);
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
            const ups = await awardOffer(offer, { pc, members, rules: r, autoSpend: own.autoSpend !== false });
            notify('success', `${offer.kind === 'quest' ? offer.data.done : 'Awarded'}.${ups.length ? ` ${ups.join('; ')}.` : ''}`);
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
            // Your persona's new name (an NPC renamed is followed without asking).
            if (members.some(member => member.name.toLowerCase() === offer.data.name.toLowerCase())) throw new Error(`A companion is already called ${offer.data.name}.`);
            await writeSheets({ ...pc, name: offer.data.name }, members);
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
    saveChatState({ npcLinks, fallen: state.fallen.filter(entry => entry.memberId !== memberId) });
}

// A companion's id follows their name, so a rename moves what the chat keeps by id (the NPC
// link) to the new id; sheet, skills, mastery progress and gear go along in the block itself.
// The link stays under the old id too: deleting the reply with the rename brings the old name
// (and id) back, still linked. `from` says who asked, for the notice ("(from NPC State Delta)").
async function renameCompanion(memberId, changes, { from = '' } = {}) {
    const { pc, members } = currentSheets();
    const before = members.find(member => member.id === memberId);
    const edited = editCompanion(members, memberId, changes ?? {}, { pcName: pc?.name ?? '' });
    await writeSheets(pc, edited.members);
    const state = chatState();
    if (Object.entries(edited.idMap).some(([old, id]) => old !== id)) saveChatState({ npcLinks: { ...state.npcLinks, ...remapIds(state.npcLinks, edited.idMap) } });
    const after = edited.members.find(member => member.id === edited.idMap[memberId]);
    if (before && after && before.name !== after.name) notify('success', `${before.name} is now ${after.name}${from ? ` (from ${from})` : ''}.`);
}

/**
 * A companion added from an NPC follows a rename there (NPC State Delta's npcProfiles), without
 * asking: renamed through renameCompanion, written into the latest reply like any sheet change
 * (so deleting that reply takes it back), with a notice. Each change once (chat state
 * `npcNames`, src/party.js npcRenames): a reply deleted or a name changed back by hand stays as
 * it is. Looked at where the party is drawn, after each reply and when the suite changes; never
 * during a fight, a reply's own pipeline or an older chat's migration, and one pass at a time.
 */
let following = false;
let followTimer = null;

function scheduleNpcFollow() {
    if (followTimer) return;
    followTimer = setTimeout(() => {
        followTimer = null;
        void followNpcRenames();
    }, 0);
}

async function followNpcRenames() {
    if (following || replying || finishing || migration.running) return;
    const ctx = context();
    const state = chatState(ctx);
    if (!settings(ctx).enabled || !storyBlock() || underWay(state) || ending || !Object.keys(state.npcLinks).length) return;
    if (latestAssistantIndex(ctx?.chat ?? []) < 0) return;
    following = true;
    try {
        const { pc, members } = currentSheets();
        const { renames, seen } = npcRenames(members, npcProfiles(), { seen: state.npcNames, done: state.dismissed, pcName: pc?.name ?? '' });
        // Remembered first: a rename that fails is not tried again on every redraw.
        if (JSON.stringify(seen) !== JSON.stringify(state.npcNames)) saveChatState({ npcNames: seen });
        for (const rename of renames) {
            const now = currentParty().find(member => member.name === rename.from);
            if (!now) continue;
            try {
                await renameCompanion(now.id, { name: rename.to }, { from: 'NPC State Delta' });
            } catch (error) {
                console.warn(`[RPG Battle] ${rename.from} could not follow the rename to ${rename.to} in NPC State Delta`, error);
            }
        }
        if (renames.length) storyBlock()?.refresh?.();
    } catch (error) {
        console.warn('[RPG Battle] NPC State Delta\'s renames could not be followed', error);
    } finally {
        following = false;
    }
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
        const asks = Boolean(pc) && !isDead(pc) && !underWay(state);
        return tokenEstimate({ handoff: handoffNow(context(), state) === 'waiting' ? state.pending.handoff : '', instruction: asks ? storyInstruction() : '' });
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
    // NPC State Delta joining (or announcing again) may bring a linked NPC's new name.
    scheduleNpcFollow();
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
    // A narrating reply deleted since: the result waits again, for this reply.
    generating = false;
    // A narration about to be spent is remembered first (its reply stays a narrating one).
    const narrated = noteNarrated(chatState(), context()?.chat ?? chat);
    if (narrated) saveChatState({ narrated });
    const pending = settleHandoff(chatState().pending, chat);
    if (!pending) {
        // Also one chatState already reads as none (its fight's reply is gone): cleared for good.
        if (chatMeta()?.[SETTINGS_KEY]?.pending) saveChatState({ pending: null });
        return '';
    }
    const replacing = (kind.includes('swipe') || kind.includes('regenerate')) && isAssistant(chat.at(-1));
    const replyIndex = replacing ? chat.length - 1 : chat.length;
    if (pending.attachedTo === null || pending.attachedTo === undefined) {
        saveChatState({ pending: { ...pending, attachedTo: replyIndex } });
        generating = true;
        return pending.handoff;
    }
    // A swipe of the narrating reply narrates the same result.
    if (pending.attachedTo === replyIndex) {
        generating = true;
        return pending.handoff;
    }
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
        // The reply that narrates a fight gets the narrating one (0.5.9): no <Wounds> for that
        // fight, but a new fight after it is still handed over.
        const pc = own.enabled ? currentSheet() : null;
        const why = !own.enabled ? 'RPG Battle is off' : !pc ? 'no character yet' : isDead(pc) ? 'your character is dead' : underWay(chatState(ctx)) ? 'a fight is under way' : '';
        const instruction = why ? '' : handoff ? NARRATING_INSTRUCTION : storyInstruction(ctx);
        setPrompt(instruction, RULES_PROMPT_KEY);
        lastSent = { at: Date.now(), type: kind, handoff: Boolean(handoff), instruction: why ? 'none' : handoff ? 'narrating' : 'story', why, chars: handoff.length + instruction.length, handoffText: handoff, instructionText: instruction };
    } catch (error) {
        console.error('[RPG Battle] interceptor failed', error);
    }
}

globalThis.rpgBattleInterceptor = onGenerationInterceptor;

// ---------------------------------------------------------------------------
// Diagnostics (0.5.9): what RPG Battle sees and sent, in plain lines, for Settings → Diagnostics

// What the last story reply was sent: { at, type, handoff, instruction: 'story'|'narrating'|'none', why, chars }.
let lastSent = null;

// What happened this session, newest last (awards, offers taken or put away, fights, story wounds).
const activity = [];
const ACTIVITY_KEPT = 12;
function logActivity(text) {
    activity.push({ at: Date.now(), chatId: chatIdOf(context()), text: String(text ?? '') });
    if (activity.length > ACTIVITY_KEPT) activity.splice(0, activity.length - ACTIVITY_KEPT);
}

const indent = text => String(text ?? '').split('\n').map(line => `  ${line}`).join('\n');

/** The last fight's result as plain lines: outcome, foes, XP, loot, levels, mastery, and its hand-off text. */
function lastFightLines(ctx, state) {
    const last = state.last;
    if (!last?.result) return ['Last fight: none in this chat yet'];
    const result = last.result;
    const party = Array.isArray(result.party) ? result.party : [];
    const nameOf = id => party.find(member => member.memberId === id)?.name ?? id;
    const xp = Object.entries(result.xp ?? {}).map(([id, value]) => `${nameOf(id)} +${Math.round(Number(value) || 0)}`).join(', ');
    const items = (result.loot?.items ?? []).map(item => `${item.name}${Number(item.qty) > 1 ? ` ×${item.qty}` : ''}`);
    const money = Number(result.loot?.money) > 0 ? formatMoney(result.loot.money, rules().currency) : '';
    const stages = Array.isArray(result.stages) ? result.stages.filter(stage => stage.outcome).length : 0;
    const lines = [
        `Last fight: ${result.outcome ?? '?'}${stages ? ` (a plan, ${stages} ${stages === 1 ? 'stage' : 'stages'} fought)` : ''}${Number(result.rounds) ? ` in ${result.rounds} rounds` : ''}`,
        `  Foes defeated: ${result.defeated?.length ? grouped(result.defeated) : 'none'}${result.fled?.length ? ` · fled: ${grouped(result.fled)}` : ''}${result.parleyed?.length ? ` · stood down: ${grouped(result.parleyed)}` : ''}`,
        `  XP: ${xp || 'none'} · loot: ${[money, ...items].filter(Boolean).join(', ') || 'none'}`,
    ];
    const ups = [];
    if (Number(last.levelsGained) > 0) ups.push(`your character +${last.levelsGained} level${last.levelsGained === 1 ? '' : 's'}`);
    for (const up of last.masteryUps ?? []) ups.push(`${up.skill} Lv ${up.level}`);
    if (ups.length) lines.push(`  Gains: ${ups.join(', ')}`);
    const narrated = state.narrated?.filter(entry => entry.index !== undefined).map(entry => `#${entry.index}`) ?? [];
    lines.push(`  Its hand-off: ${handoffNow(ctx, state)}${narrated.length ? ` · narrated by reply ${narrated.at(-1)}` : ''}. Sent as:`);
    lines.push(indent(last.handoff ?? '(none kept)'));
    return lines;
}

/**
 * Each RPG Battle block in the latest reply, and what came of it: offered, put away, applied,
 * awarded, or why not. Story Director's finished quests too.
 */
function latestReplyLines(ctx, state, sb, latest, pc) {
    if (!sb || latest < 0) return [];
    const chat = ctx?.chat ?? [];
    const narrating = narratesAt(state, chat, latest);
    const waiting = handoffNow(ctx, state) === 'waiting';
    const fought = Boolean(state.foughtAt && state.foughtAt.index === latest && state.foughtAt.text === replyStamp(sb, latest));
    const live = new Set(currentOffers(ctx, state).map(offer => offer.key));
    const away = new Set([...state.dismissed, ...state.done]);
    const texts = partyBlocksAt(sb, latest);
    const { members } = currentSheets();
    const made = storyOffers({ index: latest, texts, pc, members, persona: personaName(ctx), rules: rules(), library: library(ctx), narrating, pending: waiting });
    const status = offer => (live.has(offer.key) ? 'offered' : away.has(offer.key) ? 'taken or put away' : fought ? 'gone: a fight started since this reply' : underWay(state) ? 'waiting: a fight is under way' : 'not shown');
    const lines = [`Blocks in reply #${latest}:`];
    const wounds = blockAt(sb, latest, WOUNDS_TAG);
    if (wounds) {
        const story = state.story?.index === latest ? state.story : null;
        lines.push(`  <Wounds>: ${narrating ? 'not applied: this reply tells a fight\'s result (the fight dealt its wounds)' : story?.undone ? 'applied, then undone' : story?.applied?.length ? `applied: ${story.applied.map(describeWound).join('; ')}` : 'read, nothing applied (no name on the Party sheet, or unreadable)'}`);
    }
    const encounter = blockAt(sb, latest, ENCOUNTER_TAG);
    if (encounter) {
        const offer = encounterOffer(ctx, state);
        lines.push(`  <Encounter>: ${offer ? 'offered (Battle tab)' : state.dismissed.includes(`${latest}:${encounter}`) ? 'fought or put away' : underWay(state) ? 'waiting: a fight is under way' : ['waiting', 'narrating'].includes(handoffNow(ctx, state)) ? 'waiting: a result is still to be told' : !pc ? 'no character' : 'could not be read as foes'}`);
    }
    const kinds = [['joins', JOINS_TAG], ['leaves', LEAVES_TAG], ['learned', LEARNED_TAG], ['xp', XP_TAG], ['rest', REST_TAG]];
    for (const [kind, tag] of kinds) {
        if (!texts[kind]) continue;
        const offers = made.filter(offer => offer.kind === kind);
        let why = '';
        if (!offers.length) {
            if (!pc && ['xp', 'rest', 'learned'].includes(kind)) why = 'no character yet';
            else if (narrating && ['xp', 'rest'].includes(kind)) why = 'this reply tells a fight\'s result: XP and rest came from the fight';
            else if (waiting && kind === 'rest') why = 'a fight result still waits to be told';
            else if (kind === 'joins') why = 'already in the party, or the line could not be read';
            else if (kind === 'leaves') why = 'no companion by that name';
            else if (kind === 'learned') why = 'already known, or not someone in the party';
            else why = 'the line could not be read';
        }
        lines.push(`  <${tag}>: ${offers.length ? offers.map(offer => `${offer.text} → ${status(offer)}`).join(' | ') : `no offer (${why})`}`);
    }
    const quests = questsDoneAt(latest);
    if (quests.length) {
        for (const quest of quests) {
            const key = `${latest}:quest:${quest.id ?? quest.name}`;
            lines.push(`  Quest done (Story Director): ${quest.name} (${quest.difficulty || 'normal'}) → ${!pc ? 'no XP: no character' : away.has(key) ? 'XP awarded' : questsFailed.has(key) ? 'XP not written: shown as an offer' : fought ? 'no XP: a fight started since' : 'XP pending'}`);
        }
    } else if (globalThis.StoryDirector) lines.push('  Quests finished in this reply (Story Director): none (a failed or abandoned quest gives no XP)');
    if (lines.length === 1) lines.push('  none of RPG Battle\'s blocks');
    return lines;
}

const yesNo = value => (value ? 'yes' : 'no');

// Long arrays (a fight's log, use counts) are cut in the JSON; the report is for reading.
function trimmed(value, depth = 0) {
    if (Array.isArray(value)) {
        const head = value.slice(0, 40).map(item => trimmed(item, depth + 1));
        return value.length > 40 ? [...head, `… ${value.length - 40} more`] : head;
    }
    if (value && typeof value === 'object') {
        if (depth > 6) return '…';
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimmed(item, depth + 1)]));
    }
    if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}… (${value.length} characters)`;
    return value;
}

/**
 * (0.5.11) The data behind the report, as JSON: this chat's stored state (the hand-off, the last
 * result, what was put away), what the last reply was sent, the sheets, the offers, and the
 * latest reply's RPG Battle blocks as written. Long arrays are cut.
 */
function diagnosticsJson() {
    const ctx = context();
    try {
        const sb = storyBlock();
        const chat = ctx?.chat ?? [];
        const latest = latestAssistantIndex(chat);
        const tags = [WOUNDS_TAG, ENCOUNTER_TAG, JOINS_TAG, LEAVES_TAG, LEARNED_TAG, XP_TAG, REST_TAG, settings(ctx).partyTag];
        const blocks = sb && latest >= 0 ? Object.fromEntries(tags.map(tag => [tag, blockAt(sb, latest, tag) ?? null]).filter(([, text]) => text !== null)) : {};
        const { pc, members } = currentSheets();
        const data = {
            version: VERSION,
            chatId: chatIdOf(ctx),
            latestReply: latest,
            lastSent,
            nextReply: nextReplyPreview(ctx),
            chatState: chatState(ctx),
            sheets: { pc, members },
            offers: currentOffers(ctx),
            encounterOffer: encounterOffer(ctx),
            questsDoneInLatest: latest >= 0 ? questsDoneAt(latest) : [],
            latestReplyBlocks: blocks,
            activity: activity.filter(entry => entry.chatId === chatIdOf(ctx)),
        };
        return JSON.stringify(trimmed(data), null, 2);
    } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * (0.5.12) What the next new reply will be sent, worked out from the saved chat as the
 * interceptor would (no side effects), so it shows right after a restart too: { handoff,
 * instruction: 'story'|'narrating'|'none', why, instructionText, swipeOnly }. `swipeOnly`: the
 * hand-off belongs to the latest reply, so only a swipe of it gets it again.
 */
function nextReplyPreview(ctx = context()) {
    const own = settings(ctx);
    const chat = ctx?.chat ?? [];
    const state = chatState(ctx);
    const pending = own.enabled ? settleHandoff(state.pending, chat) : null;
    const replyIndex = chat.length;
    const attached = pending?.attachedTo;
    const handoff = pending && (attached === null || attached === undefined || attached === replyIndex) ? pending.handoff : '';
    const swipeOnly = Boolean(pending && !handoff && Number.isInteger(attached));
    const pc = own.enabled ? currentSheet() : null;
    const why = !own.enabled ? 'RPG Battle is off' : !pc ? 'no character yet' : isDead(pc) ? 'your character is dead' : underWay(state) ? 'a fight is under way' : '';
    const instructionText = why ? '' : handoff ? NARRATING_INSTRUCTION : storyInstruction(ctx);
    return { handoff, instruction: why ? 'none' : handoff ? 'narrating' : 'story', why, instructionText, swipeOnly, swipeOf: swipeOnly ? attached : null };
}

/** One plain report, a line each: the links, the character, the latest reply's blocks, what was sent, the fight and its offer. */
function diagnosticsText() {
    const ctx = context();
    const lines = [`RPG Battle v${VERSION} · ${settings(ctx).enabled !== false ? 'on' : 'off'}`];
    try {
        const sb = storyBlock();
        const sd = globalThis.StoryDirector;
        lines.push(`Story Block: ${sb ? `yes${sb.version ? ` (v${sb.version})` : ''}` : 'no (needed)'} · Story Director: ${sd ? `yes${sd.version ? ` (v${sd.version})` : ''}` : 'no'} · NPC State Delta: ${yesNo(npcApi())}`);
        const chat = ctx?.chat ?? [];
        if (!chatIdOf(ctx)) return [...lines, 'No chat open.'].join('\n');
        const state = chatState(ctx);
        const pc = currentSheet();
        lines.push(pc ? `Character: ${pc.name}, ${levelText(pc.level, rules())}, HP ${pc.hp.cur}/${pc.hp.max}${isDead(pc) ? ' · dead' : ''}` : 'Character: none yet (Party tab → create one)');
        const latest = latestAssistantIndex(chat);
        if (sb && latest >= 0) {
            lines.push(`Latest reply #${latest}: Party block ${yesNo(blockAt(sb, latest, settings(ctx).partyTag))}${narratesAt(state, chat, latest) ? ' · tells a fight\'s result' : ''}`);
        } else lines.push('Latest reply: none yet');
        if (lastSent) {
            const what = lastSent.instruction === 'story' ? 'story instruction (<Wounds>, <Encounter>, …)' : lastSent.instruction === 'narrating' ? 'narrating instruction (a new fight → <Encounter>, no <Wounds>)' : `no instruction (${lastSent.why})`;
            lines.push(`Last reply sent (${new Date(lastSent.at).toLocaleTimeString()}, ${lastSent.type}): ${lastSent.handoff ? 'fight hand-off + ' : ''}${what} · about ${Math.round(lastSent.chars / 4)} tokens`);
        } else lines.push('Last reply sent: nothing yet this session (it is filled in when a reply is generated; see "Next reply will get" below)');
        if (lastSent && (lastSent.handoffText || lastSent.instructionText)) {
            lines.push(`Injected with it (each a system message at chat depth 1; ${PROMPT_KEY} then ${RULES_PROMPT_KEY}):`);
            if (lastSent.handoffText) lines.push(`  [${PROMPT_KEY}] the hand-off:`, indent(indent(lastSent.handoffText)));
            if (lastSent.instructionText) lines.push(`  [${RULES_PROMPT_KEY}] the ${lastSent.instruction} instruction:`, indent(indent(lastSent.instructionText)));
        }
        const next = nextReplyPreview(ctx);
        const nextWhat = next.instruction === 'story' ? 'story instruction' : next.instruction === 'narrating' ? 'narrating instruction' : `no instruction (${next.why})`;
        lines.push(`Next reply will get: ${next.handoff ? 'fight hand-off + ' : ''}${nextWhat}${next.swipeOnly ? ` (the fight's hand-off went to reply #${next.swipeOf}; only a swipe of it gets it again)` : ''} · about ${Math.round((next.handoff.length + next.instructionText.length) / 4)} tokens`);
        if (next.handoff) lines.push(`  [${PROMPT_KEY}] the hand-off:`, indent(indent(next.handoff)));
        if (next.instructionText) lines.push(`  [${RULES_PROMPT_KEY}] the ${next.instruction} instruction:`, indent(indent(next.instructionText)));
        const pending = state.pending;
        lines.push(`Hand-off: ${handoffNow(ctx, state)}${Number.isInteger(pending?.attachedTo) ? ` (given to reply #${pending.attachedTo})` : ''}`);
        lines.push(`Fight: ${state.plan ? 'a plan under way' : currentFight() ? 'under way' : 'none'}`);
        const offer = encounterOffer(ctx, state);
        let why = '';
        if (!offer) {
            const written = sb && latest >= 0 ? blockAt(sb, latest, ENCOUNTER_TAG) : '';
            why = underWay(state) ? 'a fight is under way'
                : ['waiting', 'narrating'].includes(handoffNow(ctx, state)) ? 'a result waits to be told'
                    : !pc ? 'no character' : isDead(pc) ? 'your character is dead'
                        : written ? 'the latest reply\'s <Encounter> was put away or could not be read'
                            : 'the latest reply has no <Encounter> and nothing is planned';
        }
        lines.push(`Fight offer: ${offer ? `yes — ${offer.text.replace(/\s+/g, ' ').slice(0, 120)}` : `none (${why})`}`);
        lines.push('', ...latestReplyLines(ctx, state, sb, latest, pc));
        lines.push('', ...lastFightLines(ctx, state));
        const mine = activity.filter(entry => entry.chatId === chatIdOf(ctx));
        lines.push('', `Activity this session: ${mine.length ? '' : 'nothing yet'}`);
        for (const entry of mine) lines.push(`  ${new Date(entry.at).toLocaleTimeString()} ${entry.text}`);
    } catch (error) {
        lines.push(`Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return lines.join('\n');
}

/**
 * Back to the story: `text` (a next move, or the setting's message) is sent as the reader's
 * message, or with `send` false only put in the message box to edit and send.
 */
function returnToStory(text = settings().returnMessage, { send = true } = {}) {
    const box = globalThis.document?.getElementById?.('send_textarea') ?? null;
    const sendButton = globalThis.document?.getElementById?.('send_but') ?? null;
    screen = { chatId: chatIdOf(context()), mode: null };
    storyBlock()?.refresh?.();
    if (!box || !sendButton || !text) return;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    if (send === false) {
        box.focus?.();
        return;
    }
    sendButton.click();
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
    if (underWay(state)) return true;
    if (ending && ending.chatId === chatIdOf(ctx)) return true;
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
    // The fight just ended and its result is being written: its last state, without actions
    // (after Fall back, the plan as it stood, its buttons waiting).
    if (ending && ending.chatId === chatId) {
        if (ending.fight || !ending.plan) return { mode: 'fight', fight: ending.fight, actions: [], rules: r };
        return { ...betweenView(ending.plan, r), busy: true };
    }
    const state = chatState(ctx);
    // A plan between its stages: Go on or Fall back, nothing else.
    if (state.plan?.status === 'between') return betweenView(state.plan, r);
    if (screen.mode === 'result' && state.last) {
        const money = state.last.result?.loot?.money ?? 0;
        return { mode: 'result', nextMoves: nextMovesFor(state.last), result: state.last.result, handoff: state.last.handoff, levelsGained: state.last.levelsGained, pointsGained: state.last.pointsGained, levelsReached: state.last.levelsReached ?? 0, masteryUps: state.last.masteryUps ?? [], moneyText: money ? formatMoney(money, r.currency) : '', rules: r };
    }
    const sheet = currentSheet();
    if (screen.mode === 'setup' && sheet) {
        // The story's engagement as it will be fought, read-only; `known` (names and aliases) is
        // what the setup checks to tag a name as new, made up when the fight starts.
        const bestiary = fightBestiary(ctx);
        return {
            mode: 'setup',
            rows: setupRows(screen.prefill, sheet, r, bestiary),
            // A plan's stages (0.5): their places, in order; the rows carry `stage`.
            stages: screen.stages?.length > 1 ? screen.stages.map(stage => ({ place: stage.place ?? null })) : null,
            stakes: screen.stakes === 'death' ? 'death' : 'normal',
            known: knownNames(bestiary, screen.prefill),
            preparing: screen.preparing ?? null,
            rules: r,
        };
    }
    const offer = encounterOffer(ctx, state);
    return { mode: 'offer', encounter: offer ? { text: offer.text, summary: encounterSummary(offer.text), label: offer.label, rows: offer.rows, stages: offer.stages ?? null, stakes: offer.stakes } : null, pending: handoffNow(ctx, state) === 'waiting' ? state.pending.handoff : null, rules: r };
}

/**
 * Between a plan's stages: the stage just cleared, the party as it stands (no healing), the
 * next stage as it will be fought; Go on or Fall back.
 */
function betweenView(plan, r) {
    const last = plan.done.at(-1);
    const next = plan.stages[plan.at + 1] ?? null;
    const sheet = currentSheet();
    const bestiary = fightBestiary();
    return {
        mode: 'between',
        total: plan.stages.length,
        cleared: { number: plan.at + 1, place: plan.stages[plan.at]?.place ?? null, rounds: last?.result?.rounds ?? 0 },
        next: next ? { number: plan.at + 2, place: next.place ?? null, text: next.text ?? '', rows: sheet ? setupRows(next.rows, sheet, r, bestiary) : next.rows } : null,
        party: last?.result?.party ?? [],
        stakes: plan.stakes,
        known: knownNames(bestiary, next?.rows ?? []),
        rules: r,
    };
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
            mode: 'companion', level: sheet.level,
            // The story's level for them, else at most yours.
            maxLevel: Math.min(maxLevel(r), Number(partyScreen.prefill?.level) >= 1 ? Math.round(Number(partyScreen.prefill.level)) : sheet.level),
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
        // Only a result still waiting asks to go back to the story; one being narrated says so.
        pending: handoffNow(ctx, state) === 'waiting' ? state.pending.handoff : null,
        narrating: handoffNow(ctx, state) === 'narrating',
        offers: shownOffers(currentOffers(ctx, state)).map(({ key, kind, text, accept, note, confirm }) => ({ key, kind, text, accept, note, confirm })),
        recovered,
        story,
        sheetConflict: sheetConflict(ctx),
        // This story's own creatures, for the Bestiary fold.
        bestiary: state.bestiary.map(entry => ({
            name: entry.name,
            // (0.5.2) Grouped by family in the fold; a kin entry says whose.
            family: familyTitle(entry.family ?? familyOf(entry.name).family),
            kin: entry.kin ?? '',
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
    saveChatState({ skills: [...state.skills.filter(skill => !names.has(skill.name.toLowerCase())), ...party.skills], npcLinks: {}, fallen: [] });
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
    // (0.5.6) A set-aside skill swapped in for one in use, and a skill forgotten.
    onSwapSkill: (memberId, name, out) => void guarded(() => writeMember(memberId, sheet => setSkillActive(sheet, name, true, rules(), { swapOut: out }))),
    onForgetSkill: (memberId, name) => void guarded(async () => {
        await writeMember(memberId, sheet => forgetSkill(sheet, name));
        notify('info', `${name} is forgotten. Delete or swipe the latest reply to take it back.`);
    }),
    onConfirmLearn: ({ name, fromLibrary = false, template = null, setAside = null, memberId = 'pc' }) => void guarded(async () => {
        const r = rules();
        const skillName = String(name ?? '').trim();
        if (!skillName) throw new Error('Give the skill a name.');
        // Skills come from the story: only the skill a waiting offer names, under that name (its
        // type, stat, target and element may be adjusted; a different name could be a stronger
        // library skill).
        const offered = String(partyScreen.prefill?.name ?? '').trim();
        if (partyScreen.mode !== 'learn' || !offered) throw new Error('Skills come from the story: accept one it offers.');
        if (skillName.toLowerCase() !== offered.toLowerCase()) throw new Error(`The story offered ${offered}; that is the skill to learn.`);
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
        const { pc, members } = currentSheets();
        // Companions come from the story: only while a Joins offer's form is open, at the level the
        // story gave (else at most yours), with the skills worked out for them, and no gear typed in
        // (gear is given from your Inventory once they join).
        if (partyScreen.mode !== 'companion' || !partyScreen.offerKey) throw new Error('Companions come from the story: accept one it offers.');
        const storyLevel = Number(partyScreen.prefill?.level) >= 1 ? Math.round(Number(partyScreen.prefill.level)) : null;
        const ceiling = Math.max(1, Math.round(Number(pc?.level) || 1));
        const level = Math.max(1, Math.min(maxLevel(r), storyLevel ?? Math.min(ceiling, Math.round(Number(input.level) || 1))));
        const offeredSkills = new Set((partyScreen.kit?.skills ?? []).map(spec => String(spec?.name ?? '').toLowerCase()));
        input = { ...input, gearLines: '', skills: (input.skills ?? []).filter(spec => offeredSkills.has(String(spec?.name ?? '').toLowerCase())) };
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
        if (added) {
            // Their NPC's name now, so only a later change there renames them (followNpcRenames).
            // Not from an NPC: no link, not even one left under that id by an earlier companion.
            const state = chatState();
            const npcLinks = { ...state.npcLinks };
            delete npcLinks[added.id];
            const npcName = input.npcId ? String(npcProfiles().find(profile => String(profile.id) === String(input.npcId))?.name ?? '').trim() : '';
            if (input.npcId) npcLinks[added.id] = String(input.npcId);
            saveChatState({ npcLinks, ...(npcName ? { npcNames: { ...state.npcNames, [String(input.npcId)]: npcName } } : {}) });
        }
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
        if (!keepCompanions) saveChatState({ npcLinks: {}, fallen: [] });
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
        const offer = offerByKey(key);
        if (offer) logActivity(`Put away: ${offer.text}`);
        putAway(offer);
        storyBlock()?.refresh?.();
    },
    onBack: () => {
        // The Party tab's forms go back to the cards; the Battle tab's setup to its offer.
        if (partyScreen.mode) goParty(null);
        else go(null);
    },
    // Whatever the tab sends is ignored: the fight is the offer Fight? opened, as the story
    // wrote it (foes and stakes), so a changed page cannot change it. No offer, no fight.
    onStart: () => void guarded(async () => {
        const setup = storyFight(screen.mode === 'setup' && screen.chatId === chatIdOf(context()) ? { rows: screen.prefill, stages: screen.stages, stakes: screen.stakes } : null);
        const offerKey = screen.offerKey ?? null;
        // New names are made up (and flavoured) first; the fight starts once they are ready.
        const started = await prepareAndStart(setup);
        // A fight the story offered is now being fought: the offer is spent.
        if (started) {
            dismissEncounter(offerKey);
            logActivity(`Fight started${offerKey ? ` from ${String(offerKey).split(':')[0] === 'undefined' ? 'the story' : `reply #${String(offerKey).split(':')[0]}`}` : ''}`);
        }
    }),
    onRegenerateCreature: name => void guarded(() => regenerateCreature(name)),
    onForgetCreature: name => void guarded(async () => {
        forgetCreature(name);
        notify('info', `${name} is forgotten; the name will be made up anew next time.`);
    }),
    onExportBestiary: () => void guarded(async () => exportBestiary()),
    onImportBestiary: text => void guarded(async () => importBestiary(text)),
    onAction: action => void guarded(() => playAction(action)),
    // Between a plan's stages (0.5): the only two choices.
    onGoOn: () => void guarded(goOnPlan),
    onFallBack: () => void guarded(fallBackPlan),
    onAuto: () => void guarded(() => playAction({ type: 'auto' })),
    onReturn: () => returnToStory(),
    // (0.5.4) A next move: in the message box, or sent at once (Shift-click).
    onMove: (text, send = false) => { if (String(text ?? '').trim()) returnToStory(String(text).trim(), { send }); },
    onDone: () => go(null),
    onUndoStory: () => void guarded(undoStory),
    // The offer as code parsed it, not the rows the tab sends back.
    onFightEncounter: () => fightEncounter(encounterOffer()),
    // Not now, on the offer or the setup: put away for that reply.
    onDismissEncounter: () => {
        dismissEncounter(screen.mode === 'setup' && screen.offerKey ? screen.offerKey : encounterOffer()?.key);
        if (screen.mode === 'setup') go(null);
        else storyBlock()?.refresh?.();
    },
    onDisableStorySheet: () => disableStorySheet(),
};

// The Party tab's form buttons share these handlers; Back on a Party form goes back to the cards.
const partyHandlers = { ...handlers, onBack: () => goParty(null) };
const battleHandlers = { ...handlers, onBack: () => go(null) };

function baseKey(ctx, state) {
    const chat = ctx?.chat ?? [];
    return [chatIdOf(ctx), chat.length, String(chat.at(-1)?.mes ?? '').length, String(chat[0]?.mes ?? '').length, JSON.stringify(settings()), state.pending?.fightId ?? '', handoffNow(ctx, state)];
}

function battleKey() {
    const ctx = context();
    const state = chatState(ctx);
    const plan = state.plan ? `${state.plan.id}:${state.plan.at}:${state.plan.status}:${state.plan.done.length}` : '';
    return [...baseKey(ctx, state), screen.mode, JSON.stringify(screen.prefill ?? null), screen.stakes ?? '', fightKey(state.fight), plan, ending ? 'ending' : '', state.dismissed.length,
        encounterOffer(ctx, state)?.key ?? '', JSON.stringify(screen.preparing ?? null), state.bestiary.length].join('|');
}

function partyKey() {
    const ctx = context();
    const state = chatState(ctx);
    const story = state.story ? `${state.story.index}:${state.story.signature}:${state.story.undone}:${state.story.applied?.length ?? 0}:${canUndoStory(ctx, state)}` : '';
    return [...baseKey(ctx, state), JSON.stringify(partyScreen), state.recovered?.text ?? '', story, state.dismissed.length, state.done.length, state.fallen.length,
        currentOffers(ctx, state).map(offer => offer.key).join(','), sheetConflict(ctx), personaName(ctx), JSON.stringify(state.npcLinks), JSON.stringify(pendingImport?.summary ?? null),
        state.bestiary.map(entry => `${entry.name}:${entry.level}:${entry.flavoured}:${String(entry.look ?? '').length}`).join(','), npcKey(state)].join('|');
}

// The NPC profiles as far as the Party tab shows them: how many (the companion form lists them)
// and the names of the linked ones, so a rename in NPC State Delta redraws it (and is followed).
function npcKey(state) {
    const profiles = npcProfiles();
    const linked = new Set(Object.values(state.npcLinks).map(String));
    return `${profiles.length}:${profiles.filter(profile => linked.has(String(profile.id))).map(profile => `${profile.id}=${profile.name}`).join(',')}`;
}

function renderParty(pane) {
    const { legacy, folded } = currentSheets();
    if (legacy || folded) scheduleMigration();
    scheduleNpcFollow();
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
        badge: () => {
            const offers = currentOffers();
            scheduleQuestAwards(offers);
            return shownOffers(offers).length;
        },
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
        badge: () => (currentFight() || chatState().plan || encounterOffer() ? 1 : 0),
        render: pane => renderBattle(pane),
    });
    sb.onReply?.(payload => void afterReply(payload));
    // Story Block's settings can change under us (its Character Sheet switched on or off).
    sb.onUpdate?.(() => {
        settingsPanel?.setSheetConflict?.(sheetConflict());
        // A chat opened (or changed) may still keep your sheet in the older Character block, or
        // its mastery progress in metadata; a linked NPC may have been renamed meanwhile.
        scheduleMigration();
        scheduleNpcFollow();
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
        onDiagnostics: () => ({ text: diagnosticsText(), json: diagnosticsJson() }),
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
    // A reply in, or its generation stopped: a hand-off given to it is no longer "being
    // narrated" (not on GENERATION_ENDED: a quiet call elsewhere ends one too). A reply in, or
    // one deleted: the hand-off is settled (spent after a newer reply; a deleted narration
    // makes it wait again).
    const handoffEvent = (event, { done = false, settles = false }) => {
        if (event) ctx.eventSource?.on?.(event, () => {
            if (done) generating = false;
            try {
                if (settles) settlePending();
            } catch (error) {
                console.warn('[RPG Battle] the hand-off could not be settled', error);
            }
            storyBlock()?.refresh?.();
        });
    };
    handoffEvent(events.MESSAGE_RECEIVED, { done: true, settles: true });
    handoffEvent(events.GENERATION_STOPPED, { done: true });
    handoffEvent(events.MESSAGE_DELETED, { settles: true });
    // A swipe of the reply a fight started from takes the fight and its result back (0.4.3).
    handoffEvent(events.MESSAGE_SWIPED, { settles: true });
    for (const event of [events.CHAT_CHANGED, events.CHAT_LOADED]) {
        if (event) ctx.eventSource?.on?.(event, () => {
            screen = { chatId: chatIdOf(context()), mode: null };
            live = { chatId: null, key: '', fight: null };
            generating = false;
            setPrompt('');
            setPrompt('', RULES_PROMPT_KEY);
            try {
                settlePending();
            } catch (error) {
                console.warn('[RPG Battle] the hand-off could not be settled', error);
            }
        });
    }
    console.info(`[RPG Battle] v${VERSION} loaded.`);
}

init();
