import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/profile.json'
import type { Profile } from '../../types.ts'
import { ProfileView } from './Profile.tsx'
import { Pane } from './ProfilePanes.tsx'
import css from './profile.css?raw'

const profile = fixture as unknown as Profile
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of profile.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

const draw = (model: Profile, focus: string[] | null = ['sandrone'], onCard?: () => void) =>
  renderToStaticMarkup(createElement(ProfileView, { profile: model, focus, onFocus: () => undefined, refusal: null, onCard }))

test('the card has six pages in its sidebar, the first of them shown, each a button with its name', () => {
  const markup = draw(profile)
  const nav = /<nav[^>]*class="pf-nav"[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? ''
  expect(nav.match(/<button/g)).toHaveLength(6)
  for (const label of ['Attributes', 'Weapon', 'Artifacts', 'Constellation', 'Talents', 'Story']) expect(nav).toContain(label)
  expect(nav.match(/aria-current="page"/g)).toHaveLength(1)
  expect(/aria-current="page"[^>]*>[\s\S]*?Attributes/.test(nav)).toBe(true)
})

test('the card tints by her element, and her name stands behind her, hollow', () => {
  const markup = draw(profile)
  expect(markup).toContain('pf-card el-cryo')
  expect(markup).toContain('class="pf-giant" aria-hidden="true">Sandrone')
  const giant = ruleOf('.pf-giant')
  expect(giant).toMatch(/color:\s*transparent/)
  expect(giant).toMatch(/-webkit-text-stroke/)
  expect(giant).toMatch(/pointer-events:\s*none/)
})

test('the hero is a fixed 680 pixels and the panel a fixed share of it, so that the art never moves between pages', () => {
  expect(ruleOf('.pf-hero')).toMatch(/height:\s*680px/)
  expect(ruleOf('.pf-hero')).not.toMatch(/min-height|max-height/)
  expect(ruleOf('.pf-panel')).toMatch(/overflow:\s*hidden/)
  expect(ruleOf('.pf-panel')).toMatch(/margin:\s*20px 20px 20px 0/)
  // The stage and its art are placed from the hero's own box: no page of the sidebar sets a size on them.
  expect(ruleOf('.pf-art')).toMatch(/height:\s*106%/)
})

test("her art takes the hero's height, as in profile.html, cropped at the sides rather than shrunk to the stage's width", () => {
  // The wiki's art is twice as wide as it is tall, so fitted whole it would stand at half the hero's height.
  expect(ruleOf('.pf-art img')).toMatch(/object-fit:\s*cover/)
  expect(ruleOf('.pf-art img')).toMatch(/object-position:\s*center bottom/)
})

test('a page anchors its last block to its floor, and the Constellation page dims her art only', () => {
  expect(ruleOf('.pf-pane > .end')).toMatch(/margin-top:\s*auto/)
  expect(ruleOf('.pf-card.cons-mode .pf-art')).toMatch(/opacity:\s*\.12/)
  expect(plain).not.toMatch(/\.cons-mode\s+\.pf-(hero|stage|panel)\s*\{[^}]*(height|width)/)
})

test('her name block says what she is, and the pity pill opens her story', () => {
  const markup = draw(profile)
  expect(markup).toContain('Mirrored Analysis')
  expect(markup).toContain('Level <b>90</b>')
  expect(markup).toContain('<b>C2</b>')
  expect(markup).toContain('Came at pity')
  expect(markup).toMatch(/class="pf-pity"[\s\S]*?<b>71<\/b><b>44<\/b><b>62<\/b>/)
})

test('the pity pill is hidden when the history holds none of her', () => {
  expect(draw({ ...profile, pity: [] })).not.toContain('Came at pity')
})

test('the build strip holds her weapon and five pieces, each with a verdict chip', () => {
  const markup = draw(profile)
  const strip = /<div class="pf-strip"[\s\S]*?<div class="pf-unfold/.exec(markup)?.[0] ?? ''
  expect(strip.match(/class="pf-pc( open)?"/g)).toHaveLength(6)
  expect(strip).toContain('A Teaspoon of Transcendence')
  expect(strip.match(/pf-verdict keep/g)).toHaveLength(4) // the weapon, the flower, the sands and the circlet
  expect(strip).toContain('pf-verdict lvl-up')
  expect(strip).toContain('pf-verdict swap')
})

test('the unfolding starts closed and out of reach of the keyboard', () => {
  const markup = draw(profile)
  expect(markup).toMatch(/<div class="pf-unfold" id="pf-unfold" inert=""/)
  expect(ruleOf('.pf-unfold')).toMatch(/height:\s*0/)
  expect(ruleOf('.pf-unfold.open')).toMatch(/height:\s*auto/)
})

test('the stat bars of the Attributes page are cut in three and carry the goal mark', () => {
  const markup = draw(profile)
  expect(markup.match(/class="pf-seg pf-s-her"/g)?.length).toBeGreaterThanOrEqual(6)
  expect(markup).toContain('pf-s-weapon')
  expect(markup).toContain('pf-s-artifacts')
  expect(markup.match(/class="pf-goal"/g)).toHaveLength(5) // atk, cr, cd, er and dmg have goals
  expect(markup).toContain('Where her 41 substat rolls went')
  expect(markup).toContain('28 help her, 5 are of some use, 8 are wasted.')
})

test('the readiness sheet sits below the card with her parts and the three steps, each with its gain', () => {
  const markup = draw(profile)
  const sheet = /<section class="pf-sheet"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? ''
  expect(sheet).toContain('of her full potential')
  for (const part of ['Level', 'Talents', 'Weapon', 'Artifacts']) expect(sheet).toContain(`<span>${part}</span>`)
  expect(sheet).toContain('What to do next')
  expect(sheet.match(/<li>/g)).toHaveLength(3)
  expect(sheet).toContain('about +31% damage')
  expect(sheet).toContain('Researched, high confidence.')
  expect(markup.indexOf('pf-sheet')).toBeGreaterThan(markup.indexOf('pf-card'))
})

test('a character not owned shows her art and kit, marked "Not yours yet", with Pre-farm in place of Add to focus', () => {
  const unowned: Profile = {
    ...profile,
    owned: false,
    level: null,
    constellation: null,
    weapon: null,
    pieces: [],
    rolls: [],
    pity: [],
    readiness: { total: 0, parts: [] },
    constellations: profile.constellations.map((c) => ({ ...c, owned: false })),
  }
  const markup = draw(unowned)
  expect(markup).toContain('Not yours yet')
  expect(markup).toContain('Pre-farm')
  expect(markup).not.toContain('Add to focus')
  expect(markup).not.toContain('class="pf-strip"') // no build to show
  expect(markup).not.toContain('class="pf-ready"')
  // Attributes shows only the card's goals.
  expect(markup.match(/class="pf-stat"/g)).toHaveLength(5)
  expect(markup).not.toContain('Level <b>')
})

test('her art melts into the card, and the words have a soft ground of their own in the dark of her element', () => {
  expect(ruleOf('.pf-art img')).toContain('mask-composite: intersect')
  const ground = ruleOf('.pf-stage::after')
  expect(ground).toContain('var(--card-bg)')
  expect(ground).toContain('var(--edge, 0)')
  expect(ground).toContain('pointer-events: none')
  expect(draw(profile)).toMatch(/class="pf-stage"[^>]*style="--edge:0"/)
})

test('a pane keeps room for its scrollbar away from the text, and shows none while it comes in', () => {
  const pane = ruleOf('.pf-pane')
  expect(pane).toContain('scrollbar-gutter: stable')
  expect(pane).toMatch(/margin-right: -16px/)
  expect(pane).toMatch(/padding-right: 8px/)
  expect(ruleOf('.pf-pane.settling')).toContain('overflow-y: hidden')
})

test('without the focus the card keeps its Planner and has no focus button', () => {
  const markup = renderToStaticMarkup(createElement(ProfileView, { profile, focus: [], onFocus: () => undefined, refusal: null, focusShown: false }))
  expect(markup).toContain('Planner')
  expect(markup).not.toContain('Add to focus')
  expect(markup).not.toContain('aria-pressed')
})

test('the focus button shows whether she is in it, and waits for the focus to be read', () => {
  expect(draw(profile, ['sandrone'])).toMatch(/aria-pressed="true"[^>]*>In focus</)
  expect(draw(profile, [])).toMatch(/aria-pressed="false"[^>]*>Add to focus</)
  expect(draw(profile, null)).toMatch(/aria-pressed="false" disabled=""/)
})

test("the Weapon page's verdict is green only when the card says to keep it", () => {
  // The Weapon page is not the one shown first, so its pane is drawn on its own here.
  const weaponPage = (verdict: string) =>
    renderToStaticMarkup(
      createElement(Pane, {
        pane: 'weapon',
        profile: { ...profile, weapon: profile.weapon === null ? null : { ...profile.weapon, verdict } },
        tipOf: () => ({ tabIndex: 0, onMouseMove: () => undefined, onMouseLeave: () => undefined, onFocus: () => undefined, onBlur: () => undefined }),
        hot: null,
        setHot: () => undefined,
        onOpenPiece: () => undefined,
      }),
    )
  expect(weaponPage('Keep it. Its bonuses match her kit.')).toMatch(/class="pf-good">Keep it\./)
  expect(weaponPage('Replace it: a weapon with Crit Rate would serve her better.')).toMatch(/class="pf-bad">Replace it:/)
  expect(weaponPage('Level up: it is at level 70.')).toMatch(/class="pf-mid">Level up:/)
  expect(weaponPage('No verdict yet.')).toMatch(/class="pf-mid">No verdict yet\./)
})

test('a character the card calls he or they is told so on every page of the card, never as her', () => {
  const he = draw({ ...profile, pronouns: { she: 'he', her: 'him', hers: 'his' } })
  expect(he).toContain('Where his 41 substat rolls went')
  expect(he).toContain('His own')
  expect(he).toContain('What his full potential asks for')
  expect(he).toContain('of his full potential')
  expect(he).toContain('How ready he is')
  expect(he).not.toMatch(/\b[Hh]im own\b|\bhim full\b|\bhim card\b/)
  const unowned = { ...profile, owned: false, pieces: [], rolls: [], pronouns: { she: 'they', her: 'them', hers: 'their' } }
  const they = draw(unowned)
  expect(they).toContain('These are the goals of their card.')
  expect(they).toContain('once they are yours')
  expect(they).toContain('How ready they are')
})

test('the planner is one link away, beside the focus button, the two of one size', () => {
  const markup = draw(profile)
  expect(markup).toContain('href="#/characters/sandrone/plan"')
  expect(ruleOf('.pf-btn')).toMatch(/width:\s*150px/)
})

test('a constellation text longer than its row takes two lines, so that the six fit the panel, and shows whole when it is pointed at', () => {
  expect(ruleOf('.pf-cd')).toMatch(/-webkit-line-clamp:\s*2/)
  expect(ruleOf('.pf-cd')).toMatch(/overflow:\s*hidden/)
  const long = { ...profile, constellations: profile.constellations.map((c) => ({ ...c, text: 'A very long text. '.repeat(30) })) }
  const markup = renderToStaticMarkup(
    createElement(Pane, { pane: 'cons', profile: long, tipOf: () => ({ tabIndex: 0, onMouseMove: () => undefined, onMouseLeave: () => undefined, onFocus: () => undefined, onBlur: () => undefined }), hot: null, setHot: () => undefined, onOpenPiece: () => undefined }),
  )
  expect(markup.match(/<li[^>]*tabindex="0"/g)).toHaveLength(6)
})

test('the readiness sheet has her card button beside what to do next, with the pronoun of her card, once a page can open the panel', () => {
  expect(draw(profile)).not.toContain('card</button>')
  const markup = draw(profile, ['sandrone'], () => undefined)
  expect(markup).toMatch(/<h3>What to do next<\/h3><button[^>]*>Her card<\/button>/)
  const they = { ...profile, pronouns: { she: 'they', her: 'them', hers: 'their' } }
  expect(draw(they, ['sandrone'], () => undefined)).toContain('Their card</button>')
})
