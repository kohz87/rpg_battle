# Progression (rules v2, first and second slice)

Code: `src/v2/rules/` (the pinned ruleset, its class and form graph, lookups, the party sheets, flags, item rules and the
generation bounds), `src/v2/progress/` (choices, offers, credits, guards, commands, the roster, the entry points, the fold),
`src/v2/training/` (the clock, the request, the host's step, the offers). Tests: `tests/v2/progress/`,
`tests/v2/rules/`, `tests/v2/training/`. Contract: `RB_CONTRACT` §3–§7, B3 and B5 in the track B design.

The parts (`rules/index.js`, `progress/index.js`) are **not registered** by `module.js`. They are one unit: `rulesParts`
(exported by `rules/index.js`) lists `['rules', part]` and `['progress', part]`, to register together or not at all
(`rules.settle` writes `progress`; every `progress` guard reads the `rules` pin). Registering them on a chat
adds the `rules` slice, whose root is the rules-v2 marker `sdk.preflight` reads, so the lead gates it on the host's
preflight (a legacy chat must stay legacy). Until then no existing chat, pack or command changes
(`tests/v2/progress/legacy.test.js`).

## Records

- `rules`: `{ schema, rulesVersion: 2, rulesHash, pin }`. `pin` holds what Story Block's checker gave
  (`resolved`, `RULES_V2_PROGRESSION`) and an identity; every number and every class and form is read from it.
- `progress.choices[<actor>|<milestone>]`: the basic class (0), promotions (10–30) and path steps (40–90). Class,
  three skills and forms are **derived** from them (`derive.js`), so a class change swaps all three skills at once.
- `progress.attempts[id]` / `progress.credits[id]`: every paid use, and what `rules.settle` decided for it
  (1 or 0 and why). Mastery and every cap are derived from what survives; nothing is cached.

## Rules in one place

- Mastery steps `[1,5,12,22,35]`; 35 uses is 5/5 and the cap (a mastered form earns 0, reason `mastered`).
- Caps per reply and per story day, skill and actor, shared by combat, narrative and training; zero results
  (`skill-reply`, `actor-reply`, `skill-day`, `actor-day`) stay on the ledger. **An unset clock holds, it does not zero:** an
  attempt with no minute of its own while there is no clock stays pending, with no credit row and no claim, until a clock
  is set (contract §4 "unset time holds only dependent actions", §3 `CLOCK_UNSET`). `rules.settle` answers `CLOCK_UNSET` when
  only such attempts remain, and the host's `afterCapture` does not ask for it while nothing can be settled. A dormant Story
  Director is the same thing.
- The oldest milestone is the only one offered; nothing is ever chosen for the player.
- A path step needs the advanced class, the skill's current form at 5/5 and the form it is taken from to be the
  one the skill holds (selected parent). A step whose parent is missing does not apply.

## Replay

Every choice and every settlement attaches a guard (`guard.js`) and a claim (`rb:<epoch>:class|path|credit:…`). `buildGuard`
is the one helper that builds a guard envelope (exported from `progress/index.js` for the other tracks: the same `source`
hashes the same everywhere). The epoch is `epochOf(ctx)` (`ctx.epoch` once Story Block provides it, else the state's
savepoints epoch, else the genesis epoch `ep_00000000`); the guard names it, the hook hashes with the guard's own epoch and
turns the block off when it is not the state's. A settlement's guard hashes each row's **day**, not its minute (the row keeps
the minute), so a minute edited within its day moves no later settlement. Choices are refused while the combat part holds
any session at all (a won fight that is not settled yet included); only a missing or throwing `combat.session` is no fight.
On the state before the block the hook asks the same question the command asked (`assess.js`); if it is no longer
earned the block stays stored but off (REPLAY_PREREQUISITE) and nothing replaces it. `rules.settle` asks to be
planned again (`replan`), so a zero credit can become a credit and the other way.

## The ledger stays bounded (slice 2 design; review item 7)

Measured: about 0.5 ms per attempt per reply (the validator, the draft and the replay all walk the domain), 2400 attempts
is 1.2 s a reply and a 3.2 s rebuild, and the 4000 cap failed `LIMITED` inside a payer's own transaction. **Chosen: a guarded
fold of settled attempts into per-form and per-day totals, in the same domain, plus two rules that keep the payer from ever
failing on size.** (Splitting the domain was not chosen: every cap and every mastery reads all of it, so a split moves the same
total across more files and a replay still walks every shard.)

- Only a **credit** counts toward anything (`note`: a 0 counts nothing). So what mastery and the caps need from a settled
  attempt is just its credited use: `progress.sealed = { forms: { "<actor>|<form>": uses }, days: { "<actor>|<skill>|<day>": uses },
  folded }`. The actor's day total is the sum of its skills' day entries. `tallyOf(rows, sealed)` adds them to the live counts,
  so every number derived from the ledger reads the same before and after a fold.
- **The fold** is part of `rules.settle` (no new command): when the ledger holds more than `FOLD_AT` (300) attempts, the
  settlement also folds every attempt that has a credit (existing or just planned) and whose boundary reply is not the one
  settling now: the attempt and its credit rows go, the sealed counts grow. The fold writes new totals (base + n), so the guard inputs carry the ids, the counts **and the totals they were added to**
  (`foldInputs`): a fold planned on other totals (an earlier fold was taken back) is off and planned again. (Chosen over one
  record per settlement, which would grow with every settlement and need a sum on every read.)
  When a reply that held a folded attempt is deleted or re-read, the settlement's guard no longer matches and the host plans
  the step again in place (`replan`), now without that attempt, so the totals follow the surviving story exactly as the
  rows did. Audit of old zero-credit attempts is the price (they counted nothing).
- **A payer never fails on size.** `recordAttempt` does not store an attempt that cannot earn: the third use of one skill in one
  form by one character on one reply (the per-reply skill cap is 2, and the reasons that zeroed the first two persist), for
  combat and narrative attempts that count on the clock's day. At the hard limit (4000 held, e.g. a clock unset for ever) it
  returns `{ dropped: true }` instead of `LIMITED`. A reply therefore adds at most a few dozen attempts, and the ledger stays
  near `FOLD_AT` plus what waits for a clock.

## Slice 2

**Entry points** (every caller attaches its own guard and claim; the progress side only records):

- `creation.finish { class, checkActor }` and `party.addCompanion { class }` call `startRulesClass` (`progress/start.js`): the
  milestone-0 class in the same transaction, a `class.start` guard. Nothing at all in a chat that pins no rules.
- Narrative use: the capture `! skill-use <actor> | skill: <def> | form: <def>` (and the internal `skill.use`) pays the form's
  cost from the pool, gives a `use` proof and records the attempt, or cites one surviving `use` proof (`paid`), never both.
- Combat end: `recordCombatUses(ctx, { fight, uses })`: a no-op in a chat with no pin and a skipped row for anything that cannot be
  an attempt, so a fight's end never fails on its ledger. Training completion: the host's step below.

**Commands and queries** (payloads as the contract §3 and track C's fixtures): `rules.party`, `rules.flags`, `rules.item`,
`rules.training`; `skill.train` (asks), `rules.settle { session }` (the host's step), `party.setActive`, `summon.end`,
`rules.flagSet`, `rules.registerItem`.

**Roster** (`progress/roster.js`): the PC and two durable companions are active; `party.setActive` is the player's, outside any
fight, 1 to 3 living durable members with the PC among them. Summons and pets are temporary units outside that limit;
`summon.end` ends one (the player may only dismiss).

**Training** (`training/`): `skill.train` only asks; the id of the session is the next one for that character, trainer, skill and
form (a function of the chat, never allocated by a query; a stale one is `STALE`). The host's `afterCapture` asks for
`rules.settle { session }` once the clock, the place and the purse can be read. The step rolls the 10% event die once (`ctx.roll`,
recorded), checks the trainer is here and the purse can pay, pays the fee (`wallet.pay`), moves the clock by exactly sixty
minutes (`director.advance`, rejected whole if it moved otherwise), and either interrupts (the fee and the time are spent, no
credit, no refund) or records two completion attempts that count on the day the session ended. A session the host cannot start
is refused with its reason and costs nothing. A request the host cannot start (the clock never set) would hold that character's
asks for good, so the player may withdraw it with `skill.cancelTrain { actor, session }` (**not in the contract's command list**:
the lead adds it or names another way; it keeps the session as `refused`, moves no coin and no time, and is guarded like a
request). A session keeps what it earned (`awarded`, `unearned`) so its view survives the fold.

**Flags** (`rules/flags.js`): a flag is declared by the keys the pinned requirements name; it is false until an authorized event
sets it. `rules.flagSet` takes a surviving Story Director `event` proof whose payload is exactly `{ flag, value }`, from Story
Director's adapter or this module's own step only, claims the evidence once and guards the block; a deleted proof turns the write
off. The adapter that gives the proof and asks in one block is trusted by the replay through `recorded.own`.

**Items** (`rules/items.js`, `rules/bounds.js`): `rules.item` reads the pin (a pack item's rule) or what was registered.
`rules.registerItem` is the single route for generated items (Story Block's own grant, and this module's craft, trade and loot
adapters): it recomputes the bounds from Story Director's tier for where the party is, rejects (never clamps) what is over,
registers the definition with Story Block in the same transaction and stores the def, the rule and the provenance. The bounds are
v1's numbers frozen (`bounds.js`), by the place's tier: rarity ceiling common/uncommon/rare/epic at tiers 0-1/2-3/4-6/7-9, level
ceiling `min(99, 10 * (tier + 1))`, stat budget `rarityBudget` at that level, effects at the story's own ceilings, never
legendary, at most 1000 item rules. The pack's frozen ItemDefs are registered by `registerPackDefs(ctx)` (activation calls it
inside its transaction).

**Level and XP from the pin** (`progress/level.js` `pinnedSettings`): a pinned ruleset's `xpPerLevel`, level cap, starting points,
points per level and stat cap override the reader's, in the party's commands, its capture, its prompt line and its combat numbers,
and in the creation wizard's budget. Hook lines outside this part: `party/sheets.js` (`rulesFrom(settings, rules)`,
`rulesSliceOf`), `party/commands.js`, `party/capture.js`, `party/context.js`, `party/queries.js`, `creation/build.js`
(`creationRules(settings, rules)`), `creation/commands.js` (three call sites).

## Slice 3: combat on rules v2 (B4)

**Rule: a chat that pins no ruleset fights the fight it always did.** Everything below runs only when `pinnedOf(ctx)` finds a pin
(`src/v2/fight/index.js`); otherwise the engine, the setup, the stored actions, the end settlement and the v1 mastery path are v1's, byte for
byte. `tests/v2/fight/golden.json` holds traces of fixed v1 fights (one rng stream, ids, summaries) from the engine as it was before
this slice, and `engine-unchanged.test.js` plays them again; `pinned.test.js` plays an unpinned chat through the real combat part.

- **Actions come from the pinned skills and forms** (`fight/forms.js`, `fight/interpret.js`): a fighter's three skills are those of its
  class at their current forms (`derive` through `fightSkills`), with the mastery the credited uses give and the stat cap of the pin. An
  action is `{ type: 'form', form, selections: [{ effect, targets }] }`; each effect has its own side and scope (hostile damage and
  conditions, friendly heal, shield, regen and guard), a choice of one target must name a legal one, and every refusal comes before
  anything is paid or rolled. The power is the pack's hundredths with the mastery factor `1 + 0.1 x mastery` applied once; the cost
  (mp, sp) is paid once, the cooldown set once (in the actor's turns), the use counted once under the form's id. The automatic turns (foes,
  companions on auto) use the engine's own AI on the same forms, one target standing for every effect that needs one.
- **Draws belong to actions** (`setup.draws === 'action'`): each action's dice come from its own stream seeded `<seed>|<action id>`, so
  taking back one action never changes the dice of the ones before it. Action ids (`ca_xxxxxxxx`) come from the receipt's seed, the same
  on every replay. The fight is the replay of its stored actions (`combat/stored.js`), as before.
- **Closed records** (`fight/records.js`): `ActionRecord` and `ConditionRecord { kind, stacks, rounds, strength, at, source }`. Durations are
  the contract's units: rounds are actor turns inside the fight, ten story minutes each after it; a condition a fight leaves on a character
  is dated by the fight's `endingMinute`, so a read at `endingMinute + 10` has one round less. Stat shifts are fight-only conditions
  (`fight/shifts.js`); summoned units (`summon.begin`/`summon.settle`, `progress/roster.js`) join the party's side with the caster's shares,
  act on auto, are never party members and never keep a wipe from counting.
- **combat.start** carries a replay guard (`combat.start { fight, offer, party }`, `fight/guards.js` `buildStart`): the offer is still there and
  each fighter holds the forms, at the mastery, the fight was begun with, recomputed with `fightForms` from the state before the block. Take
  back the promotion or the narrative use that gave a form or a mastery and the start goes off, and the acts and the end stand on a fight
  that is not there, so they go with it.
- **combat.act** carries a replay guard (`combat.act`, `fight/guards.js`): the prefix of actions it stands on. Take back an action and the
  ones after it go off with it (`REPLAY_PREREQUISITE`), nothing is put in their place.
- **combat.end** (`settleEnd`, first in the end settlement) carries the guard that binds the fight's terminal prefix, ends the fight's units,
  pays the uses through `recordCombatUses` (attempts of kind `combat`, key `<fight>:<actor>:<skill>:<n>`, credited by the next
  `rules.settle` under the shared caps), claims and pays XP through the single `party.grantXp { actor, amount, claim }` combat variant (claim
  `xp:combat:<fight>:<member>`), and seals the result. The v1 mastery path is off for a pinned fight (`uses: {}`), and track A's quest hooks
  are not touched here: a quest's own XP and coin are its own, and a fight's loot money and XP are paid once, here. (Track A retires the old
  hooks; `src/v2/quests/` and `combat/quest.js` are not edited.)
- **Sealed BatchResult** (`fight/batch.js`, `progress.batches[br_xxxxxxxx] = { hash, bytes, seq }`, the newest 8): plain JSON built only from
  what the fight recorded, `hash = hashJson(bytes)` (the contract's Hash). `resolveBatch({ id, state }) -> { id, hash, bytes } | null` is the
  function Story Block's `batchResults.resolve` calls; it returns null for a missing id or bytes that do not hash to their hash. Once
  sealed under an id the bytes never change (a rebuild, a reload and a second fight leave them). The receipt and `combat.last` carry
  `batch: { id, hash }`. Wiring `batchResults` on the module definition is lead-owned (`module.js`) and is not done here.
- **Loot never fails the end.** `registrable(env, offered)` (`rules/items.js`) is the one question `rules.registerItem`, its replay guard and a
  fight's loot all ask: shape, a generated prefix, a rule that fits (equipment states its own), the template, the bounds (the value ceiling is
  read in the chat's coin: `valueCeiling(rarity, level, scale)`, the scale riding in the area snapshot), an id never redefined, and the
  1000-rule closure. `lootProblem(ctx, def)` runs it on the def as Story Block's `item.define` hook prices it (`defineItem` with
  `{ note: '', owner: 'party', scale }`), so what it holds is exactly what a registration would refuse. A held drop is left behind with
  `reason: 'held'` and a `cause` (`equipment`, `no-tier`, `rules`); weight keeps v1's sentence ("Left behind, too heavy to carry") and a held
  drop has its own ("Couldn't be kept here", with "set the area's danger to keep loot like this" when no tier is known: Story Director dormant or no
  policy for the place). `loot.left` rows are additive (`reason`, `cause`, pinned chats only). The end's guard also carries the area
  (`{ place, tier, scale }`), so taking back the reply that set the place takes the registered loot with it.
- **Summoned units earn nothing**: their use is not counted by the engine (`performForm`) and the settlement keeps only `session.setup.party`
  actors in the uses and the batch. The foes' XP follows the pin: `pinnedSetup` stores `xpBase = xpPerLevel` (exponent 0) and `fightRules`
  honours a setup's `xpBase`; a v1 setup has none.
- **A fight is pinned or not by its session** (`setup.draws === 'action'`), not by the chat's pin of the moment: `end` and `settleEnd` key on it, so a
  fight begun before the pin settles as v1 would (uses by the v1 path, XP without a claim). A v1 action never keeps an `id`, `form` or
  `selections` a caller sent, and a `form` action is refused.
- **Carried strengths** (`progress.carried[actor] = [{ kind, rounds, strength }]`): every end replaces the entry of each member of the fight
  (from the sealed record, whose strength is the combatant's, since v1's summary keeps names and rounds only). The next fight reads a
  regeneration's strength from it; one the story gave acts as the engine's damage-over-time default (a share of maximum HP), never as nothing.
- **summon.begin** takes `standing` (how many units of the fight stand now, this one included: the fight knows who is down; seven is refused)
  and keeps the record bounded at 24 by age (`born`), ended first, then ones that left their fight, then the oldest called.
- **progress.batches** are never written over (`storeBatch`: a taken id is a `CONFLICT`); the newest 8 results of fights are kept and a result of
  another kind (B6's death and return) is exempt from that pruning.

**Hook lines outside this part** (a pinned fight needs them; each is a one-liner or a guarded branch, all but the engine's behind `pinnedOf`):

- `src/combat.js` (+40/-5): `formHooks` export (plan, perform, describe, shifts), `'stat-shift'` in `FIGHT_ONLY`, `skill.costs` in `blockReason`,
  `formHooks.shifts` at the start and end of a turn, `type: 'form'` and skills with `parts` in `resolve`/`perform`, `form` in
  `availableActions`, the per-action stream in `actInPlace` (`f.drawsBy === 'action'`), `drawsBy` in `startFight`, `joinFight` and `ENGINE`,
  summoned units outside the wipe check and `summarize`.
- `src/v2/combat/index.js` (+45/-16): imports; `form` action fields; `built`/`pinnedSetup` and `beginUnits` in `start`; `actionWithId`,
  `guardAction` and `beginUnits` in the play path; `settleEnd` first in `end`; `uses: {}` and the XP `claim` for a pinned fight; `sealed.batch`
  on the last result and the receipt; `lootProblem` and the held rows in `grantLoot` (and the sentence for them in `end`), `guardStart` in `start`, `actionWithId` stripping v1 actions, the session (not the pin) deciding the v1 or pinned settlement; the pin's slice into `cardContext`.
- `src/v2/combat/setup.js` (+6): the pinned skills and `restoreStrengths` in `partyCombatants`.
- `src/v2/combat/stored.js` (+3/-1): `fightRules` honours a setup's `xpBase` (a pinned fight's XP per level).
- In the parts of this module: `progress/guard.js` (kinds `combat.act`, `combat.end`), `progress/assess.js` (dispatch), `progress/domain.js`
  (`batches`, `unitProblem` exported), `progress/roster.js` (`summon.begin`, `summon.settle`), `rules/commands.js` (`attachIfFree`, because
  the loot grant inside `combat.end` registers items under the end's own guard).

**Additions for the contract** (the lead folds them in): `summon.begin { actor, owner, kind, template, fight, name, level, standing, hp, mp, sp }` and
`summon.settle { fight, units: [{ actor, reason: null | 'downed' | 'expired' }] }` (both the combat part's own steps, refused for anyone else);
`br_xxxxxxxx` ids for sealed results and `ca_xxxxxxxx` for actions; `combat.act` with `{ type: 'form', form, selections: [{ effect, targets }] }`
(effects 0-3, four selections at most, the id made by the host); the `combat.session` projection `actions.skills[].form` (`describeForm`:
`{ id, skill, effects: [{ index, op, side, scope, choose, legal: [combatant ids] }] }`, next to the v1 fields name, usable, reason and target); the guard kinds `combat.start`, `combat.act`,
`combat.end`; `progress.carried`; `skill.cancelTrain` (slice 2).

**Gaps and differences (written down, not decided):**

- Death, return and wipe batches (B6) are not here (they wait for the timeline's merge). `BatchResult` v1 is the fight's own kind. Story Director
  checks and danger are slice 4 (below).
- `batchResults.resolve` is wired by the lead at integration, one resolver for fight and death batches; until then nothing in Story Block reads
  `progress.batches`.
- `lootProblem` mirrors Story Block's hook call (`{ note: '', owner: 'party', scale }`, level 1); if Story Block's call changes, so must it.

## Differences from the contract and track C's fixtures, and gaps (written down, not decided)

- `rules.item` answers an `ItemRule` (the contract); C's fixture adds `frozen: true`, which the screens do not need.
- C08: the party part allows three companions by default, so a test party has one reserve, not two.
- **No flag or generation-template schema exists in the pack checker.** Flags are therefore the keys the pinned requirements name,
  and a generated item's source template is any pinned recipe (craft/), shop (trade/) or, for story items, nothing or any pinned
  recipe, shop, foe, quest or item. The shape of the event payload (`{ flag, value }`) is this module's reading; Story Director
  has not frozen one. D/E3 own the schemas.
- Story Block's grant passes `rule: null`: a rule is made only for an item that is not equipment (no slots, no hands, weight 0).
  **Equipment from a story line is refused** until track A's slot routing says how the five legacy slots map to the eight rule
  slots (`allowedSlots`, `hands`); a name is never read for one.
- No ceiling or floor for an item's `value`, and no per-template budget (P25 asks for template-derived ceilings; the pack schema
  has no template to derive from). The tier budget stands in for them.
- In a chat with no ruleset, `rules.registerItem` passes Story Block's own grant through to `inventory.registerDefinition`
  unchecked (a sub-command that fails would fail the whole grant, so there is no "not here" to answer). Left as the lead decided,
  with a TODO: once registration gating makes a handler `FEATURE_OFF` in a non-v2 chat this becomes a refusal.
- Story equipment stays refused until a later slice imports track A's `slotsForLegacy` (`src/v2/items/slots.js`, #142): imported,
  never copied. Flags and generation templates keep the interim rules above until D adds the schema; Story Director freezes `{ flag, value }`.
- A character's pinned rules are read through one helper (`rulesSliceOf`) at every site (screens, party queries and recovery, combat cards,
  creation); the item effect ceilings are held equal to the story's by a drift test (`tests/v2/rules/items.test.js`).
- The full resolved pin rides in every checkpoint (583 KB for a big pack); B3/E6 will store `resolved` once, keyed by `rulesHash`.
- Story Block must expose `resolved`, `rulesHash`, `packHash` and `RULES_V2_PROGRESSION` to the activation: `packs.rules` returns
  only the manifest today. That is an E/D task before activation.
- Slice 4 and later: death and return.

## Slice 4: the RB side of Story Director's checks and danger

- **`rules.modifier { actor, stat, skill? } -> { actor, stat, amount, parts: [{ source, ref, reason, amount }] }`** (contract §3 P09): the modifier a check
  adds for a character, with its parts (sources `stat`, `skill`, `talent`, `item`, `effect`, `encumbrance`; `ref` is null today: the parts name
  their cause in `reason`). It reads the same parts `checks/modifiers.js` reads, so the check table and Story Director's `checks.roll` agree. An unknown
  actor or stat answers null. *If the lead retires the `checks` part, `modifiers.js` moves with this query.*
- **`checks.link` at creation** (`progress/start.js`, `linkChecks`): in a rules chat, the new player character is linked in the creation's own transaction to a
  Story Director check actor: the `checkActor` the caller named, else Story Director's default (`checks.policy`), else a new actor named like the
  character and made the default (`checks.actor`, then `checks.link`, each with its own `write` and the hash it just got). Story Director's refusal
  (an actor with another living character: `CONFLICT`) fails the creation whole. No Story Director checks (no `checks.policy`, or it throws): nothing is
  linked and nothing fails.
- **`foeToEngine`** (`fight/foes.js`, private): a pack's foe becomes an engine enemy for the area (`world.areaTier`'s answer). The area must have a tier; the foe's level
  may not pass `min(99, 10 x (tier + 1))`; `allowedFoes` (when it lists any) must name it and `allowedTags` (when it lists any) every one of its lore tags; its
  skills must be skills of the ruleset (their frozen base forms) and its loot items with complete definitions. Pools, attack, defence and crit are the player's formulas with no gear
  (`combatantFromSheet`); XP stays the engine's `foeXpWorth`; loot rows keep the pack's chance and quantity. In a pinned fight (`pinnedSetup`) an offered foe whose name
  is a pinned foe's is made this way **only where Story Director gives the place a tier and the area lets the foe in**; every other foe is the v1 projection it was
  (a fight never fails to start for want of the adapter). `areaPolicyNow` is `areaNow` with the two lists; `areaNow` itself, and so the `area` a generated item records,
  is unchanged. The index gains `foe(ref)` and `foeNamed(name)`.
- **Item and loot tiers** were already read from `world.areaTier` (`areaNow`); nothing changed there.

**Gaps and differences (written down, not decided):**

- **No element resistances.** The pack has no field for them (a foe has stats, skills, loot and lore tags; an element is only on a skill's damage effect), so there is nothing to
  wire; nothing is invented.
- **An empty `allowedFoes` or `allowedTags` means "no restriction".** The contract says only that an unknown place has empty lists; a place with a tier and a policy that names
  no foes is read as one that names none to forbid. Confirm or say otherwise.
- **No foe-stat budget beyond the schema.** P05/P06 ask for foe-stat budgets; none are published. The pack's schema (stats 1 to 99, level 1 to 99) and the level ceiling are all that bound a foe.
  The foe's own `tier` is carried by the pack and not compared with the area's.
- The foe fights with the engine's morale and flee threshold (`rules.enemy`) and carries no coin; the pack says neither. A foe that flees pays no XP or loot, as before.
- A loot row is granted by name as before (`lootTarget`); `rollLoot` (v1) drops the row's `def` ref, so the ref is not what the grant uses.
- An offered foe is matched to the pack's by name, case aside; the pack's foe replaces the offer's tier, level and role (it is fought as written).
- `world.areaTier` is read as the contract's `AreaTier`; Story Director's own tests cover its side.

## Code that production does not reach yet

`pinRules` and `registerPackDefs` (activation), and the parts themselves (`rulesParts`, not registered by `module.js`). Everything
else above is reached through the commands and queries once the parts are registered.
