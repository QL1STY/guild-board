"""The Backlog page model: what is left."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Mapping

from guildboard.history import History
from guildboard.metrics import oculi_label
from guildboard.store import Store
from guildboard.views.reference import oculi_totals

SORTS = ("least", "closest", "game")
CLOSEST_SHOWN = 5
ARCHON_SHOWN = 3
_ARCHON_STATUS = {"ongoing": "In progress", "not_open": "Not started"}


def _counters(counters: Mapping[str, float], history: History, today: date) -> list[dict[str, Any]]:
    week_first = today - timedelta(days=6)
    note = "this week" if history.coverage(week_first, today).full else "since tracking began"

    def counter(counter_id: str, label: str, names: list[str]) -> dict[str, Any]:
        change = history.change([f"stats.{name}" for name in names], week_first, today)
        delta = int(change) if change else None
        return {
            "id": counter_id,
            "label": label,
            "value": int(sum(counters.get(name, 0.0) for name in names)),
            "delta": delta,
            "delta_note": note if delta else None,
            "text": None,
        }

    return [
        counter("chests", "Chests", sorted(name for name in counters if name.startswith("chests."))),
        counter("oculi", "Oculi", sorted(name for name in counters if name.startswith("oculi."))),
        counter("achievements", "Achievements", ["achievements"]),
        counter("waypoints", "Waypoints", ["waypoints"]),
    ]


def _region(region: Mapping[str, Any], names: Mapping[int, str]) -> dict[str, Any]:
    areas = sorted(({"name": area["name"], "pct": area["pct"]} for area in region["areas"]), key=lambda a: a["pct"])
    offering = region["offerings"][0] if region["offerings"] else None
    return {
        "id": region["id"],
        "name": region["name"],
        "parent": names.get(region["parent_id"]) if region["parent_id"] else None,
        "pct": region["pct"],
        "icon": f"/api/icon/explore.{region['id']}" if region["icon_url"] else "",
        "note": f"{offering['name']} {offering['level']}" if offering else "",
        "areas": areas,
        "complete": region["pct"] >= 100.0 and all(area["pct"] >= 100.0 for area in areas),
    }


def _closest(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entries = []
    for region in regions:
        open_areas = [area for area in region["areas"] if area["pct"] < 100.0]
        if open_areas:
            for area in open_areas:
                entries.append(
                    {"label": f"{region['name']} · {area['name']}", "remaining": round(100.0 - area["pct"], 1)}
                )
        else:
            entries.append({"label": region["name"], "remaining": round(100.0 - region["pct"], 1)})
    entries = [entry for entry in entries if entry["remaining"] > 0]
    return sorted(entries, key=lambda entry: entry["remaining"])[:CLOSEST_SHOWN]


def _oculi(counters: Mapping[str, float]) -> dict[str, Any]:
    totals = oculi_totals()
    missing, unknown, complete = [], [], 0
    for name in sorted(name for name in counters if name.startswith("oculi.")):
        kind = name.split(".", 1)[1]
        have = int(counters[name])
        total = totals.get(kind)
        if total is None or have > total:
            unknown.append({"type": kind, "label": oculi_label(kind), "have": have})
        elif have == total:
            complete += 1
        else:
            missing.append({"type": kind, "label": oculi_label(kind), "have": have, "total": total})
    return {"missing": missing, "complete_count": complete, "unknown": unknown}


def _archon(notes: Mapping[str, Any]) -> dict[str, Any]:
    chapters = [
        {
            "title": chapter["number"],
            "name": chapter["title"],
            "status": _ARCHON_STATUS.get(chapter["status"], "In progress"),
        }
        for chapter in notes["archon_open"]
    ]
    return {
        "known": True,
        "all_finished": bool(notes["archon_all_finished"]),
        "open": len(chapters),
        "chapters": chapters[:ARCHON_SHOWN],
    }


def build_backlog(store: Store, history: History, today: date, sort: str = "least") -> dict[str, Any]:
    if sort not in SORTS:
        raise ValueError(f"unknown sort: {sort}")
    since = history.tracking_since()
    model: dict[str, Any] = {
        "tracking_since": since.isoformat() if since else None,
        "sort": sort,
        "counters": [],
        "regions": [],
        "complete": [],
        "closest": [],
        "oculi": {"missing": [], "complete_count": 0, "unknown": []},
        "archon": {"known": False, "all_finished": False, "open": 0, "chapters": []},
    }
    overview = store.latest_doc("overview")
    if overview is not None:
        doc = overview[1]
        names = {region["id"]: region["name"] for region in doc["regions"]}
        regions = [_region(region, names) for region in doc["regions"]]
        unfinished = [region for region in regions if not region["complete"]]
        if sort == "least":
            unfinished.sort(key=lambda region: region["pct"])
        elif sort == "closest":
            unfinished.sort(key=lambda region: -region["pct"])
        model["counters"] = _counters(doc["counters"], history, today)
        model["regions"] = unfinished
        # A complete region's card, as an unfinished one's, in the overview's own order: game order.
        model["complete"] = [region for region in regions if region["complete"]]
        model["closest"] = _closest(unfinished)
        model["oculi"] = _oculi(doc["counters"])
    notes = store.latest_doc("notes")
    if notes is not None:
        archon = _archon(notes[1])
        model["archon"] = archon
        finished = archon["all_finished"] or archon["open"] == 0
        model["counters"].append(
            {
                "id": "archon",
                "label": "Archon Quests",
                "value": archon["open"],
                "delta": None,
                "delta_note": None,
                "text": "All finished" if finished else f"{archon['open']} open",
            }
        )
    return model
