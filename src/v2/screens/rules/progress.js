// RPG Battle v2, screens for the rules-v2 views (track C): the Progress page's view query, `rpg-battle.progressView`.
//
// From the contract's projections only (RB_PHASE0 §3): rules.party (every member's SheetView), rules.progress (the
// checklist, promotions and pathways), rules.training, rules.identity (the rules hash a
// class or path choice must carry), rules.classes (the basic picker) and rules.names. It shows
// what the queries say and builds the exact command payloads a choice sends; whether a choice is open, which options it
// has and why one is waiting are the query's words, never worked out here.
//
//   state    'ready' | 'no-character' | 'unavailable' (rules are not answering) | 'mismatch' (an answer of the wrong shape)
//   members  your character first, then companions: exactly three skills each, the checklist, promotions in the
//            order given, pathways in the order given, training
//   party    the party checklist: per member, how many of the three forms are at 5 / 5
//   picker   (no character yet) the basic classes, each with its three skills

import { ASK, ask, isHash, isList, isPace, isParty, isProgress, isRecord, isText } from './ask.js';
import { btn, calendarWriter, clip, clockLabel, dayOf, moneyText, OPTION_LABELS, ratioText, spanLabel, TIER_LABELS } from './format.js';
import { namesFor } from './names.js';

/** Mastery runs 0..5 (SkillView.mastery) unless `rules.pace` says another top; a form at its top is mastered. */
export const MASTERY_TOP = 5;

const isIdentity = value => isRecord(value) && isHash(value.hash);
const isClassView = value => isRecord(value) && isText(value.id) && isText(value.name) && Array.isArray(value.skills) && value.skills.length === 3
    && value.skills.every(isText);
const isTraining = value => isRecord(value) && isText(value.actor) && (value.session === null || isRecord(value.session))
    && isRecord(value.caps) && Array.isArray(value.offers);

const isTemplate = value => isRecord(value) && isText(value.id) && isText(value.name) && Array.isArray(value.skills) && value.skills.every(item => isRecord(item) && isText(item.id));
const isTrainers = value => isRecord(value) && Array.isArray(value.fixed) && Array.isArray(value.story) && value.story.every(item => isRecord(item) && isText(item.id) && isText(item.name));
// The key two names of the same person share (training/trainers.js nameKey): a person already a trainer is not offered again.
const personKey = name => String(name ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One skill of a sheet. The bar is out of the pin's top mastery (`top`); `need` is the mastery the open promotion asks of it (the top for a path step and
 * for a pin that asks no less), and a card is done when the skill has it. `waiting`: the uses held for the story clock (rules.progress).
 */
function skillRow(skill, { need = MASTERY_TOP, top = MASTERY_TOP, waiting = 0 } = {}) {
    const mastered = skill.nextAt === null;
    return {
        skill: skill.skill, form: skill.form, name: clip(skill.name, 80), mastery: skill.mastery, needed: top, need,
        text: ratioText(skill.mastery, top), mastered, done: skill.mastery >= need,
        usesText: plural(skill.uses, 'use'),
        nextText: mastered ? 'Mastered' : `Next mastery at ${plural(skill.nextAt, 'use')}`,
        waitText: waiting > 0 ? `${plural(waiting, 'use')} waiting for the story clock` : '',
        stepText: skill.steps > 0 ? `Path step ${skill.steps} of 2` : '',
    };
}

/** How mastery grows, said once under the Skills label (`rules.pace`): empty where the query does not answer. */
function howText(pace) {
    if (pace.status !== ASK.OK) return '';
    const { top, usesForTop, perReply, perDay } = pace.value;
    return `Each skill needs ${usesForTop} uses for ${top} / ${top}. Uses come from fights (Auto too, up to ${perReply} per skill a fight), training and story skill uses \u2014 up to ${perDay} a day per skill.`;
}

function xpText(sheet) {
    if (sheet.xpToNext === null || sheet.xpToNext === undefined) return `XP ${sheet.xp}. Top level.`;
    return `XP ${sheet.xp}. ${sheet.xpToNext} to the next level.`;
}

// ---- training (rules.training's public projection) ----------------------------------------------------------------

/** How story times are written on this page: in the chat's calendar where it has one ("Goldwane 12, 23:30"), as the story clock counts them ("Day 4, 23:30") where it has none. */
function storyTimes(tools) {
    const calendar = calendarWriter(ask(tools, 'director.calendar', {}).value);
    if (!calendar) return { at: clockLabel, day: minutes => `Day ${dayOf(minutes)}`, dayNumber: n => `Day ${n}` };
    const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return {
        at: minutes => `${calendar.date(minutes, { era: false })}, ${clock(((minutes % 1440) + 1440) % 1440)}`,
        day: minutes => calendar.date(minutes, { era: false }),
        dayNumber: n => calendar.date(n * 1440, { era: false }),
    };
}

/** How a fee is written on this page: in the chat's coins ("4 silver"), as a bare number where the chat's currency is not known. */
function feeTextOf(tools) {
    const currency = ask(tools, 'inventory.currency', {});
    return currency.status === ASK.OK ? fee => moneyText(fee, currency.value) : String;
}

/**
 * The open trainers part of the Training section (RB open trainers §10.2), for the reader's own character only: the trainers the story
 * and the reader made, and "Make this a trainer" for someone who is here. `read`: { templates, trainers, present } as asked (ask results).
 */
export function trainersModel(read, names) {
    const feeText = typeof read.feeText === 'function' ? read.feeText : String;
    const none = { stories: [], binding: null, canMake: false, makeNote: '' };
    if (read.templates.status !== ASK.OK || read.trainers.status !== ASK.OK) return none;
    const templates = read.templates.value;
    const { fixed, story } = read.trainers.value;
    const stories = story.map(offer => {
        const template = templates.find(item => item.id === offer.template);
        const skills = (Array.isArray(offer.skills) ? offer.skills : []).filter(isText).map(names);
        return {
            key: offer.id,
            text: [clip(offer.name, 80), `${clip(template?.name ?? names(offer.template), 80)} (rank ${clip(offer.rank, 20)})`, clip(offer.where || names(offer.place), 80),
                Number.isSafeInteger(offer.fee) ? `fee ${feeText(offer.fee)}` : '', skills.length ? `teaches ${skills.join(', ')}` : ''].filter(Boolean).join(' · '),
        };
    });
    if (!templates.length) return { ...none, stories };
    const taken = new Set([...fixed, ...story].map(item => personKey(item.name)));
    const people = read.present.status === ASK.OK ? read.present.value.filter(isText).filter(name => name.trim() && !taken.has(personKey(name))) : [];
    if (!people.length) return { ...none, stories, makeNote: 'Nobody is here to make a trainer.' };
    return {
        stories, canMake: true, makeNote: '',
        binding: { people, templates: templates.map(item => ({ id: item.id, name: clip(item.name, 80), skills: item.skills.map(skill => ({ id: skill.id, name: clip(skill.name || names(skill.id), 80) })) })) },
    };
}

function trainingModel(answer, minutes, names, actor, trainers = null, feeText = String, times = { at: clockLabel, day: minutes => `Day ${dayOf(minutes)}`, dayNumber: n => `Day ${n}` }) {
    if (answer.status !== ASK.OK) return { state: 'unavailable', headline: '', lines: [], offers: [], caps: '', held: false, stories: [], binding: null, canMake: false, makeNote: '' };
    const { session, caps, offers } = answer.value;
    const lines = [];
    let state = 'none';
    let headline = '';
    if (session) {
        state = ['requested', 'running', 'completed', 'interrupted', 'refused'].includes(session.status) ? session.status : 'none';
        const what = `${names(session.skill)}${session.form ? ` (${names(session.form)})` : ''}`;
        if (state === 'requested') {
            headline = `Training requested: ${what}.`;
            lines.push('It starts when the story time next moves. Nothing is paid until then.');
        } else if (state === 'running') {
            headline = `Training: ${what}.`;
            if (Number.isSafeInteger(session.startMinute) && Number.isSafeInteger(session.endMinute)) {
                lines.push(`From ${times.at(session.startMinute)} to ${times.at(session.endMinute)}.`);
                if (dayOf(session.startMinute) !== dayOf(session.endMinute)) lines.push(`This crosses midnight into ${times.day(session.endMinute)}.`);
            }
            if (Number.isSafeInteger(session.capDay)) lines.push(`Credit counts toward ${times.dayNumber(session.capDay)}'s limit.`);
        } else if (state === 'completed') {
            headline = `Training finished: ${what}.`;
            if (Number.isSafeInteger(session.startMinute) && Number.isSafeInteger(session.endMinute)) lines.push(`From ${times.at(session.startMinute)} to ${times.at(session.endMinute)}.`);
            lines.push(`Credits: ${session.creditsAwarded ?? 0} of ${session.credits ?? 0}.`);
            if (session.reason === 'mastered') lines.push('No mastery gained: already mastered. XP still counts.');
            else if (['skill-day', 'actor-day', 'skill-reply', 'actor-reply'].includes(session.reason)) lines.push('No mastery gained: the daily limit was reached.');
            if (Number.isSafeInteger(session.capDay)) lines.push(`Counted on ${times.dayNumber(session.capDay)}.`);
        } else if (state === 'interrupted') {
            headline = `Training interrupted: ${what}.`;
            lines.push('No credit was given and the fee is not refunded.');
        } else if (state === 'refused') {
            headline = `Training refused: ${what}.`;
            lines.push(clip(session.reason || 'The lesson could not start. No fee or time was spent.', 240));
        }
        if (session.event?.template) lines.push(`Training event: ${clip(session.event.template, 240)}`);
    }
    const capParts = [];
    if (Number.isSafeInteger(caps.day)) capParts.push(`Day ${caps.day}`);
    if (isRecord(caps.skill)) capParts.push(`this skill ${ratioText(caps.skill.used, caps.skill.max)}`);
    if (isRecord(caps.actor)) capParts.push(`all skills ${ratioText(caps.actor.used, caps.actor.max)}`);
    const clockHold = minutes === null;
    const open = state === 'none' || state === 'completed' || state === 'interrupted' || state === 'refused';
    const offerRows = open ? offers.filter(isRecord).map(offer => {
        // The whole skill.train payload, exactly the fields the command takes, sent by the refusal-reporting command widget.
        const payload = { actor, skill: offer.payload?.skill, form: offer.payload?.form, trainer: offer.payload?.trainer, session: offer.payload?.session };
        return {
            key: `${offer.skill}|${offer.form}|${offer.trainer}`,
            text: `${names(offer.skill)} with ${clip(offer.name || names(offer.trainer), 80)}`,
            // An open trainer (the story's or the reader's) also says where it stands.
            detail: [Number.isSafeInteger(offer.fee) ? `fee ${feeText(offer.fee)}` : '', Number.isSafeInteger(offer.minutes) ? spanLabel(offer.minutes) : '',
                offer.open === true && isText(offer.where) && offer.where.trim() ? `at ${clip(offer.where, 80)}` : ''].filter(Boolean).join(', '),
            blocked: (Array.isArray(offer.blocked) ? offer.blocked : []).filter(isText).map(item => clip(item, 240)),
            canAsk: !clockHold && !(Array.isArray(offer.blocked) && offer.blocked.length),
            payload,
            button: btn('skill.train', payload, 'Ask for training', { tone: 'plain' }),
        };
    }) : [];
    return { state, headline, lines, offers: offerRows, caps: capParts.length ? `Limits: ${capParts.join(' · ')}.` : '', held: clockHold, ...(trainers ?? { stories: [], binding: null, canMake: false, makeNote: '' }) };
}

// ---- one member ----------------------------------------------------------------------------------------------------

function memberModel(sheet, progress, training, ctx) {
    const { names, hash, minutes, you, classSkills, top } = ctx;  // ctx.trainers: the open trainers section, for your own character only
    const classRef = progress.status === ASK.OK ? progress.value.class : sheet.class;
    const sheetSkills = sheet.skills.map(item => skillRow(item, { top }));
    const skills = sheet.skills.map(item => {
        const row = progress.status === ASK.OK ? progress.value.checklist.find(entry => entry.skill === item.skill && entry.form === item.form) : null;
        return skillRow(item, { need: row?.needed ?? top, top, waiting: row?.waiting ?? 0 });
    });
    const checklist = progress.status === ASK.OK
        ? progress.value.checklist.map(row => ({
            skill: row.skill, form: row.form, name: sheetSkills.find(item => item.skill === row.skill)?.name ?? names(row.skill),
            mastery: row.mastery, needed: row.needed, text: ratioText(row.mastery, row.needed), done: row.mastery >= row.needed,
        }))
        : skills.map(row => ({ skill: row.skill, form: row.form, name: row.name, mastery: row.mastery, needed: row.need, text: ratioText(row.mastery, row.need), done: row.done }));
    const done = checklist.filter(row => row.done).length;
    // The mastery the forms are asked for (every row of one member asks the same); the top where there are none.
    const need = checklist.length ? checklist[0].needed : top;
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
        skills, allMastered: skills.every(row => row.mastered), howText: ctx.howText, need,
        masteredNote: skills.every(row => row.mastered) ? 'All three skills are fully mastered. More uses add no mastery; XP still counts.' : '',
        checklist, checklistText: `${done} of ${checklist.length} forms at ${need} / ${top}`, checklistDone: done,
        progress: progress.status === ASK.OK ? 'ok' : progress.status,
        promotions, pathways,
        training: trainingModel(training, minutes, names, sheet.id, you ? ctx.trainers : null, ctx.feeText, ctx.times),
    };
}

// ---- the page ------------------------------------------------------------------------------------------------------

export function pickerModel(tools) {
    const found = ask(tools, 'rules.classes', { tier: 0 }, value => isList(value, isClassView));
    if (found.status === ASK.MISSING || found.status === ASK.EMPTY) return { state: 'unavailable', classes: [] };
    if (found.status === ASK.MALFORMED) return { state: 'mismatch', classes: [] };
    const names = namesFor(tools, found.value.flatMap(item => item.skills));
    const classes = found.value.filter(item => item.tier === undefined || item.tier === 0).map(item => ({
        id: item.id, label: clip(item.name, 80), sub: item.skills.map(names).join(' · '),
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
    // The open trainers the story and the reader made, the templates to make more from, and who is here (your own character's section only).
    const read = {
        templates: ask(tools, 'training.openTemplates', {}, value => isList(value, isTemplate)),
        trainers: ask(tools, 'training.trainers', {}, isTrainers),
        present: ask(tools, 'scene.present', {}, value => isList(value, isText)),
        feeText: feeTextOf(tools),
        times: storyTimes(tools),
    };
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
    if (read.trainers.status === ASK.OK) {
        for (const offer of read.trainers.value.story) refs.push(...(Array.isArray(offer.skills) ? offer.skills : []), offer.template, offer.place);
    }
    const names = namesFor(tools, refs.filter(isText));
    // What each class offers (its three skills), so a promotion says what it swaps in. Without the query the choice shows the name only.
    const classSkills = new Map();
    if (wanted.some(sheet => progress.get(sheet.id).status === ASK.OK && progress.get(sheet.id).value.promotions.some(row => row.choices.length))) {
        const classes = ask(tools, 'rules.classes', {}, value => isList(value, isClassView));
        if (classes.status === ASK.OK) {
            const skillNames = namesFor(tools, classes.value.flatMap(item => item.skills));
            for (const item of classes.value) classSkills.set(item.id, item.skills.map(skillNames).join(' · '));
        }
    }
    const pace = ask(tools, 'rules.pace', {}, isPace);
    const top = pace.status === ASK.OK ? pace.value.top : MASTERY_TOP;
    const time = ask(tools, 'director.time', {});
    const minutes = time.status === ASK.OK && Number.isSafeInteger(time.value.minutes) ? time.value.minutes : null;
    const hash = identity.status === ASK.OK ? identity.value.hash : null;
    const trainers = trainersModel(read, names);
    const members = wanted.map(sheet => memberModel(sheet, progress.get(sheet.id), training.get(sheet.id), { names, hash, minutes, classSkills, trainers, feeText: read.feeText, times: read.times, top, howText: howText(pace), you: sheet.id === party.value.pc }));
    // The party's header names the mastery the forms are asked for: one number when every member is asked the same, else the promotions' own.
    const needs = new Set(members.map(member => member.need));
    return {
        state: 'ready', reason: '', members,
        party: members.map(member => ({ id: member.id, name: member.name, you: member.you, text: member.checklistText, done: member.checklistDone, total: member.checklist.length, complete: member.checklistDone === member.checklist.length })),
        picker: null, hashKnown: hash !== null, clockSet: minutes !== null,
        partyText: needs.size === 1 ? `forms at ${[...needs][0]} / ${top}` : `forms at the mastery each promotion asks (of ${top})`,
    };
}

/** party.offers with the basic-class choice required when accepting a pinned join. */
export function offersView(state, args, tools) {
    const offers = ask(tools, 'party.offers', {}, Array.isArray);
    if (offers.status !== ASK.OK) return [];
    const identity = ask(tools, 'rules.identity', {}, isIdentity);
    const pinned = identity.status === ASK.OK;
    const picker = pinned ? pickerModel(tools) : null;
    return offers.value.map(offer => ({
        ...offer,
        needsClass: pinned && offer.kind === 'join',
        pick: pinned && offer.kind === 'join' ? {
            command: 'party.acceptOffer', field: 'class', label: 'Basic class for this companion', confirm: 'Accept',
            base: { offer: offer.id }, options: picker.classes,
        } : null,
    }));
}
