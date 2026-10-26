// RPG Battle v2, a lean Auto: the fight combat.startFight then actInPlace({ type: 'auto' }) plays, reduced to its win or loss, for the
// private samples an offer is calibrated with (danger.js). The engine builds, logs and previews as it goes; this only plays. It is not a
// second set of rules: every sum below is the engine's own (src/combat.js, src/v2/fight/interpret.js) taken in the same order, with the
// same draws from the same generator, and tests/v2/fight/lean.test.js holds it to the engine fight for fight (outcome, clock, round,
// every combatant's HP and standing, the generator's state) over the shipped pack, scripted setups and a fuzz of random ones.
//
// What it plays: one party member against any number of foes and waves on the timeline, with forms of damage, heal, shield and the
// conditions daze, guard and regen. Anything else (more than one party member, items, gear elements, summons, rounds, other conditions,
// area effects) is not offered: leanAuto answers null for the setup, and the caller plays it with the engine. A fight that reaches a
// turn it does not play (Defend, a stat shift, a party member fleeing) answers -1 for that seed, and the caller plays that seed with the
// engine too. Pure.

import { SHIELD_ROUNDS } from './interpret.js';

const TICK = 100;
const GUARD = 0, REGEN = 1, SHIELD = 2, DAZE = 3;
const SLOT = { guard: GUARD, regen: REGEN, shield: SHIELD, daze: DAZE };
const RELATIVE_BASE = 10;
const ACTIVE = 0, VICTORY = 1, DEFEAT = 2, FLED = 3;
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const norm = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const DOT_NAMES = new Set(['poison', 'burn', 'bleed']);

/**
 * A player of the setup's fight for many seeds: `play(stateA, stateB, out?)` plays it with the generator started at stateA (the fight's
 * opening, to the party member's first turn) and, as Auto does, at stateB (everything after it; the same stream again when the fight
 * does not draw by action), and answers 1 for a victory, 0 for any other end and -1 for a fight it does not play. `out`, when given,
 * is filled with what the engine's fight would hold at the end. Answers null when the setup is not one it plays.
 */
export function leanAuto(setup, rules) {
    if (setup.turns !== 'timeline' || (setup.party ?? []).length !== 1) return null;
    const party = setup.party[0];
    const enemies = setup.enemies ?? [];
    const waves = setup.waves ?? [];
    const members = [party, ...enemies, ...waves.flatMap(wave => wave.enemies ?? [])];
    const N = members.length;
    const E = enemies.length;
    if (members.some(c => !c || !c.hp || !c.stats || (c.conditions ?? []).length || (c.onHit ?? []).length || c.summoned || (c.gone && c.hp.cur > 0))) return null;
    if ((party.items ?? []).some(item => item?.effect?.heal && item.qty > 0)) return null;
    if (rules.combat.maxRounds > 5000) return null;
    const A = rules.attack, C = rules.combat, D = rules.derived;
    const relative = setup.hitRule === 'relative';
    const spellRoll = setup.spellRule === 'roll';
    const byAction = setup.draws === 'action';
    const speedOffset = Number.isFinite(Number(setup.speedOffset)) ? Math.max(0, Number(setup.speedOffset)) : rules.turns.speedOffset;
    const length = TICK / Math.max(1, rules.character.startStat + speedOffset);

    // --- the fighters, once -------------------------------------------------------------------------------------------------------------
    const side = new Uint8Array(N), boss = new Uint8Array(N), hasSp = new Uint8Array(N);
    const hp0 = new Float64Array(N), hpMax = new Float64Array(N), mp0 = new Float64Array(N), sp0 = new Float64Array(N), spMax = new Float64Array(N);
    const agi = new Float64Array(N), dex = new Float64Array(N), int = new Float64Array(N), crit = new Float64Array(N);
    const wait = new Float64Array(N), fleesBelow = new Float64Array(N);
    const skillFrom = new Int32Array(N + 1);
    const skills = [];
    members.forEach((c, i) => {
        side[i] = i === 0 ? 0 : 1;
        boss[i] = c.boss ? 1 : 0;
        hp0[i] = c.hp.cur; hpMax[i] = c.hp.max;
        mp0[i] = c.mp?.cur ?? 0;
        hasSp[i] = c.sp ? 1 : 0; sp0[i] = c.sp?.cur ?? 0; spMax[i] = c.sp?.max ?? 0;
        agi[i] = Number(c.stats.AGI) || 0; dex[i] = Number(c.stats.DEX) || 0; int[i] = Number(c.stats.INT) || 0;
        crit[i] = c.crit;
        fleesBelow[i] = c.fleesBelow ?? 0;
        wait[i] = TICK / (Math.max(1, agi[i] + speedOffset) * 1);
        skillFrom[i] = skills.length;
        for (const skill of c.skills ?? []) skills.push({ owner: i, skill });
    });
    skillFrom[N] = skills.length;

    const hitChance = (attackerDex, targetAgi) => Math.min(A.hitMax, Math.max(A.hitMin, A.hitBase + (num(attackerDex) - num(targetAgi)) * A.hitPerPoint));
    const relativeDex = (d, a) => {
        if (!relative) return d;
        const scale = RELATIVE_BASE / Math.max(RELATIVE_BASE, (Math.max(0, d) + Math.max(0, a)) / 2);
        return a + (d - a) * scale;
    };
    // The chance of owner a to hit t, by DEX (a blow, a hostile condition) or by INT (a spell), dazed or not.
    const hitDex = new Float64Array(N * N * 2), hitInt = new Float64Array(N * N * 2);
    for (let a = 0; a < N; a++) for (let t = 0; t < N; t++) for (let z = 0; z < 2; z++) {
        hitDex[(a * N + t) * 2 + z] = hitChance(relativeDex(dex[a], agi[t]) - z * 2, members[t].stats.AGI);
        hitInt[(a * N + t) * 2 + z] = hitChance(relativeDex(int[a], agi[t]) - z * 2, members[t].stats.AGI);
    }
    const mitigate = (raw, defence) => {
        const r = Math.max(0, num(raw));
        if (r === 0) return 0;
        return Math.max(1, (r * r) / (r + Math.max(0, num(defence))));
    };
    const valueOf = (i, skill, type) => {
        const c = members[i];
        const physical = type === 'physical';
        const base = physical ? c.patk : c.matk;
        if (i !== 0) return Math.max(1, base);
        const pivot = physical ? 'STR' : 'INT';
        const per = physical ? D.atkPerStr : D.matkPerInt;
        const stat = skill.stat in c.stats ? skill.stat : pivot;
        return Math.max(1, base + (c.stats[stat] - c.stats[pivot]) * per);
    };
    // A blow without a skill: the attack value against each foe's defence.
    const basicMit = new Float64Array(N * N);
    for (let a = 0; a < N; a++) for (let t = 0; t < N; t++) basicMit[a * N + t] = mitigate(Math.max(1, members[a].patk) * 1 * 1, members[t].pdef);

    // --- their skills, once ---------------------------------------------------------------------------------------------------------------
    const K = skills.length;
    const kind = new Uint8Array(K); // 0 attack, 1 heal, 2 buff, 3 never chosen
    const physicalPool = new Uint8Array(K), legacyMp = new Float64Array(K), hasCosts = new Uint8Array(K);
    const costMp = new Float64Array(K), costSp = new Float64Array(K), cooldown = new Float64Array(K), power = new Float64Array(K);
    const effects = [], plans = [], names = new Set();
    const formPower = (skill, part) => (part.power / 100) * (1 + 0.1 * (skill.formMastery ?? 0));
    for (let g = 0; g < K; g++) {
        const { owner, skill } = skills[g];
        const key = `${owner}|${norm(skill.name)}`;
        if (names.has(key) || !Array.isArray(skill.parts) || skill.unit || skill.type === 'debuff') return null;
        names.add(key);
        kind[g] = skill.type === 'physical' || skill.type === 'magic' ? 0 : skill.type === 'heal' ? 1 : skill.type === 'buff' ? 2 : 3;
        physicalPool[g] = skill.type === 'physical' ? 1 : 0;
        legacyMp[g] = skill.mp ?? 0;
        hasCosts[g] = skill.costs ? 1 : 0;
        costMp[g] = skill.costs?.mp ?? 0; costSp[g] = skill.costs?.sp ?? 0;
        cooldown[g] = skill.cooldown ?? 0;
        // effectivePower(skill, skill.mastery): the form's power at its mastery.
        const level = Math.min(rules.masteryMax, Math.max(1, Math.round(Number(skill.mastery ?? 1) || 1)));
        power[g] = (Number(skill?.power) || 0) * (1 + (level - 1) * rules.masteryPowerPerLevel);
        // The legacy projection the chooser reads: its conditions, and what each is worth to a skill that would put it on a foe.
        const friendly = skill.type === 'heal' || skill.type === 'buff';
        const scope = friendly ? (skill.target === 'self' ? 'self' : skill.target === 'allies' || skill.target === 'all' ? 'allies' : 'ally') : (skill.target === 'all' || skill.target === 'allies' ? 'all' : 'one');
        if (kind[g] === 0 && scope !== 'one') return null;
        if (kind[g] !== 0 && kind[g] !== 3 && scope !== 'self') return null;
        effects.push(Object.entries(skill.effect ?? {}).map(([name, rounds]) => ({
            slot: SLOT[name] ?? -1,
            bonus: DOT_NAMES.has(name) ? 0.15 * rounds : name === 'stun' ? 0.5 : 0.2,
        })));
        // The form's effects in order, each with the sums that do not change in a fight.
        const basis = skill.parts.find(other => other.power)?.power ?? 100;
        const parts = [];
        for (const part of skill.parts) {
            const hostile = part.op === 'damage' || (part.op === 'condition' && ['poison', 'burn', 'bleed', 'stun', 'daze', 'slow', 'weaken'].includes(part.kind)) || (part.op === 'stat' && part.amount < 0);
            const word = part.target;
            if (hostile && kind[g] !== 0 && kind[g] !== 3) return null;
            if (part.op === 'stat') { parts.push({ op: 'stat' }); continue; }
            if (hostile ? (word === 'all' || word === 'allies') : word !== 'self') return null;
            if (part.op === 'damage') {
                const type = part.damageType === 'magic' ? 'magic' : part.damageType === 'physical' ? 'physical' : skill.type === 'magic' ? 'magic' : 'physical';
                const raw = valueOf(owner, skill, type) * formPower(skill, part) * 1;
                const mit = new Float64Array(N);
                for (let t = 0; t < N; t++) mit[t] = mitigate(raw, type === 'physical' ? members[t].pdef : members[t].mdef);
                parts.push({ op: 'damage', physical: type === 'physical', mit });
            } else if (part.op === 'heal') {
                parts.push({ op: 'heal', amount: valueOf(owner, skill, 'heal') * formPower(skill, part) });
            } else if (part.op === 'shield') {
                parts.push({ op: 'shield', strength: Math.max(1, Math.round(valueOf(owner, skill, 'buff') * formPower(skill, part) * C.shield)) });
            } else if (part.op === 'condition') {
                const slot = SLOT[part.kind];
                if (slot === undefined || slot === SHIELD) return null;
                if (part.kind === 'daze' !== hostile) return null;
                const rounds = part.rounds;
                let strength = 0;
                if (part.kind === 'regen') {
                    // The condition's source is the form's first powered effect, else 1.0, at the caster's value.
                    const given = (basis / 100) * (1 + 0.1 * (skill.formMastery ?? 0));
                    strength = Math.max(1, Math.round(valueOf(owner, skill, 'buff') * given * 1 * C.regen));
                }
                parts.push({ op: 'condition', hostile, slot, rounds, strength, chance: part.chance, applies: rounds > 0 });
            } else return null;
        }
        plans.push(parts);
    }

    const simple = new Uint8Array(N);
    for (let a = 0; a < N; a++) {
        simple[a] = 1;
        for (let g = skillFrom[a]; g < skillFrom[a + 1]; g++) {
            if (kind[g] === 1 || kind[g] === 2) simple[a] = 0;
            if (kind[g] === 0 && power[g] + effects[g].reduce((sum, e) => sum + e.bonus, 0) > 1) simple[a] = 0;
        }
    }

    // --- one fight -------------------------------------------------------------------------------------------------------------------------
    const hp = new Float64Array(N), mp = new Float64Array(N), sp = new Float64Array(N), next = new Float64Array(N);
    const alive = new Uint8Array(N), fleeTried = new Uint8Array(N), condMask = new Uint8Array(N);
    const condRounds = new Float64Array(4 * N), condPower = new Float64Array(4 * N);
    const cooldownLeft = new Float64Array(K);
    const roster = new Int32Array(N), fresh = new Int32Array(N);
    const waveDone = new Uint8Array(waves.length);
    const waveFrom = [];
    { let at = 1 + E; for (const wave of waves) { waveFrom.push(at); at += (wave.enemies ?? []).length; } }
    const waveRound = waves.map(wave => Number(wave.round) || 1);
    let s = 0, rosterSize = 0, freshSize = 0, enemiesAlive = 0, status = ACTIVE, time = 0, round = 0, head = -1, turnStarted = false, pendingWaves = 0;
    let target = -1, entered = false;

    const rand = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const has = (i, slot) => slot >= 0 && (condMask[i] & (1 << slot)) !== 0;
    const addCondition = (i, slot, rounds, strength) => {
        const at = slot * N + i;
        if (condMask[i] & (1 << slot)) {
            condRounds[at] = Math.max(condRounds[at], rounds);
            condPower[at] = Math.max(condPower[at], strength);
        } else { condMask[i] |= 1 << slot; condRounds[at] = rounds; condPower[at] = strength; }
    };
    const shareOf = new Float64Array(N);
    // A fighter who joins stands in the fight's order; one who is down or gone leaves it.
    const join = i => {
        fresh[freshSize++] = i;
        if (!alive[i]) return;
        roster[rosterSize++] = i;
        if (side[i] === 1) enemiesAlive++;
    };
    const leave = i => {
        alive[i] = 0;
        let k = 0;
        while (roster[k] !== i) k++;
        for (; k + 1 < rosterSize; k++) roster[k] = roster[k + 1];
        rosterSize--;
        if (side[i] === 1) enemiesAlive--;
    };
    const down = i => { hp[i] = 0; condMask[i] = 0; leave(i); };
    const takeDamage = (i, amount) => {
        const dealt = Math.min(hp[i], amount);
        hp[i] -= dealt;
        if (hp[i] > 0) { shareOf[i] = hp[i] / hpMax[i]; return; }
        shareOf[i] = 0;
        down(i);
    };
    const heal = (i, amount) => {
        const gained = Math.min(hpMax[i] - hp[i], Math.max(0, Math.round(amount)));
        hp[i] += gained;
        shareOf[i] = hpMax[i] > 0 ? hp[i] / hpMax[i] : 0;
        return gained;
    };
    // One damaging hit: the roll to hit (a blow, or a spell by the spell rule), mitigation with variance, a critical, guard, shield.
    const strike = (a, t, mit, physical) => {
        if (physical) {
            if (!(rand() * 100 < hitDex[(a * N + t) * 2 + ((condMask[a] >> DAZE) & 1)])) return;
        } else if (spellRoll && !(rand() * 100 < hitInt[(a * N + t) * 2 + ((condMask[a] >> DAZE) & 1)])) return;
        let damage = mit * (A.varianceLow + rand() * (A.varianceHigh - A.varianceLow));
        if (rand() * 100 < crit[a]) damage *= A.critMultiplier;
        if (condMask[t] & (1 << GUARD)) damage *= A.defendTaken;
        damage = Math.max(1, Math.round(damage));
        let through = damage;
        if (condMask[t] & (1 << SHIELD)) {
            const absorbed = Math.min(condPower[SHIELD * N + t], damage);
            condPower[SHIELD * N + t] -= absorbed;
            if (condPower[SHIELD * N + t] <= 0) condMask[t] &= ~(1 << SHIELD);
            through = damage - absorbed;
        }
        takeDamage(t, through);
    };
    const checkEnd = () => {
        if (status !== ACTIVE) return;
        if (enemiesAlive === 0 && pendingWaves === 0) status = VICTORY;
        else if (!alive[0]) status = DEFEAT;
    };
    const enterTimeline = i => { next[i] = time + wait[i] * (0.8 + rand() * (1 - 0.8)); };
    const joinWaves = () => {
        let first = Infinity;
        for (let w = 0; w < waves.length; w++) if (!waveDone[w] && waveRound[w] < first) first = waveRound[w];
        let any = false;
        for (let w = 0; w < waves.length; w++) if (!waveDone[w] && waveRound[w] <= round) { any = true; break; }
        const early = !any && pendingWaves > 0 && enemiesAlive === 0;
        for (let w = 0; w < waves.length; w++) {
            if (waveDone[w]) continue;
            if (!(early ? waveRound[w] === first : waveRound[w] <= round)) continue;
            waveDone[w] = 1; pendingWaves--;
            for (let k = 0; k < (waves[w].enemies ?? []).length; k++) join(waveFrom[w] + k);
        }
    };
    // Counts rounds up to `to`, joining the waves due; false once the fight is broken off.
    const passRounds = to => {
        while (round < to) {
            round += 1;
            if (round > C.maxRounds) { round -= 1; status = FLED; return false; }
            freshSize = 0;
            joinWaves();
            for (let k = 0; k < freshSize; k++) enterTimeline(fresh[k]);
        }
        return true;
    };
    const nextOnTimeline = () => {
        if (enemiesAlive === 0 && pendingWaves > 0) {
            time = Math.max(time, round * length);
            if (!passRounds(round + 1)) return;
        }
        if (!entered) {
            // Each fighter's first turn, in the fight's order, the first time anyone is looked for.
            entered = true;
            for (let k = 0; k < rosterSize; k++) if (!Number.isFinite(next[roster[k]])) enterTimeline(roster[k]);
        }
        let up = -1;
        for (let k = 0; k < rosterSize; k++) {
            const i = roster[k];
            if (up < 0 || next[i] < next[up] || (next[i] === next[up] && side[i] < side[up])) up = i;
        }
        if (up < 0) return;
        time = Math.max(time, next[up]);
        const reached = Math.floor(time / length) + 1;
        if (round < reached && !passRounds(reached)) return;
        head = up; turnStarted = false;
    };
    // The start of a turn: regeneration, every duration counts down, guard from the last turn goes, a little stamina comes back.
    const beginTurn = a => {
        const mask = condMask[a];
        if (mask !== 0) {
            if (mask & (1 << REGEN)) heal(a, condPower[REGEN * N + a]);
            for (let slot = 0; slot < 4; slot++) if (mask & (1 << slot)) condRounds[slot * N + a] -= 1;
            if ((mask & (1 << GUARD)) && !(condRounds[GUARD * N + a] > 0)) condMask[a] &= ~(1 << GUARD);
        }
        if (hasSp[a] && sp[a] < spMax[a]) sp[a] = Math.min(spMax[a], sp[a] + Math.max(1, Math.round(spMax[a] * (C.spPerTurn ?? 0))));
    };
    const endTurn = (a, used) => {
        for (let g = skillFrom[a]; g < skillFrom[a + 1]; g++) if (g !== used && cooldownLeft[g] > 0) cooldownLeft[g] -= 1;
        if (condMask[a] !== 0) for (let slot = 0; slot < 4; slot++) if ((condMask[a] & (1 << slot)) && !(condRounds[slot * N + a] > 0)) condMask[a] &= ~(1 << slot);
        next[a] = time + wait[a];
        head = -1; turnStarted = false;
    };
    const blocked = (a, g) => {
        if (cooldownLeft[g] > 0) return true;
        if (legacyMp[g] > (physicalPool[g] && hasSp[a] ? sp[a] : mp[a])) return true;
        return hasCosts[g] === 1 && (costMp[g] > mp[a] || costSp[g] > (hasSp[a] ? sp[a] : 0));
    };
    // The chooser of Auto: flee when broken, heal when hurt, put up a condition that is not there, the strongest attack, else a blow.
    // Answers a skill's number, -1 for a blow, -2 for a flight and -3 for what it does not play; the foe it aims at is `target`.
    const choose = a => {
        let low = -1;
        if (side[a] === 1) low = alive[0] ? 0 : -1;
        else for (let k = 0; k < rosterSize; k++) {
            const i = roster[k];
            if (side[i] === 0) continue;
            if (low < 0 || shareOf[i] < shareOf[low]) low = i;
        }
        if (low < 0) return -3;
        target = low;
        if (side[a] === 1 && !boss[a] && fleesBelow[a] > 0 && shareOf[a] <= fleesBelow[a] && !fleeTried[a]) return -2;
        // A fighter whose skills are all attacks worth no more than a blow can only strike.
        if (simple[a]) return -1;
        const from = skillFrom[a], to = skillFrom[a + 1];
        if (shareOf[a] < C.healBelow) {
            let mend = -1;
            for (let g = from; g < to; g++) if (kind[g] === 1 && !blocked(a, g) && (mend < 0 || power[g] > power[mend])) mend = g;
            if (mend >= 0) { target = a; return mend; }
        }
        for (let g = from; g < to; g++) {
            if (kind[g] !== 2 || blocked(a, g)) continue;
            for (const { slot } of effects[g]) if (!has(a, slot)) { target = a; return g; }
        }
        let best = -1, score = 0;
        for (let g = from; g < to; g++) {
            if (kind[g] !== 0 || blocked(a, g)) continue;
            let value = power[g] * 1;
            for (const { slot, bonus } of effects[g]) if (!has(low, slot)) value += bonus;
            if (best < 0 || value > score) { best = g; score = value; }
        }
        return best >= 0 && score > 1 ? best : -1;
    };
    const perform = (a, g) => {
        // Pay once, then every effect in order.
        if (costMp[g]) mp[a] -= costMp[g];
        if (costSp[g] && hasSp[a]) sp[a] -= costSp[g];
        cooldownLeft[g] = cooldown[g];
        for (const part of plans[g]) {
            if (part.op === 'damage') {
                if (alive[target]) strike(a, target, part.mit[target], part.physical);
            } else if (part.op === 'heal') {
                heal(a, part.amount * (A.varianceLow + rand() * (A.varianceHigh - A.varianceLow)));
            } else if (part.op === 'shield') {
                addCondition(a, SHIELD, SHIELD_ROUNDS, part.strength);
            } else if (part.op === 'condition') {
                const who = part.hostile ? target : a;
                if (!alive[who]) continue;
                if (part.hostile && !(rand() * 100 < hitDex[(a * N + who) * 2 + ((condMask[a] >> DAZE) & 1)])) continue;
                if (part.chance < 100 && !(rand() * 100 < part.chance / 100)) continue;
                if (part.applies) addCondition(who, part.slot, part.rounds, part.strength);
            } else return false;
        }
        return true;
    };
    const fleeing = a => {
        fleeTried[a] = 1;
        let total = 0, count = 0;
        if (alive[0]) { total += members[0].stats.AGI; count += 1; }
        const partyAgi = count ? (0 + total) / count : 0;
        const f = rules.flee;
        const chance = Math.min(f.max, Math.max(f.min, f.base + (num(members[a].stats.AGI - ((condMask[a] >> DAZE) & 1) * 2) - num(partyAgi)) * f.perAgi - 0));
        if (rand() * 100 < chance) leave(a);
    };
    // Turns until the party member must choose (true) or the fight is over (false).
    const advance = () => {
        while (status === ACTIVE) {
            if (head < 0 || (enemiesAlive === 0 && !turnStarted)) { nextOnTimeline(); checkEnd(); continue; }
            const a = head;
            if (!alive[a]) { head = -1; turnStarted = false; continue; }
            if (!turnStarted) {
                turnStarted = true;
                beginTurn(a);
                checkEnd();
                if (status !== ACTIVE) break;
            }
            if (a === 0 && playerControl) return true;
            const choice = choose(a);
            if (choice === -3) return null;
            if (choice === -2) fleeing(a);
            else if (choice === -1) strike(a, target, basicMit[a * N + target], true);
            else if (!perform(a, choice)) return null;
            endTurn(a, choice >= 0 ? choice : -1);
            checkEnd();
        }
        return false;
    };
    let playerControl = true;

    const play = (stateA, stateB, out = null) => {
        hp.set(hp0); for (let i = 0; i < N; i++) shareOf[i] = hpMax[i] > 0 ? hp0[i] / hpMax[i] : 0;
        condMask.fill(0);
        mp.set(mp0); sp.set(sp0); next.fill(NaN); fleeTried.fill(0);
        waveDone.fill(0);
        for (let g = 0; g < K; g++) cooldownLeft[g] = skills[g].skill.cooldownLeft ?? 0;
        for (let i = 0; i < N; i++) alive[i] = hp0[i] > 0 ? 1 : 0;
        rosterSize = 0; enemiesAlive = 0; entered = false; status = ACTIVE; time = 0; round = 0; head = -1; turnStarted = false;
        pendingWaves = waves.length; playerControl = (party.controller === 'command' || party.controller === 'player');
        s = stateA;
        freshSize = 0;
        for (let i = 0; i <= E; i++) join(i);
        checkEnd();
        let outcome = advance();
        if (outcome === null) return -1;
        if (status === ACTIVE && outcome) {
            // Auto: the party member's turn runs on, from the generator the action draws.
            playerControl = false;
            if (byAction) s = stateB;
            outcome = advance();
            if (outcome === null) return -1;
        }
        if (out) {
            out.status = status; out.time = time; out.round = round; out.state = s;
            out.hp = Array.from(hp.subarray(0, N)); out.alive = Array.from(alive.subarray(0, N));
        }
        return status === VICTORY ? 1 : 0;
    };
    return play;
}
