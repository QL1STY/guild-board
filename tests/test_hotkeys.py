from guildboard.hotkeys import DEFAULT, Hotkey, hotkey_problem, parse_hotkey


def test_text_is_canonical_whatever_the_case_and_order():
    assert parse_hotkey("alt+ctrl+g").text == "Ctrl+Alt+G"
    assert parse_hotkey(" Win + Shift + f9 ").text == "Shift+Win+F9"


def test_flags_and_virtual_keys_are_what_register_hotkey_takes():
    assert parse_hotkey(DEFAULT) == Hotkey(frozenset({"Ctrl", "Alt"}), "G")
    assert parse_hotkey(DEFAULT).flags == 0x0002 | 0x0001 | 0x4000
    assert parse_hotkey(DEFAULT).virtual_key == ord("G")
    assert parse_hotkey("Ctrl+Shift+7").virtual_key == ord("7")
    assert parse_hotkey("Alt+F12").virtual_key == 0x7B


def test_what_cannot_be_read_is_none():
    for text in ["", "Ctrl+", "Ctrl+Alt+G+H", "Ctrl+Ctrl+G", "Ctrl+Alt+Space", "Hyper+G", "Ctrl+Alt+F13"]:
        assert parse_hotkey(text) is None, text


def test_problems_are_said_plainly():
    assert hotkey_problem(DEFAULT) is None
    assert hotkey_problem("Ctrl+Shift+G") is None
    assert hotkey_problem("Ctrl+Alt+Shift+G") is None
    assert hotkey_problem("Ctrl+") == "Write a key with Ctrl, Alt, Shift or Win before it, such as Ctrl+Alt+G."
    assert hotkey_problem("G") == "A hotkey needs Ctrl, Alt or Win, so that typing does not open the overlay."
    assert hotkey_problem("Shift+G") == "A hotkey needs Ctrl, Alt or Win, so that typing does not open the overlay."
    assert hotkey_problem("ctrl+alt+e") == "Ctrl+Alt+E types a letter on your keyboard. Choose another key."
    assert hotkey_problem("Ctrl+Alt+Shift+Z") == "Ctrl+Alt+Shift+Z types a letter on your keyboard. Choose another key."
