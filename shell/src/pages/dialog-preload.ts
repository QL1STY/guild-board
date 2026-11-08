/**
 * The shell's only bridge, loaded only into windows of the in-memory partition `gb-dialog`, which show Guild Board's own
 * pages from the app's `pages` folder: `window.gbDialog = { submit(value), cancel() }`. It sends a string or a number to the
 * shell and nothing comes back. The channel names are dialog.ts's SUBMIT_CHANNEL and CANCEL_CHANNEL (a sandboxed preload
 * cannot load another file, so they are written again here; dialog.test.ts checks that they agree).
 */
;(() => {
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
  contextBridge.exposeInMainWorld('gbDialog', {
    submit: (value: string | number): void => {
      if (typeof value === 'string' || typeof value === 'number') ipcRenderer.send('gb-dialog:submit', value)
    },
    cancel: (): void => {
      ipcRenderer.send('gb-dialog:cancel')
    },
  })
})()
