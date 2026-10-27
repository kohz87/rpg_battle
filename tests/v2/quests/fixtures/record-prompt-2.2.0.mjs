// Records tests/v2/quests/fixtures/prompt-2.2.0.json: the static prompt and the tails of two chats (helpers/prompt-scenarios.js) played with RPG Battle 2.2.0 on
// Story Block 2.5.0, BEFORE the rules block, the slug lists' removal or any other prompt change of 2.3.0. Run it on a checkout of 2.2.0's src with this
// folder's helpers and the same vendored Story Block; do not run it again to "fix" a failing byte-identity test:
//
//   node tests/v2/quests/fixtures/record-prompt-2.2.0.mjs > tests/v2/quests/fixtures/prompt-2.2.0.json
//
import { templateless, unpinned } from '../helpers/prompt-scenarios.js';

process.stdout.write(`${JSON.stringify({ recordedWith: { rpgBattle: '2.2.0' }, unpinned: await unpinned(), templateless: await templateless() })}\n`);
