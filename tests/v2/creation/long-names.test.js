// Long unbroken names in the creation wizard (a race, a talent, a ready-made character): they are cut at the
// widget's limit and wrap in the screen's CSS, so a phone never scrolls sideways for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChoicePick } from '../../../src/v2/creation/choice-pick.js';
import { createScreen } from '../../../src/v2/creation/screen.js';
import { installDom } from '../screens/helpers/dom.js';

const LONG = 'Supercalifragilisticexpialidocious'.repeat(3);   // 96 characters, no spaces

test('a 96-character race or talent name is cut at 80 characters and drawn as text, never markup', () => {
    const doc = installDom();
    const el = doc.createElement('div');
    doc.body.append(el);
    const picked = { value: [{ id: 'race/long', name: LONG, bonus: '+1 STR', cost: 2 }], field: 'race', label: 'Race' };
    renderChoicePick(el, picked, {});
    const name = el.querySelector('.cc-card-name').textContent;
    assert.equal(name.length, 80);
    assert.equal(name, LONG.slice(0, 80));
    assert.equal(el.querySelectorAll('.cc-card').length, 1);
});

test('the wizard\'s CSS lets a long name wrap: the card names, the registration name and the preset names', () => {
    const css = createScreen.css;
    assert.match(css, /\.cc-card-name \{[^}]*overflow-wrap: anywhere;/);
    assert.match(css, /\.cc-register-name \{[^}]*overflow-wrap: anywhere;/);
    assert.match(css, /\.rpg-preset \{[^}]*overflow-wrap: anywhere;/);
    assert.match(css, /\.cc-background-text \{[^}]*overflow-wrap: anywhere;/);
});
