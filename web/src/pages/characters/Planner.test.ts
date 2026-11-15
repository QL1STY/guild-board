import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import damageKits from '../../fixtures/damage-kits.json'
import fixture from '../../fixtures/characters/planner.json'
import type { PlannerHits, Planner as PlannerModel } from '../../types.ts'
import { noChoice } from './damage.ts'
import { PlannerView } from './Planner.tsx'
import { Counted } from './Verdict.tsx'
import css from './planner.css?raw'

const model = fixture as unknown as PlannerModel
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of planner.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

const draw = (changed: Partial<PlannerModel> = {}, withCard = false) => {
  const shown = { ...model, ...changed }
  return renderToStaticMarkup(
    createElement(PlannerView, { model: shown, plan: shown.plan, error: null, onPlan: () => undefined, onCard: withCard ? () => undefined : undefined }),
  )
}

test('the planner is dark and tinted by her element, with her name big behind the header', () => {
  const markup = draw()
  expect(markup).toContain('pp-card el-cryo')
  expect(markup).toContain('class="pp-giant" aria-hidden="true">Sandrone')
  expect(ruleOf('.pp-giant')).toMatch(/color:\s*transparent/)
})

test('three columns: her build, her artifacts and her stats, each as tall as its own parts', () => {
  const markup = draw()
  expect(markup.match(/class="pp-col"/g)).toHaveLength(3)
  expect(ruleOf('.pp-cols')).toMatch(/grid-template-columns:\s*360px 1fr 380px/)
  expect(ruleOf('.pp-cols')).toMatch(/grid-template-columns/)
})

test("the header says the set's Crit Value in its tier, and the ATK change of the tested pieces until the verdict comes", () => {
  const markup = draw()
  expect(markup).toContain('<b class="pp-cvtotal t0">130.6</b><span>Crit Value of her artifacts</span>')
  expect(markup).toContain('Stats with the tested pieces')
  expect(markup).toContain('<b class="same">No change</b>')
  for (const gone of ['damage against now', 'of her full potential', 'resin', 'focus']) expect(markup).not.toContain(gone)
})

test('the five pieces show their slot and level, their main stat and their Crit Value in its tier', () => {
  const markup = draw()
  expect(markup.match(/class="pp-piece"/g)).toHaveLength(5)
  const flower = /data-slot="flower"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? ''
  expect(flower).toContain('Flower · +20')
  expect(flower).toMatch(/<span class="pp-cv t3">42\.8 <small>CV<\/small><\/span>/)
  expect(/data-slot="plume"[\s\S]*?<\/button>/.exec(markup)?.[0]).toContain('Plume · +16')
  expect(markup).toContain('under 15')
  expect(markup).toContain('whole set: 180 · 200 · 220 · 240 · 260 · 300')
  expect(markup).not.toContain('class="tested"') // nothing is tested yet
})

test('the weapon and the set are tiles that open a picker, and the set says its effects', () => {
  const markup = draw()
  expect(markup).toContain('data-open="weapon"')
  expect(markup).toContain('A Teaspoon of Transcendence')
  expect(markup).toContain('Level 90 · R1 · Base ATK 674 · Crit DMG 44.1%')
  expect(markup).toContain('data-open="set"')
  expect(markup).toContain('5 of 5 pieces')
  expect(markup).toContain('<b>2 pieces:</b> Demo text for the 2-piece bonus.')
  expect(markup).toContain('<b>4 pieces:</b> Demo text for the 4-piece bonus.')
})

test('her stats are a table of now, tested and change, with nothing changed before a test', () => {
  const markup = draw()
  expect(markup.match(/<tr data-stat=/g)).toHaveLength(8)
  expect(markup).toContain('<th>Tested</th>')
  expect(markup).toContain('<td>2,964</td>')
  expect(markup.match(/<tr data-stat="[a-z]+" class="same">/g)).toHaveLength(8)
  expect(markup).toContain('Cryo DMG Bonus')
})

test('the talent she has at its most shows as "the most", the others as a stepper, and a talent near her highest has "Raise"', () => {
  const markup = draw()
  expect(markup).toContain('aria-label="Raise the Normal Attack target"')
  expect(markup).toMatch(/9 → <b class="up">10<\/b>/)
  expect(markup.match(/the most/g)).toHaveLength(2)
  expect(markup.match(/class="pp-raise"/g)).toHaveLength(1)
  expect(/Normal Attack<span class="pp-raise">Raise<\/span>/.test(markup)).toBe(true)
  // The target is at its most, so its raising button rests and its lowering one does not.
  expect(markup).not.toMatch(/aria-label="Lower the Normal Attack target" disabled=""/)
  expect(markup).toMatch(/aria-label="Raise the Normal Attack target" disabled=""/)
})

test('the level stepper starts from her build now, and rests at it', () => {
  const plan = { ...model.plan, level: 80 }
  const markup = draw({ now_build: { level: 80, constellation: 0, refinement: 3, weapon_level: 70 }, plan })
  expect(markup).toMatch(/aria-label="Lower the level target" disabled=""/)
  expect(markup).toMatch(/80 → <b[^>]*>80<\/b>/)
})

test("the header line has her element, weapon type, level and constellation, and the weapon's two targets step from her build", () => {
  const markup = draw()
  expect(markup).toContain('Cryo · Claymore · Level 90 · C2 · her build on HoYoLAB')
  const plan = { ...model.plan, refinement: 3, weapon_level: 70 }
  const stepped = draw({ now_build: { level: 90, constellation: 2, refinement: 3, weapon_level: 70 }, plan })
  expect(stepped).toMatch(/aria-label="Lower the refinement" disabled=""/)
  expect(stepped).toMatch(/3 → <b[^>]*>3<\/b>/)
  expect(stepped).toMatch(/aria-label="Lower the weapon level target" disabled=""/)
  expect(stepped).toMatch(/70 → <b[^>]*>70<\/b>/)
  expect(stepped).not.toMatch(/aria-label="Raise the weapon level target" disabled=""/)
})

test('a character who is not owned has her talent targets and no pieces to test', () => {
  const markup = draw({ now_build: null, sim: null })
  expect(markup).toContain('is not on your account yet, so there are no artifacts to test')
  expect(markup).not.toContain('pp-piece')
  expect(markup).not.toContain('pp-chip')
  expect(markup).not.toContain('Raise</span>')
  expect(markup).toContain('aria-label="Lower the Normal Attack target"')
})

test('the old parts are gone: main stats, a piece to try, what it takes, the days and the focus', () => {
  const markup = draw()
  for (const gone of ['Main stats', 'Try a piece you got', 'What it takes', 'Days to ready', 'Goals met', 'Substats', 'Add to your focus', 'pp-meter', 'pp-days']) {
    expect(markup).not.toContain(gone)
  }
})

test('a character the card calls he or they has his or their build, never her', () => {
  const he = draw({ pronouns: { she: 'he', her: 'him', hers: 'his' } })
  for (const words of ['His build', 'Back to his piece', 'Crit Value of his artifacts', 'on HoYoLAB']) expect(he).toContain(words)
  expect(he).not.toMatch(/\b[Hh]im (build|piece|card|artifacts)\b/)
  const they = draw({ pronouns: { she: 'they', her: 'them', hers: 'their' } })
  expect(they).toContain('Their build')
  expect(they).toContain('Back to their piece')
})

test('the header has her card button, which opens the Card panel, with the pronoun of her card', () => {
  expect(draw()).not.toContain('card</button>')
  expect(draw({}, true)).toMatch(/<button[^>]*class="pp-cardbtn"[^>]*>Her card<\/button>/)
  expect(draw({ pronouns: { she: 'they', her: 'them', hers: 'their' } }, true)).toContain('Their card</button>')
})

test('the three columns stretch to one height, and what is in them keeps its own size, with the closing note at the foot', () => {
  expect(ruleOf('.pp-cols')).toMatch(/align-items:\s*stretch/)
  expect(ruleOf('.pp-stats')).toMatch(/flex:\s*none/)
  expect(ruleOf('.pp-col > .pp-note:last-child')).toMatch(/margin-top:\s*auto/)
  expect(ruleOf('.pp-editor')).not.toMatch(/flex:\s*1/)
  expect(ruleOf('.pp-edhead.top')).toMatch(/flex-wrap:\s*nowrap/)
})

test('the pickers are a dialog fixed over the page, so that the page never changes height for them', () => {
  expect(ruleOf('.pp-card.pp-scrim')).toMatch(/position:\s*fixed/)
  expect(ruleOf('.pp-card.pp-scrim')).toMatch(/inset:\s*0/)
  expect(ruleOf('.pp-modal')).toMatch(/max-height:\s*82vh/)
})

test('with the verdict on, the right column has the verdict, a row per main talent, what is counted and her stats; off, none of it', () => {
  const hits = structuredClone(damageKits.kits.sandrone) as unknown as PlannerHits
  const withHits: PlannerModel = { ...model, sim: { ...model.sim!, hits, tables: { ...model.sim!.tables, ...damageKits.tables } } as PlannerModel['sim'] }
  const render = (verdict: boolean) =>
    renderToStaticMarkup(createElement(PlannerView, { model: withHits, plan: withHits.plan, error: null, verdict, onPlan: () => undefined }))
  const on = render(true)
  expect(on).toContain('class="pp-verdict"')
  expect(on).toContain('No change') // nothing is tested yet
  expect(on).toContain('nothing tested yet')
  expect(on.match(/class="pp-tal"/g)).toHaveLength(3)
  expect(on).toContain('Stellar-Conduct')
  expect(on).toContain('Recorded hits')
  expect(on).toContain('Counted:')
  expect(on).toContain('Polestar field')
  expect(on.indexOf('class="pp-verdict"')).toBeLessThan(on.indexOf('class="pp-tals"'))
  expect(on.indexOf('class="pp-counted"')).toBeLessThan(on.indexOf('class="pp-stats"'))
  const off = render(false)
  for (const gone of ['pp-verdict', 'pp-tal', 'pp-counted', 'Recorded hits']) expect(off).not.toContain(gone)
  expect(off).toContain('Stats with the tested pieces')
  // The core's switch on but no hits for her: stage 1's page
  const noHits: PlannerModel = { ...model, sim: { ...model.sim!, hits: null } }
  const stage1 = renderToStaticMarkup(createElement(PlannerView, { model: noHits, plan: noHits.plan, error: null, verdict: true, onPlan: () => undefined }))
  expect(stage1).not.toContain('pp-verdict')
  expect(stage1).toContain('Stats with the tested pieces')
})

test('the Counted line has one Not counted list of switches, each pressed to count it, with a hint only while it has chips', () => {
  const draw1 = (off: { name: string; label: string; with: string[] }[]) =>
    renderToStaticMarkup(createElement(Counted, { line: { fixed: [], on: [{ name: 'A', label: 'Paramita Papilio' }], off }, choice: noChoice(), onChoice: () => undefined }))
  const html = draw1([{ name: 'B', label: 'HP below 50%', with: ['B'] }])
  expect(html).toContain('Not counted:')
  expect(html).not.toContain('Left out')
  expect(html).toContain('title="Not counted. Press to count it."')
  expect(html).toContain('aria-pressed="false"')
  expect(html).toContain('Press one to count it.')
  const none = draw1([])
  expect(none).not.toContain('Not counted')
  expect(none).not.toContain('Press one to count it.')
})

test('a Not counted list of more than three effects folds into one line that names how many', () => {
  const off = ['A', 'B', 'C', 'D'].map((name) => ({ name, label: `Effect ${name}`, with: [name] }))
  const draw = (list: typeof off) =>
    renderToStaticMarkup(createElement(Counted, { line: { fixed: [], on: [], off: list }, choice: noChoice(), onChoice: () => undefined }))
  const long = draw(off)
  expect(long).toContain('4 effects. Show them')
  expect(long).not.toContain('Effect A')
  expect(long).not.toContain('Press one to count it.')
  const short = draw(off.slice(0, 3))
  expect(short).toContain('Effect C')
  expect(short).not.toContain('Show them')
})
