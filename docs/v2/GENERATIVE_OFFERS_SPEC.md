# Generative offers: implementation spec

Status: **approved** (27 Oct; the decisions at the end take precedence). RPG Battle 2.3.0 (RB) builds the core below, with a minimal Story Block 2.5.0 (SB) schema change
shipped beside it. Story Director (SD), Story Studio and NPC State Delta (NSD) get no code change. Everything said here about
today's behaviour was checked against these commits (fresh clones, 27 Oct):

| Repo | Commit | Version |
|---|---|---|
| kohz87/rpg_battle | main `13a61a4` | 2.2.0 |
| kohz87/Story_block | main `c0e3ea8` | 2.4.0 (Ersveil: Bluewatch Starter 1.6.0) |
| kohz87/Story_director | main `6cebe98` | 2.1.0 |
| kohz87/Story_studio | main `9a528c3` | 0.1.0 |
| kohz87/npc_state_delta | main `80a4532` (read only) | 1.3.0 |

The core's only new UI is the Adjustments log on RB's Quests page:
[mockups/generative-offers/adjustments-desktop.html](mockups/generative-offers/adjustments-desktop.html) (1280 px) and
[mockups/generative-offers/adjustments-phone.html](mockups/generative-offers/adjustments-phone.html) (390 px); sizes in §9.4.

## 1. The core

**Principle.** The narrator writes freely; code turns it into structured play without changing the story's choices, and keeps
the numbers honest.

| The narrator owns, always kept | Code owns, inside the pack's bounds |
|---|---|
| the offer's name, the giver, the goal text, the target as written, what a trainer teaches, the place named | the template (so the objective kind), the rank, the count, the coin, the XP, the deadline, the fee, the foe record |

Code may normalize the **form** of what the narrator owns (resolve "culvert rats" to a foe record, flatten markup, cut to length),
never replace the story's **choice** with another one. A goal code cannot count stays a goal the story judges.

**Five rules.**

1. **Read** (§3). Free-form `+ quest` and `+ trainer` lines are accepted. Natural labels: `type, goal, target, count, reward,
   due, difficulty, giver` (plus `like:` and `fee:`), and an English synonym table; packs can add words.
2. **Shape** (§4, §5). Type and goal give a quest type, the type gives the template kind. Rank comes from the target foe when
   there is one, else from difficulty and the character's rank. Numbers go through RB's money parsing and are clamped to the
   template's bounds. Every decision is recorded at capture; replay never re-decides (§7).
3. **Three bands** (§6). Within bounds: kept as written. Moderately out: adjusted, with a card note. Far out: no offer, no
   trace, and a one-shot narrator line on the next prompt.
4. **Tell back** (§8). The settled terms, and the far-out line, go to the narrator in the next prompt, so story and state agree.
5. **Rules block** (§2). A short, explicit guideline, one example per kind, and a grading guide generated from the pinned pack,
   shown only where the feature applies. Everything else is byte-identical.

**Also core, for integrity:** dedupe against existing quest threads (§5.3); kills settled by RB fights (§5.4); gathering
settled by loot, else a story item (§5.5); a deadline on every job (§5.1); a strict-mode switch (§10); the Adjustments log (§9.4).

Everything else the discussion raised is in Appendix A, one line each, with its decision kept.

## 1.1 Baseline and what the code does today

Node 24 (`npx -y node@24`, v24.22.1), the five clones side by side:

| Suite | Result |
|---|---|
| RB `node --test "tests/*.test.js" "tests/v2/**/*.test.js"` | 2,609 tests: 2,588 pass, 0 fail, 15 skipped, 6 todo |
| SB (adds `examples/fishing/tests/*.test.js`) | 3,782 tests: 3,777 pass, 0 fail, 4 skipped, 1 todo |
| SD | 950 tests: 949 pass, 0 fail, 1 skipped |
| Studio, non-browser tests after `npm ci --ignore-scripts` | 851 tests: 850 pass, 0 fail, 1 skipped |

Verified facts the design rests on:

* **The refusal the user met.** `+ quest Granary Vermin | giver: … | type: cull | …` has no `like:` and no thread of that key, so
  `quests/capture.js:36` asks `templateOf(pin, key)` (a pack quest's id or exact name), finds nothing and fails
  `RULES_MISMATCH` "This offer has no frozen quest template." A `like:` line with any label beyond `like, text, foe, place, item`
  is refused at `capture.js:21`. Bluewatch 1.6.0's closed quest is **Granary Rats** (kill 6 Cellar Rat Swarm); "Granary Vermin"
  is not its name.
* **Where the labels come from.** SD's static prompt (`tracker/note.js` `STATIC_TEXT`) tells the narrator a quest has
  "type, giver, goal, reward, step, due, difficulty". The user's lines follow it exactly.
* **The money word.** Bluewatch's currency is `copper` with coins copper 1, bronze 1, silver 10, gold 100. On it,
  `parseReward({ reward: '12 crowns' })` (`quests/parse.js:295`) answers `amount: null` with `"crowns" is not a coin here`. So
  "12 crowns" is money only when the reader's Coins setting names crowns. The golden cases give both (§11.1).
* **Open quest rewards are a formula, not a roll**: `coinMin + floor((coinMax − coinMin) × tier / 9)` from the recorded area
  danger tier (`quests/opening.js:161`). Every Bluewatch open template's count is 1.
* **The clamp pattern to reuse.** SB `domains/inventory.js:1673-1696` `storyCoin` holds a written amount to what is left
  (`paid = Math.min(amount, left)`), never refuses, and says both numbers in one sentence. RB `quests/ranks.js` `holdReward`,
  `heldText` do the same for unpinned quests. The rank helpers `defaultRank`, `DIFFICULTY_STEPS`, `WRITTEN_RANKS_ABOVE = 0`,
  `rankNamed` are reused as they are.
* **Level, tier and rank.** A place's danger tier caps a foe's level at `levelCeiling(t) = min(99, 10 × (t + 1))`
  (`rules/bounds.js:52`, used by `fight/foes.js` `foeToEngine`). A character's rank is the first ladder row whose `levels` hold
  its level (`defaultRank`; SB's `storyCoinBudget` uses the same lookup). A foe's rank is found **the same way, from its
  `level`**: its pack `tier` field is coarser (the Crag Wolf Matriarch is tier 1 but level 5, rank F) and is not used.
* **Variants and kills.** `foeVariant(base, name, area)` makes `<base>~<slug>`, re-levelled into the area's band; it refuses,
  never clamps. `! encounter N Name | like: <pack foe>` (`fight/index.js` `bindEncounter`) makes the same ref from the same
  name. A kill objective counts a beaten enemy by `matchesFoe` (`fight/foes.js:114`): the exact ref, or, with
  `allowVariants: true` and a base ref, **any variant of that base**; only fights won after the quest was accepted count
  (`quests/objectives.js:36-51`). All Bluewatch open hunts have `allowVariants: true`.
* **Gathering** counts the stacks of the objective's item the party holds at turn-in, consumed if the template says so
  (`quests/planner.js:62-77`), whatever brought them: loot, a shop, or a story `+ item` line, which SB resolves to the pack's def
  by name or alias (`packs/content.js:134`).
* **SD threads.** `director.thread({ key })` resolves any thread by `lineKey` (NFKC, lower case, punctuation folded), done and
  failed ones included (threads are never deleted). SD's closed Quest shape (`tracker/quest-shape.js`) allows `chain.previous`
  only as a def id, and neutral thread fields `giver, goal, place, due, step, progress, desc, …` (`tracker/writers.js:9`).
* **The Assist safety net** (SB `assist/safety.js`) walls `reward:`/`price:`/`pay:` labels, but `+ quest` and `+ trainer` are
  only kept out by the default kind list; a reader who adds `+ quest` there lets the extractor offer jobs. §12 closes it.
* **Story gear, the scope check** (§13): a story weapon with no stat in its note silently becomes a plain item; one with a stat
  is refused (`rules/items.js:149-150`, the whole `+ item` line fails); SB drops `slot:` and `hands:` labels. Deferred, A.10.

## 2. Rule 5: the rules block

### 2.1 When it is shown

A `context.parts` piece of RB's quests part, `feature: 'rpg-battle.generative-offers'`. Its `static()` is non-empty only when
the chat pins rules **and** the pin has at least one open quest template **and** the feature is on. Otherwise it returns `''`,
which SB leaves out (`prompt.js` `staticParts`), so unpinned chats, pins without templates and strict mode keep RB 2.2.0's
static bytes. The pin is frozen, so the block is the same on every reply of a chat. `module.js` passes
`{ settings, query: staticQuery }` to a piece's `static` (an added argument; pieces that ignore it are unchanged).

### 2.2 Exact text

`{…}` are filled by code; the rest is literal. Lines joined by `\n`.

```
Jobs and teachers: write them your way. These labels help code read them; code keeps the numbers inside this world's limits.
Job: + quest Name | giver: who | type: hunt, cull, gather, deliver, explore, escort or task | goal: what to do, with a count | reward: an amount | due: how long, e.g. in 3 days | difficulty: easy, normal or hard. Example: + quest Cellar Trouble | giver: the innkeeper | type: cull | goal: kill 4 rats in the cellar | reward: {reward} | due: in 2 days | difficulty: easy
Teacher: + trainer Name — what they teach | fee: an amount. Example: + trainer Old Soldier — spear and shield drills | fee: {fee}
Every job needs a deadline (due:). Code settles the template, rank, count, reward, XP, deadline and fee and tells you the terms on the next turn; use them from then on. A job offered in this reply can be taken up from {{user}}'s next message (then write + quest Name).
A hunt or cull counts only foes beaten in a fight: ! encounter 4 Foe (the terms name the foe). A gathering counts what the party holds when it is handed in: loot first, else + item as the story gives it.
Job ranks here (a hunt takes its foe's rank; otherwise difficulty and {{user}}'s rank decide):
{grading guide, §2.3}
```

`{reward}` is `money(coinMin)` of the first open kill template in pack order (else the first open template), `{fee}`
`money(fee.coinMin)` of the first open trainer template, both in the chat's currency (RB `money()`); on Bluewatch's own
currency `5 silver` and `4 silver`. The **Teacher** line is left out when the pin has no trainer template. The example names
are code's own, not pack lore.

### 2.3 The grading guide, generated from the pin

```
Rank {id} ({title}, levels {lo}–{hi}, pays {min}–{max}): {kinds}; foes like {A}, {B}, {C}.
```

* **Rows**: the ladder rows that have an open quest template, in ladder order, at most `offerGuideRanks` (setting, default 4).
* **Ladder**: the installed pack's own `ranks` for `pin.identity.packKey` (`packs.content({ kind: 'ranks', pack })`), else one row
  per template rank built from the pin (levels from the templates' `level` requirements, reward from their coin ranges, title
  the id). The row an offer used is recorded with it (§7), so the source never matters on replay.
* `{min}–{max}`: lowest `coinMin` to highest `coinMax` of that rank's templates, written with `rangeText` (`quests/ranks.js`).
* `{kinds}`: from that rank's templates, in this order and wording: `story tasks`, `hunts`, `deliveries`, `journeys`.
* Foes: pack foes whose rank (§1.1) is the row, by level then pack order; the first, middle and last, at most
  `offerGuideExamples` (default 3). Each line is flattened and cut to 200 code points.

Bluewatch 1.6.0 (551 characters):

```
Rank F (Registered, levels 1–10, pays 5 silver–4 gold): story tasks, hunts, deliveries; foes like Cellar Rat Swarm, Crag Wolf Matriarch, Restless Corpse.
Rank E (Journeyman, levels 11–20, pays 8 gold–30 gold): story tasks, hunts, deliveries; foes like Reef Shark, Ash Crawler, Ice Troll.
Rank D (Proven, levels 21–30, pays 30 gold–120 gold): story tasks, hunts, deliveries; foes like Stone Hound, Dungeon Shade, Glass Beetle.
Rank C (Veteran, levels 26–40, pays 120 gold–600 gold): story tasks, hunts, deliveries; foes like Dust Wraith, Tomb Sentinel.
```

### 2.4 The template slug lists: they go

While the block is shown, `questTail`'s `Open quest: … (templates: …)` line (`quests/prompt.js:23`, 450 characters on every
reply of a Bluewatch 1.6.0 chat) is left out, and the `trainer` kind's `grammarFor` returns
`+ trainer Name — what they teach [| teaches: skill, skill] [| fee: amount]. Code picks the lessons, fee and place.` (114
characters instead of 209). `like:` still works as a strong hint and is simply no longer advertised. With the feature off, or
on a pin without templates, both lines are byte for byte as in 2.2.0. Why not shrink the list: the model did not use the slugs,
they cost every reply, and type plus difficulty now pick the template deterministically.

### 2.5 Size (Bluewatch 1.6.0) and settings

| Piece | Where | Size | Cap |
|---|---|---|---|
| Rules block, fixed lines | static | 1,195 characters | fixed text and two amounts |
| Grading guide | static | 551 | `offerGuideRanks` × 201 |
| Trainer grammar | static | −95 (209 → 114) | — |
| `Open quest:` tail line | tail, every reply | −450 | — |
| Settled terms | `[Happened]`, the reply after an offer | up to 320 each | `offerTermsPerReply` lines (default 3), then "…and N more jobs are posted (see the board)." |
| Far-out line | `[Happened]`, once | up to 300 each | 2 per reply, then "…and N more offers were not possible." |

Worst case at the defaults: static **+1,652** characters (1,195 + 1 + 551 − 95; about 413 tokens, cached, unchanged reply to
reply); tail **−450** on an ordinary reply and at most **+1,220** (3 × 320 + 60 + 2 × 300 + 50 − 450) right after a burst of
offers and drops, inside SB's own tail budget (1,500 tokens, `[Happened]` at most half).

Settings (quests part, group "Jobs from the story", all `feature: 'rpg-battle.generative-offers'`): `offerGuideRanks` int 0–8
(default 4; 0 leaves out the guide and its header line), `offerGuideExamples` int 0–4 (3), `offerTermsPerReply` int 1–6 (3).

## 3. Rule 1: read

### 3.1 Which lines

| Line | 2.2.0 | 2.3.0 with the feature on |
|---|---|---|
| `+ quest <pack quest name>` (closed) | `offerQuest` | unchanged |
| `+ quest <name of an existing thread>` with **no** offer label | intent / "Already following" | unchanged (acceptance) |
| `+ quest …` with `like:` | `planOpening`, extra labels refused | the generative path; `like:` is a hint (§4.6) |
| `+ quest <new name>` with or without labels | refused `RULES_MISMATCH` | the generative path |
| `+ quest <existing thread>` **with** offer labels (`type, goal, target, count, reward, due, difficulty`) | intent | §5.3 (dedupe) |
| `+ trainer …` with or without `like:` | `like:` required | the generative path for trainers (§5.6) |

Offer labels are read case-insensitively; `goal` falls back to `text`, then to the line's text after `—`, then to the name.
`target` falls back to `foe`, then `item`. `due` also answers to `deadline`; `difficulty` to `rank`. Any other label is ignored
and listed in the Adjustments log (never a refusal). Values are flattened (`[<>\p{Cc}]` to spaces) and cut: name 80, goal 240,
any other label 80 code points.

### 3.2 The word tables (`quests/offer-words.js`, English, built in)

**Types** (first word of `type:` found in a row, else the first verb of the goal; `bounty` counts as hunt; `side`, `main`,
`contract` name no type):

| Type | Words in `type:` | Goal verbs (any tense ending -s, -es, -ed, -ing) | Template kind |
|---|---|---|---|
| hunt | hunt, slay, kill, bounty, monster, beast | kill, slay, hunt, hunt down, defeat, vanquish, banish, exorcise, take down, put down, bring down, fight, dispatch | `kill` |
| cull | cull, clear, purge, exterminate, pest, pests, vermin | cull, clear, purge, exterminate, eliminate, wipe out, drive off, drive out, destroy | `kill` |
| gather | gather, collect, harvest, forage, fetch | gather, collect, harvest, forage, fetch, find, get, obtain, procure, pick | `collect` |
| deliver | deliver, delivery, courier, supply, bring | deliver, bring, bring back, hand over, turn in, return, retrieve, recover | `collect` |
| explore | explore, scout, travel, visit, journey | explore, scout, visit, reach, travel to | `visit` |
| escort | escort, protect, guard | escort, protect, guard, rescue | `story` |
| task | task, errand, favour, favor, investigate, investigation, mystery, message, story | find out, learn, discover, investigate, ask about, talk to, help, settle, convince, persuade, watch | `story` |

When the type's kind has no open template at the decided rank, the next rank below with one is used, then the `story`
template of the rank (§4.6). Bluewatch has no `visit` template, so explore becomes a story task.

**Difficulty** (first word found): easy: easy, simple, trivial, minor, light, low, beginner, novice; normal: normal, medium,
moderate, standard, average, routine, fair; hard: hard, difficult, tough, dangerous, challenging, high, risky, perilous;
nightmare: nightmare, deadly, extreme, lethal, impossible, brutal. A value that names a ladder rank (`rankNamed`: "E", "rank E",
"Journeyman") is a written rank.

**Amount words**, rewritten to digits in `reward:`, `fee:`, `count:` and the goal before RB's parsers read them: half a dozen 6,
a dozen 12, dozen 12, a score of 20, a hundred 100, a couple of 2, a pair of 2, a few 3, a handful of 5, several 4. Digits and
`NUMBER_WORDS` (one to twenty) are `parse.js`'s own. This is an option `{ amountWords: true }` added to `countOf` and
`parseReward`; their other callers keep today's behaviour.

**Pack words.** A rules manifest may add words in any language with an optional `offerWords` (SB schema, §12.1):
`{ "hunt": [...], "cull": [...], "gather": [...], "deliver": [...], "explore": [...], "escort": [...], "task": [...],
"easy": [...], "normal": [...], "hard": [...], "nightmare": [...] }`, each 0–40 words of 1–24 code points, lower case. Pack words
are checked before the built-in table.

**Trainer subjects** (§5.6): word families folded before matching: blade (sword, swordplay, swordsmanship, fencing, rapier,
duelling), spear (pike, polearm, halberd, lance), shield (buckler, guard, defence), magic (spell, spells, arcane, sorcery,
wizardry, hedge, ward, wards, mana), street (knife, dagger, thief, rogue, stealth, alley, gutter, cane), bow (archery, arrow,
marksman), fist (unarmed, boxing, brawling, wrestling), flame (fire, holy, prayer, faith, temple).

## 4. Rule 2: shape (quests)

Pure, in `quests/offer-match.js`: `matchOffer({ pin, ix, ladder, level, area, currency, threads, words }, line)` → a **settled
binding** plus notes and a band. It is called once, live, at capture. Steps in this order:

### 4.1 Hint rank

`party = defaultRank(ladder, 'normal', level)` (the PC's level from `rules.party`; unknown → the lowest row). A written rank
is held to `party` if above it (`WRITTEN_RANKS_ABOVE = 0`); a difficulty word gives `defaultRank(ladder, word, level, 0)`;
neither gives `party`. This **hint** decides the rank only when there is no target foe.

### 4.2 Target phrase and count

From `target:` when given, else from the goal after the first verb of the decided type's kind. Leading words skipped: `the, a, an,
some, all, every, any, those, these, its, their, at least`; a number, number word or amount word there is the **count**. The
phrase runs to the first stop word (`parse.js` `STOP_WORDS` plus `north, south, east, west` and their -ern forms, `beneath,
below, above, past, through, off`), a punctuation mark, a word ending in "-ing" after the first word, or 8 words. "Kill 6 culvert
rats in the south levee granary and collect tails" gives count 6, phrase "culvert rats"; "Slay the alpha of the scrub wolf pack
north of the ditch" gives no count, phrase "alpha of the scrub wolf pack". Only the first objective is taken; the rest of the
goal stays in the goal text ("and collect tails" is kept as words). `count:` wins over the goal's count.

### 4.3 Foe (kill kinds), first match wins

Words are folded with `parse.js` `singular` and lower case; filler (`the, a, an, of, some, all, pack, band, group, horde, nest`)
is ignored.

1. **Exact**: a foe whose name, slug or alias (§12.1) equals the phrase.
2. **Contains**: foes whose whole name appears in the phrase (`nameMatches(foe.name, phrase)`); the longest name, then pack order.
3. **Part**: foes whose name contains the whole phrase (`nameMatches(phrase, foe.name)`); one → it; several → the nearest:
   least distance between the foe's rank and the hint rank, then least |foe level − PC level|, then pack order. "wolves" on a
   level-3 PC: Starved Crag Wolf.
4. **Scan**: when the phrase is empty or matched nothing, each content word of the goal in order is tried as a phrase in step 3.
5. **Named variant**: candidates are foes sharing at least one content word with the phrase in name, alias or lore tag (sorted by
   shared words, then rank distance to the hint, then level distance to the PC, then pack order); with none, the foes of the hint
   rank sorted by level distance to the PC. The variant name is the phrase in title case ("Culvert Rats"), cut to 80. The first
   of at most 8 candidates for which `foeVariant(base, name, area)` and `foeToEngine` both succeed is used. The objective binds
   the **base** ref with the template's `allowVariants: true`, so a fight against the named variant or the base counts.
6. **None**: the goal becomes a story goal (band 2), at the hint rank.

The rank is then the **foe's** (§1.1 lookup), whatever the difficulty said (noted when they differ). A foe above every templated
row takes the highest row ("above every job rank here"). A foe whose rank is above the PC's is still offered: the player's
choice; the card note says "well above your rank" and the template's `level` requirement is waived for this quest (recorded).
A matched foe over the offer place's level ceiling is bounded at its own tier `ceil(level / 10) − 1` (recorded as the area
used). A matched foe that `foeToEngine` still refuses (Bluewatch: the Crag Wolf Matriarch and the Grey Walker Manifestation are
over the interim stat budget, `fight/foes.js:28`, so `BUDGET`; `foeVariant` refuses them too) cannot be fought under these
rules: the goal becomes a story goal at the hint rank, noted "cannot be fought under these rules".

### 4.4 Item (collect kinds)

The pin's item whose name, slug or alias equals the phrase, else contains it or is contained by it, if exactly one; none or
several → a story goal (band 2). Counted at turn-in from the party's stacks, so loot, a shop or a story `+ item` all count.

### 4.5 Count bounds

`countMin`/`countMax` on the template's objective when the pack gives them (§12.1). Without them (every pin before SB 2.5.0):
`countMin = 1`, `countMax` = the largest `count` of that objective kind among the pin's **closed** quests, at least the
template's own count. Bluewatch 1.6.0: kill 8, collect 4. No count written: the template's `count`. Above `countMax`: capped
(band 3, never band 4).

### 4.6 Template

`like:` naming an open template (id or slug) of the decided kind fixes it; otherwise the first open template in pack order with
the decided kind and rank, then lower ranks, then the rank's story template. An unknown `like:` is noted and ignored. If no
open template of any usable kind exists for the line, the line is a true refusal (§6.3). Template requirements other than
`level` are evaluated as today (`evaluateRequirements`); a template they fail is skipped for the next candidate.

### 4.7 Numbers

* **Coin.** `parseReward({ reward, goal }, '', { currency, amountWords: true })`, the chat's currency from `inventory.currency`.
  `each` rewards are multiplied by the count. No amount written: the formula on the area used (§1.1). Written but unreadable
  (a foreign coin, two amounts): the formula, band 3. Written: clamped to `[coinMin, coinMax]` (band 3 if moved); more than
  `3 × coinMax` is band 4. `none`, `nothing`: raised to `coinMin` (band 3).
* **XP.** Always the formula on the template's `xpMin`/`xpMax` and the area used; shown in the settled terms.
* **Area used.** SD's `world.areaTier` for where the party is, read once; unknown tier → the decided rank's tier
  `max(0, ceil(levels[0] / 10) − 1)` (F 0, E 1, D 2, C 2); a matched foe above it → its own tier (§4.3). Recorded.

## 5. Rule 2 continued: deadlines, givers, dedupe, trainers

### 5.1 Deadline (`due:`), required

Read from `due:`: `in N minutes|hours|days|weeks`, `N days`, `a day`, `a week`, `tomorrow` (1 day), `half a day` (12 hours),
with digits or number words. The quest's `durationMinutes` is that, clamped to `[60, template.durationMinutes]` when the template
has one, else to `[60, 43,200]` (30 days). Missing or unreadable (a date, "before the harvest"): the template's
`durationMinutes`, else **7 days (10,080 minutes)**, band 2. The words stay on the thread as its `due` field. The deadline runs
from acceptance, as for timed pack quests; without a story clock (`director.time` unset) the quest gets none and the note says
so. When it passes, the existing `questExpiryHook` (`quests/credit.js:106`) marks the quest failed through the settle path.
Penalties are the narrative's.

### 5.2 Giver and turn-in

`giver:` is kept as the thread's `giver` field (SD neutral field) and shown everywhere a giver is ("to Hollis"). The quest's
`turnInPlace` is the canonical id of the place where it was offered (`atlas.canonical({})`, read once), or `null` when that is
unknown; `giver` on the Quest record stays `null`, so a giver who moves never blocks a turn-in.

### 5.3 Dedupe

The **offer key** is SD's `lineKey(name)` with a leading `the `, `a ` or `an ` removed. Before making an offer, RB asks
`director.thread({ key })` for the name as written, without its article, and with `The ` added:

| Found | Result |
|---|---|
| A thread without an RPG quest (a neutral SD hook of the same name) | the offer is made **on that thread** (`threads.link`, as `planOpening` does for a neutral goal): one owner, no double tracking |
| An offered or active RPG quest | quiet no-op ("Granary Vermin is already posted."), no Problem, no band |
| A done, failed, expired or abandoned RPG quest | band 4 with the reason "it is already done" (§8.2) |
| A far-out decision recorded for this key on an earlier reply of this lineage (§7.1 `declined`) and the line has no offer labels | quiet no-op: an acceptance of a job that never existed makes no noise |

Different names are never merged ("Granary Vermin II" is another job). Two equal keys in one reply: the second is the no-op.

### 5.4 Kills are settled by fights

The settled terms name the exact encounter line (`! encounter 6 Culvert Rats | like: cellar-rat-swarm`, or
`! encounter 4 Fen Wolf` for a pack foe), with `| tier: weak` after it for an easy job and `| tier: strong` for a hard one (see Decisions); RB's fight result is the evidence, as today. A kill the narration alone tells ("I
stomp the rats") does not count; the board shows 0/6 and the terms say how to fight them. A story goal (no foe could be bound)
is judged by `~ quest Name | met: yes` as today.

### 5.5 Gathering is settled by loot, else a story item

The objective is a pack item; loot from a foe that drops it comes first (Cellar Rat Swarm drops Rat Tail at 80 %). When nothing
drops, the narration may give it with `+ item Rat Tail | qty: 6`: SB resolves the name to the pack def and holds it to the reply's
story goods budget, and it counts at turn-in. Replay-safe: the count is read from inventory ops, which replay applies as stored.
A target that is not a pack item becomes a story goal.

### 5.6 Trainers

Same mechanism, `training/offer.js`:

* `like:` naming a trainer template wins; else the template whose name, skill names and skill classes share the most folded
  words (§3.2 families) with the line's text and `teaches:`, ties to the template whose rank is nearest at or below the PC's,
  then pack order. No shared word: no template teaches that; the line keeps its words as an SD hook (when SD is there) and the
  reader can still use **Make this a trainer** (§6.3).
* `teaches:` entries the template does not list are dropped (noted); none left → the whole list.
* `fee:` read with the money parser; in `[coinMin, coinMax]` stands (band 1); outside, clamped (band 3); above `3 × coinMax`,
  band 4. No `fee:`: the recorded d1000 roll, as 2.2.0.
* Unchanged from 2.2.0: the place, one trainer per name per chat (here again: no-op; elsewhere: band 4 "already teaches at
  <where>"), a fixed trainer's name (quiet no-op), 100 offers per chat.

## 6. Rule 3: three bands

Decided at capture, recorded with the offer (§7), never re-decided. `FAR = 3` is one constant (`quests/offer-bands.js`).

| Band | When | Result | Card note | Narrator, next prompt |
|---|---|---|---|---|
| **Within** | every number written is inside its bounds; names resolved as written; only defaults filled where nothing was written (a count of the template, the coin formula, a 7-day deadline, a named variant, a story goal for an unmatched target) | the offer as written | the terms; a line of what was filled in, when anything was | settled terms (§8.1) |
| **Moderate** | a written number moved to the nearest bound (reward, fee, count), a written reward code cannot read, `reward: none` raised to the floor | the offer with the moved number | the terms and what moved, e.g. `reward set to 5 silver (rank F range)` | settled terms, worded so nobody in the scene takes anything back |
| **Far** | reward or fee above `3 ×` its maximum; a line that offers and finishes a job at once (`status: done`, `met: yes`, "— done" on a new offer); a re-offer of a job already done; a trainer already teaching elsewhere | **no offer and no trace**: no thread, no board row, no hook, no card line, no Problem | none (listed only in the Adjustments log) | one retcon line, once (§8.2) |

Notes are never Problems. The far band is a guideline, not a punishment: the narrator is told what would work instead.

### 6.1 What happens to today's refusals

Each change is replay-safe for the same reason: the decision is made once at capture and stored as the settled binding and its
recorded inputs (§7); a replay validates the stored decision against the pin and never runs the matcher.

| Today (file:line) | Code | 2.3.0 with the feature on |
|---|---|---|
| no template for a free-form name (`quests/capture.js:36`) | `RULES_MISMATCH` | the generative path |
| `like:` with other labels (`capture.js:21`) | `INVALID` | labels read and clamped |
| no or bad `text` (`opening.js:105-106`) | `INVALID` | goal from name or text, flattened and cut |
| `like:` not an open template (`opening.js:108`) | `RULES_MISMATCH` | ignored, matched by type (noted) |
| thread already a quest or ended (`opening.js:109`) | `REFUSED` | dedupe, §5.3 |
| no area danger tier (`opening.js:110`) | `AREA` | the rank's tier, recorded (§4.7) |
| requirements fail (`opening.js:111-112`) | `REFUSED` etc. | next template; `level` waived for a foe above the PC's rank |
| timed template without a clock (`opening.js:113`) | `CLOCK_UNSET` | no deadline, noted |
| ambiguous variant name (`opening.js:128`) | `AMBIGUOUS` | the deterministic order of §4.3 |
| no target, unknown foe, variant or adapter refusal (`opening.js:131-142`) | `INVALID`, `NOT_FOUND`, `LEVEL`, `BUDGET`, `FOE_NOT_ALLOWED`, `TAG_NOT_ALLOWED` | next candidate, else a story goal |
| unknown item or place (`opening.js:147`, `:152`) | `NOT_FOUND` | a story goal; the words stay |
| target kind not in the template (`opening.js:158`) | `INVALID` | the template is chosen for the kind |
| trainer without `like:` (`training/capture.js:71`) | `INVALID` | matched (§5.6) |
| trainer extra labels (`training/capture.js:73`) | `INVALID` | `fee:` read, the rest ignored |
| trainer name or text too long, markup (`training/opening.js:158-160`) | `INVALID` | flattened and cut |
| trainer `like:` unknown (`training/opening.js:163`) | `RULES_MISMATCH` | matched |
| `teaches:` outside the template (`training/opening.js:168`) | `REFUSED` | entry dropped |
| fixed trainer's name (`training/opening.js:172`) | `REFUSED` | quiet no-op |
| teaches elsewhere (`training/opening.js:176`) | `REFUSED` | band 4 |

The 2.2.0 functions `planOpening`, `replayOpening`, `planTrainer`, `replayTrainer` are **not changed**; the new kinds wrap them
(§7.2). The reader's `quest.open` and `trainer.open` commands are unchanged.

### 6.2 Worked thresholds (Bluewatch rank F hunt: coin 50–400, kill count 1–8 on a 1.6.0 pin)

| Written | Band | Settled |
|---|---|---|
| `reward: 120 copper` | within | 120 (1 gold 2 silver) |
| `reward: 12 copper` / `none` | moderate | 50 |
| `reward: 1000 copper` (≤ 1,200) | moderate | 400 |
| `reward: 50 gold` (5,000 > 1,200) | far | no offer |
| `reward: 12 crowns` on copper | moderate | 50 (formula on tier 0), "not this chat's money" |
| `count: 40` | moderate | 8 |

### 6.3 True refusals (the only ones left)

| Code | When | What is kept |
|---|---|---|
| `INVALID` "Name the job in plain words." | the name is empty after flattening | nothing to keep |
| `RULES_MISMATCH` "This world has no open job template for that." | no open template of any usable kind (a pin with only kill templates and a story line) | an SD hook thread with the words; **Make this a quest** works on it |
| `LIMIT` | more than 16 new generative offers in one reply, or 300 open generative quests in the chat (SD's own `NEW_THREADS_PER_REPLY` and `MAX_OPEN_THREADS`), or the 100th story trainer | an SD hook thread |
| `DEPENDENCY_UNAVAILABLE` | a trainer when where the party is cannot be told (no SD) | an SD hook thread when SD is there |
| (no template teaches that) | a trainer line whose subject matches no trainer template | an SD hook; **Make this a trainer** |

These are Problems, as refusals are today. Many offers are fine otherwise: offers are options, not obligations, and there is no
cap beyond these technical ones.

## 7. Recording and replay

The hard rule holds: a guard asks only its declared `replayQueries`, `story.evidence`, its own state, or `env.recorded`.

### 7.1 State (rules domain, RB rules part; absent until first used, so other pinned chats keep their bytes)

```
rules.offers?:   { [th_ id]: { v: 1, matcher: 1, line: <16 hex of ctx.hash({ raw })>, sid, name, said: { labels as read },
                   settled: SettledBinding, band: 'within'|'moderate', notes: string[≤6, ≤160 each], where: string ≤80 } }
rules.declined?: { [dk_ + 12 hex of hash(offer key)]: { v: 1, matcher: 1, sid, name, reason, suggestion, band: 'far' } }
```

Written through a new rules-part command `rules.recordOffer { write, thread | declined, record }` (trusted caller `rpg-battle`,
add-only keyed by id; `declined` keeps at most 50, oldest removed by key). `rulesProblems` gains both shapes. Trainer offers keep
their 2.2.0 record in `training.offers` plus optional `settled: { matcher, line, said, band, notes }`.

`SettledBinding` = `{ template, text, foe?: { ref, base, name, how }, item?, count?, coin, coinBy: 'said'|'formula', xp,
durationMinutes | null, turnInPlace | null, giver: string | null, rank, area: { tier, from: 'place'|'rank'|'foe' }, waived: [] }`.

### 7.2 Guards

* **`quest.offer`** (new kind, version 2, `replyBound: true` for story lines, built with `progress/guard.js` `buildGuard`):
  payload `{ settled, thread, title, matcher }`; `inputs` = `planOpening`'s facts for the base binding plus `settled`;
  `recorded` = `{ external: { area, places }, ladderRow, level, now }`. `replayOffer` (quests part `replayGuard`, before
  `replayOpening`) re-checks the pin hash and epoch, then `planOffer(pin, ix, thread, inputs, recorded, settled)`: the template
  is open and of the settled kind; `foeVariant(base, name, area)` gives the recorded ref; count in bounds; coin in
  `[coinMin, coinMax]`; xp equals the formula on the recorded tier; duration in its clamp; then `planOpening` on the base
  binding, with `settled` applied, gives the same `inputHash`. It never calls the matcher, the money parser or any query beyond
  `quest.replayInputs` and `story.evidence`.
* **`trainer.offer`** (new kind): the unchanged `planTrainer` with the matched template (its die is still rolled and recorded);
  when a written fee stood or was clamped, the wrapper replaces the offer's `fee` and the facts' `fee` with it and records
  `feeBy: 'said'`; the guard re-checks that fee against the template's range. Reply-bound for story lines, like `trainer.open`.
* **Far out**: no block, no guard. The receipt has no ops but `narrate: true` (§8.2); `rules.declined` is written only when the
  dedupe rule of §5.3 needs it.

### 7.3 Delete, swipe, Re-read, rebuild

* **Delete or swipe** the offering reply: the block goes (reply-bound), and with it the thread, the record and anything built on
  it, as for trainers (OPEN_TRAINERS_SPEC §6.3). Swiping back shows the stored offer.
* **Re-read of an unchanged line**: SB re-runs it with the seed of its earlier receipt (same ids, same die). RB looks in
  `ctx.standing.domains.rules.offers` (and `training.offers`) for a record with this carrier's `sid` and the same `line` hash
  and **reuses its settled binding**, whatever `matcher` version is running now. So a Re-read after an upgrade never re-decides.
* **Re-read of an edited line**: a new line; the current matcher decides; the record's `matcher` says which.
* **Rebuild and reload** apply stored ops; nothing is matched or rolled.
* **A 2.2.0 chat** has only `quest.open` and `trainer.open` blocks, replayed by the unchanged 2.2.0 functions. Its refused
  free-form lines have no blocks, so a rebuild is identical; only an explicit Re-read of such a reply would now make the offer,
  as any capture fix does.

## 8. Rule 4: tell back

Both go to the narrator as `[Happened]` lines of the next prompt: the offer's receipt has `narrate: true`, so SB tells it once,
on the reply after, and a swipe or delete of the offering reply takes it away with the receipt (lineage).

### 8.1 Settled terms (bands within and moderate)

```
Posted job: {name}{ (from {giver})}: {objective} within {deadline}; pays {coin} and {xp} XP, turned in at {where}.{ Fight them as {encounter}.} These are the terms from now on; nobody in the scene has to restate them.
```

`{objective}` is `kill 6 Culvert Rats`, `bring 4 Rat Tail`, or `{goal}` for a story goal; `{deadline}` "7 days", "2 days",
"10 hours"; `{where}` the place's name, else "a settlement". Cut to 320 code points. Trainers keep 2.2.0's line
(`training/opening.js:227`), with ` (fee as agreed)` added only when a written fee stood. The phrase "nobody in the scene has to
restate them" is how a moderate change reaches the story without an NPC changing the price mid-conversation.

### 8.2 The far-out line

```
Earlier, {name} was mentioned as a job, but it isn't one that can be offered here ({reason}). Let it stay as talk or a rumour; if a job is wanted, offer {suggestion}.
```

| Reason | `{reason}` | `{suggestion}` |
|---|---|---|
| reward | `{written} is far above what a rank {R} job pays: {max} at most` | `it for {max} or less` |
| fee | `a fee of {written} is far above {template}: {max} at most` | `the lessons for {max} or less` |
| offered and done | `it was offered and finished at once` | `it as an open job, and close it when it is done` |
| already done | `{name} is already done` | `a new job under a new name` |
| teaches elsewhere | `{name} already teaches at {where}` | `them where they teach, or another teacher` |

Cut to 300 code points. It is never a Problem and leaves no visible trace; the Adjustments log lists it.

### 8.3 Same-round acceptance

The rules block says a job offered in this reply can be taken up from the player's next message. A bare `+ quest Name` in the
same reply as its offer is the existing "Takes on" path; it is allowed (no error) but the board shows the job as offered until a
later acceptance, as today for pack quests.

## 9. Card notes and the Adjustments log

### 9.1 Card line (no new SB API)

RB's quests part adds `hooks.replyCard({ index, state, changes })` (MODULES §F125): for each `rules.offers/<th>` or
`training.offers/<tn>` pointer the reply's ops touched, one line `{ icon: 'fa-scroll', text: 'Posted: Granary Vermin · kill 6
Culvert Rats · 5 silver · 50 XP · 7 days', summary: 'Job: Granary Vermin', note: <the record's notes joined, ≤160> }`, and
`flag: 'adjusted'` for band moderate, `flag: 'above your rank'` when that note is there. At most 6 lines (SB's cap).

### 9.2 Notes (exact wording)

`count set to {n}`; `count capped at {max}`; `reward set to {coin} (rank {R} range)`; `reward "{text}" is not this chat's money;
set to {coin}`; `reward "{text}" has no amount code can read; set to {coin}`; `deadline set to {d}`; `no story clock, so no
deadline`; `{Name} is a named kind of {Base}`; `no foe for "{phrase}"; the story judges the goal`; `no pack item for "{phrase}";
the story judges the goal`; `{difficulty} set aside: {Foe} is a rank {R} foe`; `well above your rank (rank {R} job; you are rank
{P})`; `like: {x} is not a template`; `{label} was not used`; `fee set to {fee}`; `{skill} is not taught by {template}`.

### 9.3 Why no Problem

Problems mean "something went wrong". A normalized offer is the system working; the card is where the reader looks for what a
reply did, so the note goes there.

### 9.4 The Adjustments log

A collapsed section **Adjustments (n)** at the end of RB's Quests page (`screens/rules/quests.js`), one row per record in
`rules.offers`, `rules.declined` and `training.offers` that has notes or a far band, newest first, 50 at most: when (the reply),
what the narrator wrote (the labels as read), what code settled, the band, the notes. Read only; query
`quest.adjustments({ limit })`; `feature: 'rpg-battle.generative-offers'`. It uses the existing screen widgets (a list of rows
and a details element), so no new widget. Mockups: desktop 1280 × 1,798 px and phone 390 × 3,163 px full page (headless
Chromium: page width equal to the viewport, so no horizontal scroll; no button or summary under 44 px).

## 10. Strict mode

The feature `rpg-battle.generative-offers` (F100, default **on**, label "Jobs from the story", `prompt: true`). Off is strict
mode: every path, prompt line and refusal is RB 2.2.0's, byte for byte; nothing already offered changes (the state is never
touched, as F100 requires). Features are the reader's (not per chat), as every F100 switch is.

## 11. Golden cases and the corpus

### 11.1 Fixture

Bluewatch 1.6.0 pinned (RB's vendored SB 2.5.0 validating it); PC Ren, level 3 (rank F); SD real (sibling checkout) with
`atlas.dangerSet` world tier 0, empty allowlists; the scene at Bluewatch Village; `director.time` set; NSD absent; the pack's own
currency unless the case says "crowns" (then the reader's Coins setting is `{ name: 'crown', plural: 'crowns' }` with no coins);
a fixed seed. "Area" below is the tier used for the formula.

### 11.2 The user's two lines (exact expected outcome on Bluewatch 1.6.0)

**G1** `+ quest Granary Vermin | giver: Hollis | type: cull | goal: Kill 6 culvert rats in the south levee granary and collect tails | reward: 12 crowns | difficulty: easy`

| | Pack currency (copper) | Reader currency "crowns" |
|---|---|---|
| Template | `open-hunt-f` (type cull → kind kill; rank F from the foe; difficulty easy agrees) | same |
| Objective | kill 6 of `pack.ersveil-bluewatch/cellar-rat-swarm`, `allowVariants: true`, shown as **Culvert Rats** (step 5 variant: shares "rat"; `cellar-rat-swarm~culvert-rats` at level 1) | same |
| Count | 6 (within 1–8) | same |
| Coin | 50 copper "5 silver" (formula, tier 0): "12 crowns" is not this chat's money | **50 crowns** (12 raised to the floor) |
| XP | 50 | 50 |
| Deadline | 7 days (no `due:`; template has none) | same |
| Giver, turn-in | thread field `giver: Hollis`; `turnInPlace` Bluewatch Village | same |
| Goal text | kept whole, "…and collect tails" included | same |
| Band | moderate | moderate |
| Card note | `reward "12 crowns" is not this chat's money; set to 5 silver; Culvert Rats is a named kind of Cellar Rat Swarm; deadline set to 7 days` | `reward set to 50 crowns (rank F range); …` |
| Next prompt | `Posted job: Granary Vermin (from Hollis): kill 6 Culvert Rats within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight them as ! encounter 6 Culvert Rats \| like: cellar-rat-swarm \| tier: weak. These are the terms from now on; nobody in the scene has to restate them.` (287) | `… pays 50 crowns …` |

**G2** `+ quest Scrub Pack | giver: Hollis | type: hunt | goal: Slay the alpha of the scrub wolf pack north of the ditch | reward: 30 crowns | difficulty: normal`

| | Pack currency | "crowns" |
|---|---|---|
| Template | `open-hunt-f` | same |
| Objective | kill 1 of `starved-crag-wolf` (`allowVariants`), shown as **Alpha of the Scrub Wolf Pack**. Candidates by shared words: Crag Wolf Matriarch ("wolf", lore tag "alpha"; refused `LEVEL`: a tier-1 base cannot re-level into a tier-0 area), then Starved Crag Wolf ("wolf"; level 3) | same |
| Count | 1 (none written; template count), noted | same |
| Coin | 5 silver (formula; foreign coin) | **50 crowns** (30 raised) |
| XP, deadline | 50; 7 days | same |
| Band | moderate | moderate |
| Next prompt | `Posted job: Scrub Pack (from Hollis): kill 1 Alpha of the Scrub Wolf Pack within 7 days; pays 5 silver and 50 XP, turned in at Bluewatch Village. Fight it as ! encounter Alpha of the Scrub Wolf Pack \| like: starved-crag-wolf. These are the terms …` (299) | `… pays 50 crowns …` |

End to end (RB-M3): accept each next reply; `! encounter 6 Culvert Rats | like: cellar-rat-swarm | tier: weak` (G1 is easy), win; the board shows 6/6;
`- quest Granary Vermin — turned in` at Bluewatch Village pays 50 copper and 50 XP once.

### 11.3 Requested cases

| # | Line (labels shortened) | Band | Template · rank | Count | Coin | Why |
|---|---|---|---|---|---|---|
| G3 | `Granary Vermin \| type: cull \| goal: Kill rats in the granary \| reward: a dozen crowns` | moderate | hunt F · F | 1 | 5 silver | "a dozen crowns" is read as 12 crowns, a foreign coin; "rats" matches Cellar Rat Swarm (part) |
| G4 | `Rat Trouble \| goal: kill a handful of rats in the cellar` | within | hunt F · F | 5 | 5 silver | "a handful of" = 5 |
| G5 | `Cellar Clearing \| goal: Kill the rats in the cellar \| difficulty: hard` (PC level 3) | within | hunt F · F | 1 | 5 silver | foe rank F; hard held to the party's F anyway |
| G5b | same, PC level 14 (rank E) | within | hunt F · F | 1 | 5 silver | the foe wins: "difficulty hard set aside: Cellar Rat Swarm is a rank F foe" |
| G6 | `Matriarch \| type: hunt \| goal: Slay the Crag Wolf Matriarch \| difficulty: easy` | within | story F · F | — | 5 silver | the foe is matched (tier 1 but level 5: rank F, tier is not rank), but it is over the interim stat budget (`BUDGET`), so the story judges the goal |
| G7 | `Bear Problem \| type: hunt \| goal: Slay the frost bear \| difficulty: easy` | within | hunt E · E | 1 | 1,044 copper (10 gold 4 silver 4 copper), XP 1,044 | Frost Bear is level 12, rank E; above the PC's rank: offered, "well above your rank", level 11 requirement waived; bounded at its own tier 1 |
| G8 | `Drake Hunt \| goal: Kill the sea drake off the coast \| reward: 300 copper` | moderate | hunt C · C | 1 | 12,000 (120 gold), XP 33,333 | level 42 is above every templated row: rank C; tier 4; 300 raised to the C floor |
| G9 | `Boar Hunt \| goal: Hunt 3 wild boars \| reward: 50 gold` | **far** | — | — | — | 5,000 > 3 × 400; next prompt: `Earlier, Boar Hunt was mentioned as a job, but it isn't one that can be offered here (50 gold is far above what a rank F job pays: 4 gold at most). Let it stay as talk or a rumour; if a job is wanted, offer it for 4 gold or less.` |
| G10 | `+ trainer Old Reka — blade drills` (no `like:`) | within | `open-blade-drills` | — | fee from the recorded die (`40 + floor(50 × (die − 1) / 999)`) | "blade" matches the template's name |
| G11 | `+ trainer Old Reka — swordplay` | within | `open-blade-drills` | — | rolled | "swordplay" folds to the blade family |
| G12 | `+ trainer Old Pell — fishing and net mending` | refusal | — | — | — | no template teaches that; kept as an SD hook; **Make this a trainer** |
| G13 | `+ trainer Old Reka — blade drills \| fee: 5 gold` | **far** | — | — | — | 500 > 3 × 90 |
| G14 | `+ trainer Old Reka — blade drills \| fee: 10 copper` | moderate | `open-blade-drills` | — | 40 (4 silver) | raised to the floor |
| G15 | `+ item Iron Sword \| slot: weapon \| hands: 1` and `+ item Iron Sword — weapon, ATK +3` | unchanged | — | — | — | story gear is deferred (A.10): the first is a plain item, the second refused, exactly as 2.2.0 |
| G16 | `The Granary Vermin \| type: cull \| goal: kill 6 rats` after G1 | no-op | — | — | — | the same offer key: "Granary Vermin is already posted." |
| G17 | G1's name after it was turned in | **far** | — | — | — | "Granary Vermin is already done" |

### 11.4 The messy-line corpus (`tests/v2/quests/fixtures/offer-corpus.json`)

Each entry: the line, the PC level, the currency, the player's message, and the expected `{ band, template, rank, count, coin,
foe | item, notes }`. The prototype's outcomes on Bluewatch 1.6.0 (level 3, tier 0, copper unless marked):

| # | Line | Expected |
|---|---|---|
| C1–C2 | G1, G2 | as §11.2 |
| C3 | `Rat Trouble \| goal: Kill a dozen rats \| reward: a dozen copper` | moderate · hunt F · 8 (12 capped) · 50 (12 raised) |
| C4 | `Leech Duty \| goal: Kill 8 sluice leeches \| reward: 120 copper` | within · hunt F · 8 · 120 · Sluice Leech |
| C5 | `Boar Hunt \| goal: Hunt 3 wild boars \| reward: 1000 copper` | moderate · hunt F · 3 · 400 · Wild Boar |
| C6 | `Tail Bounty \| goal: Kill 5 cellar rats \| reward: 1 silver each` | within · hunt F · 5 · 50 (10 × 5) |
| C7 | `Moss Run \| type: delivery \| goal: Bring 3 bluecap moss to the healer` | within · delivery F · 3 · Bluecap Moss |
| C8 | `Tails \| goal: Collect 6 rat tails for the granary keeper \| reward: 60 copper` | moderate · delivery F · 4 (6 capped at 4) · 60 · Rat Tail |
| C9 | `Lost Ledger \| type: fetch \| goal: Find the harbourmaster's lost ledger` | within · story F · 50 · "no pack item" |
| C10 | `Safe Passage \| type: escort \| goal: Escort the miller to Northbarge \| reward: 80 copper \| giver: Marrit` | within · story F · 80 |
| C11 | `The Missing Boy` (no labels) | within · story F · 50 · goal = the name |
| C12 | `Smugglers — find out who is moving salt at night` | within · story F · 50 |
| C13 | `Road Watch \| type: bounty \| goal: Drive off several roadside bandits on the north road` | within · hunt F · 4 · Roadside Bandit |
| C14 | `Big Cull \| type: cull \| target: rats \| count: 40` | moderate · hunt F · 8 · Cellar Rat Swarm |
| C15 | `Goblin Raiders \| goal: Kill the goblin raiders stealing chickens` | within · hunt F · 1 · variant Goblin Raiders of Red-cap Goblin |
| C16 | `The Hollow King \| type: hunt \| goal: Slay the Hollow King` | within · hunt F · 1 · variant Hollow King of Starved Crag Wolf (no shared word: nearest by danger) |
| C17 | `Journeyman Job \| goal: Kill 4 fen wolves \| rank: E` | within · hunt F · 4 · Fen Wolf (written E held to F; the foe is F) |
| C18 | `Old Debts \| goal: Settle the matter with the river guild \| difficulty: nightmare` | within · story F |
| C19 | `Listen \| like: open-story-task-f \| text: Hear the miller out` | within · story F (the 2.2.0 form) |
| C20 | `Listen \| like: open-chat \| text: Hear the miller out` | within · story F · "like: open-chat is not a template" |
| C21 | `Rats Again \| like: open-hunt-f \| text: cull rats \| foe: cellar-rat-swarm \| reward: 100 copper` | within · hunt F · 1 · 100 (2.2.0 refused this) |
| C22 | `Already Done \| goal: Kill 3 rats \| status: done` | far · offered and done |
| C23 | `The Grey Walker \| type: hunt \| goal: Banish the Grey Walker` | within · story F · "cannot be fought under these rules" (over its stat budget) |
| C24 | `A Favour \| goal: Help Marrit move crates \| reward: none` | moderate · story F · 50 |
| C25 | `Pelts and Teeth \| type: gather \| goal: Kill 4 fen wolves and bring their pelts` | within · delivery F · 1 · Crag Wolf Pelt |
| C26 | `Guild Contract \| type: contract \| goal: Clear 5 ditch crawlers from the culvert \| reward: 2 silver` | moderate · hunt F · 5 · 50 |
| C27 | `Pest Control \| foe: Ditch Crawler \| count: a dozen \| reward: 80 copper` | moderate · hunt F · 8 · 80 |
| C28 | `Wolf Trouble \| goal: Kill some wolves near the farms` | within · hunt F · 1 · Starved Crag Wolf (part, nearest) |
| C29 | `Help at the Mill — the miller wants the rats in his loft killed, pays 40 copper` | moderate · hunt F · 1 · 50 · Cellar Rat Swarm (scan) |
| C30 | G3–G9, G16, G17 | as §11.3 |
| C31 | `+ trainer Sergeant Holm — teaches spear and shield work` | within · `open-spear-and-shield` |
| C32 | `+ trainer Widow Asta — hedge magic, sparks and wards` | within · `open-hedge-lessons` |
| C33 | `+ trainer Fen \| teaches: cane-draw, gutter feint` | within · `open-street-craft` |
| C34 | `+ trainer Old Reka \| like: swordplay — blade drills` | within · `open-blade-drills` · "like: swordplay is not a template" |
| C35 | `+ trainer Old Reka — blade drills \| fee: 60 copper` | within · fee 60 |
| C36 | `+ trainer Old Reka — blade work \| fee: 12 crowns` | moderate · fee rolled · "fee "12 crowns" is not this chat's money" |
| C37 | G10–G14 | as §11.3 |

50 lines in all (the C30 and C37 rows expand to their cases). Six are deliberate probes (far out: G9, G13, G17, C22; no template
teaches it: G12; duplicate: G16). **Acceptance target**: of the other 44, **at least 95 %** must become valid offers with the
expected outcome (prototype: 44 of 44); of all 50, 88 % do. The test fails below the target and prints the misses.

## 12. Story Block 2.5.0 (minimal, ships with RB 2.3.0)

### 12.1 Schema (`rules-v2.schema.json`, `.schema.js`, the contract copy, the kit's reference copy, kept equal by the existing test)

* `openObjective` kill and collect branches: optional `countMin`, `countMax` (integers 1–999); the validator requires
  `countMin ≤ count ≤ countMax` when given (`bad-schema` at `…objectives[i].count`).
* `$defs.foe`: optional `aliases` (0–8 unique strings, 1–80 code points); creatures and the resolved foes keep them.
* Rules manifest: optional `offerWords` (§3.2), each list 0–40 lower-case words of 1–24 code points.

Every rules hash changes with the schema, as with SB 2.4.0; pins keep their own hash (`rules/selection.js:30`). The golden
`smallRulesPack` hashes in SB `coverage.test.js` and Studio's three test files are recomputed (as OPEN_TRAINERS_SPEC §3.4).

### 12.2 Assist wall

`assist/safety.js` `refusedWhy`: `+ quest` and `+ trainer` are refused under any setting ("the safety net never offers jobs or
teachers"), added to the wall beside `ADDS`; `~ quest` and `- quest` stay as they are. A test proves no setting lets them through.

### 12.3 Kit and Bluewatch

* `authoring-kit/prompts/rules-pack/06-quests.md`: one paragraph: open templates can bound counts with `countMin`/`countMax`;
  write one story, one hunt and one delivery template per rank you use. `05-creatures`: `aliases` (other names the story may use,
  never another creature's name). `LIMITS.md` regenerated from the schema.
* Bluewatch **1.7.0**: every open hunt `countMin 1, countMax 8` (F, E), `6` (D), `4` (C); every open delivery `countMin 1,
  countMax 6` (F, E), `4` (D, C); `aliases` on a few common creatures (`cellar-rat-swarm`: "rats", "cellar rats", "rat swarm";
  `starved-crag-wolf`: "crag wolf"; `roadside-bandit`: "bandit", "bandits"). Nothing else changes. Old pins keep 1.6.0.

## 13. Story gear: the scope check and the recommendation

Finding (§1.1): under a pin, a story weapon or armour line becomes a plain item when its note has no stat or slot word, and is
refused when it has one; `slot:` and `hands:` labels are dropped by SB. **Recommendation: not in 2.3.0.** It is a separate
mechanism (SB must pass the two labels, RB must build an `ItemRule` from them under the area's bounds), it touches every pinned
chat, not only those with templates, and it does not serve the five rules. The design is kept in A.10 so nothing is lost. G15
pins today's behaviour so 2.3.0 cannot change it by accident.

## 14. Story Director, Studio, NSD

* **SD**: no code change. RB reads `director.thread`, `threads.offer`/`threads.link`, `atlas.canonical`, `world.areaTier`,
  `director.time` as it does today; SD's own hook lines and RB offers share one thread per key (§5.3). Re-vendor RB's copy of
  SD (`npm run sync-director`) at RB-M1.
* **Studio**: no new screen in the core. `npm run sync-sb` picks up the schema; the generic record form shows `countMin`,
  `countMax`, `aliases`, `offerWords`; golden hashes updated. (The preview and the warning are deferred, A.5, A.6.)
* **NSD**: no change; RB does not read it for offers in the core (A.9). NSD prompts are untouched.

## 15. Milestones

Order: SB-M1 first (everything vendors it), then RB, Studio beside RB. One PR per milestone; each passes `git diff --check`,
`npm run check`, `npm test` on Node 24.

| # | Repo | Work | Done when |
|---|---|---|---|
| SB-M1 | SB 2.5.0 | §12.1 schema in all copies, validator check, §12.2 assist wall, §12.3 kit text and LIMITS, Bluewatch 1.7.0, CHANGELOG and upgrade note, version | the SB suite passes; the four schema copies are equal; Bluewatch 1.6.0 and 1.7.0 validate; an inverted count range is `bad-schema` at its path; no `assistExtractorKinds` value lets `+ quest` or `+ trainer` through; `npm run matrix` green with RB 2.2.0 |
| RB-M1 | RB | re-vendor SB 2.5.0 and SD; record `tests/v2/quests/fixtures/pinned-2.2.0.json` **with the 2.2.0 code** first (a Bluewatch 1.6.0 chat with a `like:` offer, a refused free-form line, a trainer offer, a fight and a turn-in); `parse.js` `amountWords` option | RB suite passes unchanged; the fixture rebuilds to the same head and Problems |
| RB-M2 | RB | `offer-words.js`, `offer-match.js`, `offer-bands.js`, `training/offer.js` matcher; the corpus test | the corpus test meets §11.4's targets with the expected outcomes; all §11.3 rows pass as pure tests |
| RB-M3 | RB | capture routing (§3.1), `quest.offer` and `trainer.offer` plan, commit and guards, `rules.recordOffer`, dedupe, deadlines, turn-in place, settled terms and far-out lines, replay tests (§16) | §11.2 end to end passes on the real host (sibling SD); every §16 test passes; `planOpening`, `replayOpening`, `planTrainer`, `replayTrainer` are byte-unchanged in the diff |
| RB-M4 | RB | rules block piece and guide (§2), slug lines dropped (§2.4), settings, strict mode, `replyCard`, Adjustments log, prompt-bytes tests | the measured sizes of §2.5 are asserted; unpinned, template-less and strict-mode static and tail are byte-identical to 2.2.0 |
| RB-M5 | RB | README "How quests and trainers work" section, `docs/dev/track-a-quests.md`, CHANGELOG 2.3.0, versions in `package.json`, `manifest.json`, `module.js` | release PR merged; SB `npm run matrix` green with RB 2.3.0 and SD main |
| ST-M1 | Studio | `npm run sync-sb` at SB 2.5.0, golden hashes, `npm run build` | Studio unit and browser suites pass; `dist/story-studio.html` clean in CI |

## 16. Tests

* **Replay** (`tests/v2/quests/offer-replay.test.js`, real host): an offer on reply A, accepted on B, fought and turned in on C;
  then each of: delete A (thread, record and what followed go; one `REPLAY_PREREQUISITE`), swipe A away and back (same thread id,
  same settled binding), Re-read A unchanged (deep-equal record, nothing paid twice), Re-read A edited (a new record),
  `store.rebuild()` and `loadChat(clone)` (head deep-equal, same Problems). A far-out line: delete its reply and the next prompt
  has no retcon line; swipe it and the line is told again only for the shown swipe.
* **Guard purity**: `replayOffer` and the trainer guard with a `query` that throws on every name except `quest.replayInputs` and
  `story.evidence` answer `{ ok: true }`; a test stubs `matchOffer` to throw and replays a stored chat.
* **Matcher upgrade**: record an offer with `matcher: 1`, swap in a table that would decide differently, Re-read the unchanged
  reply: the stored decision stands.
* **Pinned**: Bluewatch 1.6.0 and 1.7.0 pins (implicit and explicit count bounds); disabling or removing the installed pack after
  an offer changes nothing.
* **Legacy fixture**: `pinned-2.2.0.json` replays under 2.3.0 with the same head and Problems; its `quest.open` block is replayed
  by `replayOpening`.
* **Byte identity**: `staticParts` and the tail equal 2.2.0's for an unpinned chat, a pin without templates (`trainersPin()`
  without quest templates) and strict mode; NSD's own prompt keys unchanged (snapshot).
* **Fuzz**: add generative quest and trainer lines (G1, G2, a far one, a duplicate) to `tests/v2/qa/helpers/fuzz.js`; the existing
  properties hold (replay equals live after every step).
* **Corpus**: §11.4. **Kill and gather**: §11.2 end to end; a collect quest done by loot and another by `+ item Rat Tail | qty: 4`.
* **Mock-model smoke** (`tests/v2/integration/offer-smoke.test.js`): the testkit's `createFakeModel` writes the reply prose with
  G1 and G2 in its `<Changes>` block; the next generation's prompt contains both settled-terms lines; a second scripted reply
  accepts and fights.
* **Manual check list for the user's live run** (Bluewatch pinned, SB 2.5.0, RB 2.3.0, SD):
  1. The narrator offers a job in its own words: the card shows "Posted: …" and, if anything moved, a note; no Problem.
  2. The next reply's prose uses the settled coin and count without an NPC retracting anything.
  3. Accept, fight with the encounter line from the terms, see the board count, turn in, get paid once.
  4. Ask for a wildly overpaid job: no card, no board row; the next reply treats it as talk.
  5. Swipe the offering reply: the job is gone; swipe back: the same job.
  6. Turn the feature off: the old refusal comes back for free-form lines; the posted jobs stay.

## 17. Versions and upgrade notes

| Repo | From | To |
|---|---|---|
| RB | 2.2.0 | **2.3.0** |
| SB | 2.4.0 | **2.5.0** (schema, assist wall, kit, Bluewatch 1.7.0) |
| SD, NSD, Studio | — | unchanged (Studio re-syncs) |

RB CHANGELOG 2.3.0 (draft):

> **Jobs and teachers from the story.** In a chat pinned to a pack with open templates, the narrator can offer a job or a
> teacher in its own words (`+ quest Granary Vermin | giver: … | type: cull | goal: … | reward: … | due: …`). Code picks the
> template and rank, keeps the count, coin, XP, deadline and fee inside the pack's limits, tells the narrator the settled terms on
> the next reply, and notes on the reply's card what it adjusted. A far-out offer is quietly not made and the narrator is told
> once. Turn off **Jobs from the story** for the strict 2.2.0 behaviour.
>
> **Upgrading from 2.2.** Needs Story Block 2.5.0. Chats without a pin, pins without templates and strict mode keep their
> prompt byte for byte. Existing chats replay unchanged; a Re-read of an old reply whose free-form job was refused now offers it.
> The template slug list is no longer in the prompt while the feature is on; `| like:` still works.

SB CHANGELOG 2.5.0: count bounds on open objectives, foe aliases, pack offer words; the safety net never offers jobs or
teachers; Bluewatch 1.7.0. "Every rules fingerprint changes; pinned chats keep their own."

## 18. Risks and reviewer checks

| Risk | Check |
|---|---|
| A replay re-decides | the guard-purity and matcher-upgrade tests; `replayOffer` imports nothing from `offer-match.js` or `parse.js` |
| 2.2.0 chats drift | the legacy fixture; the four 2.2.0 functions unchanged in the diff |
| Static drift where the feature does not apply | the byte-identity tests; SB `npm run matrix` static column |
| A variant name collides with a real foe or with another job's variant | variants bind the base ref with `allowVariants`; two jobs naming the same variant share its ref, which is what the encounter makes anyway |
| Over-merging duplicates | only equal offer keys merge; the corpus has "Granary Vermin" and "Granary Vermin II" |
| Quests above rank feel unfair | the "well above your rank" flag on the card; it is the player's choice to accept |
| Coin inflation over long play | each job is held to its template; SB's per-reply story coin budget still holds every payout (`storyCoin`, vouched); accepted as player choice |
| `[Happened]` used for the retcon line reads oddly | the wording says "Earlier, … was mentioned"; the mock-model smoke checks the next prose does not stage a withdrawal |
| The unreadable "crowns" surprises the user | the card note names it; the README section says to set Coins if the story uses another money word |

Reviewer commands (repos side by side, Node 24): each repo's `npm test`, `npm run check`, `git diff --check origin/main...HEAD`;
SB `node authoring-kit/check.mjs examples/packs/ersveil-bluewatch/pack.json`, `npx -y node@24 scripts/matrix.mjs`; RB
`node --test tests/v2/quests/offer-*.test.js`.

## 19. Open questions, each with a recommendation

| # | Question | Recommendation |
|---|---|---|
| Q1 | Implicit count bounds on old pins (from closed quests) or the template's count only? | **Implicit**: the user's live chat is pinned to 1.6.0 and would otherwise turn "6 rats" into 1 forever; the bound still comes from the pack's own data. |
| Q2 | Raise a written reward below the floor ("12 crowns" → 50) or keep it (as unpinned `rewardHold` keeps low rewards)? | **Raise**: the template's floor is the author's contract and the settled terms fix the prose. |
| Q3 | Use `[Happened]` for the far-out line, or a dedicated tail line? | **`[Happened]`**: it is told once and follows the reply's lineage for free; a tail line would need its own state and clearing. |
| Q4 | Turn-in at the offer place (`turnInPlace`) or anywhere? | **The offer place** when known: it gives the giver a home; `null` when SD cannot tell. A moving giver is A.9. |
| Q5 | Default deadline 7 days when none is written? | **Yes**, noted on the card; packs set `durationMinutes` for their own. |
| Q6 | Should SD's static line "a job only offered stays in the story; + quest once {{user}} accepts it" change while RB's block is shown? | **Not in 2.3.0** (SD unchanged). RB's block is later in the prompt and explicit; revisit if the live run shows models avoiding offers. |
| Q7 | Variants from a foe that shares no word ("the Hollow King" as a Starved Crag Wolf)? | **Yes**, as the user directed (nearest by danger); the card names the base so the reader sees it. |
| Q8 | Story gear in 2.3.0? | **No** (§13, A.10). |
| Q9 | Feature per chat? | **No**: F100 features are the reader's; per-chat strict mode would need a chat setting SB does not have. |

## Appendix A. Deferred (decisions kept, no spec detail now)

| # | Item | Decision kept for later |
|---|---|---|
| A.1 | Item rewards | Counted in currency value: a promised item is a story item whose value (item rules, held to the area's budget) is taken out of the settled coin; worth more than the coin → downgraded or clamped (moderate), more than 3 × → far out. |
| A.2 | Chains | A follow-up offer links to the previous quest when the narrator offers it as one (`after:`); SD's closed Quest shape allows only a def id in `chain.previous`, so the link would live in RB's offer record unless SD widens the shape. |
| A.3 | Haggling | When the player's own message names a term word (reward, pay, fee, price, cost, wage, bounty) and a number, the narrator's number stands in range; the favourable quarter of the range needs a successful SD check (`? check Persuasion` on the same reply, read through a new SD query of `checks.log` by evidence, modifiers via `rules.modifier`), recorded; such a number is never far out. |
| A.4 | Optional small-model check | Off by default, on the Assist profile, only for lines the matcher cannot map, applied as a stored rewrite line (as the Assist extractor stores its lines) so replay and Re-read never call it; timeout or failure leaves the deterministic result. |
| A.5 | Studio "What the narrator sees" | A preview of the rules block and guide from the open pack, generated by RB's pure guide code vendored into Studio. |
| A.6 | Studio warning for packs without templates | A pack with quests but no open template: a Studio warning and a kit line ("free-form jobs need open templates"). |
| A.7 | Expiry of unaccepted offers | Not now; unaccepted offers cost no prompt (the tail lists only taken quests). |
| A.8 | More quest types | Types beyond what template kinds carry (per-type templates, e.g. a `types` list on a template with its own bounds). |
| A.9 | NSD givers | Resolve the giver with `npc.identity({ name })`, read only, and follow the giver's location for turn-in; today the name is stored. |
| A.10 | Story gear | SB passes `slot:`/`hands:` of `+ item` to the hooks and asks a new `rules.gearRule`; RB builds the rule from them under the area's bounds; equipment without a slot becomes a plain item with a card note instead of a refusal. |
| A.11 | Rank above the PC | Already in the core as the player's choice with a card note; any level gate is the narrative's. |

## Decisions (approved 27 Oct)

- The adjustments log mockups in `docs/v2/mockups/generative-offers/` (redesigned for readability, a82c5b0) are approved as drawn.
- Open questions Q1–Q9 are accepted as recommended: count bounds on old pins derived from the pack's closed quests; a written
  reward below the template floor is raised to it; the far-out line goes as a `[Happened]` line; turn-in at the place the job
  was offered when known; a default deadline of 7 days; SD's "a job only offered stays in the story" line unchanged in 2.3.0;
  a variant from a foe sharing no word with the target is allowed (nearest by danger, base named on the card); story gear is
  not in 2.3.0 (A.10 kept); strict mode is a reader setting, not per chat.
- Build order: Story Block 2.5.0 (SB-M1) first; then RPG Battle 2.3.0 (RB-M1 to RB-M5) and Studio ST-M1. Story Block 2.5.0
  and RPG Battle 2.3.0 ship together. Test on Node 24 (CI's version) as well as Node 22.
- Template choice (§4.6) prefers the written type: among open templates of the decided kind and rank, the first in pack order
  whose `offerType` equals the type read from the line (§3.2); else the first of that kind and rank as before; lower ranks and
  the story fallback follow the same preference. `like:` is unchanged. Templates without `offerType` (all 2.2.0-era pins,
  Bluewatch 1.6.0) behave exactly as before.
- Records are keys of the `rules` slice (`offer.<th_id>`, `declined.<dk_id>`), not entries of `rules.offers` / `rules.declined`: a chat pinned before
  2.3.0 has no such map, and a map made by the first offer's reply would take every later record's parent with it when that reply is deleted or swiped.
  Read through `offersOf` / `declinedOf`; at most 50 far-out decisions are kept (a further one is told but not recorded).
- A pay in a goal counts only after a pay marker (pays, paying, paid, reward of, worth, bounty of, for) and is never far out; digit groups ("1,000") are one
  number and a decimal, a fraction or a sign is no amount code can read (§4.7); "first in pack order" (§4.6) is the installed pack's order of its quest
  templates (the pin sorts them by id and stands for a pack that is not installed); a template shorter than an hour has its own duration as its deadline range.
- The story fallback of §4.6 prefers the written type, then the template with `offerType: task`, then the first story template (a pack without `offerType`
  keeps its first). A teacher's fee is written with the same coin formatter as a reward (`money`) in the receipt, the told line and the Progress page, while the
  rules block is shown.
- Auto fights earn skill uses: a fight begun with `autoRule: 'practice'` (the stored setup of every offer calibrated from 2.3.0 on) has Auto play each form of a
  party member that is not mastered once, where it would do something; fights and offers stored without the rule are played as before.
- A rest heals by the hours: with Story Director's clock, `! rest long` counts when its reply moved the clock by `longRestHours` or more and
  `! rest short` by an hour (v1 gives a short rest no length; an hour is the smallest stretch story time gives anything back for). Else nobody rests, the
  narrator is told once ("A long rest needs the night to pass, e.g. ! time +8h."), and the refusal is kept as the record `rest.<rs_…>` of the rules slice for
  the Adjustments log. The reply's movement is the clock less the clock when the reply began: Story Director's `time.overdue` (the clock at the last settle), and before it has settled
  anything (the first reply with a clock, which the cue that sets it runs after ours) the clock when the reply's first Director line was read (`director.turn.now.from`) or `party.rested`,
  the earlier; with neither, nothing is known to have passed and nothing has (`restTime`, `recovery.js`). A rest that counts heals exactly what the hours of its reply give under the
  recovery formula (`perHour` of max HP and MP and `spPerHour` of max SP for each whole hour; `longRestHours` or more is full and ends what a fight left), whatever the switch of passive recovery
  says, for the line and the `party.rest` command alike (`foldStoryTime(ctx, { force, since })`), and the same hours once: the fold starts at the later of the reply's start and `party.rested`, so a heal of the
  same reply that took them first (passive recovery, a wound or an item) leaves a rest nothing, and a second rest nothing again. A rest that finds them taken says so. No clock: v1's rest, unchanged.
- Promotion mastery: the pin's `constants.promotionMastery` (default and old pins `[5, 5, 5]`) is the mastery each skill needs for the promotions at 10, 20 and 30
  (`progress/offers.js` `masteryNeeded`); the checklist's `needed` is that of the open milestone.
- The switch's mode is a property of each reply (`rules/mode.js`), not of a toggle on the timeline. A reply whose capture ran with the switch on (a line of ours read: `+ quest` that can be an offer, `+ trainer`,
  an `! encounter | like:` with a count, or any other of ours) is stamped free: `mode.<ms_ id>` = `{ v: 1, sid, mode: 'free' }` in the rules slice, written by `rules.stampReply`, a step of the reply of its own run by the
  afterCapture hook once its lines are read, so the stamp does not depend on any one line surviving (a line that fails keeps no steps). The dispatcher tells the hook, in this process, that the pass was a free one (`noteRead`). A Re-read
  of the reply, edited or not, goes by the stamp of the reply as it stands (`ctx.standing`) and writes it again; a rebuild and a reload replay the stored steps. A reply with no stamp is read strict, as 2.2.0 did
  (it was read with the switch off, or recorded before 2.3.0, or none of its lines kept a step; a strict reply writes nothing). A new reply takes the switch of its moment.
  Deleting a reply takes its own stamp only, and no other reply's reading depends on it; no event, no cue and no state is kept between replies. The hook runs only for a reply that kept a receipt: a reply none of whose lines kept a step has no state of ours to read differently and keeps no stamp. The reader-facing parts (the rules block, settings, the queries and cards of the feature) follow the switch itself.
- Hours and damage: a `~ wound` spends the story time written before it (`foldStoryTime(ctx, { markOnly: true })`: it heals with passive recovery on, nothing with it off), so a rest heals a wound only by hours that passed
  after it; a rest line cannot heal a wound written after it, since it acts at its place in the reply. The story hours that pass while a fight has the party are spent when the fight is settled (`combat.end` folds
  with the fight still on the party), never healed afterwards. Minutes short of an hour are spent with the damage: a wound and the end of a fight fold with `spend`, which moves `party.rested` to the clock, so no part of an hour is carried across them into a later heal. With the story clock (whenever one exists, even if it cannot say when the reply began: the marks recovery keeps, `party.rested` and the reply's first Director line, tell, and with none nothing passed) a rest is the whole party's: `party.rest` with some members named is INVALID, every member it heals is in the receipt; without a clock
  the targeted rest of 2.2.0 stays.
- A rest's time rule is the clock's, not passive recovery's, and holds for the `party.rest` command and for a line of the story alike (`restTime`, `recovery.js`; no exception for a fresh clock: Story Block's matrix writes an
  hour of story time before the action that asks for a rest); refused-rest records have no count cap (one small record a reply, gone with it); a fight's uses are stamped with the story minute it ended at; a kill objective keeps up to its count in rows of evidence (`evidenceLimit`); a refused rest keeps its text and place as `flat()` text. Uses waiting for a credit are settled by a `beforeGenerate` cue on the reply at the head (as well
  as by afterCapture), so a reply with no change line no longer leaves them unpaid. A count in front of a named kind is any whole number 1 to 999 (a fight holds 54, the rest is cut and told).
- Progress words: `rules.pace` (`progress/offers.js` `paceOf`: `{ top, usesForTop, perReply, perDay }` from the pin's constants) feeds the line under Skills; a `rules.progress` checklist row says
  `waiting` (uses of its form held for the story clock; only while no clock is set, only when above 0). With `promotionMastery` the checklist header and the waiting lines use the
  requirement ("0 of 3 forms at 3 / 5", "Strike is 1 / 3."), the skill bars stay out of the top and a card is done at the requirement. A refused rest keeps `place` in its
  record and is the Adjustments row "Long rest at <place>" (Dropped; "No story time passed in that reply; a long rest needs 6 hours (e.g. ! time +8h). Nothing was healed.").
- Job difficulty sets the told fight's tier: easy `| tier: weak`, hard `| tier: strong`, normal (or a difficulty that names a rank, or none) no tier; nightmare reads as hard. Worked out once at
  capture and kept in the settled binding as `fightTier` (only beside a foe), so a Re-read, a reload and a rebuild tell the same line; nothing else about the offer moves (XP and coin are the
  template's formula and range). Offers made before it have no `fightTier` and tell the line as they did.
- Rank experience ranges: a pack's rank may write `xp: [lowest, highest]` (Story Block 2.5.0; open templates' `xpMin`/`xpMax` are held to it, else to the coin range). RPG Battle
  carries it in `quest.ranks` and `party.ranks` and never derives XP from a rank's coin range: a job's XP is the formula on the template's `xpMin`/`xpMax` (§5), the
  matcher's clamps and bands are coin only, and the grading guide shows coin ranges only.
