import '../styles/achievements.css'

/**
 * A count between the − and the + that change it (the look pass: a number beside an action moves with it or is changed
 * there), the step buttons of the Achievements page (achievements.css, .ach-step: round, 26 pixels, one size) in the
 * widgets' colours (widgets.css, .steps). The view sends the change: `set` is given the count that a press asks for. At 0
 * the − does nothing and keeps the focus (aria-disabled, as the card's does, where disabled would drop the focus to the
 * page). `text` is the count as the widget says it ("37 of 50 kills"); `className` is the place's own, such as the One
 * timer's, which sets where the steps stand. An achievement's card and a timer's on the Achievements page show it too
 * (AchievementCard.tsx, TimerCard.tsx), where the buttons' data-focus lets the page keep the keyboard's place. While the
 * Timers category rests after a change (`resting`), a press sends nothing, as its other buttons'.
 */
export function CountSteps({
  value,
  text,
  set,
  className,
  resting = false,
}: {
  value: number
  text: string
  set: (next: number) => void
  className?: string
  resting?: boolean
}) {
  return (
    <div className={className === undefined ? 'steps' : `steps ${className}`}>
      <button
        type="button"
        className="ach-step"
        aria-label="Count down"
        data-focus="count-down"
        aria-disabled={resting || value <= 0}
        onClick={() => {
          if (!resting && value > 0) set(value - 1)
        }}
      >
        −
      </button>
      <b>{text}</b>
      <button
        type="button"
        className="ach-step"
        aria-label="Count up"
        data-focus="count-up"
        aria-disabled={resting || undefined}
        onClick={() => {
          if (!resting) set(value + 1)
        }}
      >
        +
      </button>
    </div>
  )
}
