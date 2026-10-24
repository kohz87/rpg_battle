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

Story turn-in capture records a guarded host intent claim, not another quest ledger. RB's
afterCapture settles after SB has tallied all coin lines. Exact matching story coin reduces
that reward before payout and acquires the existing storycoin:<reply> claim atomically.
A Continue repeating an already-paid reward uses a guarded duplicate-coin correction; it
never grants another settlement or XP award. Money storage and mutations remain SB-owned.
Removing the intent line on Re-read removes its claim and prevents automatic turn-in.

Unrelated prefix replies do not invalidate payouts. Removing a consumed-item carrier or
acceptance proof retracts wallet/XP/closure/journal/claim together. Unchanged acceptance
Re-read ignores transport renumbering while retaining proof identity and bytes.
