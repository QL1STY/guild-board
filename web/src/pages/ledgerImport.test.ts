import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportButton } from './Ledger'

describe('the Ledger page Import button', () => {
  it('says Import and explains that the HoYoLAB login is read first', () => {
    const html = renderToStaticMarkup(createElement(ImportButton, { busy: false, press: async () => {} }))
    expect(html).toContain('>Import<')
    expect(html).not.toContain('Import from the game')
    expect(html).toContain(
      'title="Import: reads your history with your HoYoLAB login, or, without one, from the link the game writes when you open Feedback."',
    )
  })
})
