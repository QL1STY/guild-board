// The rows come in the address as a JSON list of texts (login.ts: accountLabel); the page sends the number of the row.
const list = document.getElementById('list')
let labels = []
try {
  const value = JSON.parse(new URLSearchParams(location.search).get('labels') ?? '[]')
  if (Array.isArray(value)) labels = value.filter((item) => typeof item === 'string')
} catch (error) {
  labels = []
}
labels.forEach((label, index) => {
  const row = document.createElement('label')
  row.className = 'row'
  const radio = document.createElement('input')
  radio.type = 'radio'
  radio.name = 'account'
  radio.value = String(index)
  radio.checked = index === 0
  const text = document.createElement('span')
  text.textContent = label
  row.append(radio, text)
  row.addEventListener('dblclick', () => window.gbDialog.submit(index))
  list.append(row)
})
const follow = () => {
  const chosen = list.querySelector('input:checked')
  if (chosen !== null) window.gbDialog.submit(Number(chosen.value))
}
document.getElementById('follow').addEventListener('click', follow)
document.getElementById('cancel').addEventListener('click', () => window.gbDialog.cancel())
// As Qt's dialog: Escape cancels, and Enter presses the default button, unless a button has the focus (it presses itself).
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.gbDialog.cancel()
  } else if (event.key === 'Enter' && !(event.target && event.target.tagName === 'BUTTON')) {
    event.preventDefault()
    follow()
  }
})
