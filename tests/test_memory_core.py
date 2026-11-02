"""The demo core of `npm run memory:characters` (tools/memory_core.py) starts only on a new, empty folder, so it can never be
pointed at the player's data folder and write its pictures there."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

TOOL = Path(__file__).parent.parent / "tools" / "memory_core.py"


def tool():
    spec = importlib.util.spec_from_file_location("memory_core", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_folder_that_holds_anything_is_refused_and_left_as_it_was(tmp_path, monkeypatch, capsys):
    (tmp_path / "guildboard.db").write_bytes(b"the player's")
    monkeypatch.setattr(sys, "argv", ["memory_core.py", "--data-dir", str(tmp_path), "--demo-now", "2026-10-25T08:00:00+00:00"])
    module = tool()
    monkeypatch.setattr(module, "Core", lambda *args, **kwargs: pytest.fail("a core started"))
    with pytest.raises(SystemExit) as ended:
        module.main()
    assert ended.value.code == 2
    assert "new, empty folder" in capsys.readouterr().err
    assert [one.name for one in tmp_path.iterdir()] == ["guildboard.db"]
