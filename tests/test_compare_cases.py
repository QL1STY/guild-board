"""The comparison of the damage engine with Genshin Optimizer's Waverider (tools/go-reference/compare.py, the Plan design 14.6):
the cases file covers every character with a kit, as the comparison's rules set them, and every case of a character whose kit is
not marked unsure agreed with GO within 0.05 percentage points on every main talent. web/src/pages/characters/compare.test.ts
holds our engine to its pinned answers; here the fixture's inputs are held to what the core makes of the kit data today."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"
CASES = json.loads((TOOL / "cases.json").read_text(encoding="utf-8"))
FIXTURE = json.loads((ROOT / "web" / "src" / "fixtures" / "compare-cases.json").read_text(encoding="utf-8"))
KITS = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))


def _compare():
    sys.path.insert(0, str(TOOL))
    spec = importlib.util.spec_from_file_location("compare", TOOL / "compare.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


compare = _compare()
from guildboard.characters.hits import is_damage  # noqa: E402


def test_every_character_with_a_kit_has_two_swaps():
    by_character: dict[str, set[str]] = {}
    for case in CASES["cases"]:
        by_character.setdefault(case["character"], set()).add(case["swap"])
    # and each kit (her own, and at a constellation) has both of them
    by_kit: dict[str, set[str]] = {}
    for case in CASES["cases"]:
        if case["reaction"] is None and case["set"] == compare.SET:
            by_kit.setdefault(case["kit"], set()).add(case["swap"])
    assert all(swaps in ({"sands", "goblet"}, {"sands", "goblet", "circlet"}) for swaps in by_kit.values())
    with_rows = {key for key, c in KITS["characters"].items() if any(c["hits"].values())}
    assert set(by_character) | set(CASES["skipped"]) == set(KITS["characters"])
    assert set(by_character) >= with_rows - set(CASES["skipped"])
    assert all({"sands", "goblet"} <= swaps <= {"sands", "goblet", "circlet"} for swaps in by_character.values())
    assert len(by_character) >= 120


def test_the_builds_follow_the_rules():
    for case in CASES["cases"]:
        # constellation 0, or the one her extra cases are at (a decided state or a row that needs one: `constellation_of`)
        assert case["constellation"] == (0 if case["kit"] == case["character"] else compare.constellation_of(case["character"])), case["id"]
        assert case["kit"] == compare.kit_key(case["character"], case["constellation"]), case["id"]
        assert case["talents"] == {"auto": 10, "skill": 10, "burst": 10}, case["id"]
        assert case["weapon"] == compare.WEAPONS[case["weapon_type"]], case["id"]
        assert case["set"] == compare.SET or (case["character"], case["set"]) in compare.SET_CASES, case["id"]
        a, b = case["mains_a"], case["mains_b"]
        assert a["goblet"] == f"{case['element']}_dmg_"
        assert a["circlet"] == "critDMG_"
        changed = {slot for slot in a if a[slot] != b[slot]}
        assert changed == {case["swap"]}, case["id"]
        if case["swap"] == "sands":
            assert b["sands"] == ("atk_" if case["scaling"] == "em" else "eleMas")
        elif case["swap"] == "circlet":
            assert b["circlet"] == "critRate_"
        else:
            assert b["goblet"] == compare.PERCENT_OF[case["scaling"]]
        for build in (case["a"], case["b"]):
            assert len(build["pieces"]) == 5 and {p["set"] for p in build["pieces"]} == {case["set_go"]}


def test_the_decided_states_are_gos_states_too():
    hu_tao = next(c for c in CASES["cases"] if c["id"] == "hu-tao:sands")
    assert hu_tao["conds"] == {"HuTao": {"GuideToAfterlifeVoyage": "on"}}
    sandrone = next(c for c in CASES["cases"] if c["id"] == "sandrone:goblet")
    assert sandrone["conds"]["Sandrone"] == {"a0StellarRadianceSc": "on"}
    assert sandrone["conds"]["reaction"] == {"polestarStacks": "12", "oppInsidePole": "on"}
    ayaka = next(c for c in CASES["cases"] if c["id"] == "kamisato-ayaka:goblet")
    assert set(ayaka["conds"]["KamisatoAyaka"]) == {"afterSprint", "afterApplySprint", "afterSkillA1"}
    furina = next(c for c in CASES["cases"] if c["id"] == "furina:sands")
    assert "Furina" not in furina["conds"]                                  # Fanfare off on both sides


def test_the_constellation_cases_stand_beside_the_constellation_0_ones():
    # every character with a decided state on that needs a constellation, or a row only a constellation deals, is compared at it as well
    extra = {c["character"]: c["constellation"] for c in CASES["cases"] if c["constellation"]}
    assert extra == {key: compare.constellation_of(key) for key in KITS["characters"] if compare.constellation_of(key)
                     and key not in CASES["skipped"]}
    assert len(extra) >= 15 and {"yanfei", "mavuika", "keqing", "arlecchino", "yae-miko", "varesa"} <= set(extra)
    for key, constellation in extra.items():
        ids = {c["id"] for c in CASES["cases"] if c["character"] == key and c["constellation"]}
        base = {f"{key}:sands@c{constellation}", f"{key}:goblet@c{constellation}"}
        # a constellation that gives CRIT also has the circlet swap, at that constellation and at 0 (the sands and goblet ratios cancel a
        # CRIT bonus that reaches every row)
        crit = compare.reaches_crit(FIXTURE["kits"][f"{key}@c{constellation}"])
        assert ids == base | ({f"{key}:circlet@c{constellation}"} if crit else set()), key
        zero = {c["id"] for c in CASES["cases"] if c["character"] == key and not c["constellation"]}
        assert {f"{key}:sands", f"{key}:goblet"} <= zero and (f"{key}:circlet" in zero) == crit, key
    assert {"lyney", "neuvillette", "clorinde", "arlecchino"} <= {k for k in extra if f"{k}:circlet" in {c["id"] for c in CASES["cases"]}}


# a character whose answers at her constellation the comparison cannot tell from the ones at 0 (columbina today): named here, with the reason, and in the README
INVISIBLE: dict[str, str] = {
    "columbina": "Her Constellation 1 and 2 Lunar-Charged elevation raises every counted row alike, so the ratios of the sands and goblet swaps "
                 "cancel it, and no swap of the comparison's separates it from her answers at 0.",
    "qiqi": "Her Constellation 2 ATK bonus holds only in the Stellar-Conduct team shape, and her usual team is the one with no Stellar team; "
            "the rest of her Constellation 2 is a state that is off.",
    "traveler-anemo": "Her Constellation 2 is Energy Recharge, which none of her counted rows scales on.",
}


def test_each_constellation_moves_an_answer_against_its_constellation_0_one():
    # a CRIT bonus on every row cancels in the sands and goblet ratios, an effect on rows the swap leaves alone does not show: the
    # character's answers at her constellation must differ from the ones at 0 somewhere (ours, pinned), or she is named in INVISIBLE
    ours = {c["id"]: c["ours"]["talents"] for c in FIXTURE["cases"]}
    at = {c["character"]: c["constellation"] for c in FIXTURE["cases"] if "constellation" in c}
    for key, constellation in at.items():
        moved = False
        for swap in ("sands", "goblet", "circlet"):
            low, high = ours.get(f"{key}:{swap}"), ours.get(f"{key}:{swap}@c{constellation}")
            if low is not None and high is not None and any(
                    (low[t] is None) != (high[t] is None) or (low[t] is not None and abs(low[t] - high[t]) > 1e-6) for t in low):
                moved = True
        assert moved or key in INVISIBLE, f"{key}: no answer at c{constellation} differs from its c0 one"
    assert all(key in {c["character"] for c in FIXTURE["cases"]} and reason for key, reason in INVISIBLE.items())
    # the circlet swap is there to show a CRIT bonus the others cancel: where it exists it moves too
    for key, constellation in at.items():
        low, high = ours.get(f"{key}:circlet"), ours.get(f"{key}:circlet@c{constellation}")
        if low is not None:
            assert any(low[t] is not None and abs(low[t] - high[t]) > 1e-6 for t in low), f"{key}: the circlet swap shows no CRIT bonus"


def test_every_constellation_case_agrees_with_gos_or_its_character_says_why():
    # a disagreement at a constellation is fixed, or the state is off in her decision file, or she is `unsure`: never left as is
    unsure = {key for key, c in KITS["characters"].items() if c.get("unsure")}
    high = [c for c in FIXTURE["cases"] if "@c" in c["id"]]
    assert len(high) >= 30
    for case in high:
        assert case["constellation"] and case["kit"] == f"{case['character']}@c{case['constellation']}", case["id"]
        assert compare.agreement(case)[0] or case["character"] in unsure, case["id"]


def test_a_few_cases_have_a_reaction_on():
    reactions = {(c["character"], c["reaction"]) for c in CASES["cases"] if c["reaction"]}
    assert reactions == set(compare.REACTION_CASES)
    assert {r for _, r in reactions} == {"vaporize", "melt", "aggravate", "spread"}


def test_every_case_ran_in_go_and_every_sure_one_agreed():
    unsure = {key for key, c in KITS["characters"].items() if c.get("unsure")}
    assert len(FIXTURE["cases"]) == len(CASES["cases"])
    failed = []
    for case in FIXTURE["cases"]:
        assert "error" not in case, case["id"]
        assert case["ours"] and case["go"], case["id"]
        agreed, notes = compare.agreement(case)
        if not agreed and case["character"] not in unsure:
            failed.append((case["id"], notes))
    assert failed == []


def test_yanfeis_five_seal_charged_attack_is_not_counted_below_constellation_6():
    # GO deals it only from Constellation 6 (`charged.4`): the planner counted it at 0 and her Normal Attack answer was off
    low = FIXTURE["kits"]["yanfei"]["talents"][0]["rows"]
    high = FIXTURE["kits"]["yanfei@c6"]["talents"][0]["rows"]
    assert {r["name"]: r["main"] for r in low}["Charged Attack (5 of 5)"] is False
    assert {r["name"]: r["main"] for r in high}["Charged Attack (5 of 5)"] is True
    assert KITS["characters"]["yanfei"]["unsure"] is None and compare.agreement(next(c for c in FIXTURE["cases"] if c["id"] == "yanfei:goblet"))[0]


def test_every_unsure_character_disagreed_somewhere():
    # `unsure` is for a disagreement the comparison found, not a shrug: each such character has a case that did not agree
    unsure = {key for key, c in KITS["characters"].items() if c.get("unsure")}
    disagreed = {c["character"] for c in FIXTURE["cases"] if not compare.agreement(c)[0]}
    # Yoimiya and Aloy were unsure because their Normal Attack's element is a state's (Niwabi Fire-Dance, Rushing Ice): both sides had
    # it physical. The infusion is read now, with the state decided on, and both agree
    assert unsure == disagreed and not unsure & {"yoimiya", "aloy"}


def test_the_checked_characters_all_agreed_but_those_marked_unsure():
    # the checked set is the decision folder's (more files, more characters: no test lists them), and a decided character who
    # disagrees with GO must say why (`unsure`); Yelan was the first of them, until the party settings proved her kit
    checked = {key for key, c in KITS["characters"].items() if c["checked"]}
    decided = {p.stem for p in (TOOL / "decided").glob("*.json") if not p.stem.startswith("_")
               and set(json.loads(p.read_text(encoding="utf-8"))) - {"unsure"}}
    assert checked == decided and {"yelan"} <= checked
    unsure_checked = {key for key in checked if KITS["characters"][key].get("unsure")}
    disagreed = {c["character"] for c in FIXTURE["cases"] if not compare.agreement(c)[0]}
    assert disagreed & checked <= unsure_checked
    assert {"varka"} <= disagreed & checked   # Nefer's hit GO shows below Constellation 6 is read now, and she agrees


def test_the_fixtures_blocks_are_what_the_core_makes_now():
    # one hits block for each character, and one more for her kit at the constellation her extra cases are at (`yanfei@c6`)
    constellations = {c["kit"]: c["constellation"] for c in CASES["cases"]}
    assert set(FIXTURE["kits"]) == set(constellations) and set(CASES["affixes"]) <= set(FIXTURE["kits"])
    for name, own in FIXTURE["kits"].items():
        key = name.split("@")[0]
        affixes = FIXTURE["affixes"].get(name) or CASES["affixes"][key]
        again = json.loads(json.dumps(compare.block(key, affixes, FIXTURE["levels"].get(name), constellations[name])))
        kind = KITS["characters"][key]["weapon_type"]
        assert again == {**own, **FIXTURE["gear"][kind]}, f"{name}: run tools/go-reference/run.py compare"
    # a talent a passive raises (his first passive raises Tartaglia's Normal Attack) or a constellation does (3 and 5 give a Skill and a
    # Burst 3 levels) is read at the level GO's hits are
    assert FIXTURE["levels"]["tartaglia"] == {"normal": 11, "skill": 10, "burst": 10}
    assert all(name.split("@")[0] == name or "@c" in name for name in FIXTURE["levels"])


def test_only_hit_rows_of_the_games_text_are_kept():
    for affixes in (CASES["affixes"], FIXTURE["affixes"]):
        assert all(is_damage(name) for rows in affixes.values() for talent in rows.values() for name, _ in talent)


def test_every_rows_move_is_the_move_of_gos_hit_for_it():
    # Tartaglia's Riptide Slash is Skill DMG though its numbers are his melee Charged Attack's (the review of 2026-11-14)
    assert FIXTURE["move_mismatches"] == []
    moves = KITS["characters"]["tartaglia"]["moves"]["skill"]
    assert moves.get("Charged Attack DMG") == "charged" and "Riptide Slash" not in moves


def test_a_set_that_raises_charged_or_plunging_attacks_is_compared_too():
    sets = {(c["character"], c["set"]) for c in CASES["cases"] if c["set"] != compare.SET}
    assert sets == set(compare.SET_CASES)
    for case in FIXTURE["cases"]:
        if (case["character"], next(iter(case["sets"]))) in sets:
            assert compare.agreement(case)[0], case["id"]


def _tartaglia(riptide_move: str) -> tuple[dict, dict]:
    """Tartaglia's Skill (GO 2c13fc40, his real numbers at 10): GO's hits and our block's two rows, Riptide Slash with `riptide_move`."""
    same = [{"talent": "skill", "index": 8, "levels": [1.19]}, {"talent": "skill", "index": 10, "levels": [1.19]}]
    char = {
        "weapon_type": "bow",
        "rows": {"skill": [{"name": "Charged Attack DMG", "params": [8, 9]}, {"name": "Riptide Slash", "params": [10]}]},
        "params": {"skill": [[0.0]] * 8 + [[1.19], [1.4229], [1.19]]},
        "hits": [
            {"group": "skill", "name": "charged1", "move": "charged", "ele": "hydro", "variant": None, "params": same, "formula": None},
            {"group": "skill", "name": "charged2", "move": "charged", "ele": "hydro", "variant": None,
             "params": [{"talent": "skill", "index": 9, "levels": [1.4229]}], "formula": None},
            {"group": "skill", "name": "riptideSlash", "move": "skill", "ele": None, "variant": None, "params": same, "formula": None},
        ],
    }
    row = {"kind": "elemental", "terms": [], "flat": 0, "count": 1, "instances": 1, "element": None, "alternative": None, "main": True}
    hits = {"talents": [{"key": "skill", "rows": [{**row, "name": "Charged Attack DMG", "move": "charged"},
                                                  {**row, "name": "Riptide Slash", "move": riptide_move}]}]}
    return char, hits


def test_the_move_check_picks_gos_hit_by_the_rows_own_numbers_not_by_its_move():
    # The check must not take the row's move to choose GO's hit: Riptide Slash written as a Charged Attack (the old fault) is
    # caught, written as Skill DMG it passes (the re-review of 2026-11-14).
    char, wrong = _tartaglia("charged")
    assert compare.move_mismatches(char, wrong) == [{"row": "skill|Riptide Slash", "ours": "charged", "go": "skill"}]
    char, right = _tartaglia("skill")
    assert compare.move_mismatches(char, right) == []


def test_a_character_with_a_party_is_compared_at_her_usual_team():
    # GO gets the same team as the engine's default: the elements the other members add to the tally, how many are Moonsign, and the
    # states the team sets (Qiqi's usual team sets none, so GO's Stellar hits stay off, as the engine's rows are)
    yelan = next(c for c in CASES["cases"] if c["id"] == "yelan:sands")
    assert yelan["party"] == "3" and sorted(yelan["team"]) == ["electro", "pyro", "pyro"] and yelan["moonsign"] == 0
    zibai = next(c for c in CASES["cases"] if c["id"] == "zibai:sands")
    assert zibai["party"] == "moonsign" and zibai["moonsign"] == 1
    assert "lockRevelation" not in CASES_QIQI["conds"].get("Qiqi", {})
    assert "party" not in next(c for c in CASES["cases"] if c["id"] == "hu-tao:sands")
    for case in CASES["cases"]:
        kit = KITS["characters"][case["character"]].get("party")
        assert (case.get("party") is not None) == (kit is not None), case["id"]
        assert kit is None or case["party"] == kit["default"], case["id"]


CASES_QIQI = next(c for c in CASES["cases"] if c["id"] == "qiqi:sands")


# the infusions decided on: each is in a comparison case, with the state that gives it on, at the constellation it needs
INFUSED_ON = {"aloy": "coil", "yoimiya": "skill", "keqing": "afterRecast", "kaveh": "afterBurst"}
# a state decided on that no swap of the comparison can prove: all his Normal rows are Anemo and the multiplier cancels in the ratio
UNPROVEN_ON = {"wanderer": "afterSkill"}


def test_every_infusion_decided_on_is_compared_with_its_state_on():
    found = {}
    for key, c in KITS["characters"].items():
        on = {t["name"] for t in c["toggles"] if t["on"]}
        for item in c["infused"]:
            if item.get("party") or (item.get("while") and item["while"] not in on):
                continue
            if (item.get("from_constellation") or 0) > compare.UNGATED_LIMIT and not item.get("while"):
                continue   # an ungated one above Constellation 2 is not compared (compare.UNGATED_LIMIT)
            found.setdefault(key, []).append(item)
            at = compare.constellation_of(key) if item.get("from_constellation") else 0
            case = next(x for x in CASES["cases"] if x["id"] == f"{key}:goblet" + (f"@c{at}" if at else ""))
            assert case["constellation"] >= item.get("from_constellation", 0), key
            block = FIXTURE["kits"][case["kit"]]
            assert any(i["element"].lower() == item["element"] and i["while"] == item["while"] for i in block["infused"]), key
            if item.get("while"):
                assert case["conds"][c["go_key"]][item["while"].rpartition(".")[2]] == next(t["state"] for t in c["toggles"] if t["name"] == item["while"]), key
    assert {"aloy", "yoimiya", "keqing", "kaveh", "hu-tao", "xiao", "diluc"} <= set(found) and "chiori" not in found
    assert {key for key, name in INFUSED_ON.items() if name in {t["name"] for t in KITS["characters"][key]["toggles"] if t["on"]}} == set(INFUSED_ON)


def test_wanderers_windfavored_is_on_and_says_no_swap_proves_it():
    for key, name in UNPROVEN_ON.items():
        decision = json.loads((TOOL / "decided" / f"{key}.json").read_text(encoding="utf-8"))["toggles"][name]
        assert decision["on"] and "No swap of the comparison can prove it" in decision["reason"]
        assert any(e["while"] == name for e in KITS["characters"][key]["effects"])


def test_the_infusions_decided_off_hold_behind_an_off_state_and_their_characters_are_sure():
    # Kazuha's, Lynette's, Dori's, Chiori's... infusions hold behind a state that is off: no case of the comparison has it, so none of
    # their answers is the infused one (each was checked once with its state on, against Genshin Optimizer; nothing committed pins that)
    for key in ("kaedehara-kazuha", "lynette", "dori", "chiori", "emilie", "navia", "furina", "traveler-pyro", "traveler-cryo"):
        c = KITS["characters"][key]
        assert c["infused"] and all(i["while"] for i in c["infused"]), key
        assert not any(t["on"] for t in c["toggles"] if t["name"] in {i["while"] for i in c["infused"]}), key
        assert c.get("unsure") is None, key
        case = next(x for x in CASES["cases"] if x["id"] == f"{key}:goblet")
        assert not any(i["while"] and i["while"].rpartition(".")[2] in case["conds"].get(c["go_key"], {}) for i in c["infused"]), key


def test_nefers_second_phantasm_hit_is_the_ordinary_hit_below_constellation_6_and_she_is_no_longer_unsure():
    # GO shows the second Phantasm Performance hit as a Lunar-Bloom hit from Constellation 6 and an ordinary one below it: the row prints the
    # ordinary hit's numbers, which the comparison had no hit for (her skill answer was 5 points off)
    nefer = KITS["characters"]["nefer"]
    assert nefer["unsure"] is None and nefer["row_gates"] == {"skill": {"Phantasm Performance 2-Hit DMG (Nefer)": {"below": 6}}}
    assert all(compare.agreement(c)[0] for c in FIXTURE["cases"] if c["character"] == "nefer")
    # the Constellation 6 form (Lunar-Bloom, 85% of Elemental Mastery) prints no row of HoYoLAB's: left out, not counted
    assert {"what": "hit skill.nefer2Dmg", "why": "no talent row prints its multiplier"} in nefer["left_out"]


# ----------------------------------------------------------------------------------------------- weapon and set swaps

GEAR_IDS = {
    "hu-tao:weapon:deathmatch", "hu-tao:weapon:deathmatch:on", "raiden-shogun:weapon:the-catch", "raiden-shogun:weapon:the-catch:on",
    "hu-tao:set:crimson-witch-of-flames", "hu-tao:set:crimson-witch-of-flames:on",
    "raiden-shogun:set:emblem-of-severed-fate", "raiden-shogun:set:emblem-of-severed-fate:on",
    "ganyu:set:wanderer-s-troupe",     # no toggle in Skyward Harp, Gladiator's Finale or Wanderer's Troupe: the states have nothing to be on
    "nahida:weapon:kagura-s-verity", "nahida:weapon:kagura-s-verity:on",    # an undecided toggle of three states, on at the third
}


def _adds(character: str, what: str, item_a: str, item_b: str) -> bool:
    """Whether a swap's `:on` case turns on a toggle its first case (the planner's start) does not: the four items' toggles that are off."""
    weapon = KITS["characters"][character]["weapon_type"]
    weapons = (item_a, item_b) if what == "weapon" else (compare.WEAPONS[weapon],)
    sets = (item_a, item_b) if what == "set" else (compare.SET,)
    items = [KITS["weapons"][w] for w in weapons] + [KITS["sets"][s] for s in sets]
    return any(not t["on"] for item in items for t in item["toggles"])


# the swaps to the items whose toggles a decision file turns on: the planner's start, and `:on` only where it turns on something more
DECIDED_GEAR_IDS = {f"{c}:{what}:{b}" for c, what, _, b in compare.DECIDED_GEAR_CASES} | {
    f"{c}:{what}:{b}:on" for c, what, a, b in compare.DECIDED_GEAR_CASES if _adds(c, what, a, b)}


def test_the_gear_swaps_are_the_ones_the_plan_names():
    # a weapon swap (Hu Tao's Staff of Homa to Deathmatch, Raiden's Engulfing Lightning to The Catch) and a 4-piece set swap on three
    # characters: Hu Tao (Crimson Witch's stack and Pyro bonus), Raiden (Emblem's Energy Recharge conversion to Burst DMG) and Ganyu (Wanderer's
    # Troupe's Charged Attack bonus, which only a bow or a catalyst wielder gets); each with the gear's states off and, where the four items
    # have a toggle, on; then one swap for each weapon or set a decision file turns a toggle of on
    assert {(c, kind, a, b) for c, kind, a, b in compare.GEAR_CASES} == {
        ("hu-tao", "weapon", "staff-of-homa", "deathmatch"), ("raiden-shogun", "weapon", "engulfing-lightning", "the-catch"),
        ("hu-tao", "set", "gladiator-s-finale", "crimson-witch-of-flames"), ("raiden-shogun", "set", "gladiator-s-finale", "emblem-of-severed-fate"),
        ("ganyu", "set", "gladiator-s-finale", "wanderer-s-troupe"),
        ("nahida", "weapon", "lost-prayer-to-the-sacred-winds", "kagura-s-verity"), *compare.DECIDED_GEAR_CASES}
    assert {c["id"] for c in CASES["gear_cases"]} == GEAR_IDS | DECIDED_GEAR_IDS
    assert {c["id"] for c in FIXTURE["gear_cases"]} == GEAR_IDS | DECIDED_GEAR_IDS


def test_every_gear_toggle_decided_on_is_on_in_a_swap_to_its_item_or_says_no_swap_can_show_it():
    # a toggle on by default flatters every character who tests the item when it is wrong: a swap to the item at the planner's start, with
    # it on in GO and in ours, shows it (the case agrees, below) when GO's answer with the item's decided toggles off (`go_off`) differs by
    # more than the tolerance; else its reason says honestly that no swap of the comparison can show it
    decided = compare.kitgen.load_decided(compare.DECIDED)
    shown: set[str] = set()
    for case in FIXTURE["gear_cases"]:
        if "go_off" not in case:
            continue
        assert not case["id"].endswith(":on") and case["gear_off"], case["id"]
        moved = max(abs(v - case["go_off"][k]) for k, v in case["go"]["talents"].items() if v is not None and case["go_off"].get(k) is not None)
        if moved > compare.TOLERANCE:
            shown |= set(case["gear_off"])
    cannot = "No swap of the comparison can show it"
    on = {name: t for kind in ("weapons", "sets") for d in decided[kind].values() for name, t in d["toggles"].items() if t["on"]}
    assert [name for name, t in on.items() if name not in shown and cannot not in t["reason"]] == []
    # and one that is shown does not say it cannot be
    assert [name for name, t in on.items() if name in shown and cannot in t["reason"]] == []
    # every swap to a decided item has GO's answer with its toggles off
    for character, what, _, item_b in compare.DECIDED_GEAR_CASES:
        start = next(c for c in FIXTURE["gear_cases"] if c["id"] == f"{character}:{what}:{item_b}")
        assert "go_off" in start, start["id"]
    # a decided item is one the planner's pickers offer (the app's reference has it), so that a swap to it can run as the planner runs it
    refs = compare.reference.load_refs()
    assert [k for k in decided["weapons"] if k not in refs.weapons] + [k for k in decided["sets"] if k not in refs.sets] == []
    # and the swaps of DECIDED_GEAR_CASES are each to an item a file decides, from the standard set or a weapon of hers with no decision
    # (her weapon type's standard one, or one with no toggle where the standard gives the tested weapon's numbers)
    for character, what, item_a, item_b in compare.DECIDED_GEAR_CASES:
        assert item_b in decided["weapons" if what == "weapon" else "sets"], item_b
        kind = KITS["characters"][character]["weapon_type"]
        if what == "weapon":
            assert KITS["weapons"][item_a]["type"] == KITS["weapons"][item_b]["type"] == kind, (character, item_b)
            assert item_a == compare.WEAPONS[kind] or not KITS["weapons"][item_a]["toggles"], (character, item_b)
        else:
            assert item_a == compare.SET, (character, item_b)


def test_an_undecided_toggle_of_three_states_is_compared_on_at_the_third_and_moves_the_answer():
    # Kagura's Verity (no decision file) on Nahida: GO's state is the one kits.json reads (3 stacks, once), and the answer moves with it
    by_id = {c["id"]: c for c in CASES["gear_cases"]}
    assert by_id["nahida:weapon:kagura-s-verity:on"]["conds"]["KagurasVerity"] == {"KaguraDance": "3"}
    assert "KagurasVerity" not in by_id["nahida:weapon:kagura-s-verity"]["conds"]
    on, off = (next(c for c in FIXTURE["gear_cases"] if c["id"] == i) for i in ("nahida:weapon:kagura-s-verity:on", "nahida:weapon:kagura-s-verity"))
    assert compare.agreement(on)[0] and abs(on["go"]["talents"]["skill"] - off["go"]["talents"]["skill"]) > compare.TOLERANCE


def test_the_gear_cases_stand_beside_the_others_and_leave_them_as_they_were():
    assert not {c["id"] for c in CASES["cases"]} & GEAR_IDS and len(CASES["cases"]) == 358 and len(FIXTURE["cases"]) == 358


def test_a_gear_cases_two_builds_differ_in_one_weapon_or_one_set_and_are_at_the_same_states():
    for case in CASES["gear_cases"]:
        swap = case["swap"]
        a, b = case["a"], case["b"]
        assert a["pieces"][0]["stats"] == b["pieces"][0]["stats"] and case["mains_a"] == case["mains_b"], case["id"]
        assert case["constellation"] == 0 and case["reaction"] is None and case["kit"] == case["character"]
        if swap == "weapon":
            assert a["weapon_go"] != b["weapon_go"] and {p["set"] for p in a["pieces"] + b["pieces"]} == {case["set_go"]}, case["id"]
        else:
            assert a["weapon_go"] == b["weapon_go"] == case["weapon_go"] and case["set_b"] != case["set"], case["id"]
            assert {p["set"] for p in a["pieces"]} == {case["set_go"]} and {p["set"] for p in b["pieces"]} == {case["set_b_go"]}, case["id"]
        assert swap == "weapon" or case["weapon"] == compare.WEAPONS[case["weapon_type"]], case["id"]
        # the states of both builds are one set of conditionals (GO's), and the gear's are in it only in the `:on` cases and, in the others,
        # for the toggles a decision file turns on (`gear_start`, where the planner starts)
        gear_sheets = {a["weapon_go"], b["weapon_go"], case["set_go"], case["set_b_go"]}
        assert case["gear_on"] == case["id"].endswith(":on"), case["id"]
        assert (case["gear_toggles"] != []) <= case["gear_on"], case["id"]
        assert set(case["gear_start"]) <= set(case["gear_toggles"]) or not case["gear_on"], case["id"]
        set_on = case["gear_toggles"] if case["gear_on"] else case["gear_start"]
        assert ({sheet for sheet in case["conds"] if sheet in gear_sheets} != set()) == (set_on != []), case["id"]


def test_the_gear_states_are_what_kits_json_reads_them_at():
    on = next(c for c in CASES["gear_cases"] if c["id"] == "hu-tao:weapon:deathmatch:on")
    assert on["conds"]["StaffOfHoma"] == {"RecklessCinnabar": "on"} and on["conds"]["Deathmatch"] == {"stack": "oneOrNone"}
    assert on["gear_toggles"] == ["deathmatch:stack", "staff-of-homa:RecklessCinnabar"]
    off = next(c for c in CASES["gear_cases"] if c["id"] == "hu-tao:weapon:deathmatch")
    assert "StaffOfHoma" not in off["conds"] and "Deathmatch" not in off["conds"] and off["gear_toggles"] == []
    # the catch has no toggle: its two effects are always on, in both
    catch = next(c for c in CASES["gear_cases"] if c["id"] == "raiden-shogun:weapon:the-catch:on")
    assert catch["gear_toggles"] == ["engulfing-lightning:TimelessDream"] and "TheCatch" not in catch["conds"]


def test_every_gear_case_ran_in_go_and_agrees_or_its_character_says_why():
    unsure = {key for key, c in KITS["characters"].items() if c.get("unsure")}
    failed = []
    for case in FIXTURE["gear_cases"]:
        assert "error" not in case, case["id"]
        assert case["ours"] and case["go"], case["id"]
        agreed, notes = compare.agreement(case)
        if not agreed and case["character"] not in unsure:
            failed.append((case["id"], notes))
    assert failed == []


def test_the_gear_cases_answers_move_with_the_gear():
    # each swap changes at least one answer, in GO and in ours: a swap that moved nothing would prove nothing
    for case in FIXTURE["gear_cases"]:
        assert any(abs(v) > 1e-6 for v in case["go"]["talents"].values() if v is not None), case["id"]
        assert any(abs(v) > 1e-6 for v in case["ours"]["talents"].values() if v is not None), case["id"]


def test_the_gear_cases_effects_come_from_the_tested_items_choices_as_the_planner_gets_them():
    # the planner answer holds the worn gear's effects; the tested weapon's and set's come with the picker's choice
    for case in FIXTURE["gear_cases"]:
        swap = case["swap_gear"]
        assert set(swap["hits"]["weapon_effects"]) == {case["weapon"]["key"]} and set(swap["hits"]["set_effects"]) == {case["sim_set"]}, case["id"]
        if case["swap"] == "weapon":
            assert swap["weapon_b"]["gear"] == compare.kits.gear_of("weapons", swap["weapon_b"]["key"], 0, 6, case["weapon_kind"]), case["id"]
        else:
            assert swap["set_b"]["gear"] == compare.kits.gear_of("sets", swap["set_b"]["key"], 0, 6, case["weapon_kind"]), case["id"]


def test_the_partial_run_reports_and_pins_the_gear_cases_of_its_characters_too():
    good = {"id": "x:weapon:y", "character": "x", "swap": "weapon", "go": {"talents": {"normal": 1.0}}, "ours": {"talents": {"normal": 1.02}}}
    bad = {**good, "id": "x:set:z", "ours": {"talents": {"normal": 1.5}}}
    data = {"cases": [], "gear_cases": [good, bad], "move_mismatches": []}
    lines, failed = compare.only_report(data, ["x"], {"x"}, set())
    assert failed == ["x:set:z"] and any("x:weapon:y: agrees" in line for line in lines)
    assert compare.only_report(data, ["x"], {"x"}, {"x"})[1] == []                    # unsure: said, not failed
    assert "x:set:z" in compare.report_table(data, {})
    compare.attach_ours(data, {"x:set:z": {"talents": {"normal": 1.0}}})
    assert bad["ours"] == {"talents": {"normal": 1.0}}
