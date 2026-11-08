/** Said on the first run, in Settings' About group and in the README: what Guild Board is not. */
export const FAN_MADE = 'Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE.'

/** Guild Board's source and its privacy notice, which Settings opens in the player's own browser. */
export const SOURCE_URL = 'https://github.com/QL1STY/guild-board/'
export const PRIVACY_URL = 'https://github.com/QL1STY/guild-board/blob/main/PRIVACY.md'

/** What Guild Board reads from HoYoLAB (spec section 7.2), as the first-run page says it. */
export const WHAT_IS_READ = [
  'Your account summary and counters: achievements, days active, chests, oculi and waypoints.',
  'How far each region and area is explored, with its offerings and reputation.',
  'Resin and the other Real-Time Notes, and which Archon Quest chapters are still open.',
  'Your characters, your Spiral Abyss, Imaginarium Theater and Stygian Onslaught results, and your primogem income.',
  'The current banners and events.',
  "Your daily check-in: this month's rewards and how many you claimed.",
  "Your characters' builds, and how many materials you hold, from HoYoLAB; character, weapon and artifact pages and pictures from the HoYoLAB wiki.",
]

/** What Guild Board never does (spec section 3, and the Pulls design's section 4), in the player's words. */
export const HANDS_OFF = [
  "It never changes, adds or deletes anything in the game's folder or in the game's Windows settings. The only things it reads there are the game's log and the history links in its web cache, read-only, and only when you press Import on the Pulls or Ledger page and your HoYoLAB login cannot be used for it.",
  "It never opens the game's process, reads or writes its memory, or hooks into it. All it learns about the game is whether it is running.",
  'It never sends keys or clicks to the game and never captures its screen.',
  "Your HoYoLAB login is kept only on this PC, encrypted for your Windows user. It is never written to a log and never sent anywhere but to HoYoverse. A wish-history link's key is kept in memory only, never on disk: for the import, and for up to a day after it to fetch new wishes.",
  "It talks to HoYoverse's own sites: hoyolab.com, hoyoverse.com and mihoyo.com. Beyond them, it downloads Paimon.moe's public achievement list from GitHub only when you ask to check for new achievements, checks GitHub for a new version of Guild Board, and talks to Guild Board's own server only after you sign in to an online account. It may also download public pictures from other sites, such as the Endgame headers, and sends nothing of yours with them.",
  'It only reads your account, except to redeem a gift code that you typed, pasted or clicked to redeem, and to claim the daily check-in reward when you press Claim. It never posts, claims or changes anything else for you.',
  "It never changes anything else on your HoYoLAB account, not even the calculator's sync setting.",
]

/**
 * How Guild Board reads the wish history and the game's own history pages (the ledger design, section 0, and the keys
 * from the login), said with HANDS_OFF in Settings.
 */
export const LEDGER_HANDS_OFF =
  "It reads your wish history and your game's own history pages (primogems, crystals, resin, artifacts) with a " +
  'read-only key HoYoverse gives your HoYoLAB login, kept in memory only (or, without a login, the link the game writes ' +
  'when you open Feedback), and only reads.'

/** What the screenshot gallery never does (the ledger, gallery and settings design, section 7), said with HANDS_OFF in Settings. */
export const GALLERY_HANDS_OFF =
  "With the gallery on, it looks at the pictures in the game's ScreenShot folder and never moves, changes or deletes one."

/** The accepted risk (spec section 3.3). The first-run page asks the player to acknowledge it. */
export const RISK = [
  'Reading your account through HoYoLAB with your own login is low-risk, but not zero-risk.',
  'The developer of the most widely used tool of this kind says that no user has ever reported a ban. Any third-party access is still technically against the Terms of Service, and if action were ever taken, it would plausibly be against the HoYoLAB account rather than the game account.',
  "HoYoverse's terms of service restrict its services to individual, non-commercial enjoyment and bar software that gives an unfair advantage or disrupts the service, and HoYoverse tells players not to use third-party plug-ins. Guild Board gives no advantage in play and does not take part in the game, but it is not made or approved by HoYoverse, and you use it at your own risk.",
  'The saved login cannot log in to the game, change your password or show your email address. It can act on HoYoLAB as you, which is why Guild Board keeps it encrypted and uses it only to read, apart from the two things you ask for: redeeming a gift code and claiming the daily check-in reward.',
]
