// The equipment planner for a module that pins no rules, for the tests of the planner itself.
//
// module.js leaves the items part's `rules.equipPlan` (its `pinnedQueries`) out of a chat that pins no rules: Story Block
// takes a module that answers it as a ready rules module and plans every equip through it, checking the wearer's
// `rules.sheet`, which only the rules parts answer. A test that wears things on the plain module (the party's own heroes
// and story items) passes these to createModule({ parts }): the planner as a part of its own and, standing in for B's
// rules.sheet, the interim sheet that answers only equipment's inputs (equip-query.js). A real chat registers neither.
import { part as items } from '../../../../src/v2/items/index.js';
import { interimSheetQuery } from '../../../../src/v2/items/equip-query.js';

/** The planner alone: what a pinned chat adds beside the rules parts (which answer `rules.sheet` themselves). */
export const PLANNER_PART = Object.freeze(['equipment', Object.freeze({ queries: Object.freeze({ 'rules.equipPlan': items.queries['rules.equipPlan'] }) })]);
/** The planner and the stand-in sheet: a plain module that can plan by itself. */
export const EQUIP_PARTS = Object.freeze([
    PLANNER_PART,
    ['equipment-sheet', Object.freeze({ queries: Object.freeze({ 'rules.sheet': interimSheetQuery }) })],
]);
