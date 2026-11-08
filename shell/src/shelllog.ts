/**
 * The shell's own log lines. While the core runs they go into its log through the `log` call (under `guildboard.shell`,
 * masked by the log's own rules); before it is ready and after it is gone, to stderr. Only the shell's own fixed texts
 * go here: Electron's own messages (a failed load prints its whole address, which can hold a login code) and errors'
 * texts never do. A cookie, a token or a key is never in a line.
 */

export interface CallLike {
  call(name: 'log', args: { level: string; text: string }): Promise<unknown>
}

const LONGEST = 1000

/** An error's name and nothing else: its text can hold an address with a code in it. */
export function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error'
}

export class ShellLog {
  private core: CallLike | null = null

  /** `toStderr` writes one line, with its line break. */
  constructor(private readonly toStderr: (line: string) => void = (line) => void process.stderr.write(line)) {}

  /** From here the lines go to the core. */
  attach(core: CallLike): void {
    this.core = core
  }

  /** The core is gone. */
  detach(): void {
    this.core = null
  }

  info(text: string): void {
    this.write('info', text)
  }

  warn(text: string): void {
    this.write('warning', text)
  }

  error(text: string): void {
    this.write('error', text)
  }

  private write(level: 'info' | 'warning' | 'error', raw: string): void {
    const text = raw.replace(/[\r\n]+/g, ' ').slice(0, LONGEST)
    const label = level
    const fallback = (): void => {
      try {
        this.toStderr(`${label}: ${text}\n`)
      } catch {
        // nowhere left to write
      }
    }
    const core = this.core
    if (core === null) {
      fallback()
      return
    }
    try {
      core.call('log', { level, text }).catch(fallback)
    } catch {
      fallback()
    }
  }
}
