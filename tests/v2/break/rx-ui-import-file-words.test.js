// rx-ui (beta rolling break, invariant 4, RB-screens2 export/import): what the wizard's "Import character"
// says about a bad file. (1) A file whose version field is not a small number is echoed whole into the
// refusal: a 400 KB string becomes a 400 KB status line in the dialog (one unbroken word), an object
// becomes "version [object Object]". (2) RPG Battle 1's party file (`rpgBattleParty: 1`, its Export) is
// told "That is not an RPG Battle character file." although it is one, from the older version.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost } from '../integration/helpers/host.js';
import { importFile } from '../../../src/v2/creation/wizard-widgets.js';

const file = text => ({ size: Buffer.byteLength(text), text: async () => text });
const POINTS = { STR: 5, DEX: 5, VIT: 0, AGI: 0, INT: 0, LUK: 0, CHA: 0 };

async function exported() {
    const host = await rpgHost();
    try {
        assert.equal((await host.cmd('creation.finish', { name: 'Ren', race: 'rpg-battle/human', points: POINTS })).ok, true);
        const out = await host.sdk.preview('party.export', {});
        return out.receipt.data.character;
    } finally {
        host.close();
    }
}

async function tryImport(text) {
    const host = await rpgHost();
    try {
        return await importFile(file(text), { command: (type, payload) => host.cmd(type, payload) });
    } finally {
        host.close();
    }
}

test('a bad version field is not echoed whole into the refusal', async () => {
    const real = await exported();
    const long = await tryImport(JSON.stringify({ ...real, rpgBattleCharacter: 'v'.repeat(400000) }));
    assert.equal(long.ok, false);
    assert.ok(long.message.length < 300, `the refusal is ${long.message.length} characters long`);
    const object = await tryImport(JSON.stringify({ ...real, rpgBattleCharacter: { a: 1 } }));
    assert.ok(!/\[object Object\]/.test(object.message), object.message);
});

test('RPG Battle 1\'s party file is named as an older RPG Battle file, not "not an RPG Battle character file"', async () => {
    const v1 = { rpgBattleParty: 1, character: { name: 'Old', level: 3, xp: 0, points: 0, hp: { cur: 10, max: 10 }, mp: { cur: 1, max: 1 }, stats: { STR: 5 } }, companions: [], gear: [], skills: [] };
    const out = await tryImport(JSON.stringify(v1));
    assert.equal(out.ok, false);
    assert.ok(!/not an RPG Battle character file/.test(out.message), out.message);
    assert.match(out.message, /RPG Battle 1|older|party file/i);
});
