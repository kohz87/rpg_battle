# RPG quests

The retained quest command names and the progress/details/ranks/owed projections are
registered by RB. `director.retriable` and `quest.board` belong to the same part.
SD is the only thread writer. Acceptance and linking install the extension on that
thread; RB has no quest domain or second quest ID. Legacy quests and owed text remain
read-only. Unpinned legacy chats do not activate the new rank/budget projection.

`planQuestSettlement` is the quest planner; `planSettlement` belongs to progression.
Terminal extension construction covers failed, expired and abandoned outcomes with
zero payout, and anchors repeat cooldowns to the terminal story minute. Chain offer
planning selects the next template only after done. Settlement dispatch will bind the
single guarded transaction in the next step; it currently fails closed when absent.

Frozen quest templates use the checker's `resolved.quests` table. Requirements and
non-collect objective proofs require the shared B3 validators; there is no text-only
completion fallback. No definition or reward is reconstructed from an installed pack.

The command fixtures use real SB/SD/RB definitions with the explicit D1 cursor/epoch
shim and frozen-rule projections. Removing only the accept/link call makes both
retained selector tests fail; the call was restored. The full suite identified an
old rank-budget activation on unpinned chats; the projection gate and its affected
item/trade/combat fixtures were then verified.
