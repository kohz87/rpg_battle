# RPG quest seams

Quest data lives only at director.threads[id].rpg. SD owns its five writers and retry ledger;
RB computes mechanics. Legacy quest/owed records remain readable and unpaid.

A settlement binds semantic thread, acceptance proof ID/bytes, objective evidence, exact
consumed stack/quantity pairs, typed payout and follow-up offers. Clock minute is retained only
for deadline/cooldown; place/giver inputs only for templates requiring them. E1 reads one
RB-owned state-only projection plus story.evidence. Guard epoch must match state.savepoints
(or B's genesis epoch before savepoints exist). Ordinary replay performs no writes or rolls.

SD questWrite/close/journal, SB consumption/rewards, one nonzero party.grantXp and the exact
rb:<epoch>:quest:<thread>:<instance>:settled claim commit together. Missing proof, cost or
owner validation holds the whole transaction. Deadline equality expires before objective checks.
Follow-up offers have fresh IDs; zero XP omits its grant.

Story turn-in capture records a guarded host intent claim, not another quest ledger. Narrated coin (`+ coin N`) always goes
to the wallet at once, as with no quest; nothing is held, reserved or claimed at narration. While exactly one active quest
instance can hold the amount (its remaining reward), RB's afterCapture publishes a `story` proof `{ type: 'quest.coin', thread,
instance, reply, coin, limit }` whose parent is that quest's acceptance proof (`quest.attributeCoin`; guard kind `quest.coinNote`).
When the quest settles `done`, the payout coin is reward minus the surviving amounts attributed to that instance (capped at the
reward), and the settlement guard binds those proofs by id and bytes: deleting or editing a narration, or swiping the acceptance,
replays to a different payout and nothing pays twice. Abandon, fail and expiry pay nothing extra and take nothing away. A UI finish
and a system turn-in read the same proofs. Narrated coin that equals the remaining reward but has no unique attribution (two
candidates) refuses the settlement (CREDIT_UNBOUND) instead of guessing.
A Continue repeating a reward the reply's own settlement already paid is the one correction that touches the wallet: it takes back
that duplicate (`quest.coin.repeat`, claim `rb:<epoch>:quest-coin-repeat:<reply>:<limit>`), and its guard needs that settlement
to survive. The settlement itself is never paid again. Money storage and mutations remain SB-owned.
Removing the intent line on Re-read removes its claim and prevents automatic turn-in.

Unrelated prefix replies do not invalidate payouts. Removing a consumed-item carrier or
acceptance proof retracts wallet/XP/closure/journal/claim together. Unchanged acceptance
Re-read ignores transport renumbering while retaining proof identity and bytes.

## Objective proofs (B3)

`quest.objective { id|key, objective, fight? | proof? }` turns one validated action into one RPG Battle proof of one objective
(`quests/proofs.js` closes the payloads, `quests/objectives.js` plans, publishes and guards). The proof's parent is the reader's
acceptance proof, so taking the acceptance back hides it. Payloads bind thread, instance, objective, kind and acceptance, then:
kill the foe, the fight, the sealed result `{id, hash}` and how many fell; story the objective text and the hash of the captured
`~ quest Name | met: yes` line; visit the canonical place and the scene name (a visit rides in a `story` proof because Story Director owns
the `visit` kind and publishes none yet). Claims: `rb:<epoch>:objective:<thread>:<instance>:<objective>` (story, visit),
`rb:<epoch>:objective:fight:<batch>:<foe>` (a sealed victory pays one objective per foe) and `rb:<epoch>:objective:proof:<proof>`.
Code, never a button, asks for kills and visits (the reply's afterCapture and the next generation's beforeGenerate); a story line
asks for story objectives. The guard kind `quest.objective` reads the state it is given (threads, combat.beaten, progress.batches,
the clock, the scene), `story.evidence` for the acceptance and a cited proof, and the place and line it recorded; it declares no query.
The planner counts a row only when `validateObjectiveProof` accepts the proof, the settlement guard hashes those proofs, so a
deleted parent turns the evidence row, the payout and their claims off together.

## Stage 5: open templates and variant hunts

`quest.open({id,template,text,foe?,place?,item?})` is the reader action behind “Make this a quest”.
It requires an existing neutral active SD goal and an explicit open template ID or slug.
`quest.openTemplates({})` lists only pinned open templates as `{id,name,kinds}[]` for the form.
The narrator uses `+ quest Name | like: <slug> | text: <objective text>` with explicit targets.
Extra labels (including narrator-supplied rewards) refuse visibly; a refused narrator opening
leaves a plain goal. Linking an offered goal leaves it offered; linking an accepted goal retains
its original acceptance. Closed templates still follow their existing offer/accept path.

Open policy fixes objective kinds, counts, consumption and requirements. Only missing target/text
slots are filled. Each target must resolve explicitly to one real place, item or allowed foe.
A variant uses its canonical `<base-ref>~<variant-slug>`; a name resolves only to a surviving explicit
variant declaration. No fuzzy matching or inferred template selection occurs. The numeric reward
is `min + floor((max-min)*areaTier/9)` for both coin and XP. The opening guard records the canonical
area and external identities; the same projection of surviving requirements is checked on replay.
It asks only `quest.replayInputs` and `story.evidence`, never live atlas/settings/economy queries.

`! encounter Variant name | like: <pack foe slug>` explicitly declares one literal variant name.
It copies frozen skills, loot and tags. Its level is `base.level + 10*(area.tier-base.tier)`; each
stat is `ceil(base.stat * foeStatBudget(level)/foeStatBudget(base.level))`. Invalid levels, per-stat
bounds, summed budgets and area allowlists refuse; nothing is clamped or redistributed. Area and
binding travel with the offer and setup. Sealed results keep `<base-ref>~<variant-slug>`, never a
name-derived kill credit. A hunt matches its exact canonical ref, or a base with `allowVariants:true`.
The existing per-fight kill claim is shared across the base family so an exact and base hunt cannot
spend the same result twice. Existing encounter behavior without a variant binding is retained.

New settlements retain proofs sorted by ID. Replay respects older saved proof order, so Re-read
cannot change an earned reward merely by changing evidence iteration order. Settlement, retraction
causes, narrated-coin attribution, repeat-coin dedupe and terminal claims use the existing machinery.
Open templates have null repeat/chain; a fresh open offer needs fresh explicit binding evidence.

## Stage 8: generative offers (2.3.0)

Design and tests: `docs/v2/GENERATIVE_OFFERS_SPEC.md`. In a chat pinned to a pack with an open quest template the narrator offers a job or a
teacher in its own words; the feature is `rpg-battle.generative-offers` (F100, default on, strict mode when off: every path is 2.2.0's).

**One decision, made once.** `matchOffer(env, line)` (`quests/offer-match.js`, pure) reads the line (`offer-words.js`: types, verbs, difficulties, durations)
and settles template, rank, count, foe/item/place, coin, XP, deadline, giver and turn-in place inside the template's bounds (`offer-rules.js`;
`offer-bands.js`: the three bands, the note wording, the terms and far-out lines). `env` is everything it reads from the world, read once by
`offer-capture.js` (`captureOffer`) at capture; nothing here is asked again. `matchTrainer` (`training/offer.js`) does the same for a teacher.
A free-form `+ quest` line that is not an old-style open or closed form routes here (`quests/capture.js`, `OFFER_LABELS`).

**Recorded and replayed.** The settled binding is stored as the key `offer.<th_id>` of the `rules` slice (`{ v, matcher, line, sid, name, said, settled, band, notes, where, shown }`),
a far-out decision as `declined.<dk_id>`, a teacher's in `training.offers/<tn_id>.settled` (`offersOf`/`declinedOf` in `rules/offers.js` read them as maps; each is one add-only key whose parent always exists, so a chat pinned before 2.3.0 has no map for the first offer's reply to make and take away); the writer is the trusted command `rules.recordOffer`
(`rules/offers.js` validates every field). The guards are `quest.offer` (`offer-plan.js`: `planOffer` re-checks the settled numbers against the template, then
calls the unchanged `planOpening`) and `trainer.offer` (wraps the unchanged `planTrainer`). `replayOffer` imports neither `offer-match.js` nor `parse.js`, asks only
`quest.replayInputs` and `story.evidence`, and never re-decides, so a table change (`MATCHER`) cannot move an offer already made; a Re-read of an unchanged line reuses
its stored `settled`. `planOpening`, `replayOpening`, `planTrainer` and `replayTrainer` are byte-unchanged (2.2.0 chats replay through them).

**What the narrator and the reader see.** `offer-block.js` makes the rules block and grading guide from the pin (the installed pack's own ranks and foe order when present);
it is a `context.parts` piece of the quests part under the feature (`quest.offerBlock`), non-empty only for a pin with an open quest template, so every other prompt is
unchanged. While it shows, the quest tail leaves out the slug list and the trainer grammar is `FREE_FORM_GRAMMAR` (`training/capture.js`). The settled terms and far-out lines are
receipts' `narrate` summaries; the tail counts those past the caps from the stored receipts (`quest.replyOffers`). `offer-card.js` is `hooks.replyCard`; `offer-log.js` is
`quest.adjustments`, drawn at the end of the Quests screen. Settings are in `offer-settings.js`.

**Tests.** `tests/v2/quests/offer-*.test.js` (corpus of 50 messy lines, golden cases, per-step matcher tests, real-host replay, fuzz, prompt and size tests),
`tests/v2/training/offer-trainer.test.js`, `tests/v2/integration/offer-smoke.test.js`. Legacy fixtures recorded with 2.2.0: `fixtures/pinned-2.2.0.json` (a Bluewatch chat) and
`fixtures/prompt-2.2.0.json` (the prompts of an unpinned and a template-less chat); do not record them again to fix a failing test. Bluewatch 1.7.0 is stood in for by pins derived from
1.6.0 with explicit bounds, aliases and offer words (`helpers/offer-env.js` `derivedPin`).
