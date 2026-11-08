/**
 * The map views' preload (maphost.py: SEEN_SOURCE and ROLE_SEEN_SOURCE). It exposes nothing to the page: no bridge and no
 * channel to the shell, only what it writes into the site's local storage as the page begins.
 *
 * The map's views live in memory, so the site's local storage starts empty at every start of Guild Board, and the map
 * would show its cookie notice, its tutorial and its update log each time. Each page begins with the marks the site
 * leaves once they are closed, unless the player's own are there already. The map also asks once for the player's server
 * and game account and keeps the answer under the HoYoLAB account's number; the shell passes the answer the login
 * already holds as `--gb-map-role=<json>` (percent-encoded, so the quotes survive a command line), the UID and region
 * alone. The HoYoLAB account number, which names the keys, is read from the page's own cookie (`ltuid_v2`, else
 * `account_id_v2`) and not passed in an argument, which every program of the player's can read.
 *
 * A sandboxed preload cannot load other files, so this is one script with no import and no export.
 */
;(() => {
  const ARGUMENT = '--gb-map-role='
  const REGION = /^[a-z0-9_]{1,20}$/
  const DIGITS = /^[0-9]+$/

  const readAccount = (): string | null => {
    const cookies = new Map<string, string>()
    for (const part of document.cookie.split(';')) {
      const at = part.indexOf('=')
      if (at > 0) cookies.set(part.slice(0, at).trim(), part.slice(at + 1).trim())
    }
    for (const name of ['ltuid_v2', 'account_id_v2']) {
      const value = cookies.get(name)
      if (value !== undefined && DIGITS.test(value)) return value
    }
    return null
  }

  const readRole = (): { uid: string; region: string } | null => {
    const argument = process.argv.find((item) => item.startsWith(ARGUMENT))
    if (argument === undefined) return null
    try {
      const text = argument.slice(ARGUMENT.length)
      const value = JSON.parse(text.startsWith('{') ? text : decodeURIComponent(text))
      const { uid, region } = value ?? {}
      // Numbers and a plain region name only.
      if (typeof uid === 'string' && typeof region === 'string' && DIGITS.test(uid) && REGION.test(region)) {
        return { uid, region }
      }
    } catch {
      // an argument that does not read is no role
    }
    return null
  }

  try {
    const now = Date.now()
    const seeds: [string, string][] = [
      ['user-guide-passed', 'true'],
      ['CookieTips-mapsea_cache_by_act.hoyolab/ys/app/interactive-map/index.html',
        JSON.stringify({ createdTime: now, cacheTime: 0, data: true })],
      ['async-announcement-hidden-ts', String(now)],
    ]
    const role = readRole()
    const account = role === null ? null : readAccount()
    if (role !== null && account !== null) {
      seeds.push(
        [`${account}:roleGameRegionStorageKey`, JSON.stringify({ createdTime: now, cacheTime: 0, data: role.region })],
        [`${account}:roleGameUIDStorageKey`, JSON.stringify({ createdTime: now, cacheTime: 0, data: role.uid })],
      )
    }
    for (const [key, value] of seeds) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
    }
  } catch {
    // local storage is closed to this page (an empty one): nothing to seed
  }
})()
