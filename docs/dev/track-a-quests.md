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
