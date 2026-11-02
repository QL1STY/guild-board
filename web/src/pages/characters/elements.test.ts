import { expect, test } from 'vitest'
import type { Element, WeaponType } from '../../types.ts'
import { SIGN_NAMES } from '../../ui/Sign.tsx'
import { ELEMENTS, elementClass, weaponSign } from './elements.ts'

test('the seven elements are in the game\'s order and each has a class of its own', () => {
  expect(ELEMENTS).toEqual(['Pyro', 'Hydro', 'Anemo', 'Electro', 'Dendro', 'Cryo', 'Geo'])
  expect(ELEMENTS.map(elementClass)).toEqual([
    'el-pyro', 'el-hydro', 'el-anemo', 'el-electro', 'el-dendro', 'el-cryo', 'el-geo',
  ])
  expect(elementClass('Cryo' as Element)).toBe('el-cryo')
})

test('each weapon type has its own sign, and every sign is drawn', () => {
  const types: WeaponType[] = ['Sword', 'Claymore', 'Polearm', 'Bow', 'Catalyst']
  const signs = types.map(weaponSign)
  expect(signs).toEqual(['sword', 'claymore', 'polearm', 'bow', 'catalyst'])
  for (const sign of signs) expect(SIGN_NAMES).toContain(sign)
})
