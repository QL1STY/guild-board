# Genshin Optimizer reference

A developer tool, never part of the app: it runs Genshin Optimizer's (GO, MIT, https://github.com/frzyc/genshin-optimizer)
Waverider engine headless, outside the repository, and writes the facts Guild Board keeps from it in its own format,
`src/guildboard/reference/characters/kits.json` and its schema. GO's code, localisation text and pictures are never copied
into the repository or shipped; its MIT notice is in THIRD-PARTY-NOTICES.txt (tools/third-party-notices.py).

The engine is Waverider (`libs/gi/wr` + `libs/gi/sheets`), the one GO's website uses, never the newer Pando
(`libs/gi/formula`), which counts Lunar and Stellar hits as ordinary ones (the research: `research_notes/Damage
simulator/go-engine.md`, git-ignored).

**Pinned commit:** `2c13fc40c4694fd8beae513493c4c8a7537173c6` ("1.15.0+zo", 2026-11-13). It is written in `run.py`
(`PINNED`) and `setup.ps1`; `run.py` refuses a checkout at another commit.

## Set up (once, about 3.2 GB)

    powershell -ExecutionPolicy Bypass -File tools\go-reference\setup.ps1

It fetches GO at the pinned commit into `GB_GO_DIR` (default `%LOCALAPPDATA%\guildboard-dev\go`), Node 24 portable from
nodejs.org beside it (checked against `SHASUMS256.txt`), and installs GO's packages with its own Yarn 3.4.1
(`CYPRESS_INSTALL_BINARY=0`; the package cache is committed in GO, so nothing more is downloaded).

## Run

    uv run python tools/go-reference/run.py kits

copies `specs/*.ts` into the checkout's `libs/gi/pando-parity/src/`, runs
`node node_modules/vitest/vitest.mjs run --config libs/gi/pando-parity/vitest.config.mts gb-kit gb-match` there with Node
24 first in `PATH` (about 30 s, nearly all of it vitest's module transform), and writes kits.json from the JSON the specs
write (`GB_OUT_DIR`, default the checkout's `gb-out`). `--from DIR` writes kits.json again from an earlier run's JSON
without GO. `GB_NODE_DIR` names Node's folder when it is not beside the checkout.

## The comparison with the damage engine

    uv run python tools/go-reference/run.py compare            (about 2 minutes)
    uv run python tools/go-reference/run.py compare --from DIR (an earlier run's JSON, no GO run)

`compare.py` writes `cases.json` (every character with counted rows, a standard build of her weapon type and two swaps: the
sands from her scaling stat's % to Elemental Mastery, the goblet from her element's DMG Bonus to her scaling stat's %; a few
cases with a reaction on), `specs/gb-compare.spec.ts` evaluates both builds of each case in GO the way GO's website does
(`uiDataForTeam`), and `compare.py` writes `web/src/fixtures/compare-cases.json`: our engine's inputs (the planner's hits block,
her base values, HoYoLAB's panel for both builds) and GO's answer for each main talent. `web/src/pages/characters/compare.test.ts`
runs our engine on it (with `GB_COMPARE_OUT` it writes our answers, which `run.py` pins in the fixture), and
`tests/test_compare_cases.py` checks that every case of a kit not marked unsure agreed within 0.05 percentage points. A
character whose disagreement is not ours to fix gets an `unsure` sentence in her decision file, which her verdict gives. The
fixture keeps every case's answers, ours and GO's.

The cases above are at Constellation 0. A character with a state decided on whose effects start at a constellation (Mavuika's
Flame Form, Keqing's Constellation 6 stacks), a row only a constellation deals (`row_gates` in kits.json: Yanfei's Charged Attack
with four Scarlet Seals, GO's `charged.4` behind Constellation 6), an infusion that starts at a constellation, or an
effect no state gates that starts at any constellation from 1 to 6 (Sandrone's Crit DMG, Hu Tao's Skill bonus, Mualani's Burst DMG
Bonus at 4, Odette's Stellar elevation at 6) has the same two swaps again at each constellation those start at, each once
(`compare.constellations_of`), as `<key>:sands@c6` and `<key>:goblet@c6`, on her kit at that constellation (`kit_of` at it, named
`<key>@c6` in the fixture), with GO at the same constellation and the states that hold there. The comparison has no boundary at a
constellation (it stopped at Constellation 2 until 2.2.1). Her Skill and Burst (or Normal Attack) are 3 levels higher at Constellation 3
and 3 more at 5: the cases hand GO talent levels of 10 and GO adds those itself (`input.total.skillIndex`...), and the fixture reads the
levels GO's hits are at from its answer (`levels`, `compare.fixture`), makes her rows' text at them (`affixes`) and gives the block
(`block(..., levels)`) the same, so both sides count the raised talent alike; `tests/test_compare_cases.py` holds each `@cN` kit's raise to
3 for each of Constellation 3 and 5 it has. A character has a set of cases for each constellation an effect, row or infusion of hers starts at (Sandrone's at 2 and 6, Varesa's at 1, 4
and 6, Columbina's at all six), not only the highest: at the highest, both sides apply every lower effect, so a gate read at the wrong start
(Constellation 4 where it is 2) would agree at 0 and at 6 and never be caught. The kit at each holds everything it gives from the lower ones.
Where a constellation gives CRIT Rate or
CRIT DMG a third swap, the circlet's CRIT DMG to CRIT Rate, is made at that constellation, and at 0 once any of her constellations gives it: a CRIT bonus on every counted row
cancels in the sands and goblet ratios. A disagreement at one is fixed in the data or the engine, or its state is switched off in her
decision file with the reason, or she gets an `unsure`.

Seven characters whose answers at their constellation no swap tells from their answers at 0 are named with the reason in `INVISIBLE` of
tests/test_compare_cases.py: Columbina (her Lunar elevation raises every row alike), Mitya (her Stellar-Conduct elevation does), Qiqi (her
Constellation 2 ATK bonus is in a team shape that is not her usual one), Vesna (the same for her Constellation 4), Chasca (the same for her
Constellation 2 stack), Xingqiu (his Constellation 4 multiplies his Skill's one counted row) and the Traveler (Anemo) (Energy Recharge).

### A batch of decisions: `compare --only`

    uv run python tools/go-reference/run.py compare --only fischl yelan @keys.txt     (keys, or @file: one per line or a JSON list)

runs the same comparison for just those characters, in GO and in our engine, prints the agreement of each case and exits 1 on any
disagreement of a decided character that is not marked unsure (a case GO could not run, or a row whose move is not GO's, counts as
one). It writes none of the committed files: `cases.json` and the fixture stay as they are (the partial fixture goes to
`GB_COMPARE_FIXTURE`, `compare-only.json` in the output folder, which `compare.test.ts` reads when it writes our answers). Run
`run.py kits --from DIR` first, so that kits.json holds the decisions (the command stops when it does not). It writes to
`GB_OUT_DIR` (default the checkout's `gb-out`), so parallel runs, each in its own worktree, name a folder each:
`GB_OUT_DIR=C:\scratch\batch-1 uv run python tools/go-reference/run.py compare --only @keys.txt`. A folder that already holds
the kit and match JSON of these same specs (`.specs-hash`) runs only GO's comparison spec (about 30 s with the match and kit
specs, a few seconds without).

### A decision sheet: `sheet`

    uv run python tools/go-reference/run.py sheet sandrone raiden-shogun @keys.txt    (or: python tools/go-reference/sheet.py ...)

writes `.superpowers/sheets/<key>.md` (git-ignored) for each key: her main talents' rows (kind, move, what each scales on at talent
level 10, which are counted), each toggle with GO's condition name, its effects in kits.json's Effect form, the counted rows it
reaches and how much it moves her main talents' damage alone (our engine, `damage.ts`, under vitest, in
`web/src/pages/characters/toggles.test.ts`; the comparison's standard build, her kit read at Constellation 6 so that every toggle
shows), what her decision file says now and a suggestion that comes from a rule (`sheet.suggest`: a self-buff that changes her own
counted hits and whose name does not point to the party, the enemy, her HP or another setup is suggested on, the rest off; read it as
a place to start, never as the decision), what her kit leaves out, and her passives' and constellations' text from the HoYoLAB wiki.
The wiki text is read from the dev copy's data folder (a copy of its files is read in a temporary folder, so nothing is created beside the originals; the entry Guild Board kept), else through the app's own wiki
code and `netpolicy` (the wiki's host only), parsed as the app parses it, and never stored or committed. `--no-damage` and
`--no-wiki` leave those out.

### The queue of characters to decide: `queue`

    uv run python tools/go-reference/run.py queue    (or: python tools/go-reference/work_queue.py)

writes `.superpowers/queue.json` and `.superpowers/queue/<batch>.txt` (git-ignored: they name the player's roster) and prints counts
only. The characters of kits.json with no decision (a file of `unsure` alone is none), the player's own first, then the rest newest
first, in batches of about 18 (`batch-01`, ... in that order) and in three lanes of batches for agents working in parallel
(lane j holds batches j, j+3, ...), the owned dealt round the lanes so each starts with owned characters. The batch files hold keys
one per line, so `run.py sheet @.superpowers/queue/batch-01.txt` and `run.py compare --only @...` take them. The player's characters
are read from a copy of the app's database (`dbcopy.py`, in a temporary folder; nothing is created in the data folder) at
`GUILDBOARD_DATA_DIR` or the standard folder; her highest raised talent is the highest of her three talents as the game shows them,
less 3 for one shown above 10 (the constellations' levels); release is the game version of `inventory.json`, a character it lacks
(not out yet) before the rest. The file is `work_queue.py` and not `queue.py`: this folder is on `sys.path` and would hide the
standard library's `queue`.

## Gear decisions: `decided/weapons/<key>.json` and `decided/sets/<key>.json`

A weapon's or set's passive is a toggle in kits.json, off by default; the planner's "Not counted:" line lists it, when it would change a counted row of the tested build, and pressing it counts it. A file for the item says which of its
toggles are on in normal play (a stack that fills from its wielder's own hits, a state she keeps up), and at which state each is read. Only
an item with a toggle on has a file (27 weapons and 3 sets); one that needs the team, the enemy, low HP, healing, a shield, being off the field
or a window that covers part of her attacks has none and stays off (when torn, off: a wrong "on" flatters everyone who tests the item). A
window after her own Skill or Burst is on when it lasts 15 seconds or more after a Skill, or 30 after a Burst (up while she casts it when it
is ready); a stack is on at its full count when her own hits or Skill fill it early in her damage (within about two seconds, Calamity
Queller's six) and it lasts while she keeps attacking:

    {"toggles": {"staff-of-homa:passive": {"on": true, "label": "Staff of Homa passive", "state": "on",
                                           "covers": [], "reason": "It is up whenever she fights."}}}

One file for each item, named for its key in kits.json (`kitgen.load_decided` reads the two folders; a batch of items is a batch of new files).
The toggle names are kits.json's own (`<key>:<name>`); **every** toggle of the item is decided (the run stops on one missing or unknown), each
with `on` (true or false), `label` and `reason` in our own words, `state` (a state the toggle has: a stack count or "on"; the effects are
read at it, so a decided state changes the item's numbers) and, if wanted, `covers` (the moves it reaches, as a character's). Any other field
is refused. An item with a file gets `checked: true` in kits.json; one with none keeps its toggles off, labelled from their code names, its
effects read at the state that gives the most, which is how kits.json held every item before these files. That is one state for the whole
toggle, chosen over every term that reads it: Kagura's Verity's 12%, 24% and 36% are the 36% of 3 stacks, a branch (Deathmatch's DEF, which
only 2 or more opponents give) is never added to the other, a flat bonus's cap (the Watatsumi weapons' 40%) is held in the rate, and an
item whose states are different bonuses given at random or by turns (The Widsith, Forged by the Golden Melody: `ONE_OF_AT_RANDOM` in
kitgen.py) is left out with its reason, as no one state is the honest one for every character.

`kitgen.gear_differences` is the stale-kits guard for them (tests/test_go_reference_gear.py holds kits.json to the folders, and `compare
--only` stops when a file says something kits.json does not: `run.py kits --from DIR` first). `run.py refresh` builds each weapon and set
alone with its file and reads it at the states its file does not pick too, as for a character; one whose sheet changed, or whose file no
longer fits, has its file moved to `decided/_stale/weapons/<key>.<old commit's first 8>.json` (or `sets/`), undecided until a person decides it again.
The comparison's gear cases are below.

### Weapon and set swaps in the comparison

`cases.json` and the fixture also hold `gear_cases` (`compare.GEAR_CASES`), beside the 358 cases and never among them: a weapon or a set swapped
with the rest of the build as it was, what the planner does when the player tests a weapon or a set. Hu Tao's Staff of Homa to Deathmatch,
Raiden's Engulfing Lightning to The Catch, and a 4-piece set swap from the standard Gladiator's Finale on three characters, each chosen for a part
of a set's bonus the others do not read (Hu Tao to Crimson Witch of Flames: a stack behind a toggle, the Vaporize and Melt bonus and a 2-piece
Pyro DMG Bonus that only a Pyro character gets; Raiden to Emblem of Severed Fate: Burst DMG from her Energy Recharge, a conversion on a
conversion; Ganyu to Wanderer's Troupe: a Charged Attack bonus that only a bow or catalyst wielder gets, and 80 Elemental Mastery on the panel).
Each is made with the gear's states where the planner starts (the toggles a decision file turns on, `gear_start`, set in GO at their decided
state, the rest off), and, when the four items (the two weapons and the two sets) have a toggle the start leaves off, with them all on
(`:on`, the case's `gear_toggles`; a `:on` that would turn on nothing more is not made): GO's conditionals are set to the state kits.json
reads each toggle at, and ours has the toggles on, in one set of states for both builds. The id is `<key>:weapon|set:<the tested item>[:on]`;
a build has its own `weapon_go`.

Then `DECIDED_GEAR_CASES`: a swap to every weapon or set whose decision file turns a toggle on, from her weapon type's standard weapon or the
standard set (Eula's The Unforged from Skyward Pride: Wolf's Gravestone gives the same numbers, so a swap from it moves nothing), on a
character who wields it and whose counted rows the toggle reaches (Ganyu to Aqua Simulacra, Nahida to Etherlight Spindlelute, Nefer to Sunny
Morning Sleep-In, whose Burst hits, Tartaglia to Heart of Depth...). Its first case is the planner's start, with the item's toggles on, and
GO alone also runs it with the tested item's decided toggles off (`conds_off`, the fixture's `go_off`): `tests/test_compare_cases.py` holds
every toggle decided on to a swap whose GO answer moves by more than the tolerance between the two (so the agreement shows the toggle, not
a swap that would agree with it off too), or to a reason that says "No swap of the comparison can show it" (Footprint of the Rainbow: no
polearm character the comparison has scales on DEF). Its `:on` case, where made, checks a Shielded or a party toggle left off. A new
decision that turns a toggle on adds its swap here.

Our side runs the way the planner does (`comparison.oursGear`, `compare.gear_swap`), not on a second panel: the first build is a sim (HoYoLAB's panel,
her base values, the five pieces, the weapon and the set); the planner answer holds the effects of the gear it wears alone; the weapon and set tested
come as the picker's choices, each with its own effects (`gear`) and the app's own numbers at level 90; the tested stats are `statsWith`'s (the
panel and the difference of the gear), and the answer is the verdict's. They agree with GO's within 0.05 points like the other cases
(`agreement`; `tests/test_compare_cases.py`).

A weapon's numbers at level 90: kits.json's `level_90` holds each 3-star-and-up weapon's base ATK and substat from GO's curves (gb-kit), and
the app's references (`reference.load_refs`) and the weapon picker's wiki rows read those in place of the wiki's, which are the same numbers
rounded (Compound Bow's 454 base ATK is 454.36). With the rounded ones, four swaps were 0.05 to 0.08 points off GO, an error of the planner
itself; 1- and 2-star weapons stop at level 70 and keep the reference's.

The first run found a fault in the planner's tested stats: a set whose 2-piece gives "Pyro DMG Bonus, for a Pyro character" (ten sets give their element's
bonus so) was left out of `statsWith`'s 2-piece swap, as the sets' `two` listed only the stats that hold for everyone, while the engine takes the 2-piece
plain stats to be `statsWith`'s; Hu Tao's swap to Crimson Witch was 10 points off GO's. `views.characters.set_two` now lists the bonus of the character's own
element in the sim block and in the picker route asked for with her key.

## The team a character's damage depends on: `party`

Some characters' damage depends on who is in the team: a passive by the number of elements (Yelan), hits that take an element of
the team (Chasca, Ifa, Prune, Heizou), hits only some teams deal (Zibai's Moonsign hit, and the Stellar hits of Qiqi, the Traveler
(Cryo) and Vesna, which replace the ordinary ones when the team sets up a Stellar reaction). Her decision file's `party` names the team
shapes (`options`: an `id`, a `label` the page shows, the `team`, the elements of the other members, `moonsign` for how many of them are
Moonsign characters, `states` for the GO conditionals the shape sets, and `elements` for the rows that take the team's element), the
usual one (`default`) and why (`reason`), the rows that take the team's element (`element_rows`, a talent's row names; the hit is one
of the shape's elements, each as likely as the rest, so each is a row with an equal share) and the rows only some shapes deal
(`only_rows`: talent, row, the options that deal it). kitgen reads her sheet once for each shape (`kitgen.party_reads`: the tally of
each element, how many elements, how many Moonsign characters, the states) and an effect that differs by shape holds `party`, the
shapes it holds for; terms that read the party and are still undecided stay `left_out`. The interface (`damage.resolveParty`) resolves
her hits for the shape the player chose (the verdict's Team line), the usual one until then. The comparison sets GO to the usual
shape: `cases.json` carries `team`, `moonsign` and `party` for her cases and `specs/gb-compare.spec.ts` adds one member for each
other element, with that element's tally and, for the first `moonsign` of them, a Moonsign flag, and GO's states are the shape's. The
members have nothing else of their own, so GO adds Elemental Resonance for two of one element and the engine does not (it is not
modelled): choose a shape's `team` with no two members of an element her damage reads a resonance of (Yelan's two-element shape is
Hydro and Pyro only). `reads` (a decision file's, apart from `party`) fixes what only she can say of the party: Linnea is a Moonsign
character and the active one.

## What is where

| File | Holds |
|---|---|
| `specs/gb-kit.spec.ts` | The extractor: every Waverider sheet's effect data (`premod`, `total`, `teamBuff`, each hit's own data, infusions) as JSON trees |
| `specs/gb-match.spec.ts` | The hit matcher: each damage hit's move, element, Lunar or Stellar kind, formula, and the datamined parameter its multiplier is, with the rows that print it |
| `specs/gb-compare.spec.ts` | The comparison: each case of cases.json in both builds, every talent hit's average damage and her base values |
| `specs/gb-tree.ts` | The node-to-JSON helper the specs use |
| `compare.py`, `cases.json` | The comparison's cases, the fixture our engine runs on, GO's hits matched to our rows |
| `kitgen.py` | Reads the trees: simplifies each effect for her alone, reads it as `gate(min(rate × max(stat − over, 0), cap))`, names the rows, merges the decision files; writes kits.json and its schema |
| `run.py` | Runs the above (`kits`, `compare`, `compare --only`, `sheet`, `queue`, `refresh`) |
| `refresh.py` | The pure part of `run.py refresh`: which sheets changed between two extractions and which decision files that puts aside in `decided/_stale/` |
| `sheet.py` | The decision sheets, one page per character (see above) |
| `work_queue.py`, `dbcopy.py` | The queue of characters to decide, and the read of a copy of the app's database (see above) |
| `web/src/pages/characters/comparison.ts`, `toggles.test.ts` | Our engine on a fixture of the comparison's shape: `compare.test.ts` (the comparison) and `toggles.test.ts` (the sheets' damage of each toggle) run it |
| `decided/<key>.json`, `decided/_about.json` | Written by a person, one file per character (`kitgen.load_decided`): the toggles of a character with decisions (on or off, a label in our own words, the reason), her main rows, fixed modes and, for Sandrone and Odette, the Stellar kind their hits are (`stellar`: the other kind's rows are listed in the planner, not counted); `unsure`, the sentence her verdict gives when the comparison could not prove her kit; `party`, the team shapes her damage depends on (above); `reads`, the reads of the party only she can state. A file with a decision makes her checked; a file of `unsure` alone is a character not decided yet. `_about.json` holds the text that says what the files are. A new decision is a new file, so characters decided in parallel never edit the same one |
| `decided/weapons/<key>.json`, `decided/sets/<key>.json` | Written by a person, one file per weapon or set (the key of kits.json's `weapons` and `sets`; see "Gear decisions"). Never read as a character's, and never by `decided/_stale/` |

The specs and these scripts are Guild Board's own (MIT); they import GO's libraries only when copied into a GO checkout.

## How a kit is read (go-engine.md, sections 2 and 3)

- **Effects.** Each stat a sheet adds is simplified with her as the active character and the target; terms that read
  the party (`tally`, `nonStacking`, another member) are listed under `left_out` ("depends on the party"). An effect adds
  `min(rate × max(stat − over, 0), cap)` to its bucket, `over` in the stat's own units (Raiden's A4: ER over 1.0, that
  is 100%), `cap` × base ATK when `cap_from` says so; with no `from` stat it adds `rate`. Gates on ascension, constellation, set pieces, the move
  (`hit.move`) and the weapon type become the Effect's gates. A term that reads one of her states (a GO conditional) is
  read at the state decided for it (else the one that gives the most) and written `while` that toggle. What is not of the
  Effect's form is listed under `left_out` with the reason, never guessed.
  Two more shapes are read: an effect that also multiplies by her Healing Bonus (`times: "heal"`, Kokomi's A4 is 15% of Max HP times it,
  read before or after the conversions as its first stat is), and a count that only her constellation changes (Odette's A1 is 4 below
  Constellation 1, 0 from 1 and 6 from 6), which is one effect for each constellation it changes at, gated there, each adding the change
  (`kitgen.constellation_steps`), so that they add up to the count at every constellation. A gate that her constellation alone decides, in a
  form other than `constellation >= N`, is read as that gate when `linear` cannot read the term as it is (`kitgen.by_constellation`):
  `constellation == 6` (Alhaitham's C6), `(constellation >= 4 ? 1 : 0) == 1` (Xingqiu's C4) and a count that is 1 or more at every
  constellation (`add(constellation >= 6 ? 1 : 0, 1.0) >= 1`, Nicole's and Vodyanitsa's) are a gate from where they start (or none), and
  a list read by a count of her constellation (Chasca's A1 by the elements of the team and Constellation 2) is a step at each constellation
  it changes at. A gate that holds only between two constellations stays left out, with `linear`'s reason.
- **Infusions.** GO's own infusions (`infusion.overridableSelf` and `nonOverridableSelf`; the party's `team` ones are left out) make her
  Normal, Charged and Plunging hits an element while the state that gives it is on, or always. Each is `{talents, element, while}` in
  kits.json's `infused`, and `from_ascension` or `from_constellation` for a gate (Chiori's A1, Dori's C6), which `kits.kit_of` checks
  at the player's, so the planner is given only the infusions that hold, and `party` for a character whose damage depends on the team
  (the Traveler (Cryo)'s A1 is read in the Stellar-Conduct shape only). The hits' own element, when a state decides it (`ele_tree` of
  gb-match: Aloy's Rushing Ice and Yoimiya's Niwabi Fire-Dance make her Normal Attack Cryo and Pyro), is an infusion of that hit's move.
  The engine turns a physical row of an infused move into the infusion's element: that element's DMG Bonus and reactions, not Physical.
  An infusion that reads anything else is left out ("an infusion the engine does not read"). A multiplier a state gives by talent level
  (Yoimiya's Niwabi Fire-Dance, Wanderer's Windfavored: `1.379` at Skill level 1) is a `mult` effect with the part over one.
- **Stacks.** A state that adds to a hit's multiplier for each stack, `(base by talent level + per stack by talent level x the state's count)
  x ATK` (Eula's Lightfall Sword, Raiden's Resolve), is a `mult` effect behind the state's toggle on the row the hit prints: its rate is
  the stack part over the base for each talent level, times the count the toggle's state gives (`kitgen.stack_multipliers`). A row of
  several hits adds their stack parts and divides by the sum of their bases; "Low/High Plunge DMG" is its low hit's, as the planner counts
  it; a row some of whose hits have no stack part, or whose alternatives have different ratios, is left out with the reason.
- **Rows with one name in two talents.** A row is its talent and its name: Skirk's Normal Attack and her Skill both have a "1-Hit DMG", and
  Cyno's Burst has the Normal Attack's five. An effect GO gives to the hits of one of them is `merge_per_hit`'s effect for that talent's
  rows, with `in_talent` naming the talent (the engine reads `hits` as the names of that talent's rows); a name only one talent has, or one
  every talent that has it holds the effect on, has no `in_talent`.
- **Hits that print each other's rows.** Hits whose numbers are one list name each other's parameters (the Traveler (Hydro)'s Dewdrop and
  Spiritbreath Thorn hits both list parameters 0 and 2); `kitgen.tie_rows` gives each the rows that print one of its own parameters before
  an effect goes to a row (`_own_params`). A slash row (`{{a}}%/{{b}}%`, not a Low/High plunge) prints one hit for each alternative, and
  the planner has a row of its own for each (`<name>`, `<name> (2 of 2)`): an effect only some alternatives have names those rows (`hits`:
  `<name> (1 of 2)` for the first, the row's own name for every alternative; Nilou's Constellation 1 Skill DMG Bonus is the Luminous
  Illusion's). A row whose alternatives are hits dealt by a state (Mualani's Sharky's Bite by Wave Momentum, Wriothesley's Charged Attack
  with and without his Rebuke) is the first hit's in the engine and in the comparison, and an effect only the others have is left out.
- **The ground impact of a plunge.** GO's `plunging_impact_dmg_`, `_dmgInc`, `_critRate_` and `_critDMG_` (Varesa's A1 and Constellation 4,
  Xianyun's A4, Albedo's and Furina's) are the engine's plunging buckets for the rows of the hits whose
  move is `plunging_impact`: the sheet's is given to each of those hits (`read_effects`' `impact_found`), a hit's own data keeps it only for
  an impact hit (the Plunge DMG hit of Varesa carries hers, and is a collision, which GO's formula does not read it for), and the rows
  merge as any hit's effect does. The Plunge DMG row (the collision) is not reached; the Low/High Plunge rows and a Skill's or Burst's
  plunging attacks are (Xianyun's Driftcloud Wave, Varesa's Volcano Kablam).
- **Two states at once.** A term that reads two or more of her states (Kaveh's A4 after his Burst, by its stacks; Yoimiya's A1 in her Skill,
  by its stacks) is one effect behind all of their toggles: `while` is the first and `also` the others, every one of which must be on
  (`kitgen._add`; `damage.ts` holds the effect while all are on and counts them all). Each state is read at the state its toggle is decided
  at. The term must give nothing when any one of its states is off (`kitgen._all_needed`: each state set to a value no state has, the term
  folds to zero), so that "all of them" is what it says; a sum of states any of which is enough (Durin's C2 elements) or a factor that is 1
  without its state (Skirk's A4 stacks) is left out with that reason. The states of the party's modes are ordinary toggles here too: GO names
  them `lock...` (Hexerei's Secret Rite, `lockHomework`: Albedo, Klee, Mona, Razor, Venti; a Stellar Revelation, `lockRevelation`: Beidou, Cyno,
  Diona, Wriothesley, Yae Miko, Yumemizuki Mizuki), `...StellarRadiance...` (the kind her Stellar hits are: Alyosha, Valeriy) or `lockedPassive` (the
  Traveler's locked passive and its seven element states, which GO sets from the party). A term of such a state beside one of hers is an
  effect `while` the mode's toggle and `also` hers (off by default, with our own label and reason) when it reaches a row of hers
  (`kitgen.reaches`, the engine's `reachesRow` over every row she has, her elements being those her rows can deal: `elements_dealt`); when it
  reaches none it is left out for a team-mode decision (Cyno's C2 and Valeriy's, Wriothesley's and Yae Miko's Stellar-Conduct bonuses, since
  none of their rows is one). A term of two states that starts at Constellation 3 or above (Albedo's, Beidou's, Furina's, Mika's... mostly C6) is an
  effect behind both toggles like any other, off until a person decides them. Left out, each with its reason: a term that gives
  something when one of its states is off (13) and a DMG bonus to an element none of her rows deals (Durin's C2 for the others; the Traveler
  (Dendro)'s C6). The decision sheet measures a toggle alone and, for an effect that needs other states, with them beside it.
- **One entry, two hits by a constellation.** A display entry of GO's sheet with a damage node in more than one branch of a gate (Nefer's
  second Phantasm Performance hit: Lunar-Bloom from Constellation 6, an ordinary ATK and Elemental Mastery hit below it) is a hit for each in
  gb-match.json (`gb-match.spec.ts`; the later ones are named `<name>~<n>`, `shown` says the entry, and gb-kit.json's `hit_data` has theirs).
  GO evaluates the entry once, so the comparison reads a later branch's value from the entry's (`compare.evaluated`). Each hit prints the
  rows whose parameters it has and carries its constellation window, so Nefer's row is gated `below: 6` and her Constellation 6 hit (no row
  of HoYoLAB's prints it) is left out: from Constellation 6 that row is not counted.
- **Rows no row of HoYoLAB's prints (`derived_rows`).** A Skill or Burst hit whose numbers are another talent's parameters, and that no row of
  its own talent prints, is nothing the planner could count (Sethos's Burst: four Dusk Bolts, GO's `burst.dusk_0` to `dusk_3`, read his Normal
  Attack's parameters 0 to 3 and were silently counted as his Normal Attack rows' own hits, so his Burst had no row). A person gives each such
  row in the decision file: `{talent, name, from_talent, from_row, hits}`, the name in our own plain words, `from_row` the row whose numbers it
  has, `hits` the GO hits that deal it (checked: they exist and read that row's parameters alone, else the run stops). kitgen gives the hits the row (their
  kind, element and move are the row's; `kits.json` keeps `derived_rows` without the hits), the effects on those hits become effects on the row
  (Sethos's Burst bonus, a share of Elemental Mastery by Burst level, is on the three Dusk Bolt rows and is the Burst row it is), `simhits`
  copies the source row's value at the copied talent's level (a row only when the copied row is there) and the comparison reads GO's hits for it
  from the decision file. His Burst is a counted talent when he has levelled it to within one level of his highest talent (spec 12.2).
- **Left out on purpose (5c-2), with the characters each touches.** Each is listed in the character's `left_out` with its reason.
  A team-mode decision (4 terms): Cyno's C2 and Valeriy's, Wriothesley's and Yae Miko's Stellar-Conduct bonuses, which no row of theirs takes.
  A sum of states any of which is enough or a factor that is 1 without its state (13: Durin's C2 Pyro bonus, Skirk's Burst by her A4
  stacks, Mavuika's A4, Columbina's C6, Diona's, Klee's, Valeriy's, Venti's and Wriothesley's): an effect behind "any of" several toggles. Varka: his
  Skill's and Burst's rows are two strikes in one row, the first of the element his team has (Pyro before Hydro, Electro and Cryo, Physical with none)
  and the second Anemo; counting them needs a row with an element for each part and the team's priority, a model the planner does not have (his
  `unsure` stays). The Traveler (Electro)'s Constellation 6 third thunder is a hit of the Falling Thunder row shown from Constellation 6 (a row
  count that changes with the constellation). Nefer's Constellation 6 Lunar-Bloom second Phantasm hit prints no row of
  HoYoLAB's. Gear: nine weapons (Vortex Vanquisher, The Unforged, Summit Shaper, Memory of Dust, Azurelight, A Thousand Blazing Suns, Starsealed
  Edict, Fractured Halo, Hymn of the Maelstrom) and two sets (Vermillion Hereafter's 4-piece, Nighttime Whispers in the Echoing Woods) have an effect
  behind two toggles now. Five of them have a decision file now (the stacks of Vortex Vanquisher, The Unforged, Summit Shaper and Memory of
  Dust on, their Shielded toggle off; Fractured Halo's ATK on, its shield toggle off) and their swaps' `:on` cases, with both toggles on,
  agree with Genshin Optimizer; the other four weapons and the two sets are off by default and were never checked against it.
- **Rows.** A hit's multiplier array equals one datamined parameter; the rows whose encoding prints that parameter are
  its rows (for the few talents where GO lists fewer parameters than the encodings count, the n-th named parameter is
  GO's n-th). Rows with the same numbers are told apart by the hit's kind. Rows split from one "/" row of the wiki's
  table (an `alternative` group) are each counted once, as spec 12.2 counts each row once; the percent change is
  unaffected when the variants share their scaling stat, and the comparison with GO agreed with this choice.
- **Already on the panel (`in_stats: true`).** HoYoLAB's panel, which stage 1's `statsWith` starts from, already holds
  some effects of what she wears: a set's always-on plain stats (statsWith swaps the 2-piece ones), her weapon's
  always-on plain passive stats (Staff of Homa's HP%, Mistsplitter's elemental DMG), and her innate stats (GO's
  `baseStats`, such as Mitya's and Nefer's 100 EM: her own stats, like base HP). The plain stat of an ascension passive
  (`from_ascension` alone: Xingqiu's A4 Hydro DMG) is marked too: it is on the panel (the audit's "panel question"). Constellation,
  conversion and conditional effects are not marked: the panel leaves them out (verification.md W7, checked on Raiden; the audit's
  "panel question"). **The engine's rule:** an `in_stats` effect is never added for her own weapon or her own sets; it is added
  only for a tested weapon or set that is not hers (and hers taken out), because the panel holds hers and not the
  tested one's.
- **Decided toggles.** Every toggle of a character with a decision file must be decided there, or the build stops; a
  character there gets `checked: true`. `run.py kits` does not stop for it: a toggle her sheet has that her file does not decide (a
  state her new effects read, as when the C0-C2 boundary went) is written off, with its code name in words, and the run lists the
  character and the toggle ("decided characters have toggles that await a decision") until a person decides it in her file.
- **Characters GO has and the game does not (`kitgen.NOT_IN_GAME`).** A table of GO's key to why: kits.json leaves them out, no decision
  file may name them, and the run prints whom it left out (Somnia, the player, 2026-11-15). It is not a filter on the app's inventory file,
  which lacks Mitya and Valeriy, who are in the game.
- **Gear decisions.** A weapon's or set's toggles are off, and offered in the planner's "Not counted:" line (when they reach a counted row), until a file decides them (next section). The label of every such toggle is ours, in `decided/_gear-labels.json` (`<key>:<name>` to a phrase, shown as "<item>: <label>"); `kits` stops if one is missing, so a refresh that brings a new item says so. Only labels are decided there: the toggles stay off.

## Refresh for a new game version

About a week after GO's "Add <version> content" commit:

    uv run python tools/go-reference/run.py refresh <the whole new commit> --dry-run     (what would change; moves and writes nothing)
    uv run python tools/go-reference/run.py refresh <the whole new commit>

With GO at the pinned commit it extracts the old pin's kits (into `refresh-old` in the output folder), fetches and checks out the
new commit in the checkout (`git fetch --depth 1 origin <commit>`, GitHub is GO's host; it is the only network use), extracts again
and builds kits.json's characters, weapons and sets from both extractions (`refresh.py`, which has no GO and no network in it).
Both are built with the decisions as they are now (a character's, a weapon's and a set's), so a decision is never itself a change; what differs between the builds is a
changed sheet: a character's rows, elements, moves, infusions, effects, toggles and their states, what is left out; a weapon's or
set's effects and toggles. A decided character is read at the states her file names, so her states (each conditional's list of them) and her build with no decision are compared too, to see GO add a state or change a number at another. A decision the new sheet does not fit (GO renamed or dropped a state her file decides, or one of her
main rows) counts as a change of her sheet too. It prints every changed, new and removed character, weapon and set with what
differs, and then:

- **Decisions of changed characters are reset to undecided.** Each changed (or removed) character's `decided/<key>.json` is moved
  to `decided/_stale/<key>.<old commit's first 8>.json`, outside the folder `kitgen.load_decided` reads (it reads `*.json` of the
  folder alone), so she is undecided; the file stays in git for a person to decide again from the old answer. Every moved key is
  printed. When a character is decided again (a new `decided/<key>.json`), delete her `decided/_stale/<key>.*.json`. A weapon or set with a decision file (`decided/weapons/<key>.json`, `decided/sets/<key>.json`) is treated the same: its file moves to `decided/_stale/weapons/` or `sets/` when its sheet changed. A new character, weapon or set has no file.
- The pin moves in `run.py`, `setup.ps1`, this file and `THIRD-PARTY-NOTICES.txt` together (the README's description of the commit becomes its date).
- `kits.json` and its schema are written for the new commit with the decisions that are left.
- The comparison runs for all (`compare`), unless `--no-compare`.

It starts only when the old pin builds with `decided/` as it is (no build error, no decision for a character the old pin lacks), builds the new kits and the pin files' new text in memory before writing anything, and puts GO's checkout back at the old pin if it stops before the first write. `--new-from` without `--no-compare` needs GO at the new commit already (it is checked first).

`--dry-run` prints what would change, moves no file, edits no pin and writes no kits.json, and leaves the checkout at the old pin.
`--old-from DIR` and `--new-from DIR` read earlier extractions (folders with `gb-kit.json` and `gb-match.json`) instead of running
GO, with no fetch: the new commit still has to be GO's checkout for the comparison. If GO's packages changed with the commit, vitest
fails and the checkout is put back; run `setup.ps1` with the new commit then. Afterwards: re-decide the characters in `decided/_stale/`
and the new ones in `decided/<key>.json`, and run `uv run pytest tests/test_characters_kits.py`.
