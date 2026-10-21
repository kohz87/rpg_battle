// B4-9: the character is named after the SillyTavern persona and the wizard has no name field
// (MODULES §F22), so a persona whose name party.create cleans to nothing ("(Ren)": v1's
// headingText drops a bracketed part) can never make a character: creation.finish answers "New
// character: a name is needed." and canGenerate keeps every reply back. A persona named "{{char}}"
// is taken as it is, so every prompt line about the character names the narrator instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgHost, seeded } from './helpers.js';

async function finish(name) {
    const host = await rpgHost();
    const content = host.q('creation.content', {});
    const made = await host.cmd('creation.finish', { name, race: content.races?.[0]?.id, points: { STR: 4, VIT: 3, AGI: 1, DEX: 2 } });
    return { host, made };
}

test('B4-9a: a persona named "(Ren)" can make a character (or is told to rename the persona)', async () => {
    await seeded(5, async () => {
        const { host, made } = await finish('(Ren)');
        try {
            assert.ok(made.ok || /persona/i.test(made.message), `creation.finish: ${made.message}`);
        } finally {
            host.close();
        }
    });
});

test('B4-9b: a persona name that is a SillyTavern macro is not kept as the character\'s name', async () => {
    await seeded(5, async () => {
        const { host, made } = await finish('{{char}}');
        try {
            assert.ok(!made.ok || !/\{\{/.test(host.q('party.pc').name), `the character is called ${host.q('party.pc')?.name}`);
        } finally {
            host.close();
        }
    });
});
