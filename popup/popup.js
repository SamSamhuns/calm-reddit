/* Calm Reddit: toolbar popup. Settings live in chrome.storage.sync. */
(() => {
  'use strict';

  const COOLDOWN_SECONDS = 10;
  // Turning these off asks you to wait first (grayscale is an extra, so it doesn't).
  const PROTECTIONS = new Set(['enabled', 'paginate', 'hideRecs', 'hideCounts', 'blurMedia', 'noAutoplay', 'gateComments', 'pause']);
  const NAMES = {
    enabled: 'Calm Reddit',
    paginate: 'Pages, not infinite scroll',
    hideRecs: 'Hide recommendations',
    hideCounts: 'Hide votes & comment counts',
    blurMedia: 'Blur images & video in feeds',
    noAutoplay: 'No video autoplay',
    gateComments: 'Comments behind a button',
    pause: 'Pause before Reddit',
  };

  const $ = (sel) => document.querySelector(sel);
  const toggles = [...document.querySelectorAll('input[type="checkbox"][data-key]')];
  const selects = [...document.querySelectorAll('select[data-key]')];
  let settings = { ...CALM_DEFAULTS };
  let countdown = 0;

  function render() {
    for (const t of toggles) t.checked = Boolean(settings[t.dataset.key]);
    for (const s of selects) {
      const value = String(settings[s.dataset.key]);
      if (![...s.options].some((o) => o.value === value)) s.add(new Option(value, value)); // keep custom values visible
      s.value = value;
    }
    document.body.classList.toggle('is-off', !settings.enabled);
    $('#status').textContent = settings.enabled ? 'Protecting your attention' : 'Off: Reddit is back to normal';
  }

  function save(patch) {
    Object.assign(settings, patch);
    render();
    return chrome.storage.sync.set(patch);
  }

  function closeConfirm() {
    clearInterval(countdown);
    $('#confirm').hidden = true;
    $('#list').inert = false;
    document.querySelector('.top').inert = false;
  }

  function askToTurnOff(key) {
    const ok = $('#confirm-ok');
    $('#confirm-title').textContent = key === 'enabled' ? 'Turn Calm Reddit off?' : `Turn off “${NAMES[key]}”?`;
    $('#confirm').hidden = false;
    $('#list').inert = true;
    document.querySelector('.top').inert = true;
    let left = COOLDOWN_SECONDS;
    ok.disabled = true;
    ok.textContent = `Turn off (${left})`;
    clearInterval(countdown);
    countdown = setInterval(() => {
      left -= 1;
      if (left > 0) {
        ok.textContent = `Turn off (${left})`;
        return;
      }
      clearInterval(countdown);
      ok.disabled = false;
      ok.textContent = 'Turn off';
    }, 1000);
    ok.onclick = () => {
      closeConfirm();
      save({ [key]: false });
    };
    $('#confirm-cancel').onclick = closeConfirm;
    $('#confirm-cancel').focus();
  }

  for (const t of toggles) {
    t.addEventListener('change', () => {
      const key = t.dataset.key;
      if (t.checked || !PROTECTIONS.has(key)) {
        save({ [key]: t.checked });
        return;
      }
      t.checked = true; // stays on until the cool-down is confirmed
      askToTurnOff(key);
    });
  }

  for (const s of selects) {
    s.addEventListener('change', () => save({ [s.dataset.key]: Number(s.value) }));
  }

  // Extensions don't run in Incognito unless you allow it, which would leave the old loophole open.
  chrome.extension.isAllowedIncognitoAccess((allowed) => {
    $('#incognito').hidden = Boolean(allowed);
  });
  $('#open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  // Page-structure report for troubleshooting (no post content); copied to the clipboard.
  $('#diag').addEventListener('click', async () => {
    const btn = $('#diag');
    let text = '';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const report = await chrome.tabs.sendMessage(tab.id, { type: 'calm:diagnose' });
      text = `Calm Reddit ${chrome.runtime.getManifest().version} diagnostics\n${JSON.stringify(report, null, 1)}`;
    } catch {
      btn.textContent = 'Open a Reddit tab first';
      setTimeout(() => { btn.textContent = 'Copy diagnostics'; }, 3000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied. Paste it into the chat.';
    } catch {
      const area = $('#diag-text'); // clipboard blocked: show it for manual copying
      area.value = text;
      area.hidden = false;
      area.select();
      btn.textContent = 'Press Ctrl/Cmd+C to copy';
    }
    setTimeout(() => { btn.textContent = 'Copy diagnostics'; }, 4000);
  });

  chrome.storage.sync.get(CALM_DEFAULTS).then((stored) => {
    settings = { ...CALM_DEFAULTS, ...stored };
    render();
  });
  render();
})();
