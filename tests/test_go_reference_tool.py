"""tools/go-reference/kitgen.py, the part of the Genshin Optimizer tool that reads GO's trees into kits.json's Effect
form, on trees shaped as GO's Waverider sheets write them (go-engine.md 2)."""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "go-reference"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, TOOL / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kitgen = _load("kitgen")


def c(v):
    return {"op": "const", "v": v}


def r(p):
    return {"op": "read", "p": p}


def gate(path, k, x):
    return {"op": "threshold", "x": [r(path), c(k), x, c(0)]}


def test_sandrones_a4_reads_as_a_capped_conversion():
    tree = gate("asc", 4, {"op": "min", "x": [{"op": "mul", "x": [r("premod.atk"), c(0.08)]}, c(160)]})
    numbers = kitgen.linear(kitgen.normalise(tree), kitgen.Context())
    assert numbers["from"] == "atk" and numbers["reads"] == "premod" and numbers["rate"] == 0.08
    assert numbers["cap"] == 160 and numbers["from_ascension"] == 4


def test_raidens_a4_reads_er_over_100_percent():
    tree = gate("asc", 4, {"op": "mul", "x": [{"op": "add", "x": [r("premod.enerRech_"), c(-1)]}, c(0.004), c(100)]})
    numbers = kitgen.linear(kitgen.normalise(tree), kitgen.Context())
    assert numbers["from"] == "er" and numbers["over"] == 1 and abs(numbers["rate"] - 0.4) < 1e-12


def test_nahidas_floor_and_cap():
    tree = {"op": "min", "x": [{"op": "mul", "x": [c(0.001), {"op": "max", "x": [
        {"op": "add", "x": [r("total.eleMas"), c(-200)]}, c(0)]}]}, c(0.8)]}
    numbers = kitgen.linear(kitgen.normalise(tree), kitgen.Context())
    assert (numbers["from"], numbers["reads"], numbers["over"], numbers["cap"]) == ("em", "final", 200, 0.8)


def test_a_two_valued_gate_becomes_a_base_and_a_step():
    tree = {"op": "mul", "x": [r("total.def"), {"op": "threshold", "x": [r("constellation"), c(6), c(1.125), c(0.75)]}]}
    terms = kitgen.terms_of(kitgen.normalise(tree))
    read = [kitgen.linear(term, kitgen.Context()) for term in terms]
    assert sorted((n["rate"], n["from_constellation"]) for n in read) == [(0.375, 6), (0.75, None)]


def test_a_state_is_read_at_its_chosen_value():
    tree = {"op": "lookup", "x": [r("conditional.Neuvillette.a1Stacks"), c(0)],
            "table": {"1": c(0.14), "2": c(0.28), "3": c(0.42)}}
    states = kitgen.conditionals(tree)
    assert kitgen.best_state(states["conditional.Neuvillette.a1Stacks"]) == "3"
    assert kitgen.simplify(tree, {"conditional.Neuvillette.a1Stacks": "2"}) == c(0.28)


def test_the_party_is_left_to_the_party():
    assert kitgen._is_party(gate("tally.moonsign", 2, c(0.1)))
    assert not kitgen._is_party(gate("asc", 1, c(0.1)))


def test_rows_line_up_where_go_lists_fewer_parameters():
    # Ayaka's Normal Attack: the encodings count to {{11}} (the game's parameters), GO has 10
    char = {"rows": {"auto": [{"name": "5-Hit DMG", "params": [6]}, {"name": "4-Hit DMG", "params": [3]},
                              *({"name": f"r{i}", "params": [i]} for i in (0, 1, 2, 7, 8, 9, 10, 11))]},
            "params": {"auto": [[0.0]] * 10}}
    rows = {row["name"]: row["params"] for row in kitgen.aligned_rows(char)["auto"]}
    assert rows["5-Hit DMG"] == [4] and rows["4-Hit DMG"] == [3]


def test_a_states_code_name_reads_as_words():
    assert kitgen.humanise("GuideToAfterlifeVoyage") == "Guide to afterlife voyage"


def test_the_pinned_commit_is_the_same_everywhere():
    run = (TOOL / "run.py").read_text(encoding="utf-8")
    setup = (TOOL / "setup.ps1").read_text(encoding="utf-8")
    pinned = re.search(r'PINNED = "([0-9a-f]{40})"', run).group(1)
    assert f"$Commit = '{pinned}'" in setup
    assert pinned in (TOOL / "README.md").read_text(encoding="utf-8")
    assert pinned in (ROOT / "THIRD-PARTY-NOTICES.txt").read_text(encoding="utf-8")
    kits = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))
    assert kits["go_commit"] == pinned


def test_setup_checks_nodes_download_and_installs_with_gos_own_yarn():
    setup = (TOOL / "setup.ps1").read_text(encoding="utf-8")
    assert "SHASUMS256.txt" in setup and "Get-FileHash -Algorithm SHA256" in setup
    assert "CYPRESS_INSTALL_BINARY = '0'" in setup and ".yarn/releases/yarn-3.4.1.cjs install" in setup
    assert "https://github.com/frzyc/genshin-optimizer.git" in setup and "nodejs.org/dist/" in setup


def test_a_skill_row_that_is_a_normal_attack_keeps_its_move():
    # Clorinde's Swift Hunt and Cyno's Pactsworn Pathclearer attacks are rows of her Skill (his Burst) that the game deals as
    # Normal Attack DMG: GO's hit says `move: normal`, and set bonuses for Normal Attacks (Gladiator's Finale) reach them.
    char = {
        "weapon_type": "sword",
        "rows": {"skill": [{"name": "Swift Hunt DMG", "params": [0]}, {"name": "Skill DMG", "params": [1]}]},
        "params": {"skill": [[0.5], [1.0]]},
        "hits": [
            {"group": "skill", "name": "normalDmg", "move": "normal", "ele": "electro", "variant": None,
             "params": [{"talent": "skill", "index": 0, "levels": [0.5]}], "formula": None},
            {"group": "skill", "name": "skillDmg", "move": "skill", "ele": None, "variant": None,
             "params": [{"talent": "skill", "index": 1, "levels": [1.0]}], "formula": None},
        ],
    }
    hits, _, moves, _, unmatched = kitgen.match_rows(char, lambda *a: "elemental")
    assert unmatched == [] and hits["skill"] == {"Swift Hunt DMG": "elemental", "Skill DMG": "elemental"}
    assert moves["skill"] == {"Swift Hunt DMG": "normal"}


def test_a_product_of_a_party_count_is_left_whole():
    # Zibai's A4: DEF +15% for each Geo member other than her, `(tally.geo − 1) × 0.15`. Multiplied out, its −0.15 read as an
    # always-on −15% DEF; it is one party term (found by the comparison with Genshin Optimizer, 2026-11-14).
    tree = gate("asc", 4, {"op": "mul", "x": [{"op": "add", "x": [r("tally.geo"), c(-1.0)]}, c(0.15)]})
    terms = kitgen.terms_of(kitgen.normalise(kitgen.simplify(tree, {})))
    assert len(terms) == 1 and kitgen._is_party(terms[0])
    # a gated party bonus inside the sum still splits: Disaster and Remorse's `(1 + (hexerei >= 2 ? 0.75 : 0)) × 0.4` keeps its 0.4
    bonus = {"op": "mul", "x": [{"op": "add", "x": [gate("tally.hexerei", 2, c(0.75)), c(1.0)]}, c(0.4)]}
    split = kitgen.terms_of(kitgen.normalise(bonus))
    assert len(split) == 2 and sum(not kitgen._is_party(t) for t in split) == 1
    # a sum without the party is still multiplied out, one Effect per term
    plain = {"op": "mul", "x": [{"op": "add", "x": [r("total.atk"), r("total.def")]}, c(0.1)]}
    assert len(kitgen.terms_of(kitgen.normalise(plain))) == 2


def test_hits_with_the_same_numbers_take_the_move_of_their_own_row():
    # Tartaglia's Skill (GO 2c13fc40, his real rows): his melee Charged Attack's first hit (`charged1`, move charged) and his
    # Riptide Slash (`riptideSlash`, move skill) have the same numbers, so each lists both parameters 8 and 10. In GO's order
    # the first is the first parameter's (8, "Charged Attack DMG"), the second the second's (10, "Riptide Slash"): Riptide
    # Slash is Skill DMG, not a Charged Attack (found by the review of the comparison, 2026-11-14).
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
    _, _, moves, _, unmatched = kitgen.match_rows(char, lambda *a: "elemental")
    assert unmatched == []
    assert moves["skill"] == {"Charged Attack DMG": "charged"}


def test_a_skill_forms_plunge_is_a_plunge_of_her_skill():
    # Lohen's Skill form plunges (GO 2c13fc40): GO reads the numbers from her Normal Attack's list, which her Skill's own
    # "Plunge DMG" row prints too. The Skill's row is the hit's as well, with GO's move: a plunge, not Skill DMG (found by the
    # comparison's check that every row's move is GO's, 2026-11-14).
    plunge = [0.639324, 0.691362, 0.7434]
    char = {
        "weapon_type": "sword",
        "rows": {"auto": [{"name": "Plunge DMG", "params": [0]}], "skill": [{"name": "Plunge DMG", "params": [1]}]},
        "params": {"auto": [plunge], "skill": [[2.0], plunge]},
        "hits": [
            {"group": "plunging", "name": "dmg", "move": "plunging_collision", "ele": None, "variant": None,
             "params": [{"talent": "auto", "index": 0, "levels": plunge}], "formula": None},
            {"group": "skill", "name": "dmg", "move": "plunging_collision", "ele": "cryo", "variant": None,
             "params": [{"talent": "auto", "index": 0, "levels": plunge}], "formula": None},
        ],
    }
    hits, _, moves, rows_of_hit, _ = kitgen.match_rows(char, lambda *a: "elemental")
    assert hits["skill"] == {"Plunge DMG": "elemental"} and moves["skill"] == {"Plunge DMG": "plunging"}
    assert hits["normal"] == {"Plunge DMG": "physical"} and rows_of_hit["skill.dmg"] == [("skill", "Plunge DMG")]


def test_the_decision_folder_reads_as_the_old_one_file_did(tmp_path):
    # tools/go-reference/decided/<key>.json: a file with decisions is a decided character (checked), a file with only `unsure` is
    # an undecided character that says why her verdict depends; `_about.json` holds the text; the folder's order is no matter
    (tmp_path / "_about.json").write_text(json.dumps({"about": "A.", "checked": "C"}), encoding="utf-8")
    (tmp_path / "hu-tao.json").write_text(json.dumps({"main": None, "toggles": {"x": {"on": True}}}), encoding="utf-8")
    (tmp_path / "yelan.json").write_text(json.dumps({"toggles": {}, "unsure": "Because."}), encoding="utf-8")
    (tmp_path / "qiqi.json").write_text(json.dumps({"unsure": "Sometimes."}), encoding="utf-8")
    decided = kitgen.load_decided(tmp_path)
    assert decided["about"] == "A." and decided["checked"] == "C"
    assert decided["characters"] == {"hu-tao": {"main": None, "toggles": {"x": {"on": True}}}, "yelan": {"toggles": {}}}
    assert decided["unsure"] == {"yelan": "Because.", "qiqi": "Sometimes."}


def test_a_decision_file_with_an_unknown_field_or_bad_json_is_refused(tmp_path):
    (tmp_path / "a.json").write_text(json.dumps({"toggles": {}, "togles": {}}), encoding="utf-8")
    with pytest.raises(SystemExit):
        kitgen.load_decided(tmp_path)
    (tmp_path / "a.json").write_text("{ not json", encoding="utf-8")
    with pytest.raises(SystemExit):
        kitgen.load_decided(tmp_path)


def test_the_real_decision_folder_has_decisions_and_well_formed_unsure_sentences():
    decided = kitgen.load_decided(TOOL / "decided")
    kits = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))["characters"]
    assert {"sandrone", "odette", "yelan"} <= set(decided["characters"])
    assert all(key in kits for key in {*decided["characters"], *decided["unsure"]})
    assert all(isinstance(sentence, str) and sentence.strip().endswith(".") for sentence in decided["unsure"].values())


def test_a_decision_file_that_is_not_an_object_is_refused_with_its_name(tmp_path):
    (tmp_path / "qiqi.json").write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(SystemExit, match="qiqi.json"):
        kitgen.load_decided(tmp_path)


def test_kits_json_that_does_not_hold_a_decision_is_told_what_differs():
    kept = {"checked": True, "unsure": None, "main": ["A"], "stellar": None,
            "toggles": [{"name": "t", "label": "L", "on": True, "covers": ["burst"], "state": "on"}]}
    mine = {"main": ["A"], "toggles": {"t": {"on": True, "label": "L", "covers": ["burst"], "state": "on", "reason": "r"}}}
    assert kitgen.decision_differences(mine, None, kept) == []
    assert kitgen.decision_differences({**mine, "main": ["B"]}, None, kept) == ["main"]
    assert kitgen.decision_differences({**mine, "stellar": "stellar-conduct"}, None, kept) == ["stellar"]
    assert kitgen.decision_differences(mine, "Because.", kept) == ["unsure"]
    assert kitgen.decision_differences(None, None, kept) == ["checked"]
    changed = {**mine, "toggles": {"t": {**mine["toggles"]["t"], "label": "Other", "state": "3", "covers": []}}}
    assert kitgen.decision_differences(changed, None, kept) == ["toggle t: label", "toggle t: covers", "toggle t: state"]
    assert kitgen.decision_differences({**mine, "toggles": {}}, None, kept) == ["toggles"]


def test_compare_only_stops_when_kits_json_lacks_a_changed_main_row(monkeypatch):
    decided = kitgen.load_decided(TOOL / "decided")
    assert run._stale_kits(["fischl", "sandrone"], decided) == []
    changed = json.loads(json.dumps(decided))
    changed["characters"]["fischl"]["main"] = ["Some Other DMG"]
    changed["characters"]["sandrone"]["stellar"] = "stellar-swirl"
    assert run._stale_kits(["fischl", "sandrone"], changed) == ["fischl", "sandrone"]


def test_the_wiki_cache_is_read_without_a_file_appearing_beside_a_wal_database(tmp_path):
    import sqlite3

    folder = tmp_path / "data"
    folder.mkdir()
    db = folder / "guildboard.db"
    _entry_db(db)
    live = sqlite3.connect(db)                       # the running app: WAL mode, a connection open, rows still in the log
    live.execute("PRAGMA journal_mode=WAL")
    live.execute("UPDATE wiki_items SET rank = 4")
    live.commit()
    before = {p.name: p.read_bytes() for p in folder.iterdir()}
    page = sheet.wiki_page("Sandrone", db_path=db, fetch=lambda *a, **k: (_ for _ in ()).throw(AssertionError("no network")))
    assert page["source"] == "cached" and page["passives"]
    assert {p.name: p.read_bytes() for p in folder.iterdir()} == before   # nothing created, nothing changed
    live.close()


# ---------------------------------------------------------------------------------------------- run.py compare --only

run = _load("run")
compare = _load("compare")
CASES = json.loads((TOOL / "cases.json").read_text(encoding="utf-8"))
FIXTURE_PATH = ROOT / "web" / "src" / "fixtures" / "compare-cases.json"


def test_keys_come_from_the_command_line_or_a_file(tmp_path):
    listed = tmp_path / "keys.txt"
    listed.write_text("# the first batch\nsandrone\n\nhu-tao   \nsandrone\n", encoding="utf-8")
    as_json = tmp_path / "keys.json"
    as_json.write_text(json.dumps(["lauma", "nahida"]), encoding="utf-8")
    assert run.parse_keys(["fischl", f"@{listed}", f"@{as_json}"]) == ["fischl", "sandrone", "hu-tao", "lauma", "nahida"]
    with pytest.raises(SystemExit):
        run.parse_keys([f"@{tmp_path / 'missing.txt'}"])


def test_the_comparison_writes_where_gb_out_dir_says(monkeypatch, tmp_path):
    monkeypatch.setenv("GB_OUT_DIR", str(tmp_path / "mine"))
    assert run.out_dir(tmp_path / "go") == tmp_path / "mine"
    monkeypatch.delenv("GB_OUT_DIR")
    assert run.out_dir(tmp_path / "go") == tmp_path / "go" / "gb-out"


def test_the_cases_of_only_some_characters(monkeypatch):
    monkeypatch.setattr(compare, "affixes_of", lambda go_key, levels=None: CASES["affixes"][next(
        k for k, c in compare.kits.load_kits()["characters"].items() if c["go_key"] == go_key)])
    plan = compare.cases(only=["sandrone", "hu-tao"])
    assert {c["character"] for c in plan["cases"]} == {"sandrone", "hu-tao"}
    assert {c["id"] for c in plan["cases"]} == {c["id"] for c in CASES["cases"] if c["character"] in ("sandrone", "hu-tao")}
    with pytest.raises(SystemExit, match="nobody"):
        compare.cases(only=["nobody"])


def _case(character, ours, go):
    return {"id": f"{character}:sands", "character": character, "ours": {"talents": ours}, "go": {"talents": go, "left_out": []}}


def test_only_exits_non_zero_for_a_decided_character_who_disagrees():
    data = {"cases": [_case("a", {"skill": 10.0}, {"skill": 10.01}), _case("b", {"skill": 10.0}, {"skill": 12.0}),
                      _case("c", {"skill": 1.0}, {"skill": 5.0}), {"id": "d:sands", "character": "d", "error": "GO did not run this case"}],
            "move_mismatches": []}
    lines, failed = compare.only_report(data, ["a", "b", "c", "d"], checked={"a", "b", "d"}, unsure={"b"})
    assert failed == ["d:sands"]                     # b is unsure (accepted), c is undecided (told, not failing)
    text = "\n".join(lines)
    assert "a:sands" in text and "agrees" in text and "c:sands" in text and "undecided" in text and "unsure" in text
    _, failed = compare.only_report(data, ["a", "b"], checked={"a", "b"}, unsure=set())
    assert failed == ["b:sands"]
    # a character the comparison skips (no counted rows) is said, not failed
    lines, failed = compare.only_report({"cases": [], "move_mismatches": []}, ["e"], checked={"e"}, unsure=set(), skipped={"e": "no counted rows"})
    assert failed == [] and "no counted rows" in "\n".join(lines)


def test_only_never_writes_the_committed_fixture(monkeypatch, tmp_path):
    # `run` imports `compare` by name when it runs, and the test files of the tool each load their own copy under that name: the one
    # this file patches is the one `run` must see, whichever file was collected last
    monkeypatch.setitem(sys.modules, "compare", compare)
    before = FIXTURE_PATH.read_bytes()
    cases = [c for c in json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"] if c["character"] == "fischl"]
    partial = {"about": "", "go_commit": "x", "tolerance": 0.05, "tables": {}, "affixes": {}, "levels": {}, "gear": {}, "kits": {},
               "move_mismatches": [], "cases": [{**c, "ours": None} for c in cases]}
    monkeypatch.setattr(compare, "cases", lambda only=None: {"cases": [], "skipped": {}, "affixes": {}, "go_commit": "x"})
    monkeypatch.setattr(compare, "fixture", lambda source, cases_path=None: partial)

    def fake(command, **kwargs):
        # our engine's run: answers each case as GO did
        Path(kwargs["env"]["GB_COMPARE_OUT"]).write_text(json.dumps({
            c["id"]: {"talents": c["go"]["talents"], "rows": {}} for c in cases}), encoding="utf-8")
        assert Path(kwargs["env"]["GB_COMPARE_FIXTURE"]).exists()
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr(run.subprocess, "run", fake)
    for name in ("gb-kit.json", "gb-match.json", "gb-compare.json"):
        (tmp_path / name).write_text("{}", encoding="utf-8")
    assert run.compare_command(tmp_path, only=["fischl"]) == 0
    assert FIXTURE_PATH.read_bytes() == before


# ---------------------------------------------------------------------------------------------- sheet.py

sheet = _load("sheet")


def _toggle(**over):
    return {"name": "skillEye", "label": "Eye", "on": False, "covers": [], "state": "on", **over}


def _effect(**over):
    return {"from": None, "reads": None, "to": "dmg:burst", "rate": 0.27, "cap": None, "cap_from": None, "over": None, "pieces": None,
            "from_ascension": None, "from_constellation": None, "talents": None, "weapon_types": None, "hits": None, "row": None,
            "while": "skillEye", "in_stats": False, **over}


def test_the_rule_suggests_on_for_a_self_buff_that_reaches_her_counted_hits():
    on, why = sheet.suggest(_toggle(), [_effect()], [], ["burst|Hit DMG"])
    assert on == "on" and "counted" in why
    off, why = sheet.suggest(_toggle(), [_effect()], [], [])
    assert off == "off" and "none of her counted hits" in why


def test_the_rule_suggests_off_for_party_setup_and_constellation_windows():
    assert sheet.suggest(_toggle(name="burstPartyBuff"), [_effect()], [], ["burst|x"])[0] == "off"
    assert sheet.suggest(_toggle(name="a1", label="While the enemy's HP is below half"), [_effect()], [], ["burst|x"])[0] == "off"
    off, why = sheet.suggest(_toggle(name="c2Window"), [_effect(from_constellation=2)], [], ["burst|x"])
    assert off == "off" and "Constellation" in why
    assert sheet.suggest(_toggle(name="x"), [_effect(from_constellation=2), _effect(from_constellation=None)], [], ["burst|x"])[0] == "on"


def test_an_effect_is_shown_in_our_effect_form_without_its_empty_fields():
    form = sheet.effect_form(_effect(rate=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]))
    assert '"to": "dmg:burst"' in form and '"while": "skillEye"' in form and "null" not in form and "false" not in form
    assert "0.1" in form and "0.7" in form and "0.4" not in form      # a long list by talent level is shortened to its ends
    assert sheet.effect_text(_effect(**{"from": "er", "reads": "premod", "to": "dmg:electro", "rate": 0.4, "over": 1.0,
                                       "from_ascension": 4, "while": None})) == \
        "adds 0.4 × (er − 1) to dmg:electro, from ascension 4"


def _facts_for(key, damage=None, wiki=None):
    return sheet.collect(key, affixes=CASES["affixes"].get(key), damage=damage, wiki=wiki)


def test_a_sheet_has_her_rows_her_toggles_and_a_marked_suggestion():
    wiki = {"source": "cached", "passives": [("Fortuitous Foe", "Raiden gains Electro DMG Bonus.")],
            "constellations": [("Ominous Inscription", "Raises Burst DMG.")]}
    damage = {"baseline": {}, "toggles": {"skillEye": {"talents": {"burst": 27.0}, "rows": {"burst|Musou no Hitotachi Base DMG": 27.0}}},
              "decided": ["skillEye"]}
    text = sheet.render(_facts_for("raiden-shogun", damage, wiki))
    for wanted in ("# Decision sheet: Raiden Shogun", "## Her main talents and their counted rows", "Musou no Hitotachi Base DMG",
                   "721.4% ATK", "## Toggles", "`conditional.RaidenShogun.skillEye`", '"to": "dmg:burst"', "+27.0%",
                   "Suggestion (a rule, not a decision): ", "## Left out", "depends on the party", "## Her passives",
                   "Fortuitous Foe", "Raiden gains Electro DMG Bonus.", "## Her constellations", "Ominous Inscription"):
        assert wanted in text, wanted
    assert "Decided now: on" in text           # she is a checked character: her decision is shown beside the suggestion


def test_a_sheet_says_what_it_could_not_find():
    text = sheet.render(_facts_for("raiden-shogun", None, {"error": "no wiki entry for her in the dev copy's data folder"}))
    assert "Damage: not computed" in text and "no wiki entry for her" in text


def test_a_character_with_no_toggles_still_has_a_sheet():
    kits_data = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))["characters"]
    key = next(k for k, c in kits_data.items() if not c["toggles"] and k in CASES["affixes"])
    text = sheet.render(_facts_for(key))
    assert "## Toggles" in text and "no toggles" in text.lower()


def _entry_db(path, name="Sandrone", with_entry=True):
    import sqlite3

    data = {"modules": {"Talents": {"talent": {"list": [
        {"title": "Normal", "desc": "n", "leveled": True}, {"title": "Skill", "desc": "s", "leveled": True},
        {"title": "Passive One", "desc": "<p>Raises <b>damage</b>.</p>", "leveled": False}, {"title": "Burst", "desc": "b", "leveled": True}]}},
        "Constellation": {"summaryList": {"list": [{"name": "C1 Name", "desc": "C1 text."}]}}}}
    db = sqlite3.connect(path)
    db.executescript("""CREATE TABLE wiki_entries (entry_page_id TEXT PRIMARY KEY, kind TEXT, name TEXT, data TEXT, version TEXT, read_at TEXT);
        CREATE TABLE wiki_items (kind TEXT, name TEXT, rank INT, icon_url TEXT, entry_page_id TEXT, read_at TEXT);""")
    db.execute("INSERT INTO wiki_items VALUES ('character', ?, 5, '', '77', 'x')", (name,))
    if with_entry:
        db.execute("INSERT INTO wiki_entries VALUES ('77', 'character', ?, ?, '7.2', 'x')", (name, json.dumps(data)))
    db.commit()
    db.close()


def test_the_wiki_text_comes_from_the_dev_copys_cache_without_touching_it(tmp_path):
    db = tmp_path / "guildboard.db"
    _entry_db(db)
    before = db.read_bytes()

    def no_network(*a, **k):
        raise AssertionError("the network is not asked for a cached entry")

    page = sheet.wiki_page("Sandrone", db_path=db, fetch=no_network)
    assert page["source"] == "cached" and page["version"] == "7.2"
    assert page["passives"] == [("Passive One", "Raises damage.")] and page["constellations"] == [("C1 Name", "C1 text.")]
    assert db.read_bytes() == before and sorted(p.name for p in tmp_path.iterdir()) == ["guildboard.db"]


def test_an_entry_the_cache_lacks_is_read_through_the_apps_own_wiki_code_and_not_stored(tmp_path):
    db = tmp_path / "guildboard.db"
    _entry_db(db, with_entry=False)
    before = db.read_bytes()
    asked = []
    answer = {"retcode": 0, "data": {"page": {"id": "77", "name": "Sandrone", "modules": [
        {"name": "Talents", "components": [{"component_id": "talent", "data": json.dumps({"list": [
            {"title": "Passive Two", "desc": "Does <i>things</i>.", "attributes": []}]})}]}]}}}

    def fetch(url, **kwargs):
        asked.append(url)
        return json.dumps(answer).encode()

    page = sheet.wiki_page("Sandrone", db_path=db, fetch=fetch)
    assert asked == ["https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=77"]
    assert page["source"] == "fetched" and page["passives"] == [("Passive Two", "Does things.")]
    assert db.read_bytes() == before


def test_a_character_the_wiki_does_not_list_gives_a_reason_not_a_crash(tmp_path):
    db = tmp_path / "guildboard.db"
    _entry_db(db)
    assert "error" in sheet.wiki_page("Nobody", db_path=db, fetch=lambda *a, **k: b"")
    assert "error" in sheet.wiki_page("Sandrone", db_path=tmp_path / "missing.db", fetch=lambda *a, **k: b"")


def test_sheets_are_written_for_many_keys_at_once_into_a_folder(tmp_path):
    written = sheet.write_sheets(["sandrone", "hu-tao"], tmp_path, damage=lambda keys: {}, wiki=lambda name: {"error": "none"},
                                 affixes=lambda key: CASES["affixes"].get(key))
    assert sorted(p.name for p in written) == ["hu-tao.md", "sandrone.md"]
    assert "# Decision sheet: Sandrone" in (tmp_path / "sandrone.md").read_text(encoding="utf-8")
    with pytest.raises(SystemExit, match="nobody"):
        sheet.write_sheets(["nobody"], tmp_path, damage=lambda keys: {}, wiki=lambda name: {}, affixes=lambda key: None)


def test_the_sheet_folder_is_git_ignored():
    assert sheet.SHEETS == ROOT / ".superpowers" / "sheets"
    assert ".superpowers/" in (ROOT / ".gitignore").read_text(encoding="utf-8")


def test_a_folders_kit_and_match_json_are_reused_only_for_the_specs_that_wrote_them(tmp_path):
    # the partial comparison skips GO's kit and match run when the folder has them from these very specs (an older gb-match lacked
    # `reacts`, which made one case disagree: the review of this task)
    assert not run.kit_json_is_current(tmp_path)
    for name in ("gb-kit.json", "gb-match.json"):
        (tmp_path / name).write_text("{}", encoding="utf-8")
    assert not run.kit_json_is_current(tmp_path)                      # no stamp: written by someone else's specs
    (tmp_path / run.SPECS_STAMP).write_text(run.specs_hash(), encoding="utf-8")
    assert run.kit_json_is_current(tmp_path)
    (tmp_path / run.SPECS_STAMP).write_text("another", encoding="utf-8")
    assert not run.kit_json_is_current(tmp_path)


def test_an_ascension_passives_plain_stat_is_on_the_panel_and_a_constellations_is_not():
    """An ascension passive's plain stat is on HoYoLAB's panel; a constellation's, a conversion's and an in-combat stat are not
    (the audit's panel question)."""
    base = {"from": None, "reads": None, "cap": None, "cap_from": None, "over": None, "pieces": None, "talents": None,
            "weapon_types": None, "hits": None, "row": None, "while": None, "in_stats": False, "from_ascension": None,
            "from_constellation": None}
    a4 = {**base, "to": "dmg:hydro", "rate": 0.2, "from_ascension": 4}
    c1 = {**base, "to": "hp%", "rate": 0.2, "from_constellation": 1}
    combat = {**base, "to": "dmg:pyro", "rate": 0.4, "while": "inCombat"}
    conversion = {**base, "to": "er", "rate": 0.2, "from": "atk", "reads": "final", "from_ascension": 4}
    effects = [a4, c1, combat, conversion]
    kitgen.mark_in_stats(effects, "character")
    assert [e["in_stats"] for e in effects] == [True, False, False, False]
    levelled = {**base, "to": "dmg:hydro", "rate": [0.1, 0.2], "from_ascension": 4}  # a rate per talent level is no plain stat
    kitgen.mark_in_stats([levelled], "character")
    assert levelled["in_stats"] is False


def test_the_comparisons_panel_holds_an_ascension_passives_stat_and_not_a_constellations():
    go = {"special": None, "innate": {}, "weapon": {"sub_key": None, "sub": 0}, "base": {"hp": 10000, "atk": 800, "def": 700}}
    effect = {"to": "dmg:hydro", "rate": 0.2, "in_stats": True, "from_ascension": 4}
    constellation = {"to": "hp%", "rate": 0.2, "in_stats": False, "from_ascension": None}
    hits = {"element": "Hydro", "effects": [effect, constellation], "weapon_effects": {}, "set_effects": {"s": {"effects": []}}}
    held = compare.panel(go, [], hits, "w", "s")
    assert held["dmg"] == 20.0 and held["hp"] == 10000


def test_the_comparisons_panel_refuses_an_in_stats_ascension_effect_it_has_no_place_for():
    go = {"special": None, "innate": {}, "weapon": {"sub_key": None, "sub": 0}, "base": {"hp": 10000, "atk": 800, "def": 700}}
    effect = {"to": "dmg:burst", "rate": 0.2, "in_stats": True, "from_ascension": 4}
    hits = {"element": "Hydro", "effects": [effect], "weapon_effects": {}, "set_effects": {"s": {"effects": []}}}
    with pytest.raises(SystemExit, match="no place on the panel"):
        compare.panel(go, [], hits, "w", "s")


def test_a_sheet_measures_a_toggle_alone_and_with_the_states_its_effects_need_beside_it():
    # Yoimiya's Skill state: alone it is her Pyro infusion and multiplier; with her A1 stacks beside it, the stacks' Pyro bonus too
    alone = {"talents": {"normal": 40.0}, "rows": {"normal|1-Hit DMG": 40.0}}
    together = {"with": ["a1"], "talents": {"normal": 52.0}, "rows": {"normal|1-Hit DMG": 52.0, "normal|2-Hit DMG": 52.0}}
    damage = {"baseline": {}, "toggles": {"skill": alone}, "together": {"skill": together}, "decided": []}
    facts = _facts_for("yoimiya", damage)
    toggle = next(t for t in facts["toggles"] if t["name"] == "skill")
    assert toggle["measured"] == alone and toggle["together"] == together
    assert toggle["reached"] == ["normal|1-Hit DMG", "normal|2-Hit DMG"]
    text = sheet.render(facts)
    assert "Moves her main talents' damage, alone: normal +40.0%" in text
    assert "With the states beside it that its effects need (a1): normal +52.0%" in text


def test_a_gear_toggle_no_decision_file_decides_takes_its_label_from_the_label_table():
    labels = {"berserker:hp": "Crit Rate bonus at low HP"}
    assert kitgen.gear_label("berserker:hp", labels) == "Crit Rate bonus at low HP"
    assert kitgen.gear_label("berserker:hp", None) == "Hp"      # no table (a hand-made `decided`): the code name in words
    with pytest.raises(SystemExit, match="no label"):
        kitgen.gear_label("brave-heart:hp", labels)            # a table that lacks one stops the run: write the label
    decided = kitgen.load_decided(TOOL / "decided")
    assert decided["gear_labels"] and all(label.strip() for label in decided["gear_labels"].values())


# ----------------------------------------------------------------------------------------------- a character who is not in the game, and a toggle nobody has decided yet


def _two_characters(decided_toggles=None, effects=None):
    """Somnia and Yanfei as GO's data holds them: Somnia is in the data at the pinned commit and not in the game."""
    def char(name):
        return {"sheet": name, "name": name, "element": "pyro", "weapon_type": "catalyst", "rows": {}, "params": {}, "hits": []}
    kit = {"characters": {"Somnia": {"effects": {}, "hit_data": {}},
                          "Yanfei": {"effects": effects or {}, "hit_data": {}}}, "weapons": {}, "sets": {}}
    decided = {"about": "", "checked": "", "unsure": {}, "characters": {"yanfei": {"toggles": decided_toggles}} if decided_toggles is not None else {}}
    return kit, {"Somnia": char("Somnia"), "Yanfei": char("Yanfei")}, decided


def _build_two(kit, match, decided, notes=None):
    return kitgen.build(kit, match, decided, "0" * 40, lambda name: name.lower(), lambda *a: "elemental", notes=notes)


def test_a_character_of_the_not_in_the_game_table_is_left_out_and_named():
    assert set(kitgen.NOT_IN_GAME) == {"Somnia"} and "2026-11-15" in kitgen.NOT_IN_GAME["Somnia"]
    kit, match, decided = _two_characters()
    notes: dict = {}
    built = _build_two(kit, match, decided, notes)
    assert set(built["characters"]) == {"yanfei"}
    assert notes["not_in_game"] == {"Somnia": kitgen.NOT_IN_GAME["Somnia"]}
    assert set(_build_two(kit, match, decided)["characters"]) == {"yanfei"}   # without notes the character is left out all the same


def test_the_real_kits_json_has_no_somnia_and_no_decision_file_names_her():
    kits_json = json.loads((ROOT / "src" / "guildboard" / "reference" / "characters" / "kits.json").read_text(encoding="utf-8"))
    assert "somnia" not in kits_json["characters"]
    assert not (TOOL / "decided" / "somnia.json").exists()
    # Mitya and Valeriy are in the game though the app's inventory file lacks them: nothing drops by that file
    assert {"mitya", "valeriy"} <= set(kits_json["characters"])


STATE = {"conditional": {"Yanfei": {}}}


def _toggled(name="burst"):
    gate_a = {"op": "match", "x": [{"op": "read", "p": f"conditional.Yanfei.{name}"}, {"op": "const", "v": "on"}, {"op": "const", "v": 0.2}, {"op": "const", "v": 0}]}
    return {"premod": {"all_dmg_": {"op": "threshold", "x": [{"op": "read", "p": "constellation"}, {"op": "const", "v": 6}, gate_a, {"op": "const", "v": 0}]}}}


def test_a_toggle_a_decided_character_has_no_decision_for_is_listed_when_the_run_asks_and_stops_it_otherwise():
    kit, match, decided = _two_characters({}, _toggled())
    with pytest.raises(SystemExit, match="does not decide the toggles"):
        _build_two(kit, match, decided)
    notes: dict = {}
    built = _build_two(kit, match, decided, notes)["characters"]["yanfei"]
    assert notes["awaiting"] == {"yanfei": ["burst"]}
    # it is there, off, with its code name in words, and the character stays checked
    assert built["checked"] is True
    assert [(t["name"], t["on"], t["label"]) for t in built["toggles"]] == [("burst", False, "Burst")]
    # a decided one is not listed
    kit, match, decided = _two_characters({"burst": {"on": False, "label": "Her Burst", "state": "on", "reason": "r"}}, _toggled())
    notes = {}
    built = _build_two(kit, match, decided, notes)["characters"]["yanfei"]
    assert "yanfei" not in notes.get("awaiting", {}) and built["toggles"][0]["label"] == "Her Burst"
