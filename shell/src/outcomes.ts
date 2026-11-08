/**
 * The two saves the interface asks for through a Save dialog (app.py: _export, _save_picture): a backup and the Wrapped
 * picture. The dialog, then the core writes the file; a balloon tells the outcome. Texts are the Qt shell's.
 */

export interface OutcomeDeps {
  call(name: 'backup_file_name' | 'export_backup' | 'picture_offer' | 'save_picture' | 'drop_picture', args?: object): Promise<unknown>
  desktop: {
    chooseBackupFile(name: string): Promise<string | null>
    choosePictureFile(name: string): Promise<string | null>
  }
  /** `Notifier.show`. */
  notify(kind: string, text: string, place: string | null): boolean
  warn?(text: string): void
}

const BACKUP_FAILED = 'The backup could not be saved.'
const PICTURE_FAILED = 'The picture could not be saved.'

/**
 * What a save's answer says (shellchannel.py, ruling R28): `{written}` when it was saved, `{refused}` with the sentence the
 * player reads when the core refused it (BackupRefused). Any other answer, and any error, is the plain failure: an error's
 * text can hold a path, and is not for the player.
 */
function outcomeOf(answer: unknown, failure: string): string {
  if (typeof answer === 'object' && answer !== null) {
    const { written, refused } = answer as { written?: unknown; refused?: unknown }
    if (typeof written === 'string' && written !== '') return `Saved ${written}.`
    if (typeof refused === 'string' && refused !== '') return refused
  }
  return failure
}

export async function exportBackup(deps: OutcomeDeps): Promise<void> {
  let name: string
  try {
    name = (await deps.call('backup_file_name')) as string
  } catch {
    deps.warn?.('The backup’s file name could not be read.')
    return
  }
  const chosen = await deps.desktop.chooseBackupFile(name)
  if (!chosen) return
  try {
    const answer = await deps.call('export_backup', { path: chosen })
    deps.notify('backup', outcomeOf(answer, BACKUP_FAILED), null)
  } catch {
    deps.notify('backup', BACKUP_FAILED, null)
  }
}

/**
 * The page sent the picture and the core holds it: the Save dialog, then the core writes the file chosen. A cancelled dialog
 * lets the picture go. Both name the picture's number: a newer picture that took its place while the dialog was open has a
 * dialog of its own, and is neither saved under this one's name nor let go here.
 */
export async function savePicture(deps: OutcomeDeps): Promise<void> {
  let offer: { number: number; name: string } | null
  try {
    offer = (await deps.call('picture_offer')) as { number: number; name: string } | null
  } catch {
    deps.warn?.('The picture’s file name could not be read.')
    return
  }
  if (offer === null) return // let go meanwhile: its ten minutes were up
  const chosen = await deps.desktop.choosePictureFile(offer.name)
  if (!chosen) {
    try {
      await deps.call('drop_picture', { number: offer.number })
    } catch {
      deps.warn?.('The picture could not be let go.')
    }
    return
  }
  try {
    const answer = await deps.call('save_picture', { path: chosen, number: offer.number })
    deps.notify('picture', outcomeOf(answer, PICTURE_FAILED), null)
  } catch {
    deps.notify('picture', PICTURE_FAILED, null)
  }
}
