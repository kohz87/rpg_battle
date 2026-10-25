// B3 closed proof payloads for quest objectives, and the one validator that decides whether a surviving proof counts.
// Story Block stamps the id, the Source and the payload hash (docs/v2/EVIDENCE.md); this file says what RPG Battle puts in
// its kill and story proofs and what makes one of them the proof of exactly one objective:
//
//   kill   { thread, instance, objective, objectiveKind: 'kill', acceptance, foe, fight, batch: { id, hash }, count }
//   story  { thread, instance, objective, objectiveKind: 'story', acceptance, text, line }
//   story  { thread, instance, objective, objectiveKind: 'visit', acceptance, place, scene }   (a visit rides in a story proof:
//          Story Director owns the visit kind and publishes none yet, see docs/dev/track-a-quests.md)
//
// `acceptance` is the id of the reader's acceptance proof and the proof's only parent: the objective cannot outlive the
// acceptance it stands on, and nothing before the acceptance can be bound to it. Pure.

import { isDefId, isHash, isObject, isRecordId } from '../rules/ids.js';

export const OBJECTIVE_OWNER = 'rpg-battle';

const COMMON = ['thread', 'instance', 'objective', 'objectiveKind', 'acceptance'];
const EXTRA = { kill: ['foe', 'fight', 'batch', 'count'], story: ['text', 'line'], visit: ['place', 'scene'] };

/** The proof kind Story Block's table gives RPG Battle for an objective kind (collect is counted from the bag, never proved). */
export const proofKindOf = objectiveKind => (objectiveKind === 'kill' ? 'kill' : objectiveKind === 'story' || objectiveKind === 'visit' ? 'story' : null);

const text = (value, max) => typeof value === 'string' && value.length >= 1 && [...value].length <= max;
const whole = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** The problem of a payload as the objective kind closes it, or ''. */
export function payloadProblem(objectiveKind, payload) {
    if (!Object.hasOwn(EXTRA, objectiveKind ?? '')) return 'That objective is not proved by a proof.';
    if (!isObject(payload)) return 'An objective proof is a record.';
    const keys = [...COMMON, ...EXTRA[objectiveKind]];
    if (Object.keys(payload).length !== keys.length || keys.some(key => !Object.hasOwn(payload, key))) return `A ${objectiveKind} proof is exactly { ${keys.join(', ')} }.`;
    if (!isRecordId(payload.thread) || !whole(payload.instance, 1, 1000000) || !isRecordId(payload.objective) || payload.objectiveKind !== objectiveKind || !isRecordId(payload.acceptance)) {
        return 'An objective proof names its thread, instance, objective, kind and acceptance.';
    }
    if (objectiveKind === 'kill') {
        if (!isDefId(payload.foe) || !isRecordId(payload.fight) || !whole(payload.count, 1, 999)) return 'A kill proof names the foe, the fight and how many fell.';
        if (!isObject(payload.batch) || Object.keys(payload.batch).sort().join() !== 'hash,id' || !isRecordId(payload.batch.id) || !isHash(payload.batch.hash)) return 'A kill proof names the sealed result it stands on.';
    } else if (objectiveKind === 'story') {
        if (!text(payload.text, 240) || !isHash(payload.line)) return 'A story proof names the objective text and the line that said it.';
    } else if (!text(payload.place, 120) || !text(payload.scene, 120)) return 'A visit proof names the canonical place and the scene it was seen in.';
    return '';
}

/** The payload that proves `objective` of `quest` from `detail` (the kind's own fields); the caller checks it with payloadProblem. */
export function objectivePayload(quest, objective, acceptance, detail) {
    const base = { thread: quest.id, instance: quest.instance, objective: objective.id, objectiveKind: objective.kind, acceptance };
    if (objective.kind === 'kill') return { ...base, foe: objective.foe, fight: detail.fight, batch: { id: detail.batch.id, hash: detail.batch.hash }, count: detail.count };
    if (objective.kind === 'story') return { ...base, text: objective.text, line: detail.line };
    return { ...base, place: objective.place, scene: detail.scene };
}

/**
 * Why `proof` is not the proof of `objective` of `quest` (given the quest's surviving acceptance proof), or ''. The same binding
 * answers a command that cites a proof, the planner that counts evidence and the settlement guard:
 * the owner and kind, the closed payload, the thread, instance and objective, the acceptance as its only parent, and for a
 * kill the foe, for a story the text and for a visit the place. `amount` (the evidence row's) must be what the proof says.
 */
export function objectiveProofProblem({ objective, quest, acceptance, proof, amount }) {
    if (!isObject(objective) || !isObject(quest) || !isObject(proof)) return 'There is no such objective proof.';
    const kind = proofKindOf(objective.kind);
    if (!kind) return 'That objective is not proved by a proof.';
    if (proof.owner !== OBJECTIVE_OWNER || proof.kind !== kind) return 'That is not RPG Battle\'s proof for this objective.';
    const problem = payloadProblem(objective.kind, proof.payload);
    if (problem) return problem;
    const said = proof.payload;
    if (said.thread !== quest.id) return 'That proof is bound to another thread.';
    if (said.instance !== quest.instance) return 'That proof is bound to another instance of the quest.';
    if (said.objective !== objective.id) return 'That proof is bound to another objective.';
    if (!acceptance || said.acceptance !== acceptance.id || !Array.isArray(proof.parents) || proof.parents.length !== 1 || proof.parents[0] !== acceptance.id) return 'That proof does not stand on this quest\'s acceptance.';
    if (objective.kind === 'kill') {
        if (said.foe !== objective.foe) return 'That proof is for another foe.';
        if (amount !== undefined && amount !== said.count) return 'The evidence does not say what the proof says.';
    } else {
        if (objective.kind === 'story' && said.text !== objective.text) return 'That proof is for another objective text.';
        if (objective.kind === 'visit' && said.place !== objective.place) return 'That proof is for another place.';
        if (amount !== undefined && amount !== 1) return 'The evidence does not say what the proof says.';
    }
    return '';
}

/** The planner's handoff (`validateProof({ objective, quest, acceptance, proof, evidence })`). */
export const validateObjectiveProof = ({ objective, quest, acceptance, proof, evidence }) => objectiveProofProblem({ objective, quest, acceptance, proof, amount: evidence?.amount }) === '';
