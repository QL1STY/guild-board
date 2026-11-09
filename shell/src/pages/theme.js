// The theme comes in the address (theme.ts: Match Windows is resolved there, so only the twelve names arrive). This script sits in each
// page's <head> as a plain script, so that the page has its theme before the body is drawn; the page's own script no longer has to.
{
  const theme = new URLSearchParams(location.search).get('theme')
  if (['parchment', 'midnight', 'slate', 'dusk', 'mist', 'mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'snezhnaya'].includes(theme)) document.documentElement.dataset.theme = theme
}
