import { expect, test, vi } from 'vitest'
import { Hotkey, toAccelerator } from '../src/hotkey.js'

test('Ctrl becomes Control and Win becomes Super', () => {
  expect(toAccelerator('Ctrl+Alt+G')).toBe('Control+Alt+G')
  expect(toAccelerator('Win+F5')).toBe('Super+F5')
  expect(toAccelerator('Ctrl+Shift+Win+Alt+7')).toBe('Control+Alt+Shift+Super+7')
})

test('every key the settings can hold maps: A to Z, 0 to 9, F1 to F12', () => {
  for (const key of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]) {
    expect(toAccelerator(`Ctrl+${key}`)).toBe(`Control+${key}`)
  }
})

test('case and spaces do not matter, as in parse_hotkey', () => {
  expect(toAccelerator('ctrl + alt + g')).toBe('Control+Alt+G')
  expect(toAccelerator('CTRL+f12')).toBe('Control+F12')
  expect(toAccelerator('g+ctrl')).toBeNull()
})

test('unreadable text is null', () => {
  for (const text of ['', ' ', '+', 'Ctrl+', 'Ctrl+Ctrl+G', 'Ctrl+Alt+AA', 'Ctrl+F13', 'Ctrl+F0', 'Hyper+G', 'Ctrl+Space', 'Ctrl+Alt+Enter']) {
    expect(toAccelerator(text), text).toBeNull()
  }
})

test('a key without Ctrl, Alt or Win is null: it would take that key from the player’s typing', () => {
  expect(toAccelerator('G')).toBeNull()
  expect(toAccelerator('Shift+G')).toBeNull()
  expect(toAccelerator('F9')).toBeNull()
})

function make(accept: boolean | ((accelerator: string) => boolean) = true) {
  const registered = new Map<string, () => void>()
  const log: string[] = []
  const register = vi.fn((accelerator: string, cb: () => void) => {
    log.push(`register ${accelerator}`)
    const ok = typeof accept === 'function' ? accept(accelerator) : accept
    if (ok) registered.set(accelerator, cb)
    return ok
  })
  const unregister = vi.fn((accelerator: string) => {
    log.push(`unregister ${accelerator}`)
    registered.delete(accelerator)
  })
  return { hotkey: new Hotkey(register, unregister), registered, log, register, unregister }
}

test('hold registers the accelerator and is held; the key calls back', () => {
  const { hotkey, registered } = make()
  const cb = vi.fn()
  expect(hotkey.state).toBe('none')
  expect(hotkey.hold('Ctrl+Alt+G', cb)).toBe('held')
  expect(hotkey.state).toBe('held')
  registered.get('Control+Alt+G')!()
  expect(cb).toHaveBeenCalledOnce()
})

test('hold returns taken when registering fails, and asks again on the next hold', () => {
  let free = false
  const { hotkey, register } = make(() => free)
  expect(hotkey.hold('Ctrl+Alt+G', () => {})).toBe('taken')
  expect(hotkey.state).toBe('taken')
  free = true
  expect(hotkey.hold('Ctrl+Alt+G', () => {})).toBe('held')
  expect(register).toHaveBeenCalledTimes(2)
})

test('a register that throws is taken', () => {
  const hotkey = new Hotkey(
    () => {
      throw new Error('invalid accelerator')
    },
    () => {},
  )
  expect(hotkey.hold('Ctrl+Alt+G', () => {})).toBe('taken')
})

test('hold of an unreadable hotkey is none and registers nothing', () => {
  const { hotkey, register } = make()
  expect(hotkey.hold('nonsense', () => {})).toBe('none')
  expect(hotkey.state).toBe('none')
  expect(register).not.toHaveBeenCalled()
})

test('holding another key lets go of the first', () => {
  const { hotkey, log, registered } = make()
  hotkey.hold('Ctrl+Alt+G', () => {})
  hotkey.hold('Ctrl+Alt+H', () => {})
  expect(log).toEqual(['register Control+Alt+G', 'unregister Control+Alt+G', 'register Control+Alt+H'])
  expect([...registered.keys()]).toEqual(['Control+Alt+H'])
})

test('holding an unreadable hotkey after a held one lets go of it', () => {
  const { hotkey, registered } = make()
  hotkey.hold('Ctrl+Alt+G', () => {})
  expect(hotkey.hold('', () => {})).toBe('none')
  expect(registered.size).toBe(0)
})

test('holding the same key again replaces the callback', () => {
  const { hotkey, registered } = make()
  const first = vi.fn()
  const second = vi.fn()
  hotkey.hold('Ctrl+Alt+G', first)
  hotkey.hold('Ctrl+Alt+G', second)
  registered.get('Control+Alt+G')!()
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
})

test('release lets go; a key that was never held is not unregistered', () => {
  const never = make(false)
  never.hotkey.hold('Ctrl+Alt+G', () => {})
  never.hotkey.release()
  expect(never.unregister).not.toHaveBeenCalled() // the other program's key is not ours to let go of
  expect(never.hotkey.state).toBe('none')
  const held = make()
  held.hotkey.hold('Ctrl+Alt+G', () => {})
  held.hotkey.release()
  expect(held.registered.size).toBe(0)
  expect(held.hotkey.state).toBe('none')
})
