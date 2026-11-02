import logging

from PySide6.QtWidgets import QSystemTrayIcon

from guildboard.shell.tray import Tray, app_icon


def _tray(calls: list):
    return Tray(
        app_icon(),
        open_window=lambda: calls.append("open"),
        sync_now=lambda: calls.append("sync"),
        set_paused=lambda paused: calls.append(("paused", paused)),
        set_pinned=lambda pinned: calls.append(("pinned", pinned)),
        to_main_display=lambda: calls.append("main display"),
        quit=lambda: calls.append("quit"),
    )


def _items(tray: Tray):
    return [action for action in tray.menu().actions() if not action.isSeparator()]


def test_the_tray_menu_offers_open_sync_pause_the_overlays_items_and_quit(qtbot):
    calls: list = []
    tray = _tray(calls)
    assert [action.text() for action in _items(tray)] == [
        "Open", "Sync now", "Pause syncing", "Show pinned widgets", "Move the overlay to the main display", "Quit",
    ]
    for action in _items(tray):
        action.trigger()
    assert calls == ["open", "sync", ("paused", True), ("pinned", False), "main display", "quit"]


def test_the_pause_item_follows_the_setting(qtbot):
    calls: list = []
    tray = _tray(calls)
    tray.show_paused(True)
    resume = _items(tray)[2]
    assert resume.text() == "Resume syncing"
    resume.trigger()
    assert calls == [("paused", False)]


def test_the_pinned_item_follows_the_setting(qtbot):
    calls: list = []
    tray = _tray(calls)
    pinned = _items(tray)[3]
    assert pinned.isCheckable() and pinned.isChecked()  # pinned widgets show over the game, as by default
    tray.show_pinned(False)
    assert not pinned.isChecked()
    pinned.trigger()
    assert calls == [("pinned", True)]


def test_clicking_the_tray_icon_opens_the_window(qtbot):
    calls: list = []
    tray = _tray(calls)
    tray.icon.activated.emit(QSystemTrayIcon.ActivationReason.Trigger)
    tray.icon.activated.emit(QSystemTrayIcon.ActivationReason.Context)  # the right click only opens the menu
    assert calls == ["open"]


def test_a_tray_item_that_fails_is_logged(qtbot, caplog):
    def boom() -> None:
        raise RuntimeError("the core is gone")

    tray = Tray(
        app_icon(), open_window=lambda: None, sync_now=boom, set_paused=lambda paused: None,
        set_pinned=lambda pinned: None, to_main_display=lambda: None, quit=lambda: None,
    )
    item = next(action for action in tray.menu().actions() if action.text() == "Sync now")
    with caplog.at_level(logging.ERROR):
        item.trigger()
    assert "the tray item Sync now failed" in caplog.text


def test_the_icon_is_drawn():
    assert not app_icon().pixmap(32, 32).isNull()
