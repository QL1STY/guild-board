/**
 * The channel between the shell and the core (src/guildboard/shellchannel.py): JSON Lines on the core's stdin and stdout.
 * The unions below match its tables name for name; the line framing is here too.
 */

export interface Settings {
  overlay_hotkey: string
  overlay_display: string
  overlay_size: number
  overlay_full_screen: boolean
  overlay_pinned: boolean
  page_size: number
  page_size_maximized: number
  start_with_windows: boolean
  sync_paused: boolean
  notifications: boolean
  tray_hint_shown: boolean
  /** `parchment`, `midnight`, `slate`, `dusk`, `mist`, a nation (`mondstadt`, `liyue`, `inazuma`, `sumeru`, `fontaine`, `natlan`, `snezhnaya`) or `system` (Match Windows); anything else is Parchment. */
  theme: string
  [key: string]: unknown
}

export interface MapSnapshot {
  tabs: { id: number; url: string; reload: number }[]
  active: number | null
  viewport: { x: number; y: number; w: number; h: number; hidden: boolean } | null
  session: number
}

export type WindowKind = 'login' | 'verify' | 'data_folder' | 'demo' | 'export_backup' | 'save_picture' | 'restart'

/** Core to shell: each line is `{"event": <name>, ...}`. */
export type CoreEvent =
  | { event: 'settings'; settings: Settings }
  | { event: 'ready'; link: string }
  | { event: 'failed'; text: string }
  | { event: 'window'; kind: WindowKind }
  | { event: 'notify'; kind: string; text: string; place: string | null }
  | { event: 'game'; running: boolean }
  | { event: 'map'; snapshot: MapSnapshot }
  | { event: 'finished' }

/** Shell to core: `{"id": <int>, "call": <name>, "args": {...}}`, answered by `{"id", "result"}` or `{"id", "error"}`. */
export type CallName =
  | 'hello'
  | 'login'
  | 'login_text'
  | 'sync_now'
  | 'set_paused'
  | 'update_settings'
  | 'backup_file_name'
  | 'export_backup'
  | 'picture_offer'
  | 'save_picture'
  | 'drop_picture'
  | 'verify_cookies'
  | 'verification_done'
  | 'map_snapshot'
  | 'map_session'
  | 'map_role'
  | 'map_seen'
  | 'map_failed'
  | 'game_running'
  | 'overlay_shell'
  | 'window_state'
  | 'offer_invite'
  | 'log'
  | 'shutdown'

export type CoreAnswer = { id: number; result: unknown } | { id: number; error: string }

/** Cuts a stream of text into lines, whatever the chunks: `\n` or `\r\n` ends a line, and empty lines are dropped. */
export class LineReader {
  private held = ''

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.held += chunk
    let at = this.held.indexOf('\n')
    while (at >= 0) {
      const line = this.held.slice(0, at)
      this.held = this.held.slice(at + 1)
      this.emit(line)
      at = this.held.indexOf('\n')
    }
  }

  /** The stream is over: what is held is the last line. */
  end(): void {
    const line = this.held
    this.held = ''
    this.emit(line)
  }

  private emit(line: string): void {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line
    if (text !== '') this.onLine(text)
  }
}

/** One message as one line. `JSON.stringify` escapes every newline inside a string, so a message is never two lines. */
export function encode(message: object): string {
  return JSON.stringify(message) + '\n'
}
