// The steps come in the address (login.ts: PASTE_STEPS); the pasted text goes to the shell and is cleared from the page.
const box = document.getElementById('box')
document.getElementById('steps').textContent = new URLSearchParams(location.search).get('steps') ?? ''
document.getElementById('use').addEventListener('click', () => {
  const text = box.value
  box.value = ''
  window.gbDialog.submit(text)
})
document.getElementById('cancel').addEventListener('click', () => window.gbDialog.cancel())
// Escape cancels, as in Qt's dialog. Enter stays a new line in the box.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.gbDialog.cancel()
})
box.focus()
