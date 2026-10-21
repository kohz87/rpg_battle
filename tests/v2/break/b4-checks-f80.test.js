// B4-2: F80 says the first uncertain attempt takes Roll 1 and the next Roll 2, "whatever they
// say". pickRoll (src/v2/checks/commands.js) honours whichever free roll the line names, by its
// number (`roll: 2`) or by its value (`roll: 17`), so a reply with one check can take the better
// of the two dice: advantage on every check, chosen by the model (invariant 3: code, not the
// model, sets the numbers). The line should take the roll its place gives it (or be flagged).
//
// The dice of a reply are drawn before its text (checks.prepare in beforeGenerate), so under a
// seeded crypto the same seed hands over the same two rolls whatever the reply says: the test
// first reads them with a plain reply, then writes the reply that names the better one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seeded, started } from './helpers.js';

const lastLog = host => host.head().domains.checks.log.at(-1);

async function rollsOf(seed) {
    return seeded(seed, async () => {
        const host = await started();
        try {
            await host.send('I sneak past.', 'You slip past the guard.');
            return [...host.head().domains.checks.prepared.at(-1).rolls];
        } finally {
            host.close();
        }
    });
}

/** A seed whose reply gets Roll 1 < Roll 2 with a gap of at least 4, and its rolls. */
async function seedWithBetterSecond() {
    for (let seed = 1; seed < 200; seed += 1) {
        const rolls = await rollsOf(seed);
        if (rolls[1] - rolls[0] >= 4 && rolls[0] !== 1 && rolls[1] !== 20) return { seed, rolls };
    }
    throw new Error('no seed found');
}

for (const [label, written] of [['by number (roll: 2)', () => '2'], ['by value (roll: <Roll 2\'s die>)', rolls => String(rolls[1])]]) {
    test(`B4-2: a reply's only check takes Roll 1; it cannot pick the better die ${label}`, async () => {
        const { seed, rolls } = await seedWithBetterSecond();
        await seeded(seed, async () => {
            const host = await started();
            try {
                const mod = 1;   // Ren the fighter: DEX 7 → +1 for stealth, no extras
                const dc = rolls[1] + mod;   // Roll 2 just makes it, Roll 1 falls 4 or more short
                await host.send('I sneak past.', host.reply('You slip past the guard.', [`? check stealth — slipping past the guard | dc: ${dc} | roll: ${written(rolls)} | result: success`]));
                assert.deepEqual(host.head().domains.checks.prepared.at(-1).rolls, rolls, 'the same seed handed over the same rolls');
                const entry = lastLog(host);
                assert.equal(entry.mod, mod);
                assert.ok(entry.roll === 1 || entry.mismatch, `rolls ${JSON.stringify(rolls)}: the only check took Roll ${entry.roll} = ${entry.die} → ${entry.outcome}, unflagged`);
            } finally {
                host.close();
            }
        });
    });
}
