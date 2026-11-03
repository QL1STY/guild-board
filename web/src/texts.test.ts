import { describe, expect, it } from 'vitest'

import { FAN_MADE, HANDS_OFF, PRIVACY_URL, RISK, SOURCE_URL, WHAT_IS_READ } from './texts.ts'

// What the first run and Settings say Guild Board never does (the Pulls design, section 4, and the second pass design,
// section 5): the two reads of the game's files on Import, the wish-history links in its web cache among them, and the
// key of the link that answered, kept in memory alone for the import and for up to a day after it.
describe('HANDS_OFF', () => {
  it('names the only reads in the game folder, read-only, only on Import and only without a usable login', () => {
    expect(HANDS_OFF[0]).toBe(
      "It never changes, adds or deletes anything in the game's folder or in the game's Windows settings. " +
        "The only things it reads there are the game's log and the history links in its web cache, read-only, " +
        'and only when you press Import on the Pulls or Ledger page and your HoYoLAB login cannot be used for it.',
    )
  })

  it("keeps a wish-history link's key in memory only, for the import and for up to a day after it", () => {
    expect(HANDS_OFF[3]).toBe(
      'Your HoYoLAB login is kept only on this PC, encrypted for your Windows user. It is never written to a log and ' +
        "never sent anywhere but to HoYoverse. A wish-history link's key is kept in memory only, never on disk: for " +
        'the import, and for up to a day after it to fetch new wishes.',
    )
  })

  it('names every address it talks to, the online account only after a sign-in', () => {
    expect(HANDS_OFF[4]).toBe(
      "It talks only to HoYoverse's own sites: hoyolab.com, hoyoverse.com and mihoyo.com. The exceptions are " +
        "Paimon.moe's public achievement list on GitHub, downloaded only when you ask to check for new achievements, " +
        "the check for a new version of Guild Board on GitHub, and, only after you sign in to an online account, " +
        "Guild Board's own server.",
    )
  })

  it('names the two things it does for you: redeem a gift code and claim the daily reward, when you ask', () => {
    expect(HANDS_OFF[5]).toBe(
      'It only reads your account, except to redeem a gift code that you typed, pasted or clicked to redeem, and to ' +
        'claim the daily check-in reward when you press Claim. It never posts, claims or changes anything else for you.',
    )
  })

  it("never changes anything on the HoYoLAB account, the calculator's sync setting included", () => {
    expect(HANDS_OFF[6]).toBe(
      "It never changes anything else on your HoYoLAB account, not even the calculator's sync setting.",
    )
  })

  it('keeps its seven rules', () => {
    expect(HANDS_OFF).toHaveLength(7)
  })
})

// What the first run says is read (the Characters design, H6): the characters' builds and the materials held from HoYoLAB,
// and the pages and pictures of characters, weapons and artifacts from the HoYoLAB wiki.
describe('WHAT_IS_READ', () => {
  it("names the builds, the materials held, and the wiki's pages and pictures", () => {
    expect(WHAT_IS_READ).toContain(
      "Your characters' builds, and how many materials you hold, from HoYoLAB; character, weapon and artifact pages and " +
        'pictures from the HoYoLAB wiki.',
    )
  })
})

// What Guild Board says it is, and where its source and privacy notice are (the public release plan, section 2).
describe('FAN_MADE', () => {
  it('says that Guild Board is unofficial and not from HoYoverse or COGNOSPHERE', () => {
    expect(FAN_MADE).toBe('Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE.')
  })
})

describe('the links of the About group', () => {
  it("are on Guild Board's own repository, which the window opens in the player's browser", () => {
    expect(SOURCE_URL).toBe('https://github.com/QL1STY/guild-board/')
    expect(PRIVACY_URL).toBe('https://github.com/QL1STY/guild-board/blob/main/PRIVACY.md')
    expect(PRIVACY_URL.startsWith(SOURCE_URL)).toBe(true)
  })
})

// The risk, as the first run and Settings say it (the public release plan, section 2): the terms, that Guild Board is not
// from HoYoverse, and that the login is used only to read apart from the two things the player asks for.
describe('RISK', () => {
  it("names HoYoverse's terms and that Guild Board is not made or approved by HoYoverse", () => {
    expect(RISK).toContain(
      "HoYoverse's terms of service restrict its services to individual, non-commercial enjoyment and bar software that " +
        'gives an unfair advantage or disrupts the service, and HoYoverse tells players not to use third-party plug-ins. ' +
        'Guild Board gives no advantage in play and does not take part in the game, but it is not made or approved by ' +
        'HoYoverse, and you use it at your own risk.',
    )
  })

  it('says the login only reads, apart from redeeming a gift code and claiming the daily check-in', () => {
    expect(RISK).toContain(
      'The saved login cannot log in to the game, change your password or show your email address. It can act on HoYoLAB ' +
        'as you, which is why Guild Board keeps it encrypted and uses it only to read, apart from the two things you ask ' +
        'for: redeeming a gift code and claiming the daily check-in reward.',
    )
    expect(RISK.join(' ')).not.toContain('only ever reads')
  })

  it('keeps the risk it always said', () => {
    expect(RISK[0]).toBe('Reading your account through HoYoLAB with your own login is low-risk, but not zero-risk.')
  })
})
