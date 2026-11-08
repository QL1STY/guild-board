/** The shell's command line: the switches the core knows, the invite link, and the debugging switches a start refuses. */

export interface ShellArgs {
  demo: boolean
  dataDir: string | null
  hidden: boolean
  quit: boolean
  demoNow: string | null
  acknowledged: boolean
  weekAndEndgame: boolean
  invite: string | null
  refused: string[]
}

// The core's INVITE (src/guildboard/cloud/__init__.py): the whole argument is the link.
const INVITE = /^guildboard:\/\/invite\/([A-Za-z0-9_-]{16,64})$/

// Switches that open a debugging door into the program: Chromium's `remote-debugging-*` (port, pipe, address, ...) and
// Node's `inspect` and `inspect-*` (brk, port, wait, brk-node, publish-uid, ...). Outside the demo a start that
// carries one quits. A family, not a list of spellings.
function opensDebugging(name: string): boolean {
  return name === 'inspect' || name.startsWith('inspect-') || name.startsWith('remote-debugging-')
}

// Chromium's Windows TrimWhitespace: JavaScript's whitespace and U+0085 (NEL), which `trim()` leaves.
const TRIM = /^[\s\u0085]+|[\s\u0085]+$/g

/**
 * The debugging switch an argument is, as Chromium and Node read it, or null, as its canonical `--name`. Chromium on
 * Windows trims the argument, takes one leading `--`, `-` or `/`, and lowercases the name before `=`; Node reads `_`
 * as `-`. Any argument can be a switch, also one that another switch of ours would take as its value.
 */
function debuggingSwitch(arg: string): string | null {
  const found = /^(?:--|-|\/)(.*)$/s.exec(arg.replace(TRIM, ''))
  if (!found) return null // no prefix: a value, not a switch
  const name = found[1].split('=', 1)[0].toLowerCase().replaceAll('_', '-')
  return opensDebugging(name) ? `--${name}` : null
}

/** `argv` is what follows the program (and, in development, what follows the app's folder). */
export function parseArgs(argv: readonly string[]): ShellArgs {
  const args: ShellArgs = {
    demo: false, dataDir: null, hidden: false, quit: false, demoNow: null,
    acknowledged: false, weekAndEndgame: false, invite: null, refused: [],
  }
  const debugging: string[] = []
  for (const arg of argv) {
    const door = debuggingSwitch(arg)
    if (door !== null && !debugging.includes(door)) debugging.push(door)
  }
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]
    const equals = arg.indexOf('=')
    const name = equals < 0 ? arg : arg.slice(0, equals)
    const inline = equals < 0 ? null : arg.slice(equals + 1)
    if (name === '--demo') args.demo = true
    else if (name === '--hidden') args.hidden = true
    else if (name === '--quit') args.quit = true
    else if (name === '--acknowledged') args.acknowledged = true
    else if (name === '--week-and-endgame') args.weekAndEndgame = true
    else if (name === '--data-dir' || name === '--demo-now') {
      let value = inline
      if (value === null && at + 1 < argv.length) value = argv[++at]
      if (name === '--data-dir') args.dataDir = value
      else args.demoNow = value
    } else {
      const found = INVITE.exec(arg)
      if (found) args.invite = found[1]
    }
  }
  args.refused = args.demo ? [] : debugging
  return args
}
