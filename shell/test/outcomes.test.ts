import { expect, test } from 'vitest'
import { exportBackup, savePicture, type OutcomeDeps } from '../src/outcomes.js'

function setup(answers: Record<string, unknown | Error>, chosen: string | null = 'C:\\Users\\Mia\\Documents\\chosen') {
  const calls: { name: string; args: object }[] = []
  const notes: [string, string, string | null][] = []
  const warnings: string[] = []
  const deps: OutcomeDeps = {
    async call(name, args = {}) {
      calls.push({ name, args })
      const answer = answers[name]
      if (answer instanceof Error) throw answer
      return answer
    },
    desktop: {
      async chooseBackupFile() {
        return chosen
      },
      async choosePictureFile() {
        return chosen
      },
    },
    notify: (kind, text, place) => {
      notes.push([kind, text, place])
      return true
    },
    warn: (text) => warnings.push(text),
  }
  return { deps, calls, notes, warnings }
}

test('a backup is exported to the file chosen, and the balloon says what was saved', async () => {
  const { deps, calls, notes } = setup({ backup_file_name: 'a.gbbackup', export_backup: { written: 'a.gbbackup' } })
  await exportBackup(deps)
  expect(calls).toEqual([
    { name: 'backup_file_name', args: {} },
    { name: 'export_backup', args: { path: 'C:\\Users\\Mia\\Documents\\chosen' } },
  ])
  expect(notes).toEqual([['backup', 'Saved a.gbbackup.', null]])
})

test('a cancelled backup dialog calls nothing more and says nothing', async () => {
  const { deps, calls, notes } = setup({ backup_file_name: 'a.gbbackup' }, null)
  await exportBackup(deps)
  expect(calls.map((c) => c.name)).toEqual(['backup_file_name'])
  expect(notes).toEqual([])
})

test('a backup the core refused shows the sentence it gave', async () => {
  const { deps, notes } = setup({ backup_file_name: 'a.gbbackup', export_backup: { refused: 'A backup cannot be saved in the game’s folders.' } })
  await exportBackup(deps)
  expect(notes).toEqual([['backup', 'A backup cannot be saved in the game’s folders.', null]])
})

test('a backup that failed in any other way says it could not be saved, never the error’s text', async () => {
  for (const text of ['The core is not running.', 'The core did not answer.', 'The core has stopped.', "[Errno 13] Permission denied: 'C:/Users/Mia/x.zip'"]) {
    const { deps, notes } = setup({ backup_file_name: 'a.gbbackup', export_backup: new Error(text) })
    await exportBackup(deps)
    expect(notes).toEqual([['backup', 'The backup could not be saved.', null]])
  }
})

test('a backup whose file name cannot be read ends quietly in the log', async () => {
  const { deps, notes, warnings } = setup({ backup_file_name: new Error('The core is not running.') })
  await exportBackup(deps)
  expect(notes).toEqual([])
  expect(warnings).toEqual(['The backup’s file name could not be read.'])
})

test('a picture is saved to the file chosen, by its number, and the balloon says what was saved', async () => {
  const { deps, calls, notes } = setup({ picture_offer: { number: 3, name: 'wrapped.png' }, save_picture: { written: 'wrapped.png' } })
  await savePicture(deps)
  expect(calls).toEqual([
    { name: 'picture_offer', args: {} },
    { name: 'save_picture', args: { path: 'C:\\Users\\Mia\\Documents\\chosen', number: 3 } },
  ])
  expect(notes).toEqual([['picture', 'Saved wrapped.png.', null]])
})

test('a picture that was let go meanwhile asks for no file', async () => {
  const { deps, calls, notes } = setup({ picture_offer: null })
  await savePicture(deps)
  expect(calls.map((c) => c.name)).toEqual(['picture_offer'])
  expect(notes).toEqual([])
})

test('a cancelled picture dialog lets the picture go by its number', async () => {
  const { deps, calls, notes } = setup({ picture_offer: { number: 3, name: 'wrapped.png' }, drop_picture: null }, null)
  await savePicture(deps)
  expect(calls).toEqual([
    { name: 'picture_offer', args: {} },
    { name: 'drop_picture', args: { number: 3 } },
  ])
  expect(notes).toEqual([])
})

test('a picture the core refused shows its sentence, and any other failure says it could not be saved', async () => {
  const refused = setup({ picture_offer: { number: 1, name: 'w.png' }, save_picture: { refused: 'That picture is no longer held.' } })
  await savePicture(refused.deps)
  expect(refused.notes).toEqual([['picture', 'That picture is no longer held.', null]])
  for (const text of ['The core has stopped.', "[Errno 13] Permission denied: 'C:/p.png'"]) {
    const failed = setup({ picture_offer: { number: 1, name: 'w.png' }, save_picture: new Error(text) })
    await savePicture(failed.deps)
    expect(failed.notes).toEqual([['picture', 'The picture could not be saved.', null]])
  }
})
