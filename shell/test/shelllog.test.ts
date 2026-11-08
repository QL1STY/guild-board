import { expect, test } from 'vitest'
import { errorName, ShellLog } from '../src/shelllog.js'

function setup() {
  const lines: string[] = []
  const calls: { name: string; args: object }[] = []
  let reject = false
  const core = {
    call(name: string, args: object): Promise<unknown> {
      calls.push({ name, args })
      return reject ? Promise.reject(new Error('The core is not running.')) : Promise.resolve(null)
    },
  }
  const log = new ShellLog((line) => lines.push(line))
  return { log, core, lines, calls, failCalls: () => (reject = true) }
}

test('before the core is ready the shell’s lines go to stderr', () => {
  const { log, lines, calls } = setup()
  log.warn('Windows refused the overlay’s hotkey')
  expect(lines).toEqual(['warning: Windows refused the overlay’s hotkey\n'])
  expect(calls).toEqual([])
})

test('while the core runs the lines go to its log through the log call', () => {
  const { log, core, lines, calls } = setup()
  log.attach(core)
  log.info('Guild Board is running')
  log.warn('a warning')
  log.error('an error')
  expect(calls).toEqual([
    { name: 'log', args: { level: 'info', text: 'Guild Board is running' } },
    { name: 'log', args: { level: 'warning', text: 'a warning' } },
    { name: 'log', args: { level: 'error', text: 'an error' } },
  ])
  expect(lines).toEqual([])
})

test('after the core is gone the lines go to stderr again', () => {
  const { log, core, lines, calls } = setup()
  log.attach(core)
  log.detach()
  log.error('late')
  expect(calls).toEqual([])
  expect(lines).toEqual(['error: late\n'])
})

test('a line the core could not take goes to stderr', async () => {
  const { log, core, lines, failCalls } = setup()
  log.attach(core)
  failCalls()
  log.info('lost')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(lines).toEqual(['info: lost\n'])
})

test('a line holds one line of text: line breaks are made spaces', () => {
  const { log, lines } = setup()
  log.error('first\nsecond\r\nthird')
  expect(lines).toEqual(['error: first second third\n'])
})

test('a very long text is cut', () => {
  const { log, lines } = setup()
  log.error('x'.repeat(5000))
  expect(lines[0].length).toBeLessThan(1100)
})

test('an error is named, never quoted: its text can hold an address with a login code', () => {
  expect(errorName(new TypeError('Failed to load URL: https://example.test/?code=made-up-code'))).toBe('TypeError')
  expect(errorName('a string')).toBe('Error')
  expect(errorName(null)).toBe('Error')
})
