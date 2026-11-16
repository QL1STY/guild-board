import type { Locator } from '@playwright/test'
import { expect } from './fixtures.ts'

/*
 * A mode's icon (the blue emblem) sits in a ring or a disc in Next up and Endgame resets. These hold that its image box is
 * centred in the ring's: the two boxes' centres are within a quarter of a pixel of each other, on both axes, in CSS pixels.
 */

/** The offset of an image's centre from the centre of the ring that holds it, in CSS pixels, by the boxes the page gives them. */
export async function offsetIn(ring: Locator, image: Locator): Promise<{ x: number; y: number }> {
  const outer = await ring.boundingBox()
  const inner = await image.boundingBox()
  expect(outer).not.toBeNull()
  expect(inner).not.toBeNull()
  return { x: inner!.x + inner!.width / 2 - (outer!.x + outer!.width / 2), y: inner!.y + inner!.height / 2 - (outer!.y + outer!.height / 2) }
}

/** Every image under `rings` (each ring holding one) is centred in its ring within a quarter of a pixel. */
export async function expectCentred(rings: Locator, image: string): Promise<void> {
  await expect(rings.first()).toBeVisible()
  const all = await rings.all()
  expect(all.length).toBeGreaterThan(0)
  for (const ring of all) {
    const picture = ring.locator(image)
    await expect(picture).toBeVisible()
    const { x, y } = await offsetIn(ring, picture)
    expect(Math.abs(x), `horizontal offset ${x}`).toBeLessThanOrEqual(0.25)
    expect(Math.abs(y), `vertical offset ${y}`).toBeLessThanOrEqual(0.25)
  }
}
