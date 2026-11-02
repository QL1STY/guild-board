import { Component, type ReactNode } from 'react'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import type { Page } from '../route.ts'

type Props = {
  /** The page shown, for the rail and the title of the frame that stands in its place. */
  page: Page
  live: Live
  /** When one of these changes, as at another address or at the core's next event, a page that failed is drawn again. */
  again: readonly unknown[]
  children: ReactNode
}

/**
 * Keeps a page that fails as it is drawn to the page area (audit M17): the rail, the top bar and the banners stay, and a
 * plain line says that the page could not be shown. Without it one page that throws, as on an answer it cannot read, would
 * leave the whole window empty, and so would every reload of its address. WidgetBoundary does the same for one widget.
 */
export class PageBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(previous: Props, before: { failed: boolean }): void {
    // Only a page that had failed before this update: the update it failed in is no reason to try again.
    const changed = previous.again.some((value, index) => !Object.is(value, this.props.again[index]))
    if (before.failed && this.state.failed && changed) this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <Frame page={this.props.page} live={this.props.live}>
        <div className="gb-panel gb-empty" role="alert">
          This page could not be shown.
        </div>
      </Frame>
    )
  }
}
