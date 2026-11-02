/**
 * The colour of the disc behind a region's emblem, which the game draws in white (as the player asked after the look
 * pass's check, since a white emblem is lost on the parchment): the colour of its nation's element, deep enough that the
 * white stands out at 4:1 or more. An area takes its nation's colour by its own name or by its parent's; anything else
 * takes the slate of the buttons.
 */
const NATIONS: readonly (readonly [RegExp, string])[] = [
  [/dragonspine|snezhnaya|nod-krai/i, '#3D82A6'], // Cryo
  [/mondstadt/i, '#2F8A7E'], // Anemo
  [/liyue|chasm|chenyu/i, '#9C701D'], // Geo
  [/inazuma|enkanomiya/i, '#7448A8'], // Electro
  [/sumeru/i, '#4F8A2C'], // Dendro
  [/fontaine|bygone/i, '#356FB0'], // Hydro
  [/natlan|sacred mountain/i, '#B4472E'], // Pyro
]
export const EMBLEM_SLATE = '#4A5366'

export function emblemColour(...names: (string | null | undefined)[]): string {
  for (const name of names) {
    if (!name) continue
    for (const [pattern, colour] of NATIONS) if (pattern.test(name)) return colour
  }
  return EMBLEM_SLATE
}
