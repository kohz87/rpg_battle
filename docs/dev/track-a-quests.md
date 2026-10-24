# RPG quests

RB registers quest.take/abandon/finish/payOwed and the retained progress/details/ranks/owed,
quest.board and director.retriable adapters. SD alone writes the thread and its rpg extension.
There is no second quest domain or ID. Historical quest/owed data is read-only and unpaid.

planQuestSettlement is distinct from B's planSettlement. The dispatcher uses B's sole
buildGuard envelope, attaches ctx.replayGuard, and lets SD close acquire the root's exact
`rb:<epoch>:quest:<thread>:<instance>:settled` claim. SD extension/closure/journal, exact
consumption, SB wallet/stacks, one nonzero XP grant and fresh follow-up offers commit together.
Any failure rolls back the whole root. Zero XP omits grantXp. Legacy difficulty and combat
amount selectors remain supported by party.grantXp; raw-result applyResult XP is retired.

Turn-in rechecks active acceptance, objectives and owner prerequisites; deadline equality
expires first. Failed/expired/abandoned outcomes pay zero. Repeat cooldown starts at terminal
story minute; repeat and chain offers get fresh th_ IDs, remain unaccepted and keep old IDs
queryable. A chain follows only done. Existing story credit reduces only remaining coin.

Reader capture obtains SD acceptance proof and forwards it through real quest.take to atomic
threads.accept. Accepted neutral threads use threads.link and retain the original proof/cursor.
Neutral SD annotations preserve the extension; terminal SD lines route through RB capture.
Narration cannot synthesize reader consent or objective completion.

The runtime/replay/C15 fixtures cover selectors and aliases, root claims, zero XP, rollback,
repeat/chain/cooldown, forged callers, legacy reloads and proof-backed acceptance. Reopening
follows every swipe/delete/Re-read mutation; removing story acceptance through Re-read also
removes the later payment. Integration gates and latest counts are in track-a.md.

Re-read may renumber acceptance transport ordinals/revisions. Guard comparison excludes
those counters while retaining the exact writer hash and original stamps in recorded inputs.
It still revalidates the acceptance's Source/cursor binding, active proof ID and payload bytes,
objectives and payout. Unchanged acceptance Re-read keeps one payment; changed proof words
or removed acceptance retracts it. The regression fails when only this normalization is removed.
