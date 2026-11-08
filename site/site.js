/* Guild Board's site. No framework and no build step. It does three things: the small working Board and the Windows warning
   (both made up, they change nothing), the tabs of the pictures, and one read of GitHub's public API in the visitor's own browser
   for the latest release, whose version, size and SHA-256 it shows. The read sends nothing of the visitor's. */
'use strict';

var RELEASES = 'QL1STY/guild-board-releases';
var SOURCE = 'QL1STY/guild-board';
var SETUP = /^Guild[ .]Board[ .]Setup(?:[ .](.*))?\.exe$/i;

/**
 * What a release from GitHub's API says about its installer, or null when it says nothing a visitor can rely on: the setup
 * asset's name, its size and its SHA-256 (the asset's `digest`), and the version. Each part GitHub did not give is null, never
 * a guess, so that the page shows no number rather than a wrong one.
 */
function releaseFacts(release) {
  if (!release || typeof release !== 'object' || !Array.isArray(release.assets)) return null;
  var asset = null;
  for (var i = 0; i < release.assets.length; i += 1) {
    var one = release.assets[i];
    if (one && typeof one.name === 'string' && SETUP.test(one.name)) { asset = one; break; }
  }
  if (!asset) return null;
  var named = SETUP.exec(asset.name)[1] || '';
  var tag = typeof release.tag_name === 'string' ? /^v?(\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?)$/.exec(release.tag_name) : null;
  var version = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/.test(named) ? named : tag ? tag[1] : null;
  var bytes = typeof asset.size === 'number' && asset.size > 0 ? asset.size : null;
  var digest = typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest) : null;
  return {
    name: asset.name,
    version: version,
    size: bytes === null ? null : Math.round(bytes / 1048576) + ' MB',
    sha256: digest ? digest[1].toLowerCase() : null,
    verify: 'gh attestation verify "' + asset.name + '" -R ' + SOURCE,
  };
}

/**
 * The item the rail marks, by its place in the rail from 0: the last section whose top has passed a line a third of the way
 * down the window; the first while the page is at its very top, and the last once the page cannot scroll any further, where
 * the last section is too short for its top to reach the line. `tops` are the sections' tops from the top of the window, in
 * the rail's order; `scrolled` is how far the page is scrolled, `view` the window's height and `page` the page's.
 */
function markedSection(tops, scrolled, view, page) {
  if (scrolled < 1) return 0;
  if (scrolled + view >= page - 2) return tops.length - 1;
  var at = 0;
  for (var i = 0; i < tops.length; i += 1) if (tops[i] <= view / 3) at = i;
  return at;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { releaseFacts: releaseFacts, markedSection: markedSection };

if (typeof document !== 'undefined') (function () {
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function show(selector, text) {
    all(selector).forEach(function (node) {
      if (text !== undefined) node.textContent = text;
      node.hidden = false;
    });
  }

  // The latest release, from GitHub's public API. The buttons already point to the releases page and work without this;
  // when the request fails, nothing here changes and the page shows no version, size or hash.
  function fillRelease(facts) {
    if (!facts) return;
    show('[data-release="name"]', facts.name);
    if (facts.size) {
      show('[data-release="size"]', facts.size);
      show('[data-release="size-facts"]', ', ' + facts.size);
    }
    if (facts.version) all('[data-release-label]').forEach(function (node) { node.textContent = 'Download Guild Board ' + facts.version; });
    all('[data-release="verify"]').forEach(function (node) { node.textContent = facts.verify; });
    if (facts.sha256) {
      all('[data-release="sha"]').forEach(function (node) { node.textContent = facts.sha256; });
      show('[data-release="hash"]');
    }
    var line = document.querySelector('[data-release="line"]');
    if (line && (facts.version || facts.sha256)) {
      line.textContent = '';
      if (facts.version) line.appendChild(document.createTextNode('Version ' + facts.version + '. '));
      if (facts.sha256) {
        line.appendChild(document.createTextNode('SHA-256 '));
        var code = document.createElement('code');
        code.textContent = facts.sha256;
        line.appendChild(code);
        line.appendChild(document.createTextNode('.'));
      }
      line.hidden = false;
    }
  }
  if (typeof fetch === 'function') {
    var wait = typeof AbortController === 'function' ? new AbortController() : null;
    var giveUp = wait ? setTimeout(function () { wait.abort(); }, 8000) : 0;
    fetch('https://api.github.com/repos/' + RELEASES + '/releases/latest', wait ? { signal: wait.signal } : {})
      .then(function (answer) { return answer.ok ? answer.json() : null; })
      .then(function (release) { fillRelease(releaseFacts(release)); })
      .catch(function () { /* the link works; the page shows no number */ })
      .then(function () { clearTimeout(giveUp); });
  }

  // The game's icons on the hero's Board come from HoYoverse; one that does not load gives way to its drawn sign.
  all('.game-icon').forEach(function (icon) {
    function gone() { icon.parentNode.classList.add('no-icon'); }
    if (icon.complete && icon.naturalWidth === 0) gone();
    else icon.addEventListener('error', gone);
  });

  // The hero's Board: a made-up month of check-ins, the whole month as the app shows it, with the rewards of the app's demo
  // (a primogem's 20, mora's 5,000 and so on, in turn), and commissions to tick.
  var AMOUNTS = ['20', '5,000', '3', '3', '20', '5', '10,000'];
  var days = document.getElementById('days');
  var tile = document.getElementById('day').content.firstElementChild;
  var count = 11;
  for (var i = 1; i <= 30; i += 1) {
    var d = tile.cloneNode(true);
    if (i <= count) d.classList.add('got');
    else if (i === count + 1) d.classList.add('now');
    d.querySelector('.day-n').textContent = i;
    d.querySelector('.day-x').textContent = '×' + AMOUNTS[(i - 1) % AMOUNTS.length];
    days.appendChild(d);
  }
  var check = document.getElementById('check');
  var prize = document.getElementById('prize');
  document.getElementById('claim').addEventListener('click', function (event) {
    event.currentTarget.hidden = true;
    document.getElementById('claim-note').hidden = false;
    check.classList.add('claimed', 'fresh');
    document.getElementById('check-count').textContent = '12 of 30';
    days.children[count].className = 'day got';
    for (var k = 0; k < 12; k += 1) {
      var s = document.createElement('i');
      s.className = 'spark';
      s.style.setProperty('--turn', k / 12 + 'turn');
      s.style.setProperty('--far', (k % 2 ? 66 : 84) + 'px');
      prize.appendChild(s);
    }
    var g = document.createElement('span');
    g.className = 'gain';
    g.textContent = '+20';
    prize.appendChild(g);
    setTimeout(function () { all('#prize .spark, #prize .gain').forEach(function (n) { n.remove(); }); }, 1500);
  });

  // The Windows warning, a picture that can be clicked through.
  var more = document.getElementById('more');
  var smartText = document.getElementById('smart-text');
  more.addEventListener('click', function () {
    more.hidden = true;
    smartText.textContent = 'App: ' + (document.querySelector('[data-release="name"]').textContent || 'Guild Board Setup');
    var run = document.createElement('button');
    run.className = 'key run';
    run.type = 'button';
    run.textContent = 'Run anyway';
    run.addEventListener('click', function () {
      document.getElementById('keys').textContent = '';
      smartText.textContent = 'That is all. The installer opens next.';
      smartText.className = 'ok';
    });
    document.getElementById('keys').prepend(run);
    run.focus();
  });

  var tasks = all('.task');
  tasks.forEach(function (t) {
    t.addEventListener('click', function () {
      t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      var done = all('.task[aria-pressed="true"]').length;
      document.getElementById('done').textContent = done + ' of 3 today';
    });
  });

  // The pictures of the pages: tabs, with the arrow keys moving between them.
  var shot = document.getElementById('shot');
  var panel = document.getElementById('shot-panel');
  var pane = document.getElementById('shot-pane');
  var note = document.getElementById('tab-note');
  var tabs = all('.tab');
  function select(tab, focus) {
    tabs.forEach(function (other) {
      var on = other === tab;
      other.setAttribute('aria-selected', on ? 'true' : 'false');
      other.tabIndex = on ? 0 : -1;
    });
    shot.src = tab.dataset.src;
    shot.alt = tab.dataset.alt;
    panel.setAttribute('aria-labelledby', tab.id);
    var about = tab.querySelector('small');
    note.textContent = about ? about.textContent : '';
    pane.scrollLeft = 0; // a new picture is read from its left edge
    if (focus) tab.focus();
    else if (tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the chip stays in the row's view
  }
  tabs.forEach(function (tab, at) {
    tab.addEventListener('click', function () { select(tab, false); });
    tab.addEventListener('keydown', function (event) {
      var to = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? at + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? at - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (to === null) return;
      event.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
  });

  // Pressing the picture opens it at its own size, in a dialog that scrolls both ways, at every width.
  var dialog = document.getElementById('shot-dialog');
  var big = document.getElementById('shot-big');
  document.getElementById('zoom').addEventListener('click', function () {
    big.src = shot.src;
    big.alt = shot.alt;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.querySelector('.dialog-pane').scrollTo(0, 0);
  });
  function closeDialog() { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }
  document.getElementById('shot-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });

  // The question about checking the file opens when a link to it is followed.
  function openAnswer() {
    var target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    if (target && target.tagName === 'DETAILS') target.open = true;
  }
  window.addEventListener('hashchange', openAnswer);
  openAnswer();

  // The rail marks the section on screen (markedSection), looked at once a frame at most while the page scrolls. A click
  // marks its item at once, and the item stays marked while the page scrolls to it: Get it, say, on a screen tall enough
  // to show Questions as well. The visitor's next scroll moves the mark again.
  var links = all('.rail nav a');
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  function mark(at) {
    links.forEach(function (a, i) {
      if (i === at) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  var queued = false;
  function look() {
    queued = false;
    var tops = sections.map(function (section) { return section.getBoundingClientRect().top; });
    // The window's height as it is now: on a phone whose toolbar folds away while the page scrolls, the height the page
    // reports for itself stays the smaller one, and the bottom would never be reached.
    mark(markedSection(tops, window.scrollY, window.innerHeight, document.documentElement.scrollHeight));
  }
  var hold = null; // while a click's own scroll runs: the timer that lets go once the page has been still a moment
  function holdOn() {
    clearTimeout(hold);
    hold = setTimeout(function () { hold = null; }, 200);
  }
  window.addEventListener('scroll', function () {
    if (hold !== null) holdOn();
    else if (!queued) {
      queued = true;
      requestAnimationFrame(look);
    }
  }, { passive: true });
  links.forEach(function (a, at) {
    a.addEventListener('click', function () {
      mark(at);
      holdOn();
    });
  });
  look();
})();
