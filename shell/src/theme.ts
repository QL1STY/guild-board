/**
 * The theme in the shell (the themes design, section 7): the colour each window is made with, so no window opens in the wrong
 * colour before its page has drawn, and the title bar's light or dark.
 *
 * The shell never reads `web/src` while it runs (the packaged app has none), so each theme's `--page-dark` is written here, and
 * `test/theme.test.ts` holds it equal to the interface's stylesheets. Nothing here touches Electron.
 */

/** The names the setting `theme` keeps and the interface's `data-theme` carries (`web/src/theme.ts`). */
export const THEMES = [
  'parchment', 'midnight', 'slate', 'dusk', 'mist',
  'mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya',
] as const
export type ThemeName = (typeof THEMES)[number]

/** Each theme's `--page-dark` (`web/src/styles/tokens.css` and `themes.css`): the colour behind a window's page. */
const BACKGROUNDS: Record<ThemeName, string> = {
  parchment: '#E6DDCA',
  midnight: '#0C0F1A',
  slate: '#2C333F',
  dusk: '#211D19',
  mist: '#E3E9F0',
  mondstadt: '#E2EDF0',
  liyue: '#1F1412',
  inazuma: '#191526',
  sumeru: '#E8EBD6',
  fontaine: '#101A30',
  natlan: '#1B1513',
  snezhnaya: '#E5ECF1',
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** The theme a setting wears: `system` (Match Windows) follows Windows, and a missing or unknown setting is Parchment. */
export function themeOf(setting: unknown, windowsDark: boolean): ThemeName {
  if (setting === 'system') return windowsDark ? 'midnight' : 'parchment'
  return isThemeName(setting) ? setting : 'parchment'
}

/** The colour a window of `theme` is made with. */
export function backgroundOf(theme: ThemeName): string {
  return BACKGROUNDS[theme]
}

/**
 * What Electron's `nativeTheme.themeSource` is set to: the dark themes (Midnight, Slate, Dusk and the dark nations Liyue,
 * Inazuma, Fontaine and Natlan) darken the title bar and the menus; every other setting, Match Windows included, leaves them
 * to Windows.
 */
const DARK_THEMES: readonly string[] = ['midnight', 'slate', 'dusk', 'liyue', 'inazuma', 'fontaine', 'natlan']

export function themeSourceOf(setting: unknown): 'dark' | 'system' {
  return typeof setting === 'string' && DARK_THEMES.includes(setting) ? 'dark' : 'system'
}
