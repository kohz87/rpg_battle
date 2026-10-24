// RPG Battle v2, screens for the rules-v2 views (track C): the Progress page's view query, `rpg-battle.progressView`.
//
// From the contract's projections only (RB_PHASE0 §3): rules.party (every member's SheetView), rules.progress (the
// checklist, promotions and pathways), rules.training (pending B3: see fixtures), rules.identity (the rules hash a
// class or path choice must carry, pending B), rules.classes (the basic picker, pending B) and rules.names. It shows
// what the queries say and builds the exact command payloads a choice sends; whether a choice is open, which options it
// has and why one is waiting are the query's words, never worked out here.
//
//   state    'ready' | 'no-character' | 'unavailable' (rules are not answering) | 'mismatch' (an answer of the wrong shape)
//   members  your character first, then companions: exactly three skills each, the checklist, promotions in the
//            order given, pathways in the order given, training
//   party    the party checklist: per member, how many of the three forms are at 5 / 5
//   picker   (no character yet) the basic classes, each with its three skills

import { ASK, ask, isHash, isList, isParty, isProgress, isRecord, isText } from './ask.js';
import { clip, clockLabel, dayOf, OPTION_LABELS, ratioText, spanLabel, TIER_LABELS } from './format.js';
import { namesFor } from './names.js';

/** Mastery runs 0..5 (SkillView.mastery); a form at 5 / 5 is done. */
export const MASTERY_TOP = 5;

const isIdentity = value => isRecord(value) && isHash(value.hash);
const isClassView = value => isRecord(value) && isText(value.id) && isText(value.name) && Array.isArray(value.skills) && value.skills.length === 3
    && value.skills.every(item => isRecord(item) && isText(item.name));
const isTraining = value => isRecord(value) && isText(value.actor) && (value.session === null || isRecord(value.session))
    && isRecord(value.caps) && Array.isArray(value.offers);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function skillRow(skill, needed = MASTERY_TOP) {
    const mastered = skill.nextAt === null;
    return {
        skill: skill.skill, form: skill.form, name: clip(skill.name, 80), mastery: skill.mastery, needed,
        text: ratioText(skill.mastery, needed), mastered, done: skill.mastery >= needed,
        usesText: plural(skill.uses, 'use'),
        nextText: mastered ? 'Mastered' : `Next mastery at ${skill.nextAt} uses`,
        stepText: skill.steps > 0 ? `Path step ${skill.steps} of 2` : '',
    };
}

function xpText(sheet) {
    if (sheet.xpToNext === null || sheet.xpToNext === undefined) return `XP ${sheet.xp}. Top level.`;
    return `XP ${sheet.xp}. ${sheet.xpToNext} to the next level.`;
}

// ---- training (pending B3 handoff: the stand-in shape is documented in tests/v2/screens/rules/fixtures.js) ----------

function trainingModel(actorId, answer, minutes, names) {
    if (answer.status !== ASK.OK) return { state: 'unavailable', headline: '', lines: [], offers: [], caps: '', held: false };
    const { session, caps, offers } = answer.value;
    const lines = [];
    let state = 'none';
    let headline = '';
    if (session) {
        state = ['requested', 'running', 'completed', 'interrupted'].includes(session.status) ? session.status : 'none';
        const what = `${names(session.skill)}${session.form ? ` (${names(session.form)})` : ''}`;
        if (state === 'requested') {
            headline = `Training requested: ${what}.`;
            lines.push('It starts when the story time next moves. Nothing is paid until then.');
        } else if (state === 'running') {
            headline = `Training: ${what}.`;
            if (Number.isSafeInteger(session.startMinute) && Number.isSafeInteger(session.endMinute)) {
                lines.push(`From ${clockLabel(session.startMinute)} to ${clockLabel(session.endMinute)}.`);
                if (dayOf(session.startMinute) !== dayOf(session.endMinute)) lines.push(`This crosses midnight into Day ${dayOf(session.endMinute)}.`);
            }
            if (Number.isSafeInteger(session.capDay)) lines.push(`Credit counts toward Day ${session.capDay}'s limit.`);
        } else if (state === 'completed') {
            headline = `Training finished: ${what}.`;
            if (Number.isSafeInteger(session.startMinute) && Number.isSafeInteger(session.endMinute)) lines.push(`From ${clockLabel(session.startMinute)} to ${clockLabel(session.endMinute)}.`);
            lines.push(`Credits: ${session.creditsAwarded ?? 0} of ${session.credits ?? 0}.`);
            if (session.reason === 'mastered') lines.push('No mastery gained: already mastered. XP still counts.');
            else if (session.reason === 'cap') lines.push('No mastery gained: the daily limit was reached.');
            if (Number.isSafeInteger(session.capDay)) lines.push(`Counted on Day ${session.capDay}.`);
        } else if (state === 'interrupted') {
            headline = `Training interrupted: ${what}.`;
            lines.push('No credit was given and the fee is not refunded.');
        }
        if (session.event && typeof session.event.text === 'string' && session.event.text) lines.push(`Something happened: ${clip(session.event.text, 240)}`);
    }
    const capParts = [];
    if (Number.isSafeInteger(caps.day)) capParts.push(`Day ${caps.day}`);
    if (isRecord(caps.skill)) capParts.push(`this skill ${ratioText(caps.skill.used, caps.skill.max)}`);
    if (isRecord(caps.actor)) capParts.push(`all skills ${ratioText(caps.actor.used, caps.actor.max)}`);
    const clockHold = minutes === null;
    const open = state === 'none' || state === 'completed' || state === 'interrupted';
    const offerRows = open ? offers.filter(isRecord).map(offer => ({
        key: `${offer.skill}|${offer.form}|${offer.trainer}`,
        text: `${names(offer.skill)} with ${clip(offer.name || names(offer.trainer), 80)}`,
        detail: [Number.isSafeInteger(offer.fee) ? `fee ${offer.fee}` : '', Number.isSafeInteger(offer.minutes) ? spanLabel(offer.minutes) : ''].filter(Boolean).join(', '),
        blocked: (Array.isArray(offer.blocked) ? offer.blocked : []).filter(isText).map(item => clip(item, 240)),
        canAsk: !clockHold && !(Array.isArray(offer.blocked) && offer.blocked.length),
        payload: { actor: actorId, skill: offer.skill, form: offer.form, trainer: offer.trainer, session: offer.session },
    })) : [];
    return { state, headline, lines, offers: offerRows, caps: capParts.length ? `Limits: ${capParts.join(' · ')}.` : '', held: clockHold };
}

// ---- one member ----------------------------------------------------------------------------------------------------

function memberModel(sheet, progress, training, ctx) {
    const { names, hash, minutes, you, classSkills } = ctx;
    const classRef = progress.status === ASK.OK ? progress.value.class : sheet.class;
    const sheetSkills = sheet.skills.map(item => skillRow(item));
    const skills = sheet.skills.map(item => skillRow(item, progress.status === ASK.OK ? progress.value.checklist.find(row => row.skill === item.skill && row.form === item.form)?.needed ?? MASTERY_TOP : MASTERY_TOP));
    const checklist = progress.status === ASK.OK
        ? progress.value.checklist.map(row => ({
            skill: row.skill, form: row.form, name: sheetSkills.find(item => item.skill === row.skill)?.name ?? names(row.skill),
            mastery: row.mastery, needed: row.needed, text: ratioText(row.mastery, row.needed), done: row.mastery >= row.needed,
        }))
        : skills.map(row => ({ skill: row.skill, form: row.form, name: row.name, mastery: row.mastery, needed: row.needed, text: row.text, done: row.mastery >= row.needed }));
    const done = checklist.filter(row => row.done).length;
    const base = { actor: sheet.id };

    const promotions = progress.status === ASK.OK ? progress.value.promotions.map(row => {
        const options = row.choices.map(ref => ({ id: ref, label: names(ref), sub: classSkills.get(ref) ?? '' }));
        const open = row.eligible && options.length > 0 && hash !== null;
        return {
            milestone: row.milestone, title: `Promotion at level ${row.milestone}`, eligible: row.eligible, waiting: !row.eligible,
            why: row.why.map(item => clip(item, 240)), open,
            note: row.eligible && hash === null ? 'The rules identity is not available, so this cannot be chosen yet.' : '',
            pick: open ? {
                command: 'class.choose', field: 'class', label: `Promotion at level ${row.milestone}`, confirm: 'Promote',
                warning: 'All three skills are swapped for the new class and start at 0 / 5. This cannot be undone.',
                base: { ...base, milestone: row.milestone, expectedClass: progress.value.class, rulesHash: hash }, options,
            } : null,
        };
    }) : [];

    const pathways = progress.status === ASK.OK ? progress.value.pathways.map(row => ({
        milestone: row.milestone, title: `Path step at level ${row.milestone}`, eligible: row.eligible, waiting: !row.eligible,
        why: row.why.map(item => clip(item, 240)),
        skills: row.eligible ? row.skills.map(item => {
            const open = item.options.length === 3 && hash !== null;
            return {
                skill: item.skill, name: names(item.skill), fromForm: item.fromForm, fromName: names(item.fromForm), step: item.step,
                stepText: `Step ${item.step} of 2, from ${names(item.fromForm)}`, open,
                pick: open ? {
                    command: 'path.choose', field: 'option', label: `${names(item.skill)}, step ${item.step}`, confirm: 'Take this path',
                    warning: 'A path is permanent. The other two options are closed to this form.',
                    base: { ...base, milestone: row.milestone, skill: item.skill, fromForm: item.fromForm, rulesHash: hash },
                    options: item.options.map((ref, index) => ({ id: ref, label: OPTION_LABELS[index] ?? names(ref), sub: names(ref) })),
                } : null,
            };
        }) : [],
    })) : [];

    return {
        id: sheet.id, name: clip(sheet.name, 80), you, kind: sheet.kind ?? (you ? 'pc' : 'companion'), open: you,
        level: sheet.level, levelText: `Level ${sheet.level}`, xpText: xpText(sheet),
        classRef, className: names(classRef), tier: sheet.tier, tierLabel: TIER_LABELS[sheet.tier] ?? '',
        skills, allMastered: skills.every(row => row.mastered),
        masteredNote: skills.every(row => row.mastered) ? 'All three skills are fully mastered. More uses add no mastery; XP still counts.' : '',
        checklist, checklistText: `${done} of ${checklist.length} forms at ${MASTERY_TOP} / ${MASTERY_TOP}`, checklistDone: done,
        progress: progress.status === ASK.OK ? 'ok' : progress.status,
        promotions, pathways,
        training: trainingModel(sheet.id, training, minutes, names),
    };
}

// ---- the page ------------------------------------------------------------------------------------------------------

export function pickerModel(tools) {
    const found = ask(tools, 'rules.classes', { tier: 0 }, value => isList(value, isClassView));
    if (found.status === ASK.MISSING || found.status === ASK.EMPTY) return { state: 'unavailable', classes: [] };
    if (found.status === ASK.MALFORMED) return { state: 'mismatch', classes: [] };
    const classes = found.value.filter(item => item.tier === undefined || item.tier === 0).map(item => ({
        id: item.id, label: clip(item.name, 80), sub: item.skills.map(skill => clip(skill.name, 80)).join(' · '),
    }));
    return { state: classes.length ? 'ready' : 'empty', classes };
}

/** rpg-battle.progressView({ actor? }) → the model above. */
export function progressView(state, args, tools) {
    const party = ask(tools, 'rules.party', {}, isParty);
    if (party.status === ASK.MISSING || party.status === ASK.EMPTY) {
        return { state: 'unavailable', reason: 'The rules are not answering yet. Check the Setup page.', members: [], party: [], picker: null };
    }
    if (party.status === ASK.MALFORMED) {
        return { state: 'mismatch', reason: 'The rules answered in a form this version does not understand (for example, a character without exactly three skills).', members: [], party: [], picker: null };
    }
    const sheets = [...party.value.active, ...party.value.reserve];
    const wanted = typeof args?.actor === 'string' && args.actor ? sheets.filter(sheet => sheet.id === args.actor) : sheets;
    if (party.value.pc === null && sheets.length === 0) {
        return { state: 'no-character', reason: '', members: [], party: [], picker: pickerModel(tools) };
    }
    const progress = new Map(wanted.map(sheet => [sheet.id, ask(tools, 'rules.progress', { actor: sheet.id }, isProgress)]));
    const training = new Map(wanted.map(sheet => [sheet.id, ask(tools, 'rules.training', { actor: sheet.id }, isTraining)]));
    const identity = ask(tools, 'rules.identity', {}, isIdentity);
    const refs = [];
    for (const sheet of wanted) {
        refs.push(sheet.class);
        const found = progress.get(sheet.id);
        if (found.status === ASK.OK) {
            refs.push(found.value.class);
            for (const row of found.value.promotions) refs.push(...row.choices);
            for (const row of found.value.pathways) for (const item of row.skills) refs.push(item.skill, item.fromForm, ...item.options);
        }
        const trained = training.get(sheet.id);
        if (trained.status === ASK.OK) {
            const { session, offers } = trained.value;
            if (session) refs.push(session.skill, session.form);
            for (const offer of offers) if (isRecord(offer)) refs.push(offer.skill, offer.form, offer.trainer);
        }
    }
    const names = namesFor(tools, refs.filter(isText));
    // What each class offers (its three skills), so a promotion says what it swaps in. Without the query the choice shows the name only.
    const classSkills = new Map();
    if (wanted.some(sheet => progress.get(sheet.id).status === ASK.OK && progress.get(sheet.id).value.promotions.some(row => row.choices.length))) {
        const classes = ask(tools, 'rules.classes', {}, value => isList(value, isClassView));
        if (classes.status === ASK.OK) for (const item of classes.value) classSkills.set(item.id, item.skills.map(skill => clip(skill.name, 80)).join(' · '));
    }
    const time = ask(tools, 'director.time', {});
    const minutes = time.status === ASK.OK && Number.isSafeInteger(time.value.minutes) ? time.value.minutes : null;
    const hash = identity.status === ASK.OK ? identity.value.hash : null;
    const members = wanted.map(sheet => memberModel(sheet, progress.get(sheet.id), training.get(sheet.id), { names, hash, minutes, classSkills, you: sheet.id === party.value.pc }));
    return {
        state: 'ready', reason: '', members,
        party: members.map(member => ({ id: member.id, name: member.name, you: member.you, text: member.checklistText, done: member.checklistDone, total: member.checklist.length, complete: member.checklistDone === member.checklist.length })),
        picker: null, hashKnown: hash !== null, clockSet: minutes !== null,
    };
}
