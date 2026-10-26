// Story Director v2, atlas part: the Map screen (SPEC §13.1), data like every screen.
//
// A tab and a full-screen view holding the atlas's own Map widget (`story-director.map`,
// widget.js) bound to the `atlas.view` query: pan and zoom, layers, search, and a place's details
// with the trip from where the reader is. Picking a place writes nothing to the story state; the
// widget keeps the view for the reader. Cards and packs may restyle or replace the screen by its
// id; `atlas.map` still gives Story Block's `ss.map` its props for a screen that wants that one.

import { MAP_WIDGET } from './widget.js';

export const MAP_SCREEN_ID = 'story-director/map';

const TEMPLATE = `<div class="atlas">
  <ss-widget name="${MAP_WIDGET}" data-props='{"bind":"q.view","label":"Map"}'></ss-widget>
</div>`;

const CSS = `.atlas { display: flex; flex-direction: column; gap: var(--ss-w-gap, 0.4em); min-width: 0; }`;

/** The Map screen definition. */
export const mapScreen = Object.freeze({
    id: MAP_SCREEN_ID,
    title: 'Map',
    icon: 'fa-map',
    mounts: Object.freeze(['tab', 'screen']),
    template: TEMPLATE,
    css: CSS,
    data: Object.freeze({
        view: Object.freeze({ query: 'atlas.view' }),
    }),
});
