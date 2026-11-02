"""The player's own data as rows that go to the account and come back (the online design, section 8; the online plan, Task C3).
A row is a kind (a table of the player's own) and a key (the same on every PC), and its data is its columns as JSON, but for
the columns that stay on this PC. A row that comes from the account is kept row by row; one that does not fit is left out,
and the log says that it did, never what it held. The SQL is the store's."""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, AsyncIterator, Callable, Iterable, Mapping
from urllib.parse import quote

from guildboard.board.layouts import MAX_DATA_CHARS, parse_widgets, with_timers
from guildboard.cloud.client import CloudClient, CloudRefused, CloudTooLarge
from guildboard.cloud.models import DAY, MONTH
from guildboard.store import OutboxRow, Store, iso, parse_iso
from guildboard.timers.rules import parse_rule

log = logging.getLogger(__name__)

# What a PC numbers for itself, or sent a reminder for: the ids of the rows and the reminders. They name nothing on another PC.
LOCAL_COLUMNS = ("id", "notified_ready_at", "notified")
# What a timer's row carries besides its columns: its Cleared, by the time each was. Its ready time is worked out from them and
# its visits are counted from them, so a timer without them would read as never cleared on another PC. They are no kind of their
# own: every Cleared and every undo of one writes the timer's row too, so the newest edit wins for them as for the row.
CLEARED = "cleared"
CLEARED_KEPT = 50  # the newest of a timer's Cleared that go with it: its ready time needs the latest, and its visits stop at 50
# The settings that are not about this PC (the online design, section 8): the display the overlay covers, the hotkey, the folders
# and the switches of this PC's own are left out. A setting is a row of the kind `settings`, its name the key, {"value": ...}.
SYNCED_SETTINGS = (
    "commission_region", "fishing_rule", "notifications", "characters_notice_weekly", "characters_notice_domain",
    "characters_notice_ready", "spending_currency", "spending_prices",
)
SETTINGS = "settings"
FIRST = "sync_first"  # how the first sync of this PC with this account stands: "asking" or "done"; nothing before it is settled
PUSH_BATCH = 200  # rows to a call up
PUSH_BATCHES = 50  # calls to a push at most: a row edited all the time cannot hold a push for ever
PULL_PAGE = 500  # rows to a read down
PULL_ROOM = 1000  # a read this size, for when a page of rows that arrived together fills the one above (0003_sync.sql says why)
OVERLAP = timedelta(minutes=1)  # a read begins this long before the newest arrival it has seen
KEY_FITS = 200  # the longest key the account takes: a longer one is no key but something pasted, and never leaves this PC
MANY_DELETES = 20  # a pull that deletes more of this PC's rows makes a copy of the database first (the audit's CLD-3)


@dataclass(frozen=True)
class Kind:
    table: str
    key: tuple[str, ...]  # the columns that name a row across PCs: the triggers of schema 12 name their lines by them too
    event: str            # the bus event that tells the pages of a change


# The tables of the player's own data, in the order of the plan. A fetched or derived table is no kind: each PC fetches those.
KINDS: tuple[Kind, ...] = (
    Kind("achievement_progress", ("stage_id",), "achievements_changed"),
    Kind("achievement_parts", ("stage_id", "part"), "achievements_changed"),
    Kind("achievement_counters", ("group_id",), "achievements_changed"),
    Kind("commission_log", ("stage_id", "day"), "achievements_changed"),
    Kind("timers", ("sync_key",), "timers_changed"),
    Kind("quick_timers", ("sync_key",), "timers_changed"),
    Kind("layouts", ("place",), "layout_changed"),
    Kind("widget_data", ("widget_id",), "layout_changed"),
    Kind("pulls_accounts", ("uid",), "pulls_changed"),
    Kind("wishlist", ("sync_key",), "pulls_changed"),
    Kind("gift_codes", ("uid", "code"), "codes_changed"),
    # Play time is read by Stats and the Board. No event is its own: every event but the start of a sync has the pages read
    # again, and this is the one that carries no more than that.
    Kind("sessions", ("sync_key",), "state_changed"),
    Kind("char_focus", ("uid", "position"), "characters_changed"),
    Kind("char_plans", ("uid", "character"), "characters_changed"),
    Kind("char_card_edits", ("uid", "character"), "characters_changed"),
    Kind("char_ticks", ("uid", "day", "task"), "characters_changed"),
    Kind("char_held", ("uid", "material"), "characters_changed"),
    Kind("char_theater", ("uid", "month"), "characters_changed"),
)
BY_TABLE = {kind.table: kind for kind in KINDS}
EVENT_OF = {kind.table: kind.event for kind in KINDS}
# The kinds the undo history records rows of. A row of one that came from another PC ends the history.
UNDO_REACHES = {"achievement_progress", "achievement_parts", "achievement_counters", "commission_log", "timers"}
SETTINGS_EVENT = "settings_changed"


USAGE_NUMBERS = ("rows_held", "rows_limit", "bytes_held", "bytes_limit")
USAGE_FLAGS = ("has_place", "seats_full")


def usage_of(answer: Any) -> dict[str, Any] | None:
    """The room an account uses, from sync_usage's answer (0005): PostgREST gives a function that returns a table as a list of
    its rows, and this one has one. Whole numbers of nothing below zero and two flags, or nothing: an answer of another shape
    is a server this version does not know, and the page shows no room."""
    row = answer[0] if isinstance(answer, list) and len(answer) == 1 else None
    if not isinstance(row, Mapping):
        return None
    for name in USAGE_NUMBERS:
        number = row.get(name)
        if isinstance(number, bool) or not isinstance(number, int) or number < 0:
            return None
    if not all(isinstance(row.get(name), bool) for name in USAGE_FLAGS):
        return None
    return {name: row[name] for name in (*USAGE_NUMBERS, *USAGE_FLAGS)}


def _refused_a_row(refused: CloudRefused) -> bool:
    """Whether the account refused what a row holds, and not the call: 0003's judge of the rows says bad_rows, and a row the call
    could not even be read with is a data error of the database, or JSON that PostgREST could not take."""
    return refused.code == "bad_rows" or refused.state.startswith("22") or refused.state == "PGRST102"


def forget_the_account(store: Store) -> None:
    """After a restore the data here is not what the account holds, and nothing says so: no line, an old cursor, and rows sent since
    that this device would never read. It is a first sync again, which asks when both hold data. The device takes a new name: the
    rows it sent are to be read too, and the copy may be running on another PC."""
    for name in ("sync_cursor", "sync_last_at", FIRST, "sync_device"):
        store.drop_meta(name)
    store.sync_drop_lines()


def events_of(kinds: Iterable[str]) -> set[str]:
    """The events that tell the pages of changes to these kinds (a setting is a kind here, whose event is its own)."""
    return {SETTINGS_EVENT if kind == SETTINGS else EVENT_OF[kind] for kind in kinds if kind == SETTINGS or kind in EVENT_OF}


def _key_values(kind: Kind, row_key: Any) -> list[str | int] | None:
    """The values of a key in a row's `row_key`, a JSON list with a number or a text for each key column; None for anything
    else. A null is not a value of a key: SQLite would make up a number for it."""
    if not isinstance(row_key, str):
        return None
    try:
        parts = json.loads(row_key)
    except (ValueError, RecursionError):
        return None
    if not isinstance(parts, list) or len(parts) != len(kind.key):
        return None
    if any(isinstance(part, bool) or not isinstance(part, (str, int)) for part in parts):
        return None
    return parts


def _canonical(parts: list[str | int]) -> str:
    """A key as SQLite's json_array writes it, which is what the lines of the outbox are named by."""
    return json.dumps(parts, separators=(",", ":"), ensure_ascii=False)


def read_row(store: Store, kind: str, row_key: str) -> dict[str, Any] | None:
    """A row as JSON: its columns but those that stay on this PC. None for a kind this PC does not have, a key that is none,
    and a row that is not there."""
    found = BY_TABLE.get(kind) if isinstance(kind, str) else None
    parts = _key_values(found, row_key) if found is not None else None
    if found is None or parts is None:
        return None
    try:
        row = store.sync_row(found.table, found.key, parts)
    except OverflowError:  # a number no SQLite integer holds
        return None
    if row is None:
        return None
    data = {column: value for column, value in row.items() if column not in LOCAL_COLUMNS}
    if found.table == "timers":
        data[CLEARED] = _cleared_of(store, row["id"])
    if found.table == "layouts":
        data["widgets"] = _timers_by_key(store, data["widgets"])
    return data


def _timers_by_key(store: Store, widgets: str) -> str:
    """A layout as it goes up: the timers it names by this PC's numbers are named by their keys, and a number that is no timer
    any more by nothing. Text that is no list goes as it is: the row is the player's, and only its timers are this PC's."""
    try:
        parsed = json.loads(widgets)
    except ValueError:
        return widgets
    if not isinstance(parsed, list):
        return widgets
    keys = store.timer_keys()
    return json.dumps(with_timers(parsed, lambda timer: keys.get(timer) if isinstance(timer, int) else timer), ensure_ascii=False)


def _cleared_of(store: Store, timer_id: int) -> list[dict[str, str]]:
    """A timer's Cleared as its row carries them."""
    return [
        {"at": iso(event.at), "recorded_at": iso(event.recorded_at), "source": event.source}
        for event in store.timer_events(timer_id)[-CLEARED_KEPT:]
    ]


def _when(value: Any) -> datetime:
    """The time of an edit as the account gave it. Without a zone it is UTC, the account's own."""
    if not isinstance(value, str):
        raise ValueError("A time is text.")
    moment = parse_iso(value)
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)


def _cleared_sent(data: Mapping[str, Any]) -> list[dict[str, str]] | None:
    """The Cleared a timer's row came with, as `_cleared_of` gives them; None when it says nothing of them. A row whose Cleared
    do not fit raises ValueError, before anything of it is written."""
    sent = data.get(CLEARED)
    if sent is None:
        return None
    if not isinstance(sent, list):
        raise ValueError("A timer's Cleared are a list.")
    cleared = []
    for event in sent:
        if not isinstance(event, Mapping) or not isinstance(event.get("source"), str):
            raise ValueError("A Cleared has its times and where it came from.")
        cleared.append({"at": iso(_when(event.get("at"))), "recorded_at": iso(_when(event.get("recorded_at"))), "source": event["source"]})
    return cleared


def _scalars(data: Mapping[str, Any], columns: Iterable[str]) -> dict[str, Any]:
    """The values of the columns this PC has, each a number, a text or nothing: a list or an object in a column is a row that
    does not fit. A column this PC lacks is left out, whatever it holds."""
    values: dict[str, Any] = {}
    for column in columns:
        if column in data:
            value = data[column]
            if value is not None and not isinstance(value, (str, int, float)):
                raise ValueError("A column holds a number or a text.")
            values[column] = value
    return values


def _no_constant(name: str) -> None:
    raise ValueError("NaN and the infinities are no JSON a page can be sent.")


def _json(value: str, kind: type | tuple[type, ...]) -> Any:
    """What a column of JSON text holds, read as its reader reads it; ValueError for text that is no JSON, or no value of
    `kind`."""
    try:
        parsed = json.loads(value, parse_constant=_no_constant)
    except RecursionError:
        raise ValueError("The JSON is nested too deep.") from None
    if not isinstance(parsed, kind):
        raise ValueError("The JSON is not the kind of value its reader takes.")
    try:  # an escaped lone surrogate reads as a character that no page can send back as UTF-8 (a UnicodeEncodeError, a ValueError)
        json.dumps(parsed, ensure_ascii=False).encode("utf-8")
    except RecursionError:
        raise ValueError("The JSON is nested too deep.") from None
    return parsed


def _time(value: str) -> str:
    """A time as the store writes it, from one that says its zone: the store's times sort as text only when all are UTC to the
    second, and a time with no zone cannot be set beside the others."""
    moment = parse_iso(value)
    if moment.tzinfo is None:
        raise ValueError("A time says its zone.")
    return iso(moment)


def _day(value: str) -> str:
    if DAY.fullmatch(value) is None:
        raise ValueError("A day is written YYYY-MM-DD.")
    date.fromisoformat(value)  # and 2026-02-30 is no day
    return value


def _month(value: str) -> str:
    if MONTH.fullmatch(value) is None:
        raise ValueError("A month is written YYYY-MM.")
    return value


def _object(value: str) -> str:
    _json(value, dict)
    return value


def _texts(value: str) -> str:
    if not all(isinstance(item, str) for item in _json(value, list)):
        raise ValueError("A list of names holds texts.")
    return value


def _rule(value: str) -> str:
    """A timer's rule: none for a pre-set, whose rule is the pre-set's, or one that this PC's timers can read."""
    if value:
        parse_rule(_json(value, dict))
    return value


def _widgets(value: str) -> str:
    """A layout, as a page could have saved it. Its timers are named by their keys here, which are longer than the numbers the
    page saved them by, so each is checked as a number: a widget that was within its size there is within it here."""
    parse_widgets(with_timers(_json(value, list), lambda timer: 0))
    return value


def _widget_data(value: str) -> str:
    _json(value, object)  # any JSON at all, as Layouts.data reads it
    if len(value) > MAX_DATA_CHARS:
        raise ValueError("A widget keeps at most so many characters.")
    return value


def _points(value: str) -> str:
    """The Fate Points of an account: each that has a time has one the store can read back (`_points_from_json`)."""
    for entry in _json(value, dict).values():
        if isinstance(entry, dict) and isinstance(entry.get("at"), str):
            _time(entry["at"])
    return value


# How the columns that this PC's readers parse are written (the audit's CLD-1): a row with a value of another form would make
# that reader fail, and the page or the loop that calls it, until a restore. A time is kept as the store writes it; the others
# are kept as they came. A column that is not named takes any value of its type, a key column as much as another.
FORMATS: dict[str, dict[str, Callable[[str], str]]] = {
    "achievement_progress": {"done_at": _time, "updated_at": _time},
    "achievement_parts": {"done_at": _time},
    "achievement_counters": {"updated_at": _time},
    "commission_log": {"day": _day, "at": _time},
    "timers": {"rule": _rule, "ready_override": _time, "created_at": _time, "updated_at": _time},
    "quick_timers": {"started_at": _time, "ready_at": _time},
    "layouts": {"widgets": _widgets, "updated_at": _time},
    "widget_data": {"data": _widget_data, "updated_at": _time},
    "pulls_accounts": {"balance_set_at": _time, "corrections": _object, "points": _points, "events_typed": _object},
    "wishlist": {"about": _day, "created_at": _time},
    "gift_codes": {"at": _time},
    "sessions": {"started_at": _time, "ended_at": _time},
    "char_plans": {"plan": _object, "updated_at": _time},
    "char_card_edits": {"edits": _object, "updated_at": _time},
    "char_ticks": {"day": _day, "done_at": _time},
    "char_held": {"set_at": _time},
    "char_theater": {"month": _month, "elements": _texts, "set_at": _time},
}


def _fitted(table: str, values: Mapping[str, Any], types: Mapping[str, str]) -> dict[str, Any]:
    """A row's values as this PC's readers read them: a column made for numbers holds a whole number and one made for text a
    text, or nothing, where the table lets it be empty; and a column of FORMATS holds a value of its form. ValueError for a
    value that does not fit, and the row is left out."""
    formats = FORMATS.get(table, {})
    fitted: dict[str, Any] = {}
    for column, value in values.items():
        if value is not None:
            if isinstance(value, bool) or not isinstance(value, int if types[column] == "INTEGER" else str):
                raise ValueError("A column holds a value of the type it was made for.")
            if column in formats:
                value = formats[column](value)
        fitted[column] = value
    return fitted


def _on_the_server(stamp: str, ahead: timedelta) -> datetime:
    """A line's stamp, which is this PC's clock, as the server's clock had it then: the account's rows say when they were
    edited by that clock, so the two are set side by side by one."""
    return _when(stamp) + ahead


def _apply(store: Store, row: Mapping[str, Any], kind: Kind, parts: list[str | int], ahead: timedelta) -> bool:
    """Keeps one row of a known kind. Whether it changed the store. A row that does not fit raises ValueError, or SQLite's
    error, and nothing of it stays."""
    edited = _when(row.get("edited_at"))
    pending = store.sync_pending(kind.table, _canonical(parts))
    if pending is not None and _on_the_server(pending.edited_at, ahead) >= edited:
        return False  # this PC changed it later, and its line goes up to say so
    if row.get("deleted") is True:
        return store.sync_drop(kind.table, kind.key, parts)
    data = row.get("data")
    if not isinstance(data, Mapping):
        raise ValueError("A row has its data as an object.")
    types = store.sync_types(kind.table)
    values = _scalars(data, [column for column in types if column not in LOCAL_COLUMNS])
    values.update(zip(kind.key, parts))  # the key of the row is the key it was sent under
    sent = values.pop("revision", None) if kind.table == "layouts" else None  # whatever the other PC counted (below)
    values = _fitted(kind.table, values, types)
    cleared = _cleared_sent(data) if kind.table == "timers" else None
    current = store.sync_row(kind.table, kind.key, parts)
    if kind.table == "layouts":
        # A page that holds a layout is refused when it saves over a newer one, by its number; this PC counted its own, so a
        # layout from another is newer than any this PC had, whatever the other PC counted.
        if current is not None and all(current.get(column) == value for column, value in values.items()):
            return False
        before = current["revision"] if current is not None else 0
        values["revision"] = max(before, sent if isinstance(sent, int) and not isinstance(sent, bool) else 0) + 1
    elif (
        current is not None and all(current.get(column) == value for column, value in values.items())
        and (cleared is None or cleared == _cleared_of(store, current["id"]))
    ):
        return False
    store.sync_put(kind.table, kind.key, values)
    if cleared is not None:
        store.sync_put_cleared(store.sync_row(kind.table, kind.key, parts)["id"], cleared)
    return True


def apply_rows(store: Store, rows: Iterable[Mapping[str, Any]], ahead: timedelta = timedelta(0)) -> set[str]:
    """Keeps rows that came from the account, each alone, and gives the kinds that changed. They are written with the
    triggers off, so that none is sent back. A kind this PC does not know is passed over (a newer phone has more). A row that
    does not fit its table is left out and logged without its content; the others go on. `ahead` is how far the server's
    clock is ahead of this PC's, by which this PC's own edits are set beside the account's."""
    changed: set[str] = set()
    with store.applying_sync():
        for row in rows:
            name = row.get("kind") if isinstance(row, Mapping) else None
            kind = BY_TABLE.get(name) if isinstance(name, str) else None
            if kind is None:
                if not isinstance(row, Mapping) or not isinstance(name, str):
                    log.warning("A synced row was not one this PC can read, and was left out.")
                continue
            try:
                parts = _key_values(kind, row.get("row_key"))
                if parts is None:
                    raise ValueError("A key is a JSON list of numbers and texts.")
                if _apply(store, row, kind, parts, ahead):  # a statement that fails undoes itself alone: the batch goes on
                    changed.add(kind.table)
            except (sqlite3.Error, ValueError, TypeError, OverflowError, RecursionError) as error:  # JSON nested too deep
                log.warning("A synced row of %s did not fit, and was left out (%s).", kind.table, type(error).__name__)
        if changed & UNDO_REACHES:
            store.clear_changes()  # as an import does: an undo must not reach back past rows it did not record (achievements/progress.py)
    return changed


@dataclass(frozen=True)
class SyncSeam:
    """What sync has of this PC, which the core hands in: the store with the player's own data, whether the player has the
    switch on, the value of a setting that syncs, how to keep one that another PC changed (with no line for it), how to tell
    the pages, and the game account this folder belongs to, which a logout of HoYoLAB does not change. Nothing else of the PC
    reaches the account but through this and `read_row`."""

    store: Store
    on: Callable[[], bool] = lambda: True
    setting: Callable[[str], Any] = lambda name: None
    apply_setting: Callable[[str, Any], bool] = lambda name, value: False
    changed: Callable[[set[str]], None] = lambda events: None
    uid: Callable[[], int | None] = lambda: None
    keep_settings: Callable[[], None] = lambda: None  # a backup of the settings too, before the account's replace them
    # Whether a setting that syncs differs from its default here: the player's data as much as a row is, which the first sync
    # with an account that holds some asks about (the player's decision of 2026-11-01).
    settings_changed: Callable[[], bool] = lambda: False


class Sync:
    """Moves the player's own rows between this PC and the account: the outbox up, in calls of `PUSH_BATCH`, and the account's
    rows down since the cursor. A failure of the server leaves everything where it was: a line goes from the outbox once its
    row was kept, and the cursor moves once the rows it passed were kept."""

    def __init__(self, seam: SyncSeam, client: CloudClient, now: Callable[[], datetime]) -> None:
        self._seam = seam
        self._client = client
        self._now = now

    # ------------------------------------------------------------------ what this PC keeps of the sync
    @property
    def _store(self) -> Store:
        return self._seam.store

    def device_id(self) -> str:
        """This PC's name to the account. The rows it sent are not read back by it."""
        device = self._store.meta("sync_device")
        if device is None:
            device = uuid.uuid4().hex
            self._store.set_meta("sync_device", device)
        return device

    def last_at(self) -> str | None:
        return self._store.meta("sync_last_at")

    def outbox_state(self) -> tuple[int, int | None]:
        return self._store.sync_outbox_state()

    def _ahead(self) -> timedelta:
        """How far the server's clock is ahead of this PC's, as its answers said (the audit's CLD-2): the outbox's stamps are
        this PC's clock, and every PC's edits are set side by side by the server's."""
        return timedelta(seconds=self._client.server_ahead())

    def _edited_at(self, line: OutboxRow) -> str:
        """A line's stamp as it goes up: by the server's clock, as the stamps of the other PCs' rows are; as SQLite wrote it
        when the clocks agree."""
        ahead = self._ahead()
        if not ahead:
            return line.edited_at
        moment = _on_the_server(line.edited_at, ahead).astimezone(timezone.utc)
        return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"

    def use_account(self, user_id: str) -> None:
        """The cursor and the time of the last sync are of one account. Another one (the player signed in as someone else)
        starts from nothing: its rows may be older than the cursor of the one before."""
        if self._store.meta("sync_account") != user_id:
            for name in ("sync_cursor", "sync_last_at", FIRST):
                self._store.drop_meta(name)
            self._store.set_meta("sync_account", user_id)

    # ------------------------------------------------------------------ up
    def _line_row(self, line: OutboxRow, device: str) -> dict[str, Any] | None:
        """A line as the row the account takes; None for a line with nothing to send, which is dropped."""
        sent = {
            "kind": line.kind, "row_key": line.row_key, "deleted": line.deleted, "edited_at": self._edited_at(line),
            "device_id": device,
        }
        if line.kind == SETTINGS:
            if line.row_key not in SYNCED_SETTINGS or line.deleted:
                return None
            return {**sent, "data": {"value": self._seam.setting(line.row_key)}}
        if len(line.row_key) > KEY_FITS:
            log.warning("A row of %s has a key too long for the account, so it stays on this PC.", line.kind)
            return None
        if line.deleted:
            return {**sent, "data": {}} if line.kind in BY_TABLE else None
        try:
            data = read_row(self._store, line.kind, line.row_key)
        except ValueError:  # a time that cannot be read: this row alone stays, and the others behind it go on
            log.warning("A row of %s could not be read, so it stays on this PC.", line.kind)
            return None
        return {**sent, "data": data} if data is not None else None

    async def _send(self, lines: list[OutboxRow], device: str) -> int:
        """One call with the rows of these lines; how many went. A line goes once its call was answered. One row the account
        cannot take refuses the whole call, and would hold back every row behind it for good, so a call refused for what a row
        holds goes again in two halves until that row stands alone. It stays on this PC, its line goes, and the log names its
        kind and nothing it holds; the next change of it makes a new line."""
        rows = [row for line in lines if (row := self._line_row(line, device)) is not None]
        if rows:
            try:
                await self._client.rpc("sync_push", {"p_rows": rows})
            except CloudRefused as refused:
                if not _refused_a_row(refused):
                    raise
                if len(lines) > 1:
                    middle = len(lines) // 2
                    return await self._send(lines[:middle], device) + await self._send(lines[middle:], device)
                log.warning("The account cannot keep a row of %s, so it stays on this PC.", lines[0].kind)
                rows = []
        for line in lines:
            self._store.sync_sent(line)
        return len(rows)

    async def usage(self) -> dict[str, Any] | None:
        """How much room this account uses and may use, as the server counts it; nothing where it gave no such answer."""
        return usage_of(await self._client.rpc("sync_usage"))

    async def push(self) -> int:
        """Sends the outbox, the oldest first. How many rows went. A line whose row was edited during its call stays, with a
        higher number, for the next one."""
        device = self.device_id()
        sent = 0
        for _ in range(PUSH_BATCHES):
            lines = self._store.sync_outbox(PUSH_BATCH)
            if not lines:
                break
            sent += await self._send(lines, device)
            if len(lines) < PUSH_BATCH:
                break
        if sent:
            self._store.set_meta("sync_last_at", iso(self._now()))
        return sent

    # ------------------------------------------------------------------ down
    def _query(self, device: str | None, since: str | None, limit: int, skip: int = 0) -> str:
        parts = ["select=kind,row_key,data,deleted,edited_at,received_at,device_id"]
        if device is not None:
            parts.append(f"device_id=neq.{device}")
        parts += ["order=received_at.asc,kind.asc,row_key.asc", f"limit={limit}"]
        if skip:
            parts.append(f"offset={skip}")
        if since is not None:
            parts.append("received_at=gte." + quote(since, safe=""))
        return "&".join(parts)

    async def _pages(self, device: str | None, since: str | None) -> AsyncIterator[list[Any]]:
        """The account's rows from `since`, a page at a time, as many as there are. A page that is full of rows that arrived
        together cannot move the read on: it is read again with room (0003_sync.sql says why one call holds fewer rows than that).
        A page that is larger than an answer may be (a row may hold 256 KB) is read again in halves, down to one row, which
        always fits, and the smaller pages stay for the rest of the read; with them, the rows that arrived together that a page
        could not hold are read on from after those already read."""
        limit, skip, shrunk = PULL_PAGE, 0, False
        while True:
            try:
                rows = await self._client.select("sync_rows", self._query(device, since, limit, skip))
            except CloudTooLarge:
                if limit == 1:
                    raise
                limit, shrunk = limit // 2, True
                continue
            yield rows
            if len(rows) < limit:
                return
            last = rows[-1].get("received_at") if isinstance(rows[-1], Mapping) else None
            if not isinstance(last, str):
                return
            if last == since:
                if shrunk:
                    skip += len(rows)
                elif limit >= PULL_ROOM:
                    log.warning("A read of the account's rows could not move on.")
                    return
                else:
                    limit = PULL_ROOM
            else:
                since, skip = last, 0
                limit = limit if shrunk else PULL_PAGE

    def _start(self) -> str | None:
        """Where a read begins: a minute before the newest arrival kept. A row that was written while another was being kept can
        arrive with a time before it, and the minute is for that; the rows read twice change nothing."""
        cursor = self._store.meta("sync_cursor")
        if cursor is None:
            return None
        try:
            return (_when(cursor) - OVERLAP).astimezone(timezone.utc).isoformat(timespec="microseconds")
        except ValueError:
            return None

    def _keep_settings(self, rows: list[Mapping[str, Any]]) -> bool:
        """Settings that came, kept as the player would have set them: only those that are not about this PC, and not one that
        was changed here later. Whether any changed."""
        changed = False
        for row in rows:
            name, data = row.get("row_key"), row.get("data")
            if name not in SYNCED_SETTINGS or row.get("deleted") is True or not isinstance(data, Mapping) or "value" not in data:
                continue
            try:
                pending = self._store.sync_pending(SETTINGS, name)
                if pending is not None and _on_the_server(pending.edited_at, self._ahead()) >= _when(row.get("edited_at")):
                    continue
                changed = self._seam.apply_setting(name, data["value"]) or changed
            except (ValueError, TypeError):
                log.warning("A synced setting did not fit, and was left out.")
        return changed

    def _keep(self, rows: list[Any], device: str) -> set[str]:
        """The rows of a page, kept. The kinds that changed."""
        rows = [row for row in rows if isinstance(row, Mapping) and row.get("device_id") != device]
        kinds = apply_rows(self._store, [row for row in rows if row.get("kind") != SETTINGS], self._ahead())
        if self._keep_settings([row for row in rows if row.get("kind") == SETTINGS]):
            kinds.add(SETTINGS)
        return kinds

    def _deletes_here(self, rows: list[Any], device: str) -> int:
        """How many rows of this PC a page of the account's would delete."""
        found = 0
        for row in rows:
            if not isinstance(row, Mapping) or row.get("deleted") is not True or row.get("device_id") == device:
                continue
            kind = BY_TABLE.get(row.get("kind")) if isinstance(row.get("kind"), str) else None
            parts = _key_values(kind, row.get("row_key")) if kind is not None else None
            if kind is None or parts is None:
                continue
            try:
                if self._store.sync_row(kind.table, kind.key, parts) is not None:
                    found += 1
            except (sqlite3.Error, OverflowError):  # a key that no row of SQLite's can have deletes nothing
                continue
        return found

    async def pull(self) -> set[str]:
        """Reads the account's rows from the cursor, a page at a time, and keeps them. The kinds that changed. Keep this PC's
        data, pressed on another PC, deletes on the account every row that PC lacked, and this PC keeps those deletes too: a
        pull that would delete more than a few of its rows makes a copy first, as Use the account's data does."""
        device = self.device_id()
        kinds: set[str] = set()
        deletes, copied = 0, False
        async for rows in self._pages(device, self._start()):
            deletes += self._deletes_here(rows, device)
            if deletes > MANY_DELETES and not copied:
                copied = True
                try:
                    self._store.backup_before("auto-sync", self._now())
                except (OSError, sqlite3.Error):  # a copy that cannot be made must not stop sync for good: the daily one stays
                    log.warning("No copy could be made before the rows the account deleted were deleted here.", exc_info=True)
            kinds |= self._keep(rows, device)
            newest = self._newer(rows)
            if newest is not None:
                self._store.set_meta("sync_cursor", newest)  # kept with the rows, so that a read cut short loses nothing
        self._store.set_meta("sync_last_at", iso(self._now()))
        return kinds

    def _newer(self, rows: list[Any]) -> str | None:
        """The latest arrival in a page or the cursor before it, as the account wrote it."""
        newest: tuple[datetime, str] | None = None
        held = self._store.meta("sync_cursor")
        for arrived in [*(row.get("received_at") for row in rows if isinstance(row, Mapping)), held]:
            try:
                moment = _when(arrived)
            except ValueError:
                continue
            if newest is None or moment > newest[0]:
                newest = (moment, str(arrived))
        return newest[1] if newest is not None else None

    # ------------------------------------------------------------------ the first sync of a PC with an account
    def first_state(self) -> str | None:
        return self._store.meta(FIRST)

    def _stamp(self) -> None:
        """Every row of this PC, and every setting that syncs, as an edit made now."""
        self._store.sync_stamp_all()
        for name in SYNCED_SETTINGS:
            self._store.sync_queue(SETTINGS, name)

    async def first_look(self) -> str:
        """What the first sync is, when it can be settled without asking. An account with nothing in it takes this PC's data;
        a PC with nothing of its own takes the account's, which the first read below brings; two that both hold data are
        asked about once, and nothing moves until the player answers. "done" or "asking". A setting that syncs and was
        changed here is this PC's data as much as a row is."""
        account_holds = bool(await self._client.select("sync_rows", "select=kind&limit=1"))
        mine = self._store.sync_has_data() or bool(self._seam.settings_changed())
        if account_holds and mine:
            self._store.set_meta(FIRST, "asking")
            return "asking"
        if mine:
            self._stamp()
        else:  # it takes the account's, and a line from before would bury what it takes: a tick taken back is a newer delete
            if account_holds:
                self._seam.keep_settings()  # the account's settings replace these: a copy first, as Use the account's data makes
            self._store.sync_drop_lines()
        self._store.set_meta(FIRST, "done")
        return "done"

    async def _account_keys(self) -> list[Mapping[str, Any]]:
        """The kind and key of every row of the account that is not a delete."""
        found: list[Mapping[str, Any]] = []
        while True:
            rows = await self._client.select(
                "sync_rows",
                f"select=kind,row_key&deleted=eq.false&order=kind.asc,row_key.asc&limit={PULL_ROOM}&offset={len(found)}",
            )
            found += [row for row in rows if isinstance(row, Mapping)]
            if len(rows) < PULL_ROOM:
                return found

    async def keep_this_pc(self) -> None:
        """Keep this PC's data: every row of it is an edit made now, so that it wins, and a row of the account that this PC
        does not have is deleted there. Both go up with the next push. A PC that holds no rows, only settings that changed, has
        nothing to win with and never held the account's rows: only its settings go up, and the rows come down on the next read."""
        keys = await self._account_keys()  # before anything is changed: a server that fails leaves the question as it was
        if not self._store.sync_has_data():
            for name in SYNCED_SETTINGS:
                self._store.sync_queue(SETTINGS, name)
            self._store.set_meta(FIRST, "done")
            return
        self._stamp()
        for row in keys:
            kind = BY_TABLE.get(row.get("kind")) if isinstance(row.get("kind"), str) else None
            if kind is None or _key_values(kind, row.get("row_key")) is None:
                continue  # a kind of a newer phone, or a setting, is not for this PC to bury
            if read_row(self._store, kind.table, row["row_key"]) is None:
                self._store.sync_queue(kind.table, row["row_key"], deleted=True)
        self._store.set_meta(FIRST, "done")

    async def use_the_account(self) -> set[str]:
        """Use the account's data: this PC's data is backed up, and then replaced by the account's. The account is read first,
        all of it, so that a server that fails changes nothing; then the backup, and then the rows, in one go. The kinds that
        changed."""
        pages = [rows async for rows in self._pages(None, None)]
        everything = [row for rows in pages for row in rows if isinstance(row, Mapping)]
        self._store.backup_before("auto-sync", self._now())
        self._seam.keep_settings()
        with self._store.applying_sync():
            self._store.sync_wipe()
            kinds = apply_rows(self._store, [row for row in everything if row.get("kind") != SETTINGS])
            if self._keep_settings([row for row in everything if row.get("kind") == SETTINGS]):
                kinds.add(SETTINGS)
            newest = self._newer(everything)
            if newest is not None:
                self._store.set_meta("sync_cursor", newest)
            self._store.set_meta("sync_last_at", iso(self._now()))
            self._store.set_meta(FIRST, "done")
        return kinds | {kind.table for kind in KINDS} | {SETTINGS}  # whatever was here is gone, and the pages read it all again
