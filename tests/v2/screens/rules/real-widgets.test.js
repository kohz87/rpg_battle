// The five pages drawn with Story Block's own standard widgets (ss.hero, ss.bar, ...) instead of stand-ins, in their fullest
// states: no warnings, no problems, and every prop the template hands a standard widget passes that widget's own check.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linksScreen, progressScreen, questsScreen, rosterScreen, setupScreen } from '../../../../src/v2/screens/rules/screens.js';
import { widgets as standard } from '../helpers/runtime.js';
import { REPEAT_CHAIN, answers, c05, c06, c08, c09, c15Repeat, c17, c18, companionOf, partyOf, sheetOf, LYRA } from './fixtures.js';
import { all, drawOver, skip, text } from './helpers.js';

function checkProps(drawn) {
    if (!standard) return;
    for (const { name, props } of drawn.widgets) {
        const widget = standard.standardWidgets[name];
        const unfolded = standard.unfoldValue({ ...props }, widget.props, widget.primary);
        assert.deepEqual(widget.validate(props), [], `${name} props: ${JSON.stringify(props)}`);
        assert.deepEqual(standard.propProblems(widget.props, unfolded), [], `${name} props: ${JSON.stringify(props)}`);
    }
}

const cases = () => {
    const hands = c09('one-handed');
    const repeat = c15Repeat();
    const lyra = companionOf(LYRA, 'Lyra', { npcId: 'np_00000001' });
    const links = c17();
    const inputs = c18();
    return [
        ['progress, step 2 open', progressScreen, c05().answers, undefined],
        ['progress, training across midnight', progressScreen, c06('running').answers, undefined],
        ['quests, repeat and chain', questsScreen, answers({ 'rules.quests': [REPEAT_CHAIN, ...repeat.quests], 'director.threads': [repeat.done, repeat.again] }), undefined],
        ['roster, full party', rosterScreen, c08().answers, undefined],
        ['roster, hands', rosterScreen, hands.answers, hands.state],
        ['roster, a dossier', rosterScreen, answers({ 'rules.party': partyOf({ active: [sheetOf(), lyra] }) }), undefined],
        ['links, world', linksScreen, links.answers, undefined],
        ['links, inputs', linksScreen, inputs.answers, undefined],
        ['setup', setupScreen, answers(), undefined],
    ];
};

for (const [name, screen, table, state] of cases()) {
    test(`real widgets: ${name}`, { skip }, () => {
        const { drawn } = drawOver(screen, table, { real: true, ...(state ? { state } : {}) });
        assert.deepEqual(drawn.warnings, []);
        assert.deepEqual(drawn.problems, []);
        assert.ok(text(drawn.el).length > 20);
        checkProps(drawn);
        assert.equal(all(drawn.el, 'script').length, 0);
    });
}
