/** One send of a note: its text, and its number among the sends, so that a failure can tell whether a newer one went after it. */
export type NoteSend = { readonly text: string; readonly number: number }

/**
 * The text of a Notes widget that the core does not have yet: typed and not sent, or sent and not kept. A send takes it;
 * a send that failed gives it back, unless something was typed or sent after it, so a failure never puts older text over
 * newer and what goes again is the newest. The widget sends what is pending half a second after typing stops, when the
 * field is left, at the core's next event, and as the widget or the page goes, so a note the core refused once is not
 * lost (audit M16).
 */
export function noteSave(): {
  typed(text: string): void
  pending(): string | null
  take(): NoteSend | null
  failed(send: NoteSend): void
} {
  let text: string | null = null
  let sends = 0
  return {
    typed(next) {
      text = next
    },
    pending: () => text,
    take() {
      if (text === null) return null
      const send = { text, number: (sends += 1) }
      text = null
      return send
    },
    failed(send) {
      if (text === null && send.number === sends) text = send.text
    },
  }
}
