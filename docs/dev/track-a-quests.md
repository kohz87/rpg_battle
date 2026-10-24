# RPG quests

The retained quest command names and the progress/details/ranks/owed projections are
registered by RB. `director.retriable` and `quest.board` belong to the same part.
SD is the only thread writer. Acceptance and linking install the extension on that
thread; RB has no quest domain or second quest ID. Legacy quests and owed text remain
read-only. Unpinned legacy chats do not activate the new rank/budget projection.

`planQuestSettlement` is the quest planner; `planSettlement` belongs to progression.
Terminal extension construction covers failed, expired and abandoned outcomes with
zero payout, and anchors repeat cooldowns to the terminal story minute. Chain offer
planning selects the next template only after done. Settlement dispatch binds one guarded root transaction for SD extension/closure/journal,
SB consumption/wallet/stacks, one nonzero XP grant and fresh repeat/chain offers.

Frozen quest templates use the checker's `resolved.quests` table. Requirements and
non-collect objective proofs require the shared B3 validators; there is no text-only
completion fallback. No definition or reward is reconstructed from an installed pack.

The command fixtures use real SB/SD/RB definitions with the explicit D1 cursor/epoch
shim and frozen-rule projections. Removing only the accept/link call makes both
retained selector tests fail; the call was restored. The full suite identified an
old rank-budget activation on unpinned chats; the projection gate and its affected
item/trade/combat fixtures were then verified.

The B5 envelope comes only from progress.buildGuard. Its public export is on track B at
3f27e5650e70ae5cf0130743d13642f4e92fdc5e and is not on main. Integration must merge it;
production fails closed when absent. Tests load that exact helper in a temporary archive,
with no duplicate helper in this tree. D1 cursor()/epoch likewise use only the host seam.
The host owns active epoch comparison (E6); the quest hook checks pinned rules, the expected
thread/writer hash, original acceptance, objective proof bytes, inputs and planned result.

The permitted party/commands.js retirement clears raw-result XP before applyResult;
combat's explicit XP grant and the retained grantXp payload variants stay intact.
No other party or combat engine file was edited for this step.

Verification: 1,748 tests, 1,741 passed, zero failures, one skipped, six TODOs; syntax and
whitespace checks passed. Guard removal alone fails the swipe/delete replay fixtures;
raw XP restoration alone fails the duplicate-award fixture. Reopening the chat follows
each swipe/delete/Re-read mutation in the settlement fixtures.
