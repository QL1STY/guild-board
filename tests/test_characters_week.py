"""Task E4: the week plan. Its expected days are what week.html's own `plan()` prints for the same four characters (run under
node on 2026-10-29); Sunday is day 0, and Python's weekdays count Monday as 0 and Sunday as 6."""
from __future__ import annotations

import dataclasses
from datetime import date, timedelta

import pytest

from characters_samples import (
    CHARITY, DOCTOR, FELLFROST, GATE, IL_DOTTORE, LIONS, VAGRANCY, WEEK_RESIN_MAX, WEEK_RESIN_NOW, WEEK_TODAY, refs_sample,
    week_focus,
)
from guildboard.characters import odds, week
from guildboard.characters.models import FocusInput, Need, Source
from guildboard.metrics import slug

SUNDAY = WEEK_TODAY


def run(focus=None, resin_now=WEEK_RESIN_NOW, discounts=3, **extra):
    return week.plan(
        focus if focus is not None else week_focus(), resin_now, WEEK_RESIN_MAX, discounts, SUNDAY, refs_sample(), **extra,
    )


def day(result, index):
    """A day's tasks as (kind, where, runs, resin, who), in order."""
    return [(t.kind, t.where, t.runs, t.resin, t.who) for t in result.days[index].tasks]


def test_sunday_serves_sandrone_first_then_odette_and_picks_flockingweed():
    result = run()
    assert day(result, 0) == [
        ("weekly", "The Doctor", 1, 30, ("sandrone",)),
        ("books", "Overturned Roost", 6, 120, ("sandrone",)),
        ("weekly", "Il Dottore", 1, 30, ("odette",)),
        ("books", "Relics of the Frozen Grace", 1, 20, ("odette",)),
        ("flowers", "Fellfrost Peak", 0, 0, ("alyosha",)),
        ("level", "Raise her Normal Attack to 10", 0, 0, ("sandrone",)),
    ]
    sunday = result.days[0]
    assert (sunday.day, sunday.start, sunday.spent) == (SUNDAY, 200, 200)
    pick = sunday.tasks[4]
    assert pick.free and pick.gets == (("alyosha", "flockingweed", 14.0),)
    assert sunday.tasks[5].free and sunday.tasks[5].why == "everything her goal needs is in"
    assert not sunday.tasks[0].free


def test_the_tasks_carry_stable_keys_and_plain_reasons():
    sunday = run().days[0].tasks
    assert sunday[0].key == "2026-10-25:weekly:The Doctor:sandrone"
    assert sunday[1].key == "2026-10-25:books:Overturned Roost:sandrone"
    assert sunday[0].why == "1 Madman's Restraint for Sandrone"
    assert sunday[1].why == "about 7 Philosophies of Vagrancy, for her Normal Attack 10"
    assert sunday[1].gets == (("sandrone", slug("Philosophies of Vagrancy"), 7.0),)
    assert sunday[4].why == "14 Flockingweed, for her level 80"
    keys = [t.key for d in run().days for t in d.tasks]
    assert len(keys) == len(set(keys))


def test_monday_brings_the_weekly_bosses_back_and_gives_odette_nine_runs():
    monday = run().days[1]
    assert [(t.kind, t.where, t.runs, t.resin, t.who) for t in monday.tasks] == [
        ("books", "Relics of the Frozen Grace", 9, 180, ("odette",)),
    ]
    assert (monday.start, monday.spent) == (180, 180)


def test_tuesday_finishes_alyosha():
    result = run()
    assert day(result, 2) == [
        ("weekly", "The Game Before the Gate", 1, 30, ("jahoda",)),
        ("boss", "Chimeric Winged Lions", 3, 120, ("alyosha",)),
        ("artifacts", "An artifact domain", 1, 20, ("sandrone",)),
        ("flowers", "Fellfrost Peak", 0, 0, ("alyosha",)),
        ("level", "Raise her to level 80", 0, 0, ("alyosha",)),
    ]
    tuesday = result.days[2]
    assert (tuesday.start, tuesday.spent) == (180, 170)
    assert tuesday.tasks[3].gets == (("alyosha", "flockingweed", 9.0),)
    assert tuesday.tasks[2].why == "a chance at her Cryo DMG Bonus goblet"


def test_wednesday_finishes_jahoda_with_what_carried_over():
    wednesday = run().days[3]
    assert [(t.kind, t.where, t.runs, t.resin, t.who) for t in wednesday.tasks] == [
        ("books", "Overturned Roost", 9, 180, ("jahoda",)),
        ("level", "Raise her Skill to 8", 0, 0, ("jahoda",)),
    ]
    assert (wednesday.start, wednesday.spent) == (190, 180)


def test_the_ready_days_are_0_2_3_and_4():
    ready = run().ready
    assert {key: (None if d is None else (d - SUNDAY).days) for key, d in ready.items()} == {
        "sandrone": 0, "alyosha": 2, "jahoda": 3, "odette": 4,
    }
    assert ready["odette"] == date(2026, 10, 29)


def test_moving_jahoda_first_gives_her_sunday():
    focus = week_focus()
    result = run(focus=(focus[3], focus[0], focus[1], focus[2]))
    assert day(result, 0)[:2] == [
        ("weekly", "The Game Before the Gate", 1, 30, ("jahoda",)),
        ("books", "Overturned Roost", 8, 160, ("jahoda",)),
    ]
    assert [t[:2] for t in day(result, 1)[:2]] == [("weekly", "The Doctor"), ("weekly", "Il Dottore")]
    assert (result.ready["sandrone"] - SUNDAY).days == 3


def test_vesna_in_place_of_jahoda_shares_il_dottore_with_odette():
    sandrone, odette, alyosha, _ = week_focus()
    need = lambda name, amount, source: Need(slug(name), name, None, amount, None, True, source)  # noqa: E731
    vesna = FocusInput(
        key="vesna", name="Vesna", pronouns=("she", "her", "her"), goal="Level 90", luck=(), needs=(
            need("Vagabond's Cracked Armor", 20, Source("boss", "Guardian Blade of Drifting Snow", ())),
            need("Golden Fern", 35, Source("flowers", "Flamefeather Valley", ())),
            need("Profaned Sprout", 1, IL_DOTTORE),
            need("Philosophies of Glory", 6, Source("books", "Relics of the Frozen Grace", (2, 5, 6))),
        ),
    )
    result = run(focus=(sandrone, odette, alyosha, vesna))
    shared = [t for t in result.days[0].tasks if t.where == "Il Dottore"]
    assert len(shared) == 1 and shared[0].who == ("odette", "vesna") and shared[0].runs == 1
    assert shared[0].why == "1 Twisted Withered Branch for Odette, 1 Profaned Sprout for Vesna"
    assert shared[0].key == "2026-10-25:weekly:Il Dottore:odette"
    assert (result.ready["vesna"] - SUNDAY).days == 5


def test_unspent_resin_carries_over_up_to_200():
    quiet = run(focus=[])
    assert [d.start for d in quiet.days[:3]] == [200, 200, 200]
    assert week.plan([], 40, 160, 3, SUNDAY, refs_sample()).days[1].start == 160   # 40 + 180, held to the maximum of 160
    assert run(focus=[], resin_now=10).days[1].start == 190
    assert run(focus=week_focus()).days[3].start == 190   # 10 carried over on top of the day's 180


def test_a_weekly_boss_ticked_this_week_is_not_planned_again_before_monday():
    for done in (frozenset({"The Doctor"}), frozenset({"2026-10-22:weekly:The Doctor:sandrone"})):
        result = run(weekly_done=done)
        assert "The Doctor" not in [t.where for t in result.days[0].tasks]
        assert [t.where for t in result.days[1].tasks if t.kind == "weekly"] == ["The Doctor"]


def test_a_weekly_boss_that_gives_a_material_only_by_chance_says_so():
    """The research gives a weekly boss's chance of each of its materials: below 1, a run is a chance, not "0.5" of one."""
    refs = dataclasses.replace(refs_sample(), yields={**refs_sample().yields, "weekly": 0.5})
    sunday = week.plan(week_focus(), WEEK_RESIN_NOW, WEEK_RESIN_MAX, 3, SUNDAY, refs).days[0].tasks
    assert sunday[0].where == "The Doctor" and sunday[0].why == "a chance at Madman's Restraint for Sandrone"
    refs = dataclasses.replace(refs, yields={**refs.yields, "weekly": 1.5})
    vesna = FocusInput("vesna", "Vesna", ("she", "her", "her"), "Level 90", (
        Need(slug("Profaned Sprout"), "Profaned Sprout", None, 3, None, True, IL_DOTTORE),
    ), ())
    first = week.plan([vesna], WEEK_RESIN_NOW, WEEK_RESIN_MAX, 3, SUNDAY, refs).days[0].tasks[0]
    assert first.why == "about 2 Profaned Sprout for Vesna"


def test_ticks_mark_tasks_done_without_changing_the_plan():
    """A weekly boss ticked today is in `weekly_done` and in today's ticks: the plan still shows it today, as it did, and
    does not send the player to it again before Monday."""
    key = "2026-10-25:weekly:The Doctor:sandrone"
    without = run()
    assert run(ticks=frozenset({key}), weekly_done=frozenset({key})) == without
    assert run(ticks=frozenset({"2026-10-25:books:Overturned Roost:sandrone"})) == without
    low = run(resin_now=0, ticks=frozenset({key}), weekly_done=frozenset({key}))   # the game's resin already fell
    assert "The Doctor" not in [t.where for t in low.days[0].tasks]
    assert [t.where for t in low.days[1].tasks if t.kind == "weekly"][:1] == ["The Doctor"]   # the reset on Monday


def test_with_no_focus_the_plan_is_empty_and_resin_carries_over():
    result = run(focus=[])
    assert len(result.days) == 35 and result.days[0].day == SUNDAY and result.days[34].day == SUNDAY + timedelta(days=34)
    assert all(d.tasks == () and d.spent == 0 and d.start == 200 for d in result.days)
    assert result.ready == {} and result.luck == {} and result.resin_by == {}
    assert len(week.plan([], 200, 200, 3, SUNDAY, refs_sample(), horizon=7).days) == 7


def test_the_goblets_chances_pass_one_half_and_nine_in_ten_on_the_days_the_mockup_prints():
    """week.html prints half a chance on day 17 (Wednesday 11 November), and nine in ten not within the 35 days."""
    result = run()
    assert result.luck == {"sandrone": (date(2026, 11, 11), None)}
    p = 0.00554
    runs, total = [], 0
    for d in result.days:
        total += sum(t.runs for t in d.tasks if t.kind == "artifacts")
        runs.append(total)
    assert odds.day_reaching(p, runs, 0.5) == 17 and odds.day_reaching(p, runs, 0.9) is None


def test_resin_by_counts_the_first_seven_days_for_each_character():
    assert run().resin_by == {"sandrone": 670, "odette": 270, "alyosha": 120, "jahoda": 210}


def test_what_is_held_is_taken_off_what_is_needed():
    need = Need(slug("Philosophies of Vagrancy"), "Philosophies of Vagrancy", None, 10, 4, True, VAGRANCY)
    focus = FocusInput("sandrone", "Sandrone", ("she", "her", "her"), "Normal Attack 10", (need,), ())
    first = run(focus=[focus]).days[0].tasks[0]
    assert (first.kind, first.runs, first.resin) == ("books", 6, 120)   # 6 still to get, at 1.17 a run
    full = dataclasses.replace(need, held=10)
    assert [t.kind for t in run(focus=[dataclasses.replace(focus, needs=(full,))]).days[0].tasks] == ["level"]


def test_a_domain_that_is_shut_waits_for_its_day_and_sunday_opens_every_one():
    need = Need("x", "Philosophies of Charity", None, 3, None, True, CHARITY)   # Monday, Thursday, Sunday
    focus = FocusInput("odette", "Odette", ("she", "her", "her"), "Level 90", (need,), ())
    saturday = week.plan([focus], 200, 200, 3, SUNDAY - timedelta(days=1), refs_sample())
    assert saturday.days[0].tasks == ()   # Saturday: shut
    assert [t.kind for t in saturday.days[1].tasks] == ["books", "level"]   # Sunday: open


def test_needs_that_cannot_be_planned_do_not_hold_a_character_back_and_enemy_drops_are_a_daily_reminder():
    books = Need("b", "Philosophies of Vagrancy", None, 1, None, True, Source("books", "Overturned Roost", ()))
    drops = Need("e", "Chaos Gear", None, 5, None, True, Source("enemies", "Ruin Guards", ()))
    other = Need("u", "Mystery Thing", None, 2, None, True, Source("unknown", "", ()))
    focus = FocusInput("sandrone", "Sandrone", ("she", "her", "her"), "Normal Attack 10", (books, drops, other), ())
    result = run(focus=[focus])
    assert [(t.kind, t.free) for t in result.days[0].tasks] == [("books", False), ("enemies", True), ("level", True)]
    assert result.ready["sandrone"] == SUNDAY
    assert result.days[1].tasks == ()
