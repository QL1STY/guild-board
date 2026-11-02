"""Which of a browser's cookies make up a HoYoLAB login. Only these are handed to the core."""
from __future__ import annotations

from typing import Iterable, Mapping

# The names a login is made of are the token store's, which keeps them alone of what HoYoLAB sets later.
from guildboard.tokenstore import OLDER_SESSION_COOKIES, SESSION_COOKIES

REQUIRED = ("ltoken_v2", "ltuid_v2", "ltmid_v2")
SITES = ("hoyolab.com", "hoyoverse.com")


def from_site(domain: str, sites: Iterable[str]) -> bool:
    """True for one of `sites` or a subdomain of one; a cookie's domain may start with a dot."""
    host = domain.lstrip(".").lower()
    return any(host == site or host.endswith("." + site) for site in sites)


def session_cookies(cookies: Mapping[str, str]) -> dict[str, str]:
    names = SESSION_COOKIES + OLDER_SESSION_COOKIES
    return {name: value for name, value in cookies.items() if name in names and value}


class CookieCollector:
    def __init__(self, domains: Iterable[str] = SITES) -> None:
        self._domains = tuple(domains)
        self._cookies: dict[str, str] = {}

    def add(self, name: str, value: str, domain: str) -> None:
        if name in SESSION_COOKIES and value and from_site(domain, self._domains):
            self._cookies[name] = value  # the newest value wins

    def remove(self, name: str, value: str, domain: str) -> None:
        # When a site replaces a cookie, the removal of the old value can arrive after the new value.
        if from_site(domain, self._domains) and self._cookies.get(name) == value:
            del self._cookies[name]

    def complete(self) -> bool:
        return all(self._cookies.get(name) for name in REQUIRED)

    def cookies(self) -> dict[str, str]:
        return dict(self._cookies)
