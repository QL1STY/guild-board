"""The game's own history logs: primogems, Genesis Crystals, resin and artifacts (the ledger design, section 4).

They are the pages the game itself opens, on HoYoverse's self-help service, read with the same kind of key the wish
history is read with. They are only read.
"""

# The overseas servers' history logs; a log's address is this and "Get<Kind>Log". It is the wish history's own host:
# genshin's hk4e-api-os.hoyoverse.com no longer answers there (found at the check with the player, 2026-10-27).
LEDGER_URL = "https://public-operation-hk4e-sg.hoyoverse.com/common/hk4e_self_help_query/User/"
KINDS = ("primogem", "crystal", "resin", "artifact")


def endpoint(kind: str) -> str:
    """The log's name for a kind: "primogem" is GetPrimogemLog."""
    return f"Get{kind.capitalize()}Log"
