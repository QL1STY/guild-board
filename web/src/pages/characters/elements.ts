import type { Element, WeaponType } from '../../types.ts'
import type { SignName } from '../../ui/Sign.tsx'

/** The seven elements in the game's own order, as the roster's filter lists them. */
export const ELEMENTS: readonly Element[] = ['Pyro', 'Hydro', 'Anemo', 'Electro', 'Dendro', 'Cryo', 'Geo']

/** The class of an element's palette in elements.css (`el-cryo`): a card or a ring that carries it draws in her colours. */
export function elementClass(element: Element): string {
  return `el-${element.toLowerCase()}`
}

/** The five weapon types in the order the roster's filter lists them. */
export const WEAPON_TYPES: readonly WeaponType[] = ['Sword', 'Claymore', 'Polearm', 'Bow', 'Catalyst']

/** The drawn sign of a weapon type, which the profile's Weapon page and the roster's filter show. */
export function weaponSign(type: WeaponType): SignName {
  switch (type) {
    case 'Sword':
      return 'sword'
    case 'Claymore':
      return 'claymore'
    case 'Polearm':
      return 'polearm'
    case 'Bow':
      return 'bow'
    case 'Catalyst':
      return 'catalyst'
  }
}
