// Finds the parts of Story Block's runtime the screens tests use, in a Story Block checkout: the
// screen validator (src/v2/view/screens.js), the template renderer (src/v2/view/template/ with
// bind.js and css.js), the condition language (src/v2/events/), the standard widgets' prop checks
// (src/v2/view/widgets/). The DOM they draw into is this folder's own fake (dom.js).
//
// Where to look: STORY_BLOCK_DIR (one directory, or several joined by the path delimiter), then a
// Story Block checkout beside this repository (../story_block, ../Story_block), then the copy of Story
// Block's runtime this repository keeps for its tests (tests/vendor/story-block). Each piece is taken
// from the first directory that has it, so a branch with the renderer and one with the widgets can be
// combined. Missing pieces are null and the tests that need them are skipped with the reason.

import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

export const searched = [
    ...String(process.env.STORY_BLOCK_DIR ?? '').split(delimiter).filter(Boolean),
    join(repo, '..', 'story_block'),
    join(repo, '..', 'Story_block'),
    join(repo, 'tests', 'vendor', 'story-block'),
].map(dir => resolve(dir));

const firstWith = file => searched.find(dir => existsSync(join(dir, file))) ?? null;

async function load(file) {
    const dir = firstWith(file);
    if (!dir) return null;
    return { dir, module: await import(pathToFileURL(join(dir, file)).href) };
}

const found = {
    screens: await load('src/v2/view/screens.js'),
    template: await load('src/v2/view/template/index.js'),
    events: await load('src/v2/events/index.js'),
    widgets: await load('src/v2/view/widgets/index.js'),
    registry: await load('src/v2/registry.js'),
};
// bind.js, css.js and the fake DOM come from the renderer's own checkout, so they match it.
const rendererDir = found.template?.dir ?? null;
const sibling = async file => (rendererDir && existsSync(join(rendererDir, file)) ? import(pathToFileURL(join(rendererDir, file)).href) : null);
const bind = await sibling('src/v2/view/bind.js');
const css = await sibling('src/v2/view/css.js');

if (!found.screens) throw new Error(`Story Block's src/v2/view/screens.js was not found (looked in ${searched.join(', ')}).`);

/** validateScreen and resolveData from the first Story Block runtime found; `validatorFrom` says where. */
export const { validateScreen, resolveData } = found.screens.module;
export const validatorFrom = found.screens.dir.startsWith(repo) ? found.screens.dir.slice(repo.length + 1) : found.screens.dir;

/** The renderer and what it needs, or null with `missing` saying why. */
export const renderer = found.template && bind && css && found.events
    ? { ...found.template.module, ...bind, scopeCss: css.scopeCss, events: found.events.module, dir: rendererDir }
    : null;

export const rendererMissing = renderer ? '' : [
    !found.template && 'the template renderer (src/v2/view/template/index.js)',
    found.template && !bind && 'bind.js beside the renderer',
    found.template && !css && 'css.js beside the renderer',
    !found.events && 'the condition language (src/v2/events/)',
].filter(Boolean).join(', ') + ` not found in a Story Block checkout (looked in ${searched.join(', ')}; set STORY_BLOCK_DIR)`;

/** The css scoper alone (it may exist without a full renderer), or null. */
export const scopeCss = css?.scopeCss ?? (firstWith('src/v2/view/css.js') ? (await import(pathToFileURL(join(firstWith('src/v2/view/css.js'), 'src/v2/view/css.js')).href)).scopeCss : null);

/** Story Block's module-definition check (src/v2/registry.js), or null. */
export const definitionProblems = found.registry?.module?.definitionProblems ?? null;

/** Story Block's standard widgets (for their prop checks), or null. */
export const widgets = found.widgets?.module ?? null;
