"""The pity rules of the Pulls design (section 6): each wish's count, guarantee and path, worked out by hand on histories
built in order, the standard pool of its time, the window of the imports, and the luck figures."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Callable

import pytest

from guildboard.pulls import ALL_POOLS, rules
from guildboard.pulls.rules import (
    Correction,
    PoolRule,
    PoolState,
    Wish,
    five_star_chance,
    load_reference,
    luck,
    luckier_than,
    pity_distribution,
    pool_state,
    typical_average,
    window_start,
)
from guildboard.store import WishImportRow

UTC = timezone.utc
START = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
NOW = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)
TYPE_OF = {"character": "301", "weapon": "302", "standard": "200", "chronicled": "500", "novice": "100"}
WEAPONS = {"Skyward Harp", "Azurelight", "Symphonist of Scents", "Wolf's Gravestone", "Cool Steel"}


class History:
    """One pool's wishes, built in order: one an hour from `start`, each id one more than the last."""

    def __init__(self, pool: str = "character", start: datetime = START) -> None:
        self.pool = pool
        self.at = start
        self.wishes: list[Wish] = []

    def then(self, count: int, five: str | None = None, *, four_every: int = 10, gacha_type: str = "") -> History:
        """`count` wishes: the last of them a 5★ named `five` when one is given, a 4★ at every `four_every`-th of them
        (none with 0), the others 3★."""
        for n in range(1, count + 1):
            if five is not None and n == count:
                rank, name = 5, five
            elif four_every and n % four_every == 0:
                rank, name = 4, "Bennett"
            else:
                rank, name = 3, "Cool Steel"
            kind = "weapon" if name in WEAPONS else "character"
            wish_id = 1_700_000_000_000_000_000 + len(self.wishes) + 1
            self.wishes.append(Wish(wish_id, self.pool, gacha_type or TYPE_OF[self.pool], name, kind, rank, self.at))
            self.at += timedelta(hours=1)
        return self

    def wait(self, how_long: timedelta) -> History:
        self.at += how_long
        return self


def complete(pool: str, history: History, **settings) -> PoolState:
    """The state of a history that is complete: no run has said where it starts."""
    return pool_state(pool, history.wishes, window_start=None, correction=None, **settings)


def run(run_id: int, day: str, pools: tuple[str, ...] = ALL_POOLS, outcome: str = "ok") -> WishImportRow:
    started = datetime.fromisoformat(f"{day}T10:00:00+00:00")
    return WishImportRow(run_id, 700000001, started, started + timedelta(minutes=2), outcome, 0, 0, None, pools)


def at_ten(day: str) -> datetime:
    return datetime.fromisoformat(f"{day}T10:00:00+00:00")


# ---------------------------------------------------------------------------------------------- the model and the file


def test_the_reference_file_holds_the_rules_of_each_wish():
    reference = load_reference()
    assert reference.pool("character") == PoolRule(90, 74, 10, 0.006, 0.06, 0.55, ("301", "400"))
    assert reference.pool("weapon") == PoolRule(80, 63, 10, 0.007, 0.07, 0.75, ("302",))
    assert reference.pool("standard") == PoolRule(90, 74, 10, 0.006, 0.06, None, ("200",))
    assert reference.pool("chronicled") == PoolRule(90, 74, 10, 0.006, 0.06, 0.5, ("500",))
    assert reference.pool("novice") == PoolRule(90, 74, 10, 0.006, 0.06, None, ("100",))
    assert load_reference() is reference  # read once


def test_the_soft_pity_model_is_the_one_documented():
    assert five_star_chance("character", 73) == 0.006
    assert five_star_chance("character", 74) == pytest.approx(0.066)
    assert five_star_chance("character", 90) == 1.0
    assert five_star_chance("weapon", 62) == 0.007
    assert five_star_chance("weapon", 63) == pytest.approx(0.077)
    assert five_star_chance("weapon", 80) == 1.0
    assert sum(pity_distribution("character")) == pytest.approx(1.0)
    # Index n is the n-th wish after the count; index 0 is unused.
    assert len(pity_distribution("character")) == 91 and pity_distribution("character")[0] == 0.0
    assert pity_distribution("character")[1] == 0.006
    assert len(pity_distribution("character", 61)) == 30
    assert sum(pity_distribution("character", 61)) == pytest.approx(1.0)
    assert len(pity_distribution("weapon", 23)) == 58
    assert pity_distribution("character", 89) == [0.0, 1.0]


def test_the_models_mean_lies_near_the_published_average_rate():
    for pool, published in (("character", 62.5), ("weapon", 54)):
        mean = sum(n * chance for n, chance in enumerate(pity_distribution(pool)))
        assert abs(mean - published) <= 3, pool


# ---------------------------------------------------------------------------------------------- the character event


def test_a_lost_fifty_fifty_makes_the_next_five_star_guaranteed():
    state = complete("character", History().then(76, "Qiqi").then(60))
    assert state.pity == 60
    assert state.known
    assert state.guarantee == "guaranteed"
    assert state.fives[0].pity == 76
    assert state.fives[0].result == "lost"
    assert state.four == 60 % 10
    assert state.wishes == 136
    assert state.last_five == state.fives[0]
    assert state.path_item == "" and state.path_points is None


def test_a_guaranteed_five_star_then_a_won_fifty_fifty():
    state = complete("character", History().then(76, "Qiqi").then(61, "Skirk").then(30, "Skirk"))
    assert [(five.wish.name, five.pity, five.result) for five in state.fives] == [
        ("Qiqi", 76, "lost"),
        ("Skirk", 61, "guaranteed"),
        ("Skirk", 30, "won"),
    ]
    assert state.guarantee == "fifty"
    assert state.pity == 0
    assert state.known


def test_the_second_character_banner_shares_the_count():
    history = (
        History().then(20).then(15, gacha_type="400").then(10).then(30, "Skirk", gacha_type="400").then(7, four_every=0)
    )
    state = complete("character", history)
    assert state.fives[0].pity == 75  # 20 + 15 + 10 + 30, from both banners
    assert state.fives[0].wish.gacha_type == "400"
    assert state.pity == 7
    assert state.four == 7


def test_a_truncated_history_without_a_five_star_is_at_least():
    state = pool_state("character", History().then(40).wishes, window_start=START - timedelta(days=1), correction=None)
    assert state.pity == 40
    assert state.known is False
    assert state.guarantee == "unknown"


def test_a_correction_gives_the_start():
    state = pool_state(
        "character", History().then(40).wishes, window_start=START - timedelta(days=1), correction=Correction(21, True)
    )
    assert state.pity == 61
    assert state.known
    assert state.guarantee == "guaranteed"
    # A correction of a complete history is where it starts too.
    state = pool_state("character", History().then(40).wishes, window_start=None, correction=Correction(5, False))
    assert (state.pity, state.known, state.guarantee) == (45, True, "fifty")


def test_the_first_featured_five_star_in_a_window_is_featured_not_won():
    window = START - timedelta(days=1)
    state = pool_state("character", History().then(50, "Skirk").then(5).wishes, window_start=window, correction=None)
    assert state.fives[0].result == "featured"
    assert state.fives[0].pity is None
    assert state.guarantee == "fifty"
    assert state.known
    assert state.pity == 5
    # A standard 5★ there is a lost 50/50, which settles the guarantee as well.
    state = pool_state("character", History().then(50, "Qiqi").then(5).wishes, window_start=window, correction=None)
    assert (state.fives[0].result, state.fives[0].pity) == ("lost", None)
    assert (state.guarantee, state.known, state.pity) == ("guaranteed", True, 5)


def test_wishes_before_the_window_do_not_settle_the_pity():
    history = History().then(60, "Skirk").wait(timedelta(days=200))
    window = history.at
    history.then(30)
    state = pool_state("character", history.wishes, window_start=window, correction=None)
    assert state.pity == 30
    assert state.known is False
    assert state.guarantee == "unknown"
    assert state.fives[0].pity is None  # listed, with no count
    assert state.wishes == 90
    # With a correction, the count starts at the window as the correction says; the wishes before it do not count.
    corrected = pool_state("character", history.wishes, window_start=window, correction=Correction(10, True))
    assert (corrected.pity, corrected.known, corrected.guarantee) == (40, True, "guaranteed")


def test_window_start_follows_the_chain_of_imports():
    runs = [run(1, "2026-04-01"), run(2, "2026-09-01"), run(3, "2026-10-23")]
    assert window_start(runs, "character", NOW) == at_ten("2026-04-01") - timedelta(days=180)
    assert window_start(list(reversed(runs)), "character", NOW) == at_ten("2026-04-01") - timedelta(days=180)
    # More than 180 days between two runs: the wishes between them may be gone, so the chain starts after the gap.
    broken = [run(1, "2025-12-01"), run(3, "2026-09-01"), run(4, "2026-10-23")]
    assert window_start(broken, "character", NOW) == at_ten("2026-09-01") - timedelta(days=180)
    # A run that failed after it finished the character event counts for that pool alone.
    failed = run(2, "2026-06-01", pools=("character",), outcome="failed")
    assert window_start([*broken, failed], "character", NOW) == at_ten("2026-06-01") - timedelta(days=180)
    assert window_start([*broken, failed], "weapon", NOW) == at_ten("2026-09-01") - timedelta(days=180)
    # No run finished the pool: a history read as complete.
    assert window_start([], "character", NOW) is None
    assert window_start([run(1, "2026-10-23", pools=("weapon",))], "character", NOW) is None


def kept(wish_id: int, at: datetime, import_id: int, pool: str = "character") -> Wish:
    """A 3★ of `pool` that the import run `import_id` kept."""
    return Wish(wish_id, pool, TYPE_OF[pool], "Cool Steel", "weapon", 3, at, import_id)


def test_the_window_reaches_back_to_the_oldest_wish_the_chain_kept():
    # HoYoverse keeps six months, which reach a few days past 180: the chain's first run kept wishes from before its
    # start − 180 days, and the window starts at the oldest of them, so that they count.
    runs = [run(1, "2026-04-01"), run(2, "2026-09-01")]
    sliver = [kept(1, at_ten("2026-04-01") - timedelta(days=183), 1), kept(2, at_ten("2026-04-01") - timedelta(days=182), 1)]
    later = [kept(3, at_ten("2026-08-30"), 2)]
    assert window_start(runs, "character", NOW, [*sliver, *later]) == at_ten("2026-04-01") - timedelta(days=183)
    # Wishes the chain kept inside the 180 days leave the window where its runs put it.
    assert window_start(runs, "character", NOW, later) == at_ten("2026-04-01") - timedelta(days=180)
    # A wish that a run before a gap of 180 days or more kept is not the chain's: a gap may lie after it.
    broken = [run(1, "2025-12-01"), run(3, "2026-09-01")]
    old = kept(1, at_ten("2025-12-01") - timedelta(days=183), 1)
    assert window_start(broken, "character", NOW, [old, *later]) == at_ten("2026-09-01") - timedelta(days=180)
    # Nor does a wish of a run that did not finish the pool.
    unfinished = run(4, "2026-09-02", pools=("weapon",))
    stray = kept(4, at_ten("2026-09-02") - timedelta(days=200), 4)
    assert window_start([*runs, unfinished], "character", NOW, [stray, *later]) == at_ten("2026-04-01") - timedelta(days=180)


def test_a_correction_counts_the_wishes_kept_before_the_runs_180_days():
    # The sliver the chain's first run kept before its start − 180 days counts from the correction: here a 5★ in it, a
    # lost 50/50 at the correction's 10 + 2, makes the next one guaranteed.
    start = at_ten("2026-10-20")
    history = History(start=start - timedelta(days=183)).then(2, "Qiqi").then(1)
    history.wait(timedelta(days=10)).then(40)
    wishes = [Wish(w.id, w.pool, w.gacha_type, w.name, w.kind, w.rank, w.at, 1) for w in history.wishes]
    window = window_start([run(1, "2026-10-20")], "character", NOW, wishes)
    assert window == start - timedelta(days=183)
    state = pool_state("character", wishes, window_start=window, correction=Correction(10, False))
    assert [(five.wish.name, five.pity, five.result) for five in state.fives] == [("Qiqi", 12, "lost")]
    assert (state.pity, state.known, state.guarantee) == (41, True, "guaranteed")


# ---------------------------------------------------------------------------------------------- the paths


def test_the_weapon_banner_loses_to_a_standard_weapon_and_charts_its_path():
    history = History("weapon").then(10)
    banner = history.at
    history.then(40, "Skyward Harp")
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner)
    assert state.fives[0].result == "lost"
    assert state.guarantee == "guaranteed"
    assert state.path_points == 1
    assert state.path_item == "Azurelight"
    history.then(30, "Azurelight")
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner)
    assert state.fives[1].result == "path"
    assert state.fives[1].pity == 30
    assert state.path_points == 0
    assert state.guarantee == "fifty"


def test_the_fate_point_resets_with_the_banner_and_can_be_set():
    # A 75/25 lost on an earlier banner: the next 5★ is a featured weapon, but the point did not carry over.
    history = History("weapon").then(50, "Skyward Harp").wait(timedelta(days=10))
    banner = history.at
    history.then(20)
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner)
    assert state.guarantee == "guaranteed"
    assert state.path_points == 0

    # The other featured weapon, inside the banner: a won 75/25 and a point.
    history = History("weapon").then(5)
    banner = history.at
    history.then(40, "Symphonist of Scents")
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner)
    assert (state.fives[0].result, state.guarantee, state.path_points) == ("won", "fifty", 1)
    # The game showed 0 after it (the chart was changed, say): that count replaces the history's up to then.
    set_at = history.at
    history.then(10)
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner, points_set=(0, set_at))
    assert state.path_points == 0
    history.then(50, "Symphonist of Scents")
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner, points_set=(0, set_at))
    assert state.path_points == 1
    # A figure from before the banner started belongs to another banner.
    state = complete(
        "weapon", history, path_item="Azurelight", banner_start=banner, points_set=(0, banner - timedelta(days=1))
    )
    assert state.path_points == 1
    # A point set with no 5★ after it stays; nothing counts without a chart or a running banner.
    state = complete("weapon", History("weapon").then(5), path_item="Azurelight", banner_start=START, points_set=(1, NOW))
    assert state.path_points == 1
    assert complete("weapon", history, path_item="", banner_start=banner).path_points == 0
    assert complete("weapon", history, path_item="Azurelight", banner_start=None).path_points == 0


def test_the_chronicled_path():
    history = History("chronicled").then(3)
    banner = history.at
    history.then(60, "Ganyu")
    state = complete("chronicled", history, path_item="Shenhe", banner_start=banner)
    assert state.fives[0].result == "off-path"
    assert state.path_points == 1
    assert state.guarantee == "guaranteed"
    history.then(70, "Shenhe")
    state = complete("chronicled", history, path_item="Shenhe", banner_start=banner)
    assert state.fives[1].result == "path"
    assert state.path_points == 0
    assert state.guarantee == "fifty"

    # A 5★ before the banner started, or with no running banner, gives no point, and today's path does not judge it.
    early = History("chronicled").then(60, "Ganyu").wait(timedelta(days=30))
    later_banner = early.at
    early.then(10)
    state = complete("chronicled", early, path_item="Shenhe", banner_start=later_banner)
    assert (state.fives[0].result, state.path_points, state.guarantee) == (None, 0, "fifty")
    state = complete("chronicled", early, path_item="Shenhe", banner_start=None)
    assert (state.fives[0].result, state.path_points, state.guarantee) == (None, 0, "fifty")
    # No path chosen: the 5★ is judged neither way.
    state = complete("chronicled", early, path_item="", banner_start=later_banner)
    assert (state.fives[0].result, state.path_points, state.guarantee) == (None, 0, "fifty")
    # The point is the chronicled wish's only guarantee: a correction gives the count, not a guarantee.
    state = pool_state(
        "chronicled", History("chronicled").then(5).wishes, window_start=None, correction=Correction(30, True)
    )
    assert (state.pity, state.guarantee) == (35, "fifty")


def test_a_path_is_judged_only_inside_the_running_banner():
    # The charted weapon got on an earlier banner was no path of today's: a won 75/25 then, and no point now.
    history = History("weapon").then(40, "Azurelight").wait(timedelta(days=20))
    banner = history.at
    history.then(30, "Azurelight")
    state = complete("weapon", history, path_item="Azurelight", banner_start=banner)
    assert [five.result for five in state.fives] == ["won", "path"]
    assert (state.path_points, state.guarantee) == (0, "fifty")
    lost = complete("weapon", History("weapon").then(40, "Skyward Harp").wait(timedelta(days=20)).then(5),
                    path_item="Azurelight", banner_start=banner)
    assert lost.fives[0].result == "lost"  # a lost 75/25 is lost whatever the banner
    assert complete("weapon", history, path_item="Azurelight", banner_start=None).fives[1].result == "won"
    # The chronicled wish's 5★ before the banner are judged neither way; inside it, by the path.
    chronicled = History("chronicled").then(50, "Shenhe").wait(timedelta(days=20))
    chronicled_banner = chronicled.at
    chronicled.then(60, "Ganyu")
    state = complete("chronicled", chronicled, path_item="Shenhe", banner_start=chronicled_banner)
    assert [five.result for five in state.fives] == [None, "off-path"]
    assert (state.path_points, state.guarantee) == (1, "guaranteed")


def test_the_standard_wish_judges_no_five_star():
    state = complete("standard", History("standard").then(76, "Wolf's Gravestone").then(44))
    assert state.fives[0].result is None
    assert state.fives[0].pity == 76
    assert state.guarantee == "none"
    assert state.path_points is None
    assert state.pity == 44
    novice = complete("novice", History("novice").then(20, four_every=10))
    assert (novice.guarantee, novice.path_points, novice.pity, novice.four) == ("none", None, 20, 0)


def test_a_five_star_resets_the_four_star_count_too():
    assert complete("character", History().then(7, four_every=0)).four == 7
    assert complete("character", History().then(8, "Skirk", four_every=0).then(3, four_every=0)).four == 3
    assert complete("character", History().then(12, four_every=10)).four == 2
    # Each count is known: the history settles it, or is complete.
    assert all(state.four_known for state in (
        complete("character", History().then(7, four_every=0)),
        pool_state("character", History().then(8, "Skirk", four_every=0).then(3, four_every=0).wishes,
                   window_start=START, correction=None),
        pool_state("character", History().then(12).wishes, window_start=START, correction=None),
    ))


def test_with_no_4_star_kept_the_4_star_count_is_the_wishes_since_the_window():
    # Ruling R22: with no 4★ or 5★ kept, a history that has a window cannot tell the 4★ count. It is at least the wishes
    # kept since the window's start, so the next 4★ comes within 10 less those.
    state = pool_state("chronicled", History("chronicled").then(5, four_every=0).wishes, window_start=START,
                       correction=None)
    assert (state.four, state.four_known) == (5, False)
    # Wishes kept before the window are not counted: a gap may lie between them and it.
    history = History().then(3, four_every=0).wait(timedelta(days=200))
    window = history.at
    history.then(4, four_every=0)
    state = pool_state("character", history.wishes, window_start=window, correction=Correction(0, False))
    assert (state.four, state.four_known) == (4, False)
    # A complete history knows it from its start.
    assert (complete("chronicled", History("chronicled").then(5, four_every=0)).four_known) is True


# ---------------------------------------------------------------------------------------------- luck and the standard pool


def test_luck_figures():
    character = complete("character", History().then(77, "Skirk").then(81, "Qiqi").then(61))
    standard = complete("standard", History("standard").then(76, "Wolf's Gravestone").then(44))
    figures = luck({"character": character, "standard": standard})
    assert figures.fives == 3  # every 5★, the standard wish's too
    assert figures.average_pity == 79  # the character event's alone: (77 + 81) / 2
    assert figures.won == 1
    assert figures.lost == 1
    assert figures.luckier_than == pytest.approx(luckier_than([("character", 77), ("character", 81)]))
    assert luckier_than([("character", 1)]) == pytest.approx(0.994)
    assert luckier_than([("character", 90)]) == 0.0
    assert luckier_than([]) is None
    # Two 5★ need more than one: a player of the published odds needs more than 2 for two 5★ almost always.
    assert luckier_than([("character", 1), ("weapon", 1)]) == pytest.approx(1 - 0.006 * 0.007)
    # A 5★ whose count is not known is counted, and left out of the figures.
    unknown = pool_state("character", History().then(50, "Skirk").wishes, window_start=START, correction=None)
    figures = luck({"character": unknown})
    assert (figures.fives, figures.average_pity, figures.won, figures.lost, figures.luckier_than) == (1, None, 0, 0, None)


def test_luck_counts_the_character_events_known_five_stars():
    # The character event: a 5★ whose count is not known (the history starts after the one before it), then 5★ at 74,
    # 33 and 80. The weapon event's 5★ at 70 is one of the fives and in neither the average nor the comparison.
    started = History().then(50, "Skirk").then(74, "Qiqi").then(33, "Ganyu").then(80, "Shenhe")
    character = pool_state("character", started.wishes, window_start=START, correction=None)
    weapon = complete("weapon", History("weapon").then(70, "Azurelight"))
    assert [five.pity for five in character.fives] == [None, 74, 33, 80]
    figures = luck({"character": character, "weapon": weapon})
    assert figures.fives == 5
    assert figures.average_pity == 62.3  # (74 + 33 + 80) / 3, to one decimal
    assert figures.luckier_than == pytest.approx(luckier_than([("character", 74), ("character", 33), ("character", 80)]))
    # No known character 5★ gives no average and no comparison, however many weapon 5★ there are.
    alone = luck({"character": pool_state("character", History().then(50, "Skirk").wishes, window_start=START,
                                           correction=None), "weapon": weapon})
    assert (alone.fives, alone.average_pity, alone.luckier_than) == (2, None, None)
    assert luck({"weapon": weapon}).average_pity is None
    # What a typical player's average is, by the same model: its mean for the character event, 62.3 to a decimal.
    assert typical_average() == pytest.approx(62.3, abs=0.05)
    assert round(typical_average()) == 62 and round(typical_average(), 1) == 62.3
    assert typical_average() == pytest.approx(sum(n * chance for n, chance in enumerate(pity_distribution("character"))))


def test_the_50_50_record_is_the_character_events_alone():
    """The luck line's "50/50: won 1, lost 1" is the character event's 50/50 (spec 2.4). The weapon event's 75/25 is not in
    it, and its 5★ are not in the average or the comparison, which the character event's known 5★ make alone."""
    character = complete("character", History().then(77, "Skirk").then(81, "Qiqi").then(61))
    # On the weapon event a featured weapon, a 75/25 won, then a standard one, a 75/25 lost.
    weapon = complete("weapon", History("weapon").then(40, "Azurelight").then(30, "Wolf's Gravestone").then(5))
    assert [five.result for five in weapon.fives] == ["won", "lost"]
    figures = luck({"character": character, "weapon": weapon})
    assert (figures.won, figures.lost) == (1, 1)  # Skirk won and Qiqi lost
    assert figures.fives == 4
    assert figures.average_pity == (77 + 81) / 2
    assert figures.luckier_than == pytest.approx(luckier_than([("character", 77), ("character", 81)]))
    # The weapon event alone has no 50/50 to count, and no average.
    alone = luck({"weapon": weapon})
    assert (alone.fives, alone.won, alone.lost, alone.average_pity) == (2, 0, 0, None)


def _pities(count: int, count_of: Callable[[int], int]) -> list[tuple[str, int]]:
    """`count` 5★, every fifth of the weapon event, at the counts `count_of` gives."""
    return [
        ("weapon", min(count_of(n), 79)) if n % 5 == 0 else ("character", min(count_of(n), 89)) for n in range(count)
    ]


def test_luck_is_exact_up_to_30_counts_and_approximated_closely_and_at_once_beyond():
    shapes = (
        lambda n: 62, lambda n: 66, lambda n: 58, lambda n: 60 + n % 7, lambda n: 50 + (n * 37) % 40,
        lambda n: 10 + (n * 29) % 60, lambda n: 70 + (n * 7) % 12,
    )
    for count in range(30, 41):
        for count_of in shapes:
            five_stars = tuple(sorted(_pities(count, count_of)))
            exact, approximated = rules._exact_luckier_than(five_stars), rules._approximated_luckier_than(five_stars)
            assert approximated == pytest.approx(exact, abs=0.01), (count, five_stars[:3])
    # Exact up to 30 5★, approximated beyond.
    thirty, thirty_one = _pities(30, lambda n: 62), _pities(31, lambda n: 62)
    assert luckier_than(thirty) == rules._exact_luckier_than(tuple(sorted(thirty)))
    assert luckier_than(thirty_one) == rules._approximated_luckier_than(tuple(sorted(thirty_one)))
    started = time.perf_counter()
    assert 0 <= luckier_than(_pities(250, lambda n: 55 + n % 30)) <= 1
    assert time.perf_counter() - started < 0.25


def test_the_standard_pool_of_its_time():
    reference = load_reference()
    assert reference.is_standard("Tighnari", "character", datetime(2022, 9, 1, tzinfo=UTC)) is False
    assert reference.is_standard("Tighnari", "character", datetime(2022, 10, 1, tzinfo=UTC)) is True
    assert reference.is_standard("Skirk", "character", NOW) is False
    assert reference.is_standard("Wolf's Gravestone", "weapon", NOW) is True
    assert reference.is_standard("Qiqi", "weapon", NOW) is False
