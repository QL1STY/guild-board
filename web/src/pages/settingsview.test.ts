import { describe, expect, it } from 'vitest'

import type { OnlineView } from '../onlinetypes.ts'
import {
  accountLine, backupLine, BOTH_HOLD_DATA, cloudSpace, galleryFolderMissing, KEEP_REPLACES, KEEP_THIS_PC, noticeSwitches, NO_PLACE_FREE,
  onlineLine, opensSyncLog, overlayLine, spaceText, syncDataLine, USE_REPLACES, USE_THE_ACCOUNT,
} from './settingsview.ts'

describe('galleryFolderMissing', () => {
  it('asks for the folder only when the gallery says it could not find it', () => {
    expect(galleryFolderMissing({ folder_missing: true })).toBe(true)
  })

  it('does not ask when the folder was found, or the answer says nothing of it', () => {
    expect(galleryFolderMissing({ folder_missing: false })).toBe(false)
    expect(galleryFolderMissing({ months: [] })).toBe(false)
    expect(galleryFolderMissing({ folder_missing: 'yes' })).toBe(false)
  })

  it('does not ask while there is no answer, as when the gallery cannot be read', () => {
    expect(galleryFolderMissing(null)).toBe(false)
    expect(galleryFolderMissing(undefined)).toBe(false)
    expect(galleryFolderMissing('Not Found')).toBe(false)
  })
})

describe('accountLine', () => {
  const account = { server: 'os_euro', uid: 700000001 }

  it('names the server and the UID, and that HoYoLAB is logged in to', () => {
    expect(accountLine(account, 'live')).toBe('Europe · UID 700000001 · logged in to HoYoLAB')
  })

  it('says it is the demo account in the demo', () => {
    expect(accountLine(account, 'demo')).toBe('Europe · UID 700000001 · the demo account')
  })

  it('keeps a server it does not know by its own name, and leaves out a UID it does not have', () => {
    expect(accountLine({ server: 'os_moon', uid: null }, 'live')).toBe('os_moon')
  })
})

describe('onlineLine', () => {
  it('says what going online does before signing in, and that Discord is not asked for the e-mail address', () => {
    expect(onlineLine({ state: 'signed_out', name: null, tag: null })).toBe(
      'Sign in to add friends and copy your data to your account. Discord tells Guild Board your name, and is not asked for your e-mail address.',
    )
  })

  it('sends the player to the browser while a sign-in waits', () => {
    expect(onlineLine({ state: 'waiting', name: null, tag: null })).toBe('Finish signing in in your browser.')
  })

  it('names the account once signed in', () => {
    expect(onlineLine({ state: 'signed_in', name: 'Sora', tag: '7687' })).toBe('Signed in with Discord as Sora#7687')
  })

  it('reads the name and the tag the online server sent as text, without the controls that turn the words round', () => {
    expect(onlineLine({ state: 'signed_in', name: 'So‮ra', tag: '7687' })).toBe('Signed in with Discord as Sora#7687')
    expect(onlineLine({ state: 'signed_in', name: { evil: true } as never, tag: '7687' })).toBe('Signed in with Discord')
  })

  it('names nobody while the core does not know the name yet', () => {
    // Guild Board stopped between keeping the session and reading the profile, and the server is away at this start.
    expect(onlineLine({ state: 'signed_in', name: null, tag: null })).toBe('Signed in with Discord')
  })

  it('says friends and sync are paused while the session is lost', () => {
    expect(onlineLine({ state: 'sign_in_again', name: 'Sora', tag: '7687' })).toBe(
      'Your session has ended, so friends and sync are paused.',
    )
  })
})

describe('backupLine', () => {
  const at = (iso: string) => `at ${iso}`

  it('says when the last backup was made, newest first as the core lists them', () => {
    expect(backupLine([{ made_at: '2026-10-27T04:00:00+00:00' }, { made_at: '2026-10-26T04:00:00+00:00' }], at)).toBe(
      'Last backup at 2026-10-27T04:00:00+00:00 · a copy is kept each day for 14 days',
    )
  })

  it('says when there is none yet, and only how long copies are kept while the list is being read', () => {
    expect(backupLine([], at)).toBe('No backup yet · a copy is kept each day for 14 days')
    expect(backupLine(null, at)).toBe('A copy is kept each day for 14 days')
  })
})

describe('opensSyncLog', () => {
  it('opens the sync log for the address the plate\'s See the log goes to', () => {
    expect(opensSyncLog('#/settings/log')).toBe(true)
    expect(opensSyncLog('#/settings/log?from=plate')).toBe(true)
  })

  it('leaves it closed for Settings alone and for anything else', () => {
    expect(opensSyncLog('#/settings')).toBe(false)
    expect(opensSyncLog('#/settings/logs')).toBe(false)
    expect(opensSyncLog('#/board/log')).toBe(false)
    expect(opensSyncLog('')).toBe(false)
  })
})

describe('overlayLine', () => {
  it('names the hotkey that opens the overlay', () => {
    expect(overlayLine('Ctrl+Alt+G')).toBe('A small panel over the game · Ctrl+Alt+G')
  })
})

describe('noticeSwitches', () => {
  it('lists the three Characters notices, each with its name and its sentence, in the order of the design', () => {
    const rows = noticeSwitches({})
    expect(rows.map((row) => row.name)).toEqual(['Characters: weekly bosses', 'Characters: domains', 'Characters: level-ups'])
    expect(rows.map((row) => row.key)).toEqual(['characters_notice_weekly', 'characters_notice_domain', 'characters_notice_ready'])
    expect(rows[0].sentence).toBe('A notification on Sunday at 18:00 server time while a weekly boss in your plan is not done')
  })

  it('has every switch on until the player switches one off, since a core that has no value for it sends it on', () => {
    expect(noticeSwitches({}).map((row) => row.on)).toEqual([true, true, true])
    expect(noticeSwitches({ characters_notice_domain: false }).map((row) => row.on)).toEqual([true, false, true])
  })
})

describe('syncDataLine', () => {
  const timeOf = (iso: string) => `at ${iso}`

  it('says that the data stays on this PC while the switch is off, whatever else is known', () => {
    expect(syncDataLine({ on: false, last_at: null, needs_choice: false }, timeOf)).toBe('Your data stays on this PC')
    expect(syncDataLine({ on: false, last_at: '2026-10-13T08:00:00Z', needs_choice: true }, timeOf)).toBe('Your data stays on this PC')
  })

  it('says that it waits for the choice while the question is open', () => {
    expect(syncDataLine({ on: true, last_at: null, needs_choice: true }, timeOf)).toBe('Waiting for your choice below')
  })

  it('says that nothing was synced yet, or when the last sync was', () => {
    expect(syncDataLine({ on: true, last_at: null, needs_choice: false }, timeOf)).toBe('Your data is copied to your account · not synced yet')
    expect(syncDataLine({ on: true, last_at: '2026-10-13T08:00:00Z', needs_choice: false }, timeOf)).toBe(
      'Your data is copied to your account · last synced at 2026-10-13T08:00:00Z',
    )
  })
})

describe('spaceText', () => {
  it('counts in KB up to 1,000 of them and in MB, to one decimal, after', () => {
    expect(spaceText(0)).toBe('0 KB')
    expect(spaceText(300)).toBe('1 KB') // something is never nothing
    expect(spaceText(739_328)).toBe('722 KB')
    expect(spaceText(1_000 * 1024 - 600)).toBe('999 KB')
    expect(spaceText(1_000 * 1024)).toBe('1 MB')
    expect(spaceText(3_565_158)).toBe('3.4 MB')
    expect(spaceText(4_194_304)).toBe('4 MB') // the limit of an account, 4 MiB, without a decimal that is only a zero
    expect(spaceText(5 * 1_048_576 + 52_429)).toBe('5.1 MB')
  })
})

describe('cloudSpace', () => {
  const usage = (changes: Partial<NonNullable<OnlineView['usage']>> = {}): NonNullable<OnlineView['usage']> => ({
    rows_held: 1_911, rows_limit: 20_000, bytes_held: 739_328, bytes_limit: 4_194_304, has_place: true, seats_full: false, ...changes,
  })

  it('gives the room in plain units, and the items beneath it', () => {
    expect(cloudSpace(usage())).toEqual({
      kind: 'space', line: 'Cloud space: 722 KB of 4 MB used', items: '1,911 of 20,000 items', value: 739_328, max: 4_194_304, note: null,
    })
  })

  it('warns at 90 percent of the bytes or of the items, and not below', () => {
    const note = 'Sync will stop taking new changes when this space is full. They stay on this PC.'
    expect(cloudSpace(usage({ bytes_held: 3_774_873 }))).toMatchObject({ note: null }) // 89.99...%
    expect(cloudSpace(usage({ bytes_held: 3_774_874 }))).toMatchObject({ note })
    expect(cloudSpace(usage({ rows_held: 17_999 }))).toMatchObject({ note: null })
    expect(cloudSpace(usage({ rows_held: 18_000 }))).toMatchObject({ note })
    expect(cloudSpace(usage({ bytes_held: 4_194_304 }))).toMatchObject({ note })
  })

  it('uses the numbers it is given, whatever the limits are', () => {
    expect(cloudSpace(usage({ rows_held: 9, rows_limit: 10, bytes_held: 1_048_576, bytes_limit: 2_097_152 }))).toEqual({
      kind: 'space', line: 'Cloud space: 1 MB of 2 MB used', items: '9 of 10 items', value: 1_048_576, max: 2_097_152,
      note: 'Sync will stop taking new changes when this space is full. They stay on this PC.',
    })
  })

  it('says only that no place is free for an account that holds none while the places are taken', () => {
    expect(NO_PLACE_FREE).toBe(
      'All the places for syncing are taken right now. Your data stays on this PC, and friends and stats still work.',
    )
    expect(cloudSpace(usage({ rows_held: 0, bytes_held: 0, has_place: false, seats_full: true }))).toEqual({
      kind: 'full', sentence: NO_PLACE_FREE,
    })
  })

  it('shows the room of an account that holds a place, though the places are taken', () => {
    expect(cloudSpace(usage({ seats_full: true }))).toMatchObject({ kind: 'space' })
  })
})

describe('the question of the first sync', () => {
  it('is put plainly, and each answer says what it replaces', () => {
    expect(BOTH_HOLD_DATA).toBe('This PC and your account both hold data.')
    expect([KEEP_THIS_PC, USE_THE_ACCOUNT]).toEqual(["Keep this PC's data", "Use the account's data"])
    expect(KEEP_REPLACES).toBe("Replaces the data on your account with this PC's, or sends only this PC's changed settings if that is all it holds.")
    expect(USE_REPLACES).toBe("Replaces this PC's data with your account's. A backup of this PC's data is made first.")
  })
})
