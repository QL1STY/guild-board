import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/profile.json'
import type { Profile } from '../../types.ts'
import endgameSource from './Endgame.tsx?raw'
import plannerSource from './Planner.tsx?raw'
import { ProfileView } from './Profile.tsx'
import profileSource from './Profile.tsx?raw'
import { PageSwitch, Trail } from './Trail.tsx'

const profile = fixture as unknown as Profile
const sandrone = { key: 'sandrone', icon: null, element: 'Cryo' as const }
const draw = (props: Parameters<typeof Trail>[0]) => renderToStaticMarkup(createElement(Trail, props))
const link = (markup: string, name: string) =>
  new RegExp(`<a [^>]*href="([^"]*)"[^>]*>(?:<[^>]+>)*${name}(?:<[^>]+>)*</a>`).exec(markup)

test('the trail names the page, and "Characters" leads back to the roster', () => {
  const markup = draw({ here: 'Sandrone', character: sandrone })
  expect(link(markup, 'Characters')?.[1]).toBe('#/characters')
  expect(markup).toContain('Sandrone')
  expect(markup).toContain('\u203a') // the separator between the two
})

const drawSwitch = (props: Parameters<typeof PageSwitch>[0]) => renderToStaticMarkup(createElement(PageSwitch, props))

test('the heading holds the trail alone: no link but "Characters", and no switch', () => {
  const markup = draw({ here: 'Sandrone', character: sandrone })
  expect(markup.match(/<a /g)).toHaveLength(1)
  expect(link(markup, 'Characters')?.[1]).toBe('#/characters')
  expect(markup).not.toContain('role="group"')
  expect(markup).not.toContain('aria-current')
  expect(markup).not.toContain('Planner')
})

test('the switch has a Profile link and a Planner link, the current one marked and dark', () => {
  const profileOn = drawSwitch({ here: 'Sandrone', characterKey: 'sandrone', view: 'profile' })
  expect(link(profileOn, 'Planner')?.[1]).toBe('#/characters/sandrone/plan')
  expect(link(profileOn, 'Profile')?.[1]).toBe('#/characters/sandrone')
  expect(profileOn.match(/aria-current="page"/g)).toHaveLength(1)
  expect(/aria-current="page"[^>]*>(?:<[^>]+>)*Profile/.test(profileOn)).toBe(true)
  expect(/<div[^>]*role="group"[^>]*aria-label="Sandrone&#x27;s pages"/.test(profileOn)).toBe(true)
  const planOn = drawSwitch({ here: 'Sandrone', characterKey: 'sandrone', view: 'plan' })
  expect(/aria-current="page"[^>]*>(?:<[^>]+>)*Planner/.test(planOn)).toBe(true)
  expect(planOn.match(/aria-current="page"/g)).toHaveLength(1)
})

test('the endgame has the trail alone: no face and no switch', () => {
  const markup = draw({ here: 'Endgame', character: null })
  expect(link(markup, 'Characters')?.[1]).toBe('#/characters')
  expect(markup).toContain('Endgame')
  expect(markup).not.toContain('role="group"')
  expect(markup).not.toContain('cx-ava')
})

test('with a character the trail carries her face', () => {
  expect(draw({ here: 'Sandrone', character: sandrone })).toContain('el-cryo')
})

test('the profile card has no Planner link of its own and no arrows to the character beside her', () => {
  const markup = renderToStaticMarkup(
    createElement(ProfileView, { profile, focus: ['sandrone'], onFocus: () => undefined, refusal: null }),
  )
  expect(markup).not.toContain('>Planner<')
  expect(markup).not.toContain('Previous character')
  expect(markup).not.toContain('Next character')
})

test('the pages of a character drop the old ways back: arrows, All characters, and the planner\'s profile link', () => {
  for (const source of [profileSource, plannerSource, endgameSource]) {
    expect(source).not.toContain('All characters')
    expect(source).not.toContain('Previous character')
    expect(source).not.toContain('pf-arrow')
  }
  expect(plannerSource).not.toContain(' profile`')
  expect(profileSource).toContain('<Trail')
  expect(profileSource).toContain('<PageSwitch')
  expect(plannerSource).toContain('<Trail')
  expect(plannerSource).toContain('<PageSwitch')
  expect(endgameSource).toContain('<Trail')
})
