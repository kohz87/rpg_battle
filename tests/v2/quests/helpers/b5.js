// Import the rule owner's export from this checkout, or an explicit integration checkout.
// CI does not need another branch's git objects and never copies or archives its source.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const path = process.env.RPG_BATTLE_PROGRESS_DIR
    ? pathToFileURL(resolve(process.env.RPG_BATTLE_PROGRESS_DIR, 'index.js'))
    : new URL('../../../../src/v2/progress/index.js', import.meta.url);
const buildGuard = existsSync(path) ? (await import(path.href)).buildGuard : null;
const b5Skip = typeof buildGuard === 'function' ? false : 'Track B progress.buildGuard is not integrated; supply its checkout with RPG_BATTLE_PROGRESS_DIR.';
export { buildGuard, b5Skip };
