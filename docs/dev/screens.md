# Screens: the skill tree and the creation wizard

Area notes for the glass screens (Story Block's look, `docs/dev/ui-and-screens.md` in kohz87/Story_block).

## Skills (widget `rpg-battle.skill-tree`, `src/v2/screens/skill-tree.js`)

The Party card's skills are this widget. It draws a node list; it decides nothing about skills. The screen builds the
list (`skillNodes` in `src/v2/screens/view.js`) from the party part's own skill data.

Node shape (the widget's `value` prop, a list):

| Field | Type | Meaning |
|---|---|---|
| `id` | text | unique in the list (today: the skill's name) |
| `name` | text | shown and spoken |
| `icon` | Font Awesome class | the tile's glyph (`fa-star` when missing) |
| `tier` | whole number | the row: 1 starting, 2 intermediate, 3 expert; 0 is "taught by the story", drawn last |
| `level`, `max` | whole numbers | the level it has (0 when not learned) and its cap |
| `uses` | whole number | uses toward the next level (for the detail) |
| `state` | `locked` \| `available` \| `learned` \| `maxed` \| `closed` | see below |
| `requires` | list of ids | the parents: a line is drawn from each to this node; several nodes may share a parent |
| `closedBy` | id | for a `closed` node, the chosen node on the other path (its name is said) |
| `hint` | text | said under the name (a locked or closed node gets its hint from the tree instead) |
| `inUse` | `true` \| `false` \| `null` | in use, set aside, or no switch (Use / Set aside shows only for a boolean) |
| `kind`, `note`, `facts` | text, text, list of text | the detail card's lines |

States:

- `locked`: a requirement is not at its cap. Not a button. Hint: "Unlocks when <parent> reaches its cap".
- `available`: unlocked with no uses yet (an accent ring).
- `learned`: some uses. A hairline.
- `maxed`: at its cap. A green ring and a star.
- `closed`: another path from the same parent was chosen. A button (its detail says why), hatched, struck through, with a
  ban marker. Hint: "<chosen> path chosen". Its accessible name: "Ice Lance, closed: Fire path chosen".

Layout: leaves (nodes with no children) take consecutive slots across the card; each parent sits at the mean of its
children's slots, so a 1 → 3 → (2,2,2) tree fans out without crossing lines. Tiers are rows. Above six leaves, and below
a 480 px container, the same tree is an indented list with "from <parent>" under each line (`data-grid="no"` or the
container query). Caps: 12 tiers of 24 tiles (`SKILL_TIERS_MAX`, `SKILL_TILES_MAX`).

Today's skills map to tier-1 (or tier-0) nodes with no `requires`, so no lines are drawn; `state` is `maxed` at the cap,
`available` with no uses, `learned` otherwise. The view adds no rule: the logic of skills is unchanged.

## Character creation (`src/v2/creation/`)

The wizard's steps keep their ids, commands, payloads and rules. Each step is a main column (its choices) and the
details panel "Your character" (portrait, name, race, talents, the final stats; drawn again from the draft at each
change) on every step. The screen asks Story Block for a wide window (`width: 'wide'`, 960 px on a wide screen). A step
560 px or wider (a container query on each `.cc-step`) puts the panel in the right column; on a phone the panel stacks under
the choices, one step per screen, with the dialog's own step list as the indicator.

The rules choice comes first. While a rules pack is offered and none is pinned (`rules.selection` is `offered`), every step
shows "Choose your rules" (`.cc-gate`, query `rpg-battle.rulesGate`) in place of its choices, with the same `rules.pin`
button Setup draws (`rulesChoice` in `screens/rules/setup.js` builds both; widget `rpg-battle.rules-pin` wraps
`rpg-battle.command-button`, so there is one pin command and one guard). The You step has no Create until the pin is made.
After it, the steps are as before. With no pack offered, or a pin made, nothing of this shows.

- The class and check-actor choices (`rpg-battle.class-pick`) are full-width rows like the talents: the name, the skills on
  their own line, a "Chosen" badge. Picking by keyboard keeps the focus on the row.
- Races are tiles (`button.cc-card`, `aria-pressed`); talents are rows (`.cc-row`). Both come from `rpg-battle.choice-pick`.
- The radar is `rpg-battle.stat-radar` (`creation/radar.js`): SVG made with `createElementNS`, one axis per stat, colours
  from the screen's classes (tokens), and a visually hidden list of the same values (`.cc-sr-only`).
- Buttons are Story Block's `ss-button`s; Back, Next and the step list are the dialog's own glass footer.
- Limits: `PORTRAIT_URL_MAX` (2048, the Portrait field), `TALENT_LIST_MAX` (60), `RADAR_RINGS_MAX`, `RADAR_AXES_MAX`,
  `RADAR_SCALE_MIN` (radar.js).
