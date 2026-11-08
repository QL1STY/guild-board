// The bar under the login and verification windows' pages. What it says comes in the address (frame.ts); a press goes to
// the shell as the word "paste" or "retry".
const query = new URLSearchParams(location.search)
const message = query.get('message')
if (message) {
  document.getElementById('message-text').textContent = message
  document.getElementById('message').hidden = false
  document.getElementById('retry').hidden = query.get('retry') !== '1'
}
const note = query.get('note')
if (note) {
  document.getElementById('note').textContent = note
  document.getElementById('note').hidden = false
}
const service = query.get('service')
if (service) {
  document.getElementById('service-text').textContent = service
  document.getElementById('service').hidden = false
}
document.getElementById('retry').addEventListener('click', () => window.gbDialog.submit('retry'))
document.getElementById('paste').addEventListener('click', () => window.gbDialog.submit('paste'))
