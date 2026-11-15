"""The Plan page's model (the Plan design, section 4): for each planned character, the talent book and the weapon material that
are open each day, the weekly boss material, and who could be added. It is made only from wiki entries the app already keeps: a
character or weapon whose entry, or whose material's entry, is not read yet has `None` where the days would be, never a guess."""
from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, Any, Mapping, Sequence

from guildboard.gameday import game_day_start
from guildboard.store import iso

if TYPE_CHECKING:
    from guildboard.characters.service import Char, Characters

BOOK = "Teachings of "
SUNDAY = 6
_CONNECTORS = {"of", "from"}
_ARTICLES = {"of", "from", "the", "a", "an"}


def domain_days(days: Sequence[int]) -> tuple[int, ...]:
    """The days a domain is open, from the weekdays its entry names (Monday is 0). The wiki's text names more than the domain's
    own days, so they are the pair the first weekday below Thursday names (Monday: Monday and Thursday), and every domain also
    opens on Sunday. `()` when it names none."""
    first = min((day for day in days if 0 <= day < 3), default=None)
    return () if first is None else (first, first + 3, SUNDAY)


def weapon_series(names: Sequence[str]) -> str:
    """The series of a weapon material from the names of its tiers: the longest run of words they all share ("Tile of Decarabian's
    Tower" and "Debris of Decarabian's City" share "of Decarabian's"), without the words that only join it ("of", "from", "the",
    "a") and without a possessive's 's. Of "Branch of a Distant Sea", which every tier of that series shares whole, it keeps what
    follows the "of". One name alone, or tiers that share nothing, give the first name as it is: no rule of the game's naming holds
    for every series, so a name is never cut by guess."""
    words = [name.split() for name in names if name]
    if not words:
        return ""
    first = words[0]
    if len(words) == 1:
        return " ".join(first)
    run: list[str] = []
    for size in range(len(first), 0, -1):
        for start in range(len(first) - size + 1):
            window = first[start:start + size]
            if all(any(other[at:at + size] == window for at in range(len(other) - size + 1)) for other in words[1:]):
                run = window
                break
        if run:
            break
    after = [i for i, word in enumerate(run) if word.lower() in _CONNECTORS]
    if after and after[-1] + 1 < len(run):
        run = run[after[-1] + 1:]
    while run and run[0].lower() in _ARTICLES:
        run = run[1:]
    while run and run[-1].lower() in _ARTICLES:
        run = run[:-1]
    if run and run[-1].endswith("'s"):
        run[-1] = run[-1][:-2]
    return " ".join(run) or " ".join(first)


def _next_open(days: Sequence[int] | None, today: int) -> int | None:
    """The weekday after today that the days include, counting on into next week; None when they are not known."""
    if not days:
        return None
    return next((day for day in ((today + step) % 7 for step in range(1, 8)) if day in days), None)


def _material(svc: "Characters", key: str, hints: Mapping[str, tuple[str, str | None]], kind: str) -> dict[str, Any] | None:
    """One material of a kind ("books" or "forgery") as the page shows it, None while its entry is not read or says no days."""
    name, icon, source = svc.material_info(key, hints)
    days = domain_days(source.days) if source.kind == kind else ()
    if not days:
        return None
    series = name.removeprefix(BOOK) if kind == "books" else name
    return {"series": series, "icon": svc.address(icon), "days": list(days)}


def book_of(svc: "Characters", char: "Char") -> dict[str, Any] | None:
    """Her talent book: the "Teachings of X" her Talents' level-up materials name, with the days its entry gives."""
    page = char.page
    if page is None:
        return None
    hints = {key: (name, icon) for key, (name, icon, _entry) in page.material_names.items()}
    for level in sorted(page.talent_costs):
        for key, _amount in page.talent_costs[level]:
            if hints.get(key, ("", None))[0].startswith(BOOK):
                return _material(svc, key, hints, "books")
    return None


def weekly_of(svc: "Characters", char: "Char") -> tuple[str, str | None] | None:
    """Her weekly boss material: the talent material that is neither a book nor a common drop nor Crown of Insight, which her
    material's entry says by its source (a weekly boss's challenge reward)."""
    page = char.page
    if page is None:
        return None
    hints = {key: (name, icon) for key, (name, icon, _entry) in page.material_names.items()}
    for level in sorted(page.talent_costs, reverse=True):
        for key, _amount in page.talent_costs[level]:
            name, icon, source = svc.material_info(key, hints)
            if source.kind == "weekly":
                return name, svc.address(icon)
    return None


def weapon_material_of(svc: "Characters", char: "Char") -> tuple[dict[str, Any], str] | None:
    """Her weapon's domain material and the key its domain is grouped by (the name of its lowest tier). A weapon's Ascend costs
    list the domain material first in each phase (after Mora), so its tiers' names are all there, whether or not each material's
    own entry is read yet: the series is named from them, and so is the same for every weapon of the domain. Its days come from
    any tier whose entry is read and says a Domain of Forgery; None while none does."""
    weapon = char.build.weapon if char.build else None
    page = svc.weapon_page(weapon.key) if weapon else None
    row = svc.weapon_row(weapon.key) if weapon else None
    if page is None or row is None:
        return None
    from guildboard.characters.wiki import materials_of

    hints = {key: (name, icon) for key, (name, icon, _entry) in materials_of(row).items()}
    tiers: list[str] = []   # the keys of the first material of each phase, lowest tier first
    for phase in sorted(page.ascension_costs):
        first = next((key for key, _amount in page.ascension_costs[phase] if key != "mora"), None)
        if first is not None and first not in tiers:
            tiers.append(first)
    read = None   # the lowest tier whose entry is read and gives a domain's days
    for key in tiers:
        read = _material(svc, key, hints, "forgery")
        if read is not None:
            break
    if read is None:
        return None
    names = [hints[key][0] for key in tiers if key in hints]
    if not names:   # the weapon's page names none of its tiers: no series to name, so nothing to say
        return None
    series = weapon_series(names)
    icon = svc.address(hints[tiers[0]][1]) if tiers[0] in hints and hints[tiers[0]][1] else read["icon"]
    return {"series": series, "icon": icon, "days": read["days"]}, names[0]


def _group(
    rows: Sequence[Mapping[str, Any]], field: str, today: int, domains: Mapping[str, str] | None = None
) -> list[dict[str, Any]]:
    """The rows whose `field` is open today, grouped (a book by its series, a weapon material by its domain's key in `domains`),
    each with who needs it."""
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        found = row[field]
        if found is None or today not in found["days"]:
            continue
        entry = grouped.setdefault((domains or {}).get(row["key"], found["series"]), {**found, "who": []})
        entry["who"].append(row["key"])
        if field == "material":
            entry.setdefault("weapons", [])
            if row["weapon"]["name"] and row["weapon"]["name"] not in entry["weapons"]:
                entry["weapons"].append(row["weapon"]["name"])
    return list(grouped.values())


def build_plan(svc: "Characters") -> dict[str, Any]:
    today = svc.today()
    weekday = today.weekday()
    chars = [char for char in (svc.char(key) for key in svc.focus()) if char is not None]
    rows: list[dict[str, Any]] = []
    weekly: dict[str, dict[str, Any]] = {}
    domains: dict[str, str] = {}   # by character: the key of her weapon material's domain
    for char in chars:
        made = weapon_material_of(svc, char)
        weapon = char.build.weapon if char.build else None
        rows.append({
            "key": char.key, "name": char.name, "icon": svc.address(char.icon),
            "weapon": {"name": weapon.name if weapon else None, "icon": svc.address(weapon.icon) if weapon else None},
            "book": book_of(svc, char), "material": made[0] if made else None,
        })
        if made:
            domains[char.key] = made[1]
        boss = weekly_of(svc, char)
        if boss is not None:
            weekly.setdefault(boss[0], {"material": boss[0], "icon": boss[1], "who": []})["who"].append(char.key)
    idle = [
        {
            "key": row["key"], "book_next": _next_open(row["book"] and row["book"]["days"], weekday),
            "weapon_next": _next_open(row["material"] and row["material"]["days"], weekday),
        }
        for row in rows
        if not any(row[field] is not None and weekday in row[field]["days"] for field in ("book", "material"))
    ]
    planned = {char.key for char in chars}
    addable = sorted(
        (
            {"key": char.key, "name": char.name, "icon": svc.address(char.icon)}
            for char in (svc.char(key) for key in svc.keys() if key not in planned)
            if char is not None and char.owned
        ),
        key=lambda entry: entry["name"].lower(),
    )
    return {
        "weekday": weekday, "date": today.isoformat(), "turns_at": iso(game_day_start(today + timedelta(days=1), svc.server())),
        "count": len(rows),
        "books": _group(rows, "book", weekday), "weapons": _group(rows, "material", weekday, domains), "idle": idle, "rows": rows,
        "weekly": list(weekly.values()), "discounts_left": svc.boss_discounts(), "addable": addable,
    }
