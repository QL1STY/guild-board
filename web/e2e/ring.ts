import type { Locator, Page } from '@playwright/test'

/**
 * A page's freshness ring (web/src/frame/FreshRing.tsx), found by the test id of its short label: `characters-sync`,
 * `pulls-import` or `ledger-import`. The label is the few words beside the ring ("2 min ago", "page 3 · 41 new"); the
 * sentence is the ring's accessible name, which is also its tooltip. On Characters the ring is a button, elsewhere an image.
 */
export function ring(page: Page, testId: 'characters-sync' | 'pulls-import' | 'ledger-import'): {
  /** The few words beside the ring (role "status"). */
  label: Locator
  /** The ring itself, the element that carries the sentence as its accessible name. */
  mark: Locator
  /** The gold arc, absent while the ring is empty. */
  arc: Locator
} {
  const box = page.locator('.gb-fresh', { has: page.getByTestId(testId) })
  return { label: box.getByTestId(testId), mark: box.locator('[aria-label]'), arc: box.locator('.gb-fresh-arc') }
}
