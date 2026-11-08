from guildboard.places import launch_target, place_of


def test_a_notification_kind_opens_its_place():
    assert place_of("reminder") == "achievements/timers"
    assert place_of("quick") == "board"
    assert place_of("codes") == "codes"
    assert place_of("characters") == "week"
    assert place_of("characters/hu-tao") == "characters/hu-tao"
    assert place_of("test") is None and place_of(None) is None


def test_a_kind_that_only_looks_like_a_character_opens_nothing():
    for kind in ("characters/", "characters/../x", "characters/Sandrone", "characters/a b", "hint"):
        assert place_of(kind) is None, kind


def test_every_place_a_notification_opens_is_a_launch_place():
    for kind in ("reminder", "quick", "codes", "characters", "characters/hu-tao"):
        assert launch_target(place_of(kind)) == f"/#/{place_of(kind)}"


def test_a_launch_to_nowhere_opens_the_board():
    assert launch_target("nowhere") == "/" and launch_target("") == "/"
