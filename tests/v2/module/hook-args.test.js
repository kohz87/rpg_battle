// The merged hooks hand the host's extra arguments on to every part (beforeGenerate's { type }).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createModule } from '../../../src/v2/module.js';

test('beforeGenerate hands { type } on, so a Continue keeps the reply\'s prepared dice', async () => {
    const def = createModule();
    const chat = [{ is_user: false }, { is_user: true }, { is_user: false }];
    const state = { domains: { checks: { prepared: [{ for: 2, rolls: [12, 5] }], log: [], last: null } } };
    const view = { state, chat, settings: () => ({}), query: () => undefined };
    const cont = await def.hooks.beforeGenerate(view, { type: 'continue' });
    assert.ok(!cont.commands.some(c => c.type === 'checks.prepare'), 'a Continue re-rolled');
    const fresh = await def.hooks.beforeGenerate(view, { type: 'normal' });
    assert.ok(!fresh.commands.some(c => c.type === 'checks.prepare'), 'RB never prepares check dice');
});
