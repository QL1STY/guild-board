"""The Endgame readiness page's model (the plan's `Endgame`; design 6.5): teams built from who is owned and how ready each is,
against this month's Spiral Abyss, Imaginarium Theater and Stygian Onslaught."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Sequence

from guildboard.characters import BUILT, ELEMENTS, teams, theater
from guildboard.characters.models import Member, Team
from guildboard.gameday import server_tz
from guildboard.views.characters import day_text

if TYPE_CHECKING:
    from guildboard.characters.service import Char, Characters

PICK_MONTH = "This month's elements weren't in HoYoLAB's calendar. Pick them:"
TOP_ACTIONS = 3


def _members(svc: "Characters", after: bool) -> tuple[list[Member], dict[str, "Char"], dict[str, int]]:
    """Everyone owned as a team builder's Member, with the readiness now or, for the focus, once their plans are done."""
    focus = set(svc.focus())
    pool, chars, now = [], {}, {}
    for key in svc.keys():
        char = svc.char(key)
        if char is None or char.build is None:
            continue
        ready_now = svc.readiness_now(char).total
        ready = svc.readiness_after(char).total if after and key in focus else ready_now
        chars[key], now[key] = char, ready_now
        pool.append(Member(
            key=key, name=char.name, element=char.element, roles=char.card.roles, keeps_alive=char.card.keeps_alive,
            wants=char.card.partners, ready=ready,
        ))
    return pool, chars, now


def _team_view(svc: "Characters", team: Team, chars: dict[str, "Char"], label: str, note: str | None) -> dict[str, Any]:
    return {
        "label": label, "lead_element": team.members[0].element,
        "members": [
            {"key": m.key, "name": m.name, "icon": svc.address(chars[m.key].icon), "role": m.roles[0] if m.roles else "support",
             "ready": m.ready}
            for m in team.members
        ],
        "ready": team.ready, "note": note,
    }


def _weakest(team: Team) -> Member:
    return min(team.members, key=lambda m: m.ready)


def _mode(doc: dict[str, Any] | None, mode: str) -> dict[str, Any] | None:
    return next((m for m in (doc or {}).get("modes", ()) if m.get("mode") == mode), None)


def _end_day(svc: "Characters", text: str | None) -> str:
    if not text:
        return ""
    try:
        when = datetime.fromisoformat(text)
    except ValueError:
        return ""
    when = when if when.tzinfo is not None else when.replace(tzinfo=timezone.utc)
    return day_text((when.astimezone(server_tz(svc.server())) + timedelta(seconds=1)).date())


def _average(values: Sequence[int]) -> int:
    return round(sum(values) / len(values)) if values else 0


def _theater_elements(svc: "Characters", text: str | None) -> tuple[tuple[str, ...], bool, tuple[str, ...]]:
    """The elements shown, whether they are the calendar's, and the calendar's own (empty when it names none).

    The player's pick for the month shows whenever one is kept (picking others previews them, design §6.5), else the calendar's."""
    calendar = theater.elements(text or "")
    picked = svc.store.theater_elements(svc.uid(), svc.theater_month())
    if picked:
        return tuple(picked), False, calendar
    return calendar, bool(calendar), calendar


def build_endgame(svc: "Characters", after: bool) -> dict[str, Any]:
    pool, chars, now = _members(svc, after)
    doc = svc.store.latest_doc("endgame")
    detail = (doc[1].get("detail") or {}) if doc is not None else {}
    calendar = svc.store.latest_doc("calendar")
    text = ((calendar[1].get("detail") or {}).get("theater_text") if calendar is not None else None)
    ids = {int(record["id"]): key for key, char in chars.items() if (record := char.record) is not None}

    # The Abyss: two teams for floor 12, with no one in both.
    abyss_teams = teams.build_teams(pool, 2)
    lost = next(
        (h for h in detail.get("abyss_halves") or () if h.get("stars", 3) < 3), None
    )
    there = {ids.get(int(i)) for i in lost.get("characters") or ()} if lost is not None else set()
    lost_with = [len({m.key for m in team.members} & there) >= 2 for team in abyss_teams]
    abyss = []
    for index, team in enumerate(abyss_teams):
        weakest = _weakest(team)
        note = f"Its weakest member is {weakest.name}, at {weakest.ready}%."
        if lost is not None and lost_with[index]:
            half = "first" if lost.get("half") == 1 else "second"
            note = f"You lost a star in {lost.get('chamber')}, {half} half with this team. " + note
        abyss.append(_team_view(svc, team, chars, ("First half", "Second half")[index], note))

    # Stygian Onslaught: one team for each boss, without the elements it is bad against.
    stygian = []
    unled = []
    for boss in detail.get("stygian_bosses") or ():
        well = [e for e in boss.get("advantage") or () if e in ELEMENTS]
        badly = [e for e in boss.get("disadvantage") or () if e in ELEMENTS]
        fit = teams.build_teams([m for m in pool if m.element not in badly], 1, lead=well)
        view = _team_view(svc, fit[0], chars, boss["name"], None) if fit else None
        stygian.append({"name": boss["name"], "does_well": well, "does_badly": badly, "team": view})
        if fit and well and fit[0].members[0].element not in well:
            unled.append((boss["name"], well))

    # The Imaginarium Theater: only the month's elements, up to three teams.
    elements, from_calendar, calendar_elements = _theater_elements(svc, text)
    rows = teams.cast(pool, elements)
    thin = teams.thinnest(rows)
    theater_teams = teams.build_teams([m for m in pool if m.element in elements], 3) if elements else ()
    cast = [
        {"element": element, "ready": count, "thinnest": element == thin, "members": [
            {"key": m.key, "name": m.name, "icon": svc.address(chars[m.key].icon), "ready": m.ready, "counted": m.ready >= BUILT}
            for m in members
        ]}
        for element, members, count in rows
    ]
    close = [
        {"key": m.key, "name": m.name, "icon": svc.address(chars[m.key].icon), "element": m.element, "ready": m.ready,
         "to_go": BUILT - m.ready}
        for m in teams.close(pool, elements)
    ]
    theater_view = {
        "month": svc.theater_month(), "elements": list(elements), "calendar_elements": list(calendar_elements), "from_calendar": from_calendar, "cast": cast,
        "teams": [
            _team_view(svc, team, chars, f"{team.members[0].name}'s team", None) for team in theater_teams
        ],
        "close": close,
    }

    abyss_ready = _average([team.ready for team in abyss_teams])
    theater_ready = _average([team.ready for team in theater_teams])
    stygian_ready = _average([s["team"]["ready"] for s in stygian if s["team"]])
    abyss_mode, theater_mode = _mode(doc[1] if doc else None, "abyss"), _mode(doc[1] if doc else None, "theater")
    stygian_mode = _mode(doc[1] if doc else None, "stygian")
    difficulty = detail.get("stygian_difficulty")
    ready_in = sum(count for _e, _m, count in rows)
    modes = [
        {
            "key": "abyss", "label": "Spiral Abyss",
            "value": (abyss_mode or {}).get("result_text") or "No record yet",
            "text": (
                f"Your two teams for floor 12 are {abyss_ready}% ready."
                if len(abyss_teams) == 2 else "Fewer than two teams are ready for floor 12 yet."
            ) + (f" Resets {_end_day(svc, (abyss_mode or {}).get('period_end'))}." if (abyss_mode or {}).get("period_end") else ""),
            "ready": abyss_ready,
        },
        {
            "key": "theater", "label": "Imaginarium Theater",
            "value": ", ".join(elements) if elements else "Elements not known",
            "text": (
                f"{ready_in} ready in these elements, {len(theater_teams)} full team{'' if len(theater_teams) == 1 else 's'}."
                if elements else PICK_MONTH
            ) + (f" Ends {_end_day(svc, (theater_mode or {}).get('period_end'))}." if (theater_mode or {}).get("period_end") else ""),
            "ready": theater_ready,
        },
        {
            "key": "stygian", "label": "Stygian Onslaught",
            "value": f"Difficulty {difficulty} of 6" if difficulty else (stygian_mode or {}).get("result_text") or "No record yet",
            "text": (
                f"A fitting team for each of the {len(stygian)} bosses, {stygian_ready}% ready on average."
                if stygian else "No Stygian bosses have been read yet."
            ),
            "ready": stygian_ready,
        },
    ]
    return {
        "after": after, "modes": modes, "abyss": abyss, "stygian": stygian, "theater": theater_view,
        "clear": _clear(svc, pool, chars, abyss_teams, lost, lost_with, rows, thin, unled), "sync": svc.sync_view(),
    }


def _clear(
    svc: "Characters", pool: list[Member], chars: dict[str, "Char"], abyss_teams: Sequence[Team], lost: Any,
    lost_with: Sequence[bool], rows: Sequence[Any], thin: str | None, unled: Sequence[tuple[str, list[str]]],
) -> list[dict[str, Any]]:
    """Up to three actions that would lift the weakest spots, best first."""
    focus = svc.focus()
    actions: list[dict[str, Any]] = []
    if len(abyss_teams) == 2:
        weaker_at = min((0, 1), key=lambda index: abyss_teams[index].ready)
        weaker = abyss_teams[weaker_at]
        gains = {m.key: svc.readiness_after(chars[m.key]).total - svc.readiness_now(chars[m.key]).total for m in weaker.members}
        key = max(gains, key=lambda k: gains[k]) if max(gains.values()) > 0 else _weakest(weaker).key
        char = chars[key]
        now, then = svc.readiness_now(char).total, svc.readiness_after(char).total
        # Said only of the team the star was lost with, as its own note says.
        where = f", the one that lost a star in {lost.get('chamber')}" if lost is not None and lost_with[weaker_at] else ""
        if gains[key] > 0:
            actions.append({
                "key": key, "icon": svc.address(char.icon), "title": f"Finish {char.name}'s plan",
                "text": f"{char.name} is in your weaker Abyss team{where}. {char.card.pronouns[2].capitalize()} plan takes "
                        f"{char.card.pronouns[1]} from {now}% to {then}%.",
                "action": "planner", "target": key,
            })
        else:
            actions.append({
                "key": key, "icon": svc.address(char.icon), "title": f"Build {char.name}",
                "text": f"{char.name} is the weakest in your weaker Abyss team{where}, at {now}%.",
                "action": "planner" if key in focus else "focus", "target": key,
            })
    if thin is not None:
        row = next(r for r in rows if r[0] == thin)
        short = [m for m in row[1] if m.ready < BUILT]
        if short:
            best = short[0]
            char = chars[best.key]
            actions.append({
                "key": best.key, "icon": svc.address(char.icon), "title": f"Build {best.name}",
                "text": f"The Theater's {thin} cast is your thinnest, with {row[2]} ready. {best.name} would make {row[2] + 1}.",
                "action": "planner" if best.key in focus else "focus", "target": best.key,
            })
    for boss, well in unled:
        candidates = sorted((m for m in pool if m.element in well), key=lambda m: -m.ready)
        if candidates:
            best = candidates[0]
            char = chars[best.key]
            actions.append({
                "key": best.key, "icon": svc.address(char.icon), "title": f"Build {best.name} for the {boss}",
                "text": f"{' and '.join(well)} {'does' if len(well) == 1 else 'do'} well against it, and none of your teams "
                        f"leads with {' or '.join(well)} yet.",
                "action": "planner" if best.key in focus else "focus", "target": best.key,
            })
            break
    return actions[:TOP_ACTIONS]
