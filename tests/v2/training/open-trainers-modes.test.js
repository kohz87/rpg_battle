// The open trainers suites that hold in both modes (GENERATIVE_OFFERS_SPEC §10, §16): they run on their own in strict mode (Jobs from the story off, RPG Battle
// 2.2.0's behaviour; helpers/open.js), and here again with the feature on. `open-trainers.test.js` is left out: it is the 2.2.0 refusals, which the generative path
// replaces for free-form lines (offer-trainer.test.js covers that path), and so is `open-trainers-real-sd.test.js` (its first test reads the guard of the 2.2.0 `trainer.open`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SUITES = ['open-trainers-kind', 'open-trainers-pins', 'open-trainers-queries', 'open-trainers-replay'];

for (const suite of SUITES) test(`${suite} passes with Jobs from the story on, as it does in strict mode`, () => {
    const env = { ...process.env, RB_TRAINERS_FEATURE: 'on' };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', fileURLToPath(new URL(`./${suite}.test.js`, import.meta.url))], { env, encoding: 'utf8', timeout: 300000 });
    assert.equal(run.status, 0, `${run.stdout}`.split('\n').filter(line => /^not ok|^# (pass|fail)/.test(line)).join('\n') || run.stderr);
    assert.match(run.stdout, /^# fail 0$/m);
});
