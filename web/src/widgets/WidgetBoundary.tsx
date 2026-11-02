import { Component, type ReactNode } from 'react'

type Props = {
  /** What the widget shows from: when one of them changes, as at the core's next event, a failed widget tries again. */
  again: readonly unknown[]
  children: ReactNode
}

/**
 * Keeps a widget that fails as it is drawn to its own frame: it says so, and the rest of the page stays. Without it,
 * one widget would leave the whole window empty, and the Board is the page Guild Board opens on.
 */
export class WidgetBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(previous: Props, before: { failed: boolean }): void {
    // Only a widget that had failed before this update: the update it failed in is no reason to try again.
    const changed = previous.again.some((value, index) => !Object.is(value, this.props.again[index]))
    if (before.failed && this.state.failed && changed) this.setState({ failed: false })
  }

  render(): ReactNode {
    return this.state.failed ? <p className="wid-line">This widget could not be shown.</p> : this.props.children
  }
}
