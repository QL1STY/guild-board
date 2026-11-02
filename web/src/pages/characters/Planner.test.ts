import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/planner.json'
import type { Planner as PlannerModel } from '../../types.ts'
import { PlannerView } from './Planner.tsx'
import { draftFromTyped } from './plannerview.ts'
import css from './planner.css?raw'

const model = fixture as unknown as PlannerModel
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of planner.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

const draw = (changed: Partial<PlannerModel> = {}, focus: string[] | null = ['sandrone'], withCard = false) => {
  const shown = { ...model, ...changed }
  return renderToStaticMarkup(
    createElement(PlannerView, {
      model: shown,
      plan: shown.plan,
      piece: draftFromTyped(shown.plan.typed, shown.element),
      focus,
      error: null,
      onPlan: () => undefined,
      onPiece: () => undefined,
      onFocus: () => undefined,
      onReset: () => undefined,
      onHeld: () => undefined,
      onCard: withCard ? () => undefined : undefined,
    }),
  )
}

test('the planner is dark and tinted by her element, with her name big behind the header', () => {
  const markup = draw()
  expect(markup).toContain('pp-card el-cryo')
  expect(markup).toContain('class="pp-giant" aria-hidden="true">Sandrone')
  expect(ruleOf('.pp-giant')).toMatch(/color:\s*transparent/)
})

test('three columns share one height and each spreads its sections across it, with no blank space', () => {
  const markup = draw()
  expect(markup.match(/class="pp-col"/g)).toHaveLength(3)
  expect(ruleOf('.pp-cols')).toMatch(/align-items:\s*stretch/)
  expect(ruleOf('.pp-cols')).toMatch(/grid-template-columns:\s*440px 1fr 392px/)
  expect(ruleOf('.pp-col')).toMatch(/justify-content:\s*space-between/)
  expect(ruleOf('.pp-col')).toMatch(/display:\s*flex/)
})

test('the header says her damage change, her readiness now and with the plan, and today\'s resin', () => {
  const markup = draw()
  expect(markup).toContain('damage against now')
  expect(markup).toContain('89% → 99%')
  expect(markup).toContain('of her full potential')
  expect(markup).toContain('of 200 today')
  const same = draw({ with_plan: { ...model.with_plan, readiness: 89 } })
  expect(same).toMatch(/<b>89%<\/b>/)
})

test('the damage meter is for damage roles, and goals met stand in its place for the others', () => {
  const damage = draw()
  expect(damage).toContain('class="pp-meter"')
  expect(damage).not.toContain('Goals met')
  const support = draw({
    damage_role: false,
    goals_met: [
      { label: 'Energy Recharge', text: '122% of 140%', met: false },
      { label: 'Crit Rate', text: '75% of 60%', met: true },
    ],
  })
  expect(support).not.toContain('class="pp-meter"')
  expect(support).not.toContain('damage against now')
  expect(support).toContain('Goals met')
  expect(support).toContain('122% of 140%')
  expect(support.match(/class="met"/g)).toHaveLength(1)
})

test('the talent she has at its most shows as "the most", and the others as a stepper from now to the target', () => {
  const markup = draw()
  expect(markup).toContain('aria-label="Raise the Normal Attack target"')
  expect(markup).toMatch(/9 → <b class="up">10<\/b>/)
  expect(markup.match(/the most/g)).toHaveLength(2)
  // The target is at its most, so its raising button rests and its lowering one does not.
  expect(markup).not.toMatch(/aria-label="Lower the Normal Attack target" disabled=""/)
  expect(markup).toMatch(/aria-label="Raise the Normal Attack target" disabled=""/)
})

test('the level, refinement and weapon level steppers start from her build now, and rest at it', () => {
  const now = { level: 80, refinement: 3, weapon_level: 70 }
  const plan = { ...model.plan, level: 80, refinement: 3, weapon_level: 70 }
  const markup = draw({ now_build: now, plan })
  expect(markup).toMatch(/aria-label="Lower the level target" disabled=""/)
  expect(markup).toMatch(/80 → <b[^>]*>80<\/b>/)
  expect(markup).toMatch(/aria-label="Lower the refinement" disabled=""/)
  expect(markup).toMatch(/3 → <b[^>]*>3<\/b>/)
  expect(markup).toMatch(/aria-label="Lower the weapon level target" disabled=""/)
  expect(markup).toMatch(/70 → <b[^>]*>70<\/b>/)
  expect(markup).not.toMatch(/aria-label="Raise the weapon level target" disabled=""/)
})

test('a character who is not owned keeps the steppers from the start, and her weapon level is still editable', () => {
  const plan = { ...model.plan, level: 50, refinement: 2, weapon_level: 40 }
  const markup = draw({ now_build: null, plan })
  expect(markup).not.toMatch(/aria-label="Lower the level target" disabled=""/)
  expect(markup).not.toMatch(/aria-label="Lower the weapon level target" disabled=""/)
  expect(markup).not.toMatch(/aria-label="Lower the refinement" disabled=""/)
  expect(markup).not.toMatch(/\d+ → <b[^>]*>50<\/b>/)
  expect(markup).toMatch(/<b>40<\/b>/)
})

test('the four chips of the header are one width, so the readiness one is as wide as its neighbours', () => {
  const width = (selector: string) => /(?:^|;|\s)width:\s*(\d+px)/.exec(ruleOf(selector))?.[1]
  expect(width('.pp-chip')).toBeDefined()
  expect(width('.pp-focus')).toBe(width('.pp-chip'))
})

test("a long list of sets shows the card's only, with a button for every set", () => {
  const many = Array.from({ length: 63 }, (_, index) => ({ key: `set-${index}`, name: `Set ${index}`, icon: null, text: 'a set', tag: index === 0 ? 'Hers' : null }))
  const markup = draw({ sets: many, plan: { ...model.plan, set: { sets: ['set-0'], pieces: '4' as const } } })
  expect(markup.match(/class="pp-set"/g)).toHaveLength(1)
  expect(markup).toContain('Show every set, 63 in all')
  expect(ruleOf('.pp-sets.all')).toMatch(/max-height:\s*\d+px/)
})

test('the weapon list starts with the one she has, tagged, and its choice is the plan\'s', () => {
  const markup = draw()
  const list = /<div class="pp-list-in"[\s\S]*?<\/div><\/div>/.exec(markup)?.[0] ?? ''
  expect(list.match(/role="option"/g)).toHaveLength(4)
  expect(list.indexOf('A Teaspoon of Transcendence')).toBeLessThan(list.indexOf('Verdict'))
  expect(list).toContain('<em>Hers</em>')
  expect(list).toMatch(/aria-selected="true"[^>]*><span class="pic pp-pic/)
  // The list starts closed and out of reach of the keyboard.
  expect(markup).toMatch(/class="pp-list" id="pp-wlist" inert=""/)
})

test('each main stat has its chips, the one she wears now marked, and the plan\'s chosen one pressed', () => {
  const markup = draw()
  const goblet = /Goblet<\/span><div class="pp-seg">[\s\S]*?<\/div>/.exec(markup)?.[0] ?? ''
  expect(goblet).toMatch(/aria-pressed="true">Cryo DMG Bonus/)
  expect(goblet).toMatch(/class="now" aria-pressed="false">ATK %/)
  expect(ruleOf(".pp-seg button.now:not([aria-pressed='true'])::after")).toMatch(/content:\s*' now'/)
})

test('a piece below +20 has a switch for levelling it, on as the plan has it', () => {
  const markup = draw()
  expect(markup).toMatch(/role="switch" aria-checked="true" class="pp-toggle"/)
  expect(markup).toContain('Level the Plume from +16 to +20')
})

test('every stat shows now, a bar with its marks, the plan and the change, and the change reads up, down or none', () => {
  const markup = draw()
  expect(markup.match(/class="pp-srow"/g)).toHaveLength(8)
  expect(markup).toContain('class="dl down">−420')
  expect(markup).toContain('class="dl up">+0.8')
  expect(markup).toContain('class="dl same">no change')
  expect(markup.match(/<i class="g"/g)).toHaveLength(5) // atk, cr, cd, dmg and er have goals
})

test('a warning shows only when the core gives one', () => {
  expect(draw()).not.toContain('pp-warn')
  expect(draw({ warning: 'In combat her Crit Rate reaches 104.2%: 4.2% is wasted. Crit DMG would serve her better.' })).toContain('4.2% is wasted')
})

test('"Try a piece" has its fields, shows what the core says of the piece, and an "Use it in her plan" switch', () => {
  const markup = draw()
  expect(markup).toContain('Try a piece you got')
  expect(markup.match(/aria-label="Substat \d"/g)).toHaveLength(4)
  expect(markup).toContain('<b>28</b><span>crit value</span>')
  expect(markup).toContain('6 of 6')
  expect(markup).toContain('+9%')
  expect(markup).toContain("against the plan&#x27;s goblet")
  expect(markup).toMatch(/role="switch" aria-checked="false" class="pp-use" disabled=""/) // nothing typed yet, so nothing to use
})

test('a typed piece that is in the plan marks the box as used, and its switch can be pressed', () => {
  const plan = { ...model.plan, typed: { slot: 'goblet' as const, main: 'dmg', subs: [['cr', 7], ['cd', 14]] as [string, number][], use: true } }
  const markup = draw({ plan })
  expect(markup).toContain('class="pp-try used"')
  expect(markup).toMatch(/role="switch" aria-checked="true" class="pp-use"/)
  expect(markup).not.toMatch(/class="pp-use" disabled/)
})

test('without Your week the planner has no What it takes, no resin of today and no focus, and its two columns fill the page', () => {
  const markup = renderToStaticMarkup(
    createElement(PlannerView, {
      model, plan: model.plan, piece: draftFromTyped(model.plan.typed, model.element), error: null, focus: ['sandrone'],
      onPlan: () => undefined, onPiece: () => undefined, onReset: () => undefined, onFocus: () => undefined, onHeld: () => undefined,
      takesShown: false,
    }),
  )
  expect(markup).not.toContain('What it takes')
  expect(markup).not.toContain('Add to your focus')
  expect(markup).not.toContain('In your focus')
  expect(markup).not.toMatch(/of 200 today/)
  expect(markup).toContain('pp-cols two')
  expect(css).toMatch(/\.pp-cols\.two\s*\{[^}]*grid-template-columns:\s*440px 1fr/)
})

test('what it takes names the resin it costs today and where the pieces come from', () => {
  const markup = draw()
  expect(markup).toContain('Today her book domain is open.')
  expect(markup).toContain('Her book, 6 runs: 120')
  expect(markup).toContain('The rest: 10')
  expect(markup).toContain('About 1 in 181 runs')
  expect(markup).toContain('Sanctifying Elixir')
  expect(markup).toMatch(/class="best"><span>Sanctifying Elixir[^<]*<\/span><b>Certain/)
})

test('with the calculator\'s sync off the materials take what is typed, and the page says how to switch it on', () => {
  const off = draw({ sync: { ...model.sync, calculator: 'off' } })
  expect(off).toContain("Calculator sync is off in HoYoLAB, so Guild Board can&#x27;t see what you hold.")
  expect(off.match(/aria-label="Amount of [^"]+ you hold"/g)).toHaveLength(5)
  expect(draw()).not.toContain('aria-label="Amount of')
})

test('with nothing to find the box says so in one plain line, never an empty one', () => {
  const none = draw({ takes: { ...model.takes, find: [] } })
  expect(none).toContain('Nothing to find')
  expect(none).toContain('main stats already match the plan.')
  expect(none).toContain('Ready today')
})

test('the days curve has its two marks with the core\'s dates, and its summary', () => {
  const markup = draw()
  expect(markup).toContain('Half a chance, Sun 8 Nov')
  expect(markup).toContain('Nine in ten, Thu 10 Dec')
  expect(markup).toContain('<b>half a chance by Sun 8 Nov</b>')
  expect(markup.match(/class="mark"/g)).toHaveLength(2)
})

test('a character the card calls he or they has his or their plan, never her', () => {
  const he = draw({ pronouns: { she: 'he', her: 'him', hers: 'his' } })
  for (const words of ['His plan', 'Back to his card&#x27;s plan', 'Use it in his plan', 'His goal', 'of his full potential', 'Substats he wants', 'on his profile']) {
    expect(he).toContain(words)
  }
  expect(he).not.toMatch(/\b[Hh]im (plan|card|goal|full|profile)\b/)
  const they = draw({ pronouns: { she: 'they', her: 'them', hers: 'their' }, takes: { ...model.takes, find: [] } })
  expect(they).toContain('Substats they want')
  expect(they).toContain('rolls they want')
  expect(they).toContain('Their main stats already match the plan.')
})

test('the focus button says whether she is in the focus and how many are', () => {
  expect(draw({}, ['sandrone', 'odette'])).toMatch(/aria-pressed="true"[^>]*><b>In your focus<\/b><span>2 of 4 characters/)
  expect(draw({}, ['odette'])).toMatch(/aria-pressed="false"[^>]*><b>Add to your focus<\/b><span>1 of 4 characters/)
})

test('the header has her card button, which opens the Card panel, with the pronoun of her card', () => {
  expect(draw()).not.toContain('card</button>')
  expect(draw({}, ['sandrone'], true)).toMatch(/<button[^>]*class="pp-cardbtn"[^>]*>Her card<\/button>/)
  expect(draw({ pronouns: { she: 'they', her: 'them', hers: 'their' } }, ['sandrone'], true)).toContain('Their card</button>')
})
