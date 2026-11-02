import type { Page } from '@playwright/test'

/**
 * Lets a test change part of what the core answers, to show a page data that the demo account does
 * not have. The request still goes to the core; `change` edits the answer before the page sees it.
 * Reload the page afterwards. A fetch still on its way when the test ends is let go (the page fixture).
 */
export async function changeAnswer<T>(page: Page, path: string, change: (data: T) => void): Promise<void> {
  await page.route(`**${path}*`, async (route) => {
    const response = await route.fetch()
    const data = (await response.json()) as T
    change(data)
    await route.fulfill({ response, json: data })
  })
}

/** For a request or an answer that a route holds: `held` waits until `release` lets it go. */
export function holding(): { held: Promise<void>; release: () => void } {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return { held, release }
}
