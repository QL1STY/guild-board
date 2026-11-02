"""Shows what Import would find in the game's files, for the check with the player (the Pulls design, section 4).

Run by hand, with the player's go-ahead and the game in the state to be checked:
`python -m guildboard.pulls.cache_probe`.
Guild Board never runs it. It reads the same two files as Import, read-only, with gamecache's own functions, and prints,
in this order: the log's path and whether it was read, the data folder, the cache file chosen and its size, whether it
could be opened for reading, how many links were found (one for each key), and the parameters of the first, the one
Import tries first, with the length of its key. It never prints a key.
"""
from __future__ import annotations

from guildboard.pulls import gamecache

# The link's parameters that are shown, when it has them. The others are left out, as the key is.
SHOWN = ("gacha_type", "init_type", "region", "game_version", "lang", "timestamp")


def _why(problem: Exception) -> str:
    """What went wrong with a file: the name of the error behind it and, on Windows, its number. A problem with no error
    behind it, such as a file too large, is told in the sentence Import gives."""
    cause = problem.__cause__ if isinstance(problem, gamecache.CacheProblem) else problem
    if not isinstance(cause, OSError):
        return str(problem)
    number = getattr(cause, "winerror", None)
    return type(cause).__name__ + (f", Windows error {number}" if number is not None else "")


def main() -> int:
    """Print what each step found. 0 when at least one link was found, else 1."""
    print("Guild Board's cache probe: it reads the game's log and web cache, read-only, and never prints a key.")
    log = gamecache.log_path()
    print(f"Log file: {log}")
    try:
        size = log.stat().st_size
        text = gamecache.read_log(log)
    except (gamecache.CacheProblem, OSError) as problem:
        print(f"Log read: no, {_why(problem)}")
        return 1
    print(f"Log read: yes, {size} bytes")

    folder = gamecache.data_folder(text)
    if folder is None:
        print("Data folder: not named in the log")
        return 1
    print(f"Data folder: {folder}")

    cache = gamecache.cache_file(folder)
    if cache is None:
        print("Cache file: none found under the data folder's web caches")
        return 1
    print(f"Cache file: {cache}")
    try:
        print(f"Cache size: {cache.stat().st_size} bytes")
    except OSError as problem:
        print(f"Cache size: not known, {_why(problem)}")
        return 1
    try:
        data = gamecache.read_cache(cache)
    except (gamecache.CacheProblem, OSError) as problem:
        print(f"Cache opened for reading: no, {_why(problem)}")
        return 1
    print("Cache opened for reading: yes")

    found = gamecache.links(data)
    print(f"Links found: {len(found)}")
    if not found:
        return 1
    first = found[0]
    shown = [f"{name}={first.query[name]}" for name in SHOWN if name in first.query]
    print("Link parameters: " + " ".join(shown))
    absent = [name for name in SHOWN if name not in first.query]
    if absent:
        print("Not in the link: " + " ".join(absent))
    print(f"Key length: {len(first.query[gamecache.KEY])} characters")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
