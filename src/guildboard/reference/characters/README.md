# The Characters reference

Made at build time by the scripts in `tools/research/` and the research runs of the Characters pages. Guild Board only reads these files; it never
fetches them. Checked 2026-10-29 and 2026-10-30, for game version 7.1.

| File | Holds | Made by |
|---|---|---|
| `schema/*.json` | One JSON Schema per file below | Task 1 |
| `inventory.json` | 127 released characters, 252 weapons and 63 sets from the HoYoLAB wiki: keys, names, entry ids, elements, weapon types, rarities, icons; for characters also version, ascension stat, local specialty, and the art's and the chart's addresses | `inventory.py` |
| `stars.json` | Six constellation stars per chart, C1 to C6, in the chart's pixels (119 charts) | `stars.py`, with `stars_corrections.json` |
| `cards/<key>.json` | One card per released character: role, damage talent and its table, scaling stat, goals, main stats, weights, sets, weapons, partners, pronouns, sources and confidence (56 high, 68 medium, 3 low) | `builds.py` drafts, then four agents |
| `weapons.json`, `sets.json` | Base stats at level 90 and the passives' and set bonuses' stat effects, per refinement | `weapons.py`, `sets.py`, from the hand-written `tools/research/effects/*.txt` |
| `tables.json` | Yields per run, artifact main stats and odds, substat weights and average rolls, talent scaling, reactions, and EXP to each level (cumulative from level 1) | `tables.py` |
| `flowers.json` | 60 local specialties: places and how many one pass of the map's harvest route gives | `flowers.py` |

## Sources

- The HoYoLAB wiki (`sg-wiki-api.hoyolab.com`) for the inventory, kits, weapons, sets and specialties.
- KQM's Quick Guides and Game8's "Best Builds and Teams" pages for the cards, with genshin.gg or genshin-builds.com as a
  third source for the lowest-confidence cards.
- The AnimeGameData datamine, the fandom wiki's Loot System pages and Genshin Optimizer's constants for the tables.
- The official HoYoLAB interactive map for the flowers' counts.

Each file and card names its sources with their addresses and the date checked.

## Open items

- Left out of the inventory, which needs an element, a weapon type and a rarity: the Traveler with no element,
  Manekin and Manekina, and Valeriy and Mitya (7.2, not out yet). An owned character without a card falls back to the
  role's defaults (design §5).
- 11 released characters have no constellation chart on the wiki (most Travelers, Manekin, Manekina, Lohen, Nicole),
  so they have no stars; their profile draws the ring.
- Forked and closed-loop charts keep an order chosen by eye (medium confidence); no source gives the game's own order. On 39
  charts the lines fork, so no order follows them all and at least one step joins two stars the chart does not join.
  `tools/research/stars_check.py` (`npm run proof:stars` first) measures the stars on the real page.
- Goals no source gives are left out of the cards; the app fills them from the role's defaults.
- `yields.weekly` (0.8 of each material a claim) and the flowers' route counts are not confirmed by a second source.
- Sets carry no version on the wiki; none was found newer than 7.1.
- Every card's `teams` is empty: the sources give no team lists. The endgame builds teams by itself.

## Adding a version's new characters

1. Run `uv run python tools/research/inventory.py`, then `uv run --with pillow python tools/research/stars.py` and look at
   the new characters' contact sheets.
2. Run `uv run python tools/research/builds.py` for the new drafts. Its Game8 lookup goes through the site's menu, which
   missed Lan Yan once; check a new character that seems missing by hand.
3. One agent writes the new characters' cards as in R3, Steps 2 and 3, and runs
   `uv run pytest tests/test_characters_reference.py -q`.
4. New weapons and sets: add their effects to `tools/research/effects/` and run `weapons.py` and `sets.py`.

Until then, the app's fallback covers a new character (design §5).
