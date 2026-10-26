// npm run sync-director [-- --from <Story Director checkout>]
//
// Copies Story Director's v2 runtime into tests/vendor/story-director/ so the suites that run RPG Battle next
// to the real Story Director (the host fixture, the checks suites) also run when only this repo is checked
// out. The layout is kept so relative imports work there: src/v2/ and every other file those import (followed
// through their imports, e.g. src/changes.js), plus the one Story Director suite that tests/v2/checks/outside.test.js
// re-runs (tests/v2/checks/roll.test.js and what it imports). The vendored folder is replaced as a whole.
// Writes VERSION with the commit it was copied from. Plain Node, no dependencies.
//
// `--from` defaults to $STORY_DIRECTOR, then ../Story_director.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join('tests', 'vendor', 'story-director');
const ROOTS = [join('src', 'v2'), join('tests', 'v2', 'checks', 'roll.test.js')];
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

/** Every file to copy, relative to `from`: the roots plus what their scripts import from inside `from`. */
export function filesToCopy(from) {
    const files = new Set();
    const queue = [];
    for (const root of ROOTS) {
        const path = join(from, root);
        if (!existsSync(path)) continue;
        for (const file of statSync(path).isDirectory() ? walk(path) : [path]) queue.push(file);
    }
    while (queue.length) {
        const file = queue.pop();
        const rel = relative(from, file);
        if (files.has(rel)) continue;
        files.add(rel);
        if (!/\.m?js$/.test(file)) continue;
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
            const target = resolve(dirname(file), match[1]);
            const inside = relative(from, target);
            if (inside.startsWith('..') || inside.split(sep)[0] === 'node_modules' || !existsSync(target)) continue;
            queue.push(target);
        }
    }
    return [...files].sort();
}

function commitOf(from) {
    try {
        const sha = execFileSync('git', ['-C', from, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const dirty = execFileSync('git', ['-C', from, 'status', '--porcelain', '--', 'src', ...ROOTS], { encoding: 'utf8' }).trim();
        return dirty ? `${sha}+local-changes` : sha;
    } catch {
        return 'unknown (not a git checkout)';
    }
}

/** Copies into `<to>/tests/vendor/story-director/`; returns { target, files, commit }. */
export function syncDirector({ from, to = ROOT }) {
    const source = resolve(from);
    const target = join(resolve(to), VENDOR);
    if (!existsSync(join(source, 'src', 'v2', 'module.js'))) throw new Error(`${source} is not a Story Director checkout with src/v2/.`);
    if (resolve(to) === source) throw new Error('The target is Story Director itself; give the RPG Battle checkout to copy into.');
    const files = filesToCopy(source);
    rmSync(target, { recursive: true, force: true });
    for (const file of files) {
        mkdirSync(dirname(join(target, file)), { recursive: true });
        cpSync(join(source, file), join(target, file));
    }
    const commit = commitOf(source);
    let version = '';
    try { version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version ?? ''; } catch { version = ''; }
    // A package.json marks the folder as ES modules even when RPG Battle's own package does not.
    writeFileSync(join(target, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    writeFileSync(join(target, 'VERSION'), `Story Director ${version}\ncommit ${commit}\nfiles ${files.length}\n`);
    return { target, files, commit };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = process.argv.slice(2);
    let from = process.env.STORY_DIRECTOR || resolve(ROOT, '..', 'Story_director');
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--from') from = args[++i];
        else from = args[i];
    }
    try {
        const { target, files, commit } = syncDirector({ from });
        console.log(`Copied ${files.length} files into ${target} (commit ${commit}).`);
    } catch (error) {
        console.error(`sync-director: ${error.message}`);
        process.exitCode = 1;
    }
}
