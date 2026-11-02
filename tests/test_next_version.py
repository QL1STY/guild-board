"""The next game version's primogems (the Pulls second pass, Task 3): the versions calendar and the banners that correct
it, the fixed sources over the version's days, and the events and quests that the Traveler's Diary gives, worked out by
hand."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Mapping, Sequence

from guildboard.gameday import server_tz
from guildboard.pulls.nextversion import NextVersion, Row, load_reference, next_version
from guildboard.store import BannerRow

SERVER = "os_euro"
REFERENCE = load_reference()
KEYS = ["commissions", "events", "endgame", "update", "quests", "welkin", "gnostic_hymn"]
# The diary of 2026-10-24: August and September are full months, October is not over.
DIARY = {
    "2026-08": {"events": 3100, "quests": 620},
    "2026-09": {"events": 2400, "quests": 400},
    "2026-10": {"events": 900},
}


def banner_ending(text: str) -> BannerRow:
    """A banner that ends at `text` on the server's clock, such as "2026-11-24 14:59"."""
    ends = datetime.fromisoformat(text).replace(tzinfo=server_tz(SERVER))
    starts = ends - timedelta(days=21)
    return BannerRow(9001, "Void Star's Advent", "character", ("Skirk",), "", starts, ends, starts)


def version(
    today: str, *, banners: Sequence[BannerRow] = (), diary: Mapping[str, Mapping[str, float]] | None = None,
    welkin: bool = False, hymn: bool = False, typed: Mapping[str, int] | None = None, reference: dict = REFERENCE,
) -> NextVersion:
    return next_version(date.fromisoformat(today), banners, diary or {}, welkin, hymn, typed or {}, reference)


def rows(next_: NextVersion) -> dict[str, Row]:
    return {row.key: row for row in next_.rows}


def calendar_from(day: str) -> dict:
    """The reference with its known version, 7.1, started on another day."""
    return {**REFERENCE, "calendar": {**REFERENCE["calendar"], "started": day}}


# ---------------------------------------------------------------------------------------------- the calendar


def test_the_calendar_places_7_2_from_today():
    next_ = version("2026-10-24")
    assert (next_.number, next_.starts_on, next_.ends_on) == ("7.2", date(2026, 11, 4), date(2026, 12, 16))
    assert next_.days == 42
    # The update's own day belongs to the new version: the next one is the one after it.
    assert version("2026-11-03").number == "7.2"
    assert (version("2026-11-04").number, version("2026-11-04").starts_on) == ("7.3", date(2026, 12, 16))
    assert (version("2026-09-23").number, version("2026-09-23").starts_on) == ("7.2", date(2026, 11, 4))


def test_in_a_first_half_the_next_version_still_follows_the_cadence():
    # 7.2's first half runs 4 to 25 Nov: its banners end on the 24th at 14:59, which is not the version's end.
    first_half = [banner_ending("2026-11-24 14:59")]
    next_ = version("2026-11-10", banners=first_half)
    assert (next_.number, next_.starts_on, next_.ends_on) == ("7.3", date(2026, 12, 16), date(2027, 1, 27))


def test_a_banner_end_near_the_calendar_moves_the_start():
    near = banner_ending("2026-11-05 14:59")  # the server's day 5 Nov, so the version starts on the 6th
    next_ = version("2026-10-24", banners=[near])
    assert (next_.number, next_.starts_on, next_.ends_on) == ("7.2", date(2026, 11, 6), date(2026, 12, 18))
    far = banner_ending("2026-11-20 14:59")
    assert version("2026-10-24", banners=[far]).starts_on == date(2026, 11, 4)
    assert version("2026-10-24", banners=[far, near]).starts_on == date(2026, 11, 6)
    # Three days off still moves it, four do not.
    assert version("2026-10-24", banners=[banner_ending("2026-11-06 14:59")]).starts_on == date(2026, 11, 7)
    assert version("2026-10-24", banners=[banner_ending("2026-11-07 14:59")]).starts_on == date(2026, 11, 4)
    # Of two that are near, the one nearest to the calendar's day.
    both = [banner_ending("2026-11-05 14:59"), banner_ending("2026-11-03 14:59")]
    assert version("2026-10-24", banners=both).starts_on == date(2026, 11, 4)


def test_a_banners_end_is_read_as_a_game_day_of_the_server():
    # 03:30 on the 5th is before the 04:00 reset: it is still the game day of the 4th, so the version starts on the 5th.
    assert version("2026-10-24", banners=[banner_ending("2026-11-05 03:30")]).starts_on == date(2026, 11, 5)
    assert version("2026-10-24", banners=[banner_ending("2026-11-05 04:30")]).starts_on == date(2026, 11, 6)


def test_a_late_update_is_still_the_next_version_until_its_day():
    # The banners end on 4 Nov at 14:59, a day after the calendar's update: 7.2 comes on the 5th, and 7.3 is not next.
    late = [banner_ending("2026-11-04 14:59")]
    assert (version("2026-11-04", banners=late).number, version("2026-11-04", banners=late).starts_on) == (
        "7.2", date(2026, 11, 5),
    )
    assert (version("2026-11-05", banners=late).number, version("2026-11-05", banners=late).starts_on) == (
        "7.3", date(2026, 12, 16),
    )
    # With no banner to say so, the calendar's day stands.
    assert version("2026-11-04").number == "7.3"
    # The banners of the version that ended on the calendar's day change nothing.
    ended = [banner_ending("2026-11-03 14:59")]
    assert version("2026-11-04", banners=ended).number == "7.3"


def test_the_calendar_cannot_always_place_the_number():
    assert version("2026-01-01").number is None  # a version before the known one's cadence reaches x.0
    assert version("2026-01-01").starts_on == date(2026, 1, 14)  # the days are still the cadence's
    odd = {**REFERENCE, "calendar": {**REFERENCE["calendar"], "version": "seven"}}
    assert version("2026-10-24", reference=odd).number is None
    assert version("2026-10-24", reference=odd).starts_on == date(2026, 11, 4)
    # Typing a count needs a number to key it by.
    assert rows(version("2026-10-24", typed={"7.2": 2330}, reference=odd))["events"].estimated is True


# ---------------------------------------------------------------------------------------------- the fixed sources


def test_the_rows_of_7_2():
    next_ = version("2026-10-24", welkin=True)
    assert [row.key for row in next_.rows] == KEYS
    assert next_.rows == (
        Row("commissions", 2520, 0, True, False),
        Row("events", 0, 0, True, True),
        Row("endgame", 3050, 0, True, False),  # Abyss 1,600 (16 Nov, 16 Dec), Theater 1,000 (1 Dec), Stygian 450
        Row("update", 600, 0, True, False),
        Row("quests", 0, 0, True, True),
        Row("welkin", 3780, 0, True, False),
        Row("gnostic_hymn", 680, 4, False, False),
    )
    assert (next_.primogems, next_.fates, next_.pulls) == (2520 + 3050 + 600 + 3780, 0, 62)
    assert next_.primogems == 9950
    # With the Welkin Moon off its row stays, with its amount, and the total leaves it out.
    off = version("2026-10-24")
    assert rows(off)["welkin"] == Row("welkin", 3780, 0, False, False)
    assert (off.primogems, off.fates, off.pulls) == (6170, 0, 38)


def test_the_gnostic_hymn_adds_primogems_and_fates():
    next_ = version("2026-10-24", welkin=True, hymn=True)
    assert rows(next_)["gnostic_hymn"] == Row("gnostic_hymn", 680, 4, True, False)
    assert (next_.primogems, next_.fates, next_.pulls) == (10630, 4, 70)


def test_a_reset_counts_after_the_versions_first_day_and_up_to_its_last():
    # 7.2 runs from 4 Nov to the 16 Dec update: the Abyss's 16 Dec reset counts, as the update's day is the last day.
    assert rows(version("2026-10-24"))["endgame"].primogems == 800 * 2 + 1000 + 450
    # A version that starts on the 16th does not count that day's Abyss reset: it was before the update.
    first_on_the_16th = version("2026-10-20", reference=calendar_from("2026-10-05"))
    assert (first_on_the_16th.starts_on, first_on_the_16th.ends_on) == (date(2026, 11, 16), date(2026, 12, 28))
    assert rows(first_on_the_16th)["endgame"].primogems == 800 + 1000 + 450  # 16 Dec and 1 Dec
    # Nor the Theater's reset of a version's first day, the 1st, but the next one counts.
    first_on_the_1st = version("2026-10-25", reference=calendar_from("2026-10-20"))
    assert (first_on_the_1st.starts_on, first_on_the_1st.ends_on) == (date(2026, 12, 1), date(2027, 1, 12))
    assert rows(first_on_the_1st)["endgame"].primogems == 800 + 1000 + 450  # 16 Dec and 1 Jan
    # A version that ends on the 1st counts that reset: the update's day.
    last_on_the_1st = version("2026-10-20", reference=calendar_from("2026-10-09"))
    assert (last_on_the_1st.starts_on, last_on_the_1st.ends_on) == (date(2026, 11, 20), date(2027, 1, 1))
    assert rows(last_on_the_1st)["endgame"].primogems == 800 + 2 * 1000 + 450  # 16 Dec, then 1 Dec and 1 Jan


# ---------------------------------------------------------------------------------------------- the diary


def test_events_and_quests_come_from_the_diarys_full_months():
    next_ = version("2026-10-24", diary=DIARY)
    # 3,100 + 2,400 over the 31 + 30 days of August and September, times 42, down to tens: 3,786 is 3,780.
    assert rows(next_)["events"] == Row("events", 3780, 0, True, True)
    assert rows(next_)["quests"] == Row("quests", 700, 0, True, True)  # 1,020 over 61 days, times 42: 702
    # The current, unfinished month is not used, whatever it holds.
    unfinished = {**DIARY, "2026-10": {"events": 99999, "quests": 99999}}
    assert version("2026-10-24", diary=unfinished).rows == next_.rows
    # The store gives amounts as floats.
    floats = {month: {name: float(amount) for name, amount in sources.items()} for month, sources in DIARY.items()}
    assert version("2026-10-24", diary=floats).rows == next_.rows


def test_only_the_two_months_before_this_one_are_read():
    older = {"2026-06": {"events": 9999, "quests": 9999}, "2026-07": {"events": 9999, "quests": 9999}, **DIARY}
    assert version("2026-10-24", diary=older).rows == version("2026-10-24", diary=DIARY).rows
    # One full month of the two stands alone, over its own days: 2,400 over 30, times 42.
    one = rows(version("2026-10-24", diary={"2026-09": {"events": 2400, "quests": 400}, "2026-10": {"events": 900}}))
    assert (one["events"].primogems, one["quests"].primogems) == (3360, 560)
    # A full month that gave no events still counts its days: 3,100 over 61 days, times 42, is 2,134.
    quiet = {"2026-08": {"events": 3100}, "2026-09": {"mail": 100}}
    assert rows(version("2026-10-24", diary=quiet))["events"].primogems == 2130
    # The months before a new year are December and November.
    january = {"2026-11": {"events": 3000}, "2026-12": {"events": 3100}}
    assert rows(version("2027-01-10", diary=january))["events"].primogems == 4200  # 6,100 over 61 days is 100 a day


def test_with_no_full_month_the_current_months_days_so_far_stand_in():
    only_this_month = {"2026-10": {"events": 900, "quests": 240}}
    next_ = version("2026-10-24", diary=only_this_month)
    # 900 over the 24 days so far, times 42, is 1,575, down to tens; 240 over 24 days, times 42, is 420.
    assert (rows(next_)["events"].primogems, rows(next_)["quests"].primogems) == (1570, 420)
    assert rows(next_)["events"].estimated is True
    assert rows(version("2026-10-24", diary={"2026-07": {"events": 5000}}))["events"] == Row("events", 0, 0, True, True)


def test_only_the_events_and_quests_sources_are_read_from_the_diary():
    # Whatever source holds the Welkin Moon's 90 a day (the daily activity, the mail), it is never counted twice.
    rich = {
        "2026-08": {**DIARY["2026-08"], "daily_activity": 2790, "mail": 900, "spiral_abyss": 800},
        "2026-09": {**DIARY["2026-09"], "daily_activity": 2700, "other": 100},
    }
    with_diary = version("2026-10-24", diary=rich, welkin=True)
    assert with_diary.rows == version("2026-10-24", diary=DIARY, welkin=True).rows
    assert rows(with_diary)["welkin"].primogems == 3780
    # A source is the events' or the quests' by its name alone: it contains "event", or "quest".
    by_name = {"2026-09": {"events_and_more": 3000, "quests_and_trials": 600, "mail": 800}}
    named = rows(version("2026-10-24", diary=by_name))
    assert (named["events"].primogems, named["quests"].primogems) == (4200, 840)


def test_a_typed_events_count_replaces_the_estimate():
    next_ = version("2026-10-24", diary=DIARY, typed={"7.2": 2330})
    assert rows(next_)["events"] == Row("events", 2330, 0, True, False)
    assert rows(next_)["quests"] == Row("quests", 700, 0, True, True)  # the quests stay the diary's
    assert version("2026-10-24", diary=DIARY, typed={"7.1": 9999}).rows == version("2026-10-24", diary=DIARY).rows
    assert version("2026-10-24", typed={"7.1": 9999}).rows == version("2026-10-24").rows
    assert rows(version("2026-10-24", typed={"7.2": 0}))["events"] == Row("events", 0, 0, True, False)  # 0 is a count
    # With the Welkin Moon and these, the mockup's figures: 12,980 primogems.
    full = version("2026-10-24", diary=DIARY, welkin=True, typed={"7.2": 2330})
    assert full.primogems == 2520 + 2330 + 3050 + 600 + 700 + 3780 == 12980


# ---------------------------------------------------------------------------------------------- the reference


def test_the_reference_is_the_checked_one():
    reference = load_reference()
    assert load_reference() is reference  # read once
    assert reference["calendar"] == {"version": "7.1", "started": "2026-09-23", "cadence_days": 42}
    assert reference["sources"] == {
        "commissions_per_day": 60,
        "abyss_per_reset": 800, "abyss_reset_day": 16,
        "theater_per_reset": 1000, "theater_reset_day": 1,
        "stygian_per_version": 450,
        "maintenance_per_version": 300, "codes_per_version": 300,
        "welkin_per_day": 90,
        "gnostic_hymn": {"primogems": 680, "fates": 4},
    }
    assert reference["checked"] == "2026-10-24"
    assert reference["references"] == [
        "https://timesaver.gg/blog/genshin-7-1-free-primogems",
        "https://www.gamsgo.com/blog/genshin-impact-6-6-pull-count",
        "https://uu-top.com/en/blog/genshin-7-2-pull-count",
        "https://www.u7buy.com/blog/genshin-impact-7-2-primogem-count/",
    ]
