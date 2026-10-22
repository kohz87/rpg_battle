// rx-ui (beta rolling break, WAVE_BRIEF rule 7 "names flattened", Crafting screen with odd data): a
// story-taught recipe keeps invisible format characters in its name. "+ recipe ‮Salve​" is
// kept as written: the Crafting screen draws a right-to-left override that turns the rest of the row
// around, and "Salve" taught again is a second recipe that looks the same. Story Block's item names drop
// \p{Cf} (domains/names.js cleanName); recipe names should too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { craftHost, personOf } from '../craft/helpers.js';

const teach = name => `+ recipe ${name} | from: Hollis | who: Ren | makes: Salve Jar | with: Herb x2 | craft: cooking`;

test('a recipe name is kept without bidi controls or zero-width characters, and the same name is one recipe', async () => {
    const host = await craftHost();
    try {
        await host.send('Hollis teaches me.', host.reply('He shows you.', [teach('‮Salve​')]));
        await host.send('Again.', host.reply('Once more.', [teach('Salve')]));
        const names = personOf(host).recipes.map(recipe => recipe.name);
        for (const name of names) assert.ok(!/\p{Cf}/u.test(name), `a recipe name keeps format characters: ${JSON.stringify(name)}`);
        assert.equal(names.filter(name => name.replace(/\p{Cf}/gu, '') === 'Salve').length, 1, `two look-alike recipes: ${JSON.stringify(names)}`);
    } finally {
        host.close();
    }
});
