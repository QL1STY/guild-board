import { type RefObject, useRef, useState } from 'react'
import '../styles/achievements.css'
import { api, messageOf } from '../api.ts'
import type { ImportPreview } from '../types.ts'
import { useStepFocus } from '../ui/focus.ts'
import { fileLine, importSummary, unknownLine } from './achievementsview.ts'

/** The core's own limit (MAX_FILE_BYTES in importers.py), with its sentence. A larger file is refused unread. */
const MAX_FILE_BYTES = 30_000_000
const TOO_LARGE = 'The file is larger than 30 MB. No achievement save is that big.'
const UNREADABLE = 'The file could not be read.'

/** What a preview is asked for: the text and name of the file the player chose. */
type Source = { text: string; file: string }

type Step =
  /** The first step. After an import, `imported` names the file it came from, until the player moves on. */
  | { name: 'start'; imported: string | null }
  | { name: 'preview'; source: Source; preview: ImportPreview }

type Importing = {
  step: Step
  /** Set while a request is out. A press meanwhile sends nothing. */
  busy: boolean
  /** The sentence of the last step that was refused or failed, until the next one succeeds. */
  refusal: string | null
  /** The Paimon.moe profile the player picked, shown until its preview is back. */
  picked: string | null
  previewFile: (file: File) => void
  pickProfile: (profile: string) => void
  apply: () => void
  /** Cancel, and Close: back to the first step. Nothing is sent. */
  back: () => void
}

/**
 * Previews an import and makes it (spec 8.3), each only when the player asks. A preview that fails leaves the panel
 * where it was; an import that fails goes back to the first step, where the player can look at the preview again.
 */
function useImport(): Importing {
  const [step, setStep] = useState<Step>({ name: 'start', imported: null })
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const out = useRef(false) // as busy, but at once: two presses before the page shows the first send one request
  /**
   * Runs one request at a time, and answers null when another is out. The request gives the step to go to, or null to
   * stay. A failure shows its sentence, and the panel goes to `failed`, or else stays.
   */
  const run = (request: () => Promise<Step | null>, failed?: Step): Promise<void> | null => {
    if (out.current) return null
    out.current = true
    setBusy(true)
    return request()
      .then(
        (next) => {
          if (next !== null) setStep(next)
          setRefusal(null)
        },
        (error: unknown) => {
          if (failed !== undefined) setStep(failed)
          setRefusal(messageOf(error))
        },
      )
      .finally(() => {
        out.current = false
        setBusy(false)
      })
  }
  const preview = (source: Source, profile?: string) => async (): Promise<Step> => {
    const body = profile === undefined ? source : { ...source, profile }
    return { name: 'preview', source, preview: await api.post<ImportPreview>('/api/import/preview', body) }
  }
  const previewFile = (file: File) => {
    if (out.current) return
    if (file.size > MAX_FILE_BYTES) {
      setRefusal(TOO_LARGE) // as the core would say, but the file is not read and nothing is sent
      return
    }
    void run(async () => {
      let text: string
      try {
        text = await file.text()
      } catch {
        throw new Error(UNREADABLE)
      }
      return preview({ text, file: file.name })()
    })
  }
  const pickProfile = (profile: string) => {
    if (step.name !== 'preview') return
    const going = run(preview(step.source, profile))
    if (going === null) return
    setPicked(profile)
    void going.finally(() => setPicked(null))
  }
  const apply = () => {
    if (step.name !== 'preview' || step.preview.nothing_new) return
    const { source, preview: shown } = step
    void run(
      async () => {
        const body = { ...source, profile: shown.profile, fingerprint: shown.fingerprint }
        const summary = await api.post<ImportPreview>('/api/import/apply', body)
        return { name: 'start', imported: summary.file }
      },
      { name: 'start', imported: null },
    )
  }
  const back = () => {
    if (out.current) return
    setStep({ name: 'start', imported: null })
    setRefusal(null)
  }
  return { step, busy, refusal, picked, previewFile, pickProfile, apply, back }
}

/** What the import would change (spec 8.3), with Import and Cancel. Nothing is saved before Import. */
function Preview({
  importing,
  preview,
  line,
}: {
  importing: Importing
  preview: ImportPreview
  /** The summary takes the focus when the preview comes in place of the button that asked for it. */
  line: RefObject<HTMLParagraphElement | null>
}) {
  const unknown = unknownLine(preview.unknown)
  return (
    <>
      <p ref={line} className="ach-lead" tabIndex={-1}>
        {importSummary(preview)}
      </p>
      {unknown !== null && <p>{unknown}</p>}
      {preview.conflicts.length > 0 && (
        <ul className="ach-conflicts">
          {preview.conflicts.map((conflict, index) => (
            <li key={index}>{conflict}</li>
          ))}
        </ul>
      )}
      {preview.profiles.length > 1 && (
        <label className="ach-profile">
          Paimon.moe profile
          <select
            value={importing.picked ?? preview.profile}
            onChange={(event) => importing.pickProfile(event.target.value)}
          >
            {preview.profiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile === '' ? 'Main profile' : profile}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ach-buttons">
        {/* With nothing new, a press sends nothing, and the button keeps the focus that disabled would drop to the
            page, as when another profile's preview finds nothing new while the focus is on Import. */}
        <button
          type="button"
          className="gb-btn"
          aria-disabled={importing.busy || preview.nothing_new}
          onClick={importing.apply}
        >
          Import
        </button>
        <button type="button" className="gb-btn quiet" aria-disabled={importing.busy} onClick={importing.back}>
          Cancel
        </button>
      </div>
    </>
  )
}

/** Choose a file: a button that opens the file picker. The input itself is out of sight, but it takes the focus. */
function FileChooser({ choose }: { choose: (file: File) => void }) {
  return (
    <label className="gb-btn quiet ach-file">
      Choose a file
      <input
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = '' // so that choosing the same file again previews it again
          if (file !== undefined) choose(file)
        }}
      />
    </label>
  )
}

/**
 * Settings' import (spec 8.3 and 12.5): a file the player chooses; then the preview; then the import, named above
 * the first step.
 */
export function ImportPanel() {
  const importing = useImport()
  const { step } = importing
  const { line, watch } = useStepFocus(step.name)
  // The first line of the first step takes the focus when the step comes back.
  const first = step.name === 'start' && step.imported !== null ? 'imported' : 'file'
  return (
    <div data-testid="import-panel" {...watch}>
      {step.name === 'preview' ? (
        <Preview importing={importing} preview={step.preview} line={line} />
      ) : (
        <>
          {step.imported !== null && (
            <p ref={first === 'imported' ? line : undefined} className="ach-lead ach-path" tabIndex={-1}>
              Imported from {step.imported}.
            </p>
          )}
          <p ref={first === 'file' ? line : undefined} tabIndex={-1}>
            {fileLine()}
          </p>
          <div className="ach-buttons">
            <FileChooser choose={importing.previewFile} />
          </div>
        </>
      )}
      <p className="ach-problem" role="alert">
        {importing.refusal}
      </p>
    </div>
  )
}
