// Exercise B's one guard builder from its pinned integration commit, without vendoring it.
// Once merged, use the public export directly. Until then a temporary archive supplies imports.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let buildGuard;
try { ({ buildGuard } = await import('../../../../src/v2/progress/index.js')); }
catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const root = fileURLToPath(new URL('../../../..', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'quest-b5-'));
    try {
        const archive = execFileSync('git', ['archive', '3f27e5650e70ae5cf0130743d13642f4e92fdc5e', 'package.json', 'src'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
        execFileSync('tar', ['-x', '-C', dir], { input: archive });
        ({ buildGuard } = await import(pathToFileURL(join(dir, 'src/v2/progress/guard.js'))));
    } finally { rmSync(dir, { recursive: true, force: true }); }
}
export { buildGuard };
