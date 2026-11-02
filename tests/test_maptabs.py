import pytest

from guildboard.maptabs import (
    DEFAULT_URL, MapError, MapTabs, UnknownTab, is_map_url, map_name,
)

FISHING = "https://act.hoyolab.com/ys/app/interactive-map/index.html?lang=en-us#/map/2?shown_types=5&center=1.00,2.00&zoom=-1.00"


def names(tabs):
    return [tab["name"] for tab in tabs.model()["tabs"]]


def test_only_pages_of_the_hoyolab_map_are_map_addresses():
    assert is_map_url(DEFAULT_URL) and is_map_url(FISHING)
    for url in (
        "http://act.hoyolab.com/ys/app/interactive-map/index.html",
        "https://act.hoyolab.com.example.net/ys/app/interactive-map/index.html",
        "https://act.hoyolab.com/other/page", "https://www.hoyolab.com/", "javascript:alert(1)", "", None, 5,
    ):
        assert not is_map_url(url)


def test_a_tab_is_named_after_its_map_until_it_is_renamed():
    assert map_name("Teyvat Interactive Map - HoYoLAB") == "Teyvat"
    assert map_name("The Chasm Interactive Map - HoYoLAB") == "The Chasm"
    assert map_name("") == "Map" and map_name(None) == "Map"


def test_a_new_store_has_one_default_tab(store):
    tabs = MapTabs(store)
    model = tabs.model()
    assert [t["name"] for t in model["tabs"]] == ["Map"]
    assert model["active"] == model["tabs"][0]["id"] and model["can_reopen"] is False
    assert tabs.url_of(model["active"]) == DEFAULT_URL


def test_tabs_open_close_and_come_back_in_order(store):
    tabs = MapTabs(store)
    first = tabs.model()["active"]
    second = tabs.add(FISHING)
    assert tabs.model()["active"] == second and tabs.url_of(second) == FISHING
    tabs.remove(second)
    assert tabs.model()["active"] == first and tabs.model()["can_reopen"] is True
    assert tabs.reopen() == second and tabs.url_of(second) == FISHING and tabs.model()["active"] == second
    with pytest.raises(MapError, match="There is no closed tab to open again."):
        tabs.reopen()


def test_closing_the_last_tab_opens_a_fresh_one(store):
    tabs = MapTabs(store)
    only = tabs.model()["active"]
    tabs.remove(only)
    [tab] = tabs.model()["tabs"]
    assert tab["id"] != only and tabs.model()["active"] == tab["id"] and tabs.url_of(tab["id"]) == DEFAULT_URL


def test_a_tab_keeps_the_name_the_player_gave_it_and_loses_it_when_given_none(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    tabs.seen(tab, FISHING, "Teyvat Interactive Map - HoYoLAB")
    assert names(tabs) == ["Teyvat"]
    tabs.rename(tab, "  Fishing  ")
    assert names(tabs) == ["Fishing"] and tabs.model()["tabs"][0]["custom"] is True
    tabs.seen(tab, FISHING, "The Chasm Interactive Map - HoYoLAB")
    assert names(tabs) == ["Fishing"]
    tabs.rename(tab, "   ")
    assert names(tabs) == ["The Chasm"]
    with pytest.raises(MapError, match="A tab's name is at most 40 characters."):
        tabs.rename(tab, "x" * 41)
    with pytest.raises(UnknownTab, match="There is no such tab."):
        tabs.rename(999, "a")


def test_a_duplicate_starts_from_the_same_view_and_sits_next_to_it(store):
    tabs = MapTabs(store)
    first = tabs.model()["active"]
    tabs.seen(first, FISHING, "")
    tabs.rename(first, "Fishing")
    tabs.add()
    copy = tabs.duplicate(first)
    assert names(tabs) == ["Fishing", "Fishing 2", "Map"] and tabs.url_of(copy) == FISHING
    assert tabs.model()["active"] == copy


def test_the_page_address_follows_the_map_but_only_to_map_addresses(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    assert tabs.seen(tab, FISHING, "") is False  # an address alone changes nothing the page shows
    assert tabs.url_of(tab) == FISHING
    tabs.seen(tab, "https://www.hoyolab.com/home", "")
    assert tabs.url_of(tab) == FISHING
    assert tabs.seen(999, FISHING, "Teyvat Interactive Map - HoYoLAB") is False  # a closed tab's late news


def test_tabs_survive_a_restart(store):
    tabs = MapTabs(store)
    first = tabs.model()["active"]
    second = tabs.add(FISHING)
    tabs.rename(second, "Fishing")
    tabs.activate(first)
    again = MapTabs(store)
    assert names(again) == ["Map", "Fishing"] and again.model()["active"] == first
    assert again.url_of(second) == FISHING
    assert again.add() not in (first, second)  # ids are not used again


def test_a_damaged_save_starts_over_with_one_tab(store):
    store.set_meta("map_tabs", "{not json")
    assert names(MapTabs(store)) == ["Map"]
    store.set_meta("map_tabs", '{"tabs": [{"id": 1, "url": "https://example.net/"}], "active": 7, "next": 2}')
    again = MapTabs(store)
    assert again.url_of(again.model()["active"]) == DEFAULT_URL


def test_the_shell_gets_addresses_and_the_area_to_fill(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    assert tabs.snapshot() == {"tabs": [{"id": tab, "url": DEFAULT_URL, "reload": 0}], "active": tab, "viewport": None}
    tabs.reload(tab)
    assert tabs.snapshot()["tabs"][0]["reload"] == 1
    tabs.set_viewport({"x": 10, "y": 20.5, "w": 800, "h": 600, "hidden": False})
    assert tabs.snapshot()["viewport"] == {"x": 10.0, "y": 20.5, "w": 800.0, "h": 600.0, "hidden": False}
    tabs.set_viewport(None)
    assert tabs.snapshot()["viewport"] is None
    for bad in (
        {"x": 1}, {"x": "a", "y": 0, "w": 1, "h": 1}, {"x": 0, "y": 0, "w": -1, "h": 5}, 5,
        {"x": 0, "y": 0, "w": 1e12, "h": 5},  # larger than any display: Qt's rectangles could not hold it
    ):
        with pytest.raises(MapError, match="The map's area is not understood."):
            tabs.set_viewport(bad)


def test_a_tab_that_failed_says_so_until_it_loads(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    tabs.set_failed(tab, True)
    assert tabs.model()["tabs"][0]["failed"] is True
    tabs.set_failed(tab, False)
    assert tabs.model()["tabs"][0]["failed"] is False


def test_there_are_at_most_twenty_tabs(store):
    tabs = MapTabs(store)
    for _ in range(19):
        tabs.add()
    with pytest.raises(MapError, match="At most 20 tabs can be open."):
        tabs.add()


def test_a_title_that_is_only_an_address_is_not_a_name(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    assert tabs.seen(tab, FISHING, "Loading https://act.hoyolab.com/ys/app/interactive-map/index.html") is False
    assert names(tabs) == ["Map"]


def test_a_look_alike_address_is_not_a_map_address():
    # urlsplit reads the host of the first as act.hoyolab.com, and Chromium reads it as evil.example.
    for url in (
        r"https://evil.example\@act.hoyolab.com/ys/app/interactive-map/index.html",
        "https://act.hoyolab.com@evil.example/ys/app/interactive-map/index.html",
        r"https://act.hoyolab.com\.evil.example/ys/app/interactive-map/index.html",
        r"https://act.hoyolab.com/ys/app/interactive-map/index.html\..\x",
        DEFAULT_URL + "a" * 5000,
    ):
        assert not is_map_url(url)
    assert is_map_url(DEFAULT_URL + "a" * 100)


def test_a_title_is_cut_and_a_title_with_half_an_emoji_is_whole(store):
    tabs = MapTabs(store)
    tab = tabs.model()["active"]
    tabs.seen(tab, DEFAULT_URL, "Teyvat \ud83d Interactive Map - HoYoLAB")
    assert tabs.model()["tabs"][0]["name"] == "Teyvat \ufffd"
    tabs.seen(tab, DEFAULT_URL, "x" * 5000 + " - HoYoLAB")
    assert len(tabs._tabs[0]["title"]) <= 200
