import { expect, test } from 'vitest'
import { parseArgs } from '../src/args.js'

test('the command line', () => {
  expect(parseArgs(['--demo', '--data-dir', 'C:\\x', '--hidden'])).toMatchObject({ demo: true, dataDir: 'C:\\x', hidden: true })
  expect(parseArgs(['--', 'guildboard://invite/abcdefghijklmnop']).invite).toBe('abcdefghijklmnop')
  expect(parseArgs(['guildboard://invite/short']).invite).toBeNull()
  expect(parseArgs(['--remote-debugging-port=9222']).refused).toEqual(['--remote-debugging-port'])
  expect(parseArgs(['--demo', '--remote-debugging-port=9222']).refused).toEqual([])
})

test('every switch and its default', () => {
  expect(parseArgs([])).toEqual({
    demo: false, dataDir: null, hidden: false, quit: false, demoNow: null,
    acknowledged: false, weekAndEndgame: false, invite: null, refused: [],
  })
  expect(parseArgs(['--demo', '--demo-now', '2026-10-13T08:00:00+00:00', '--acknowledged', '--week-and-endgame', '--quit']))
    .toMatchObject({ demoNow: '2026-10-13T08:00:00+00:00', acknowledged: true, weekAndEndgame: true, quit: true })
  expect(parseArgs(['--data-dir=E:\\h']).dataDir).toBe('E:\\h')
  expect(parseArgs(['--data-dir']).dataDir).toBeNull()
})

test('the refused debugging switches', () => {
  expect(parseArgs(['--inspect', '--inspect-brk=9229', '--inspect-port=1', '--remote-debugging-pipe', '--inspect']).refused)
    .toEqual(['--inspect', '--inspect-brk', '--inspect-port', '--remote-debugging-pipe'])
  expect(parseArgs(['--demo', '--inspect']).refused).toEqual([])
})

test('the refused switches are found in every spelling Chromium accepts', () => {
  expect(parseArgs(['-remote-debugging-port=9351']).refused).toEqual(['--remote-debugging-port'])
  expect(parseArgs(['/remote-debugging-port=9353']).refused).toEqual(['--remote-debugging-port'])
  expect(parseArgs(['--REMOTE-Debugging-Port=9352']).refused).toEqual(['--remote-debugging-port'])
  expect(parseArgs(['--inspect-brk=9229']).refused).toEqual(['--inspect-brk'])
  expect(parseArgs(['/INSPECT']).refused).toEqual(['--inspect'])
  expect(parseArgs(['  -Inspect-Port=1 ']).refused).toEqual(['--inspect-port'])
  expect(parseArgs(['-remote-debugging-pipe', '--REMOTE-DEBUGGING-PIPE']).refused).toEqual(['--remote-debugging-pipe'])
  expect(parseArgs(['--demo', '/INSPECT', '-remote-debugging-port=1']).refused).toEqual([])
})

test('the refusal follows Chromium’s whitespace and Node’s spelling, not a list', () => {
  expect(parseArgs(['\u0085--remote-debugging-port=1']).refused).toEqual(['--remote-debugging-port'])
  expect(parseArgs(['--remote-debugging-pipe\u0085']).refused).toEqual(['--remote-debugging-pipe'])
  expect(parseArgs(['\u0085--remote-debugging-pipe']).refused).toEqual(['--remote-debugging-pipe'])
  expect(parseArgs(['--inspect_brk=9229']).refused).toEqual(['--inspect-brk'])
  expect(parseArgs(['--inspect_port']).refused).toEqual(['--inspect-port'])
  expect(parseArgs(['--inspect-wait=9229']).refused).toEqual(['--inspect-wait'])
  expect(parseArgs(['--inspect-brk-node', '--inspect-publish-uid=stderr']).refused).toEqual(['--inspect-brk-node', '--inspect-publish-uid'])
  expect(parseArgs(['/Remote_Debugging_Address=0.0.0.0']).refused).toEqual(['--remote-debugging-address'])
  expect(parseArgs(['--remote-debugging-anything']).refused).toEqual(['--remote-debugging-anything'])
  expect(parseArgs(['\u2003--inspect']).refused).toEqual(['--inspect'])
  expect(parseArgs(['--demo', '\u0085--remote-debugging-port=1', '--inspect_brk']).refused).toEqual([])
})

test('legitimate starts are not refused', () => {
  const ok = parseArgs([
    '--', 'guildboard://invite/abcdefghijklmnop', '--data-dir', 'C:\\Users\\x\\GuildBoard', '--hidden',
  ])
  expect(ok.refused).toEqual([])
  expect(ok.invite).toBe('abcdefghijklmnop')
  for (const folder of ['C:\\Users\\x\\GuildBoard', 'D:\\g', '\\\\server\\share\\x', 'E:\\inspect\\remote-debugging-x']) {
    expect(parseArgs(['--data-dir', folder]).refused).toEqual([])
  }
  expect(parseArgs(['--demo-now', '2026-10-13T08:00:00+00:00']).refused).toEqual([])
  expect(parseArgs(['--inspector', '--inspection=1', '--remote-debugger']).refused).toEqual([])
})

test('a refused switch is found even where another switch takes it as its value', () => {
  expect(parseArgs(['--data-dir', '/inspect']).refused).toEqual(['--inspect'])
  expect(parseArgs(['--inspected', 'inspect', '--remote-debugger=1']).refused).toEqual([])
})

test('an invite must be the whole argument', () => {
  expect(parseArgs(['guildboard://invite/abcdefghijklmnop']).invite).toBe('abcdefghijklmnop')
  expect(parseArgs(['guildboard://invite/abcdefghijklmnop/x']).invite).toBeNull()
  expect(parseArgs(['guildboard://invite/' + 'a'.repeat(65)]).invite).toBeNull()
})
