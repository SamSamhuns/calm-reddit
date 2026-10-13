/* Calm Reddit: toolbar popup. Settings live in chrome.storage.sync, your past reasons in chrome.storage.local. */
(() => {
  'use strict';

  // Every checkbox and select is wired by its data-key (a key of CALM_DEFAULTS in settings.js).
  // Unticking a checkbox asks you to wait first, unless it has data-instant.
  // The wait is a random 8 to 16 s, so it does not become a habit.
  const cooldownSeconds = () => 8 + Math.floor(Math.random() * 9);

  const $ = (sel) => document.querySelector(sel);
  const toggles = [...document.querySelectorAll('input[type="checkbox"][data-key]')];
  const selects = [...document.querySelectorAll('select[data-key]')];
  const subreddits = $('#subreddits');
  let settings = { ...CALM_DEFAULTS };
  let countdown = 0;

  function render() {
    for (const t of toggles) t.checked = Boolean(settings[t.dataset.key]);
    for (const s of selects) {
      const value = String(settings[s.dataset.key]);
      if (![...s.options].some((o) => o.value === value)) s.add(new Option(value, value)); // keep custom values visible
      s.value = value;
    }
    if (document.activeElement !== subreddits) subreddits.value = settings.subreddits.join(', ');
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

  // "Turn off “Hide ads”?", "Unblock “Home feed”?" (the verb comes from the section's data-undo).
  function offTitle(input) {
    if (input.dataset.key === 'enabled') return 'Turn Calm Reddit off?';
    const name = input.getAttribute('aria-label') || input.labels[0]?.textContent.trim();
    return `${input.closest('[data-undo]')?.dataset.undo || 'Turn off'} “${name}”?`;
  }

  function confirmThen(title, apply) {
    const ok = $('#confirm-ok');
    $('#confirm-title').textContent = title;
    $('#confirm').hidden = false;
    $('#list').inert = true;
    document.querySelector('.top').inert = true;
    let left = cooldownSeconds();
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
      apply();
    };
    $('#confirm-cancel').onclick = closeConfirm;
    $('#confirm-cancel').focus();
  }

  for (const t of toggles) {
    t.addEventListener('change', () => {
      const key = t.dataset.key;
      if (t.checked || t.hasAttribute('data-instant')) {
        save({ [key]: t.checked });
        return;
      }
      t.checked = true; // stays on until the cool-down is confirmed
      confirmThen(offTitle(t), () => save({ [key]: false }));
    });
  }

  for (const s of selects) {
    s.addEventListener('change', () => {
      const key = s.dataset.key;
      const value = typeof CALM_DEFAULTS[key] === 'number' ? Number(s.value) : s.value;
      if (key === 'subredditMode' && value === 'off') {
        s.value = settings[key]; // stays as it was until the cool-down is confirmed
        confirmThen('Stop using your subreddit list?', () => save({ [key]: value }));
        return;
      }
      save({ [key]: value });
    });
  }

  // Saved while you type too, because closing the popup doesn't always fire "change".
  let listTimer = 0;
  const saveList = () => {
    clearTimeout(listTimer);
    save({ subreddits: calmParseSubreddits(subreddits.value) });
  };
  subreddits.addEventListener('input', () => {
    clearTimeout(listTimer);
    listTimer = setTimeout(saveList, 500);
  });
  subreddits.addEventListener('change', saveList);

  // Safari has its own wording and no extension settings page to open.
  const browser = location.protocol === 'safari-web-extension:' ? 'safari' : 'chrome';
  document.querySelectorAll('[data-browser]').forEach((el) => { el.hidden = el.dataset.browser !== browser; });

  // Extensions don't run in Incognito unless you allow it, which would leave the old loophole open.
  chrome.extension.isAllowedIncognitoAccess((allowed) => {
    $('#incognito').hidden = Boolean(allowed);
  });
  $('#open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  // The report of the Calm Reddit scripts in the active tab. Rejects when it is not a Reddit tab.
  async function tabReport() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'calm:diagnose' });
  }

  // Protections that may not work on this tab, because Reddit changed the page (landmarks in page.js), by their row names.
  tabReport().then((report) => {
    const names = (report?.page?.affected || []).map((token) => {
      const key = CALM_FEATURES.find(([, t]) => t === token)?.[0];
      return document.querySelector(`[data-key="${key}"]`)?.closest('.row')?.querySelector('.name')?.textContent;
    }).filter(Boolean);
    $('#health-list').replaceChildren(...names.map((name) => Object.assign(document.createElement('li'), { textContent: name })));
    $('#health').hidden = !names.length;
  }).catch(() => {});

  // Page-structure report for troubleshooting (no post content); copied to the clipboard.
  $('#diag').addEventListener('click', async () => {
    const btn = $('#diag');
    let text = '';
    try {
      const report = await tabReport();
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

  // The reasons you gave on the pause screen (bridge.js adds them), newest first.
  chrome.storage.local.get('calmHistory').then(({ calmHistory = [] }) => {
    $('#history ol').append(...calmHistory.toReversed().map(({ text, at }) => {
      const time = document.createElement('time');
      time.dateTime = new Date(at).toISOString();
      time.textContent = new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const li = document.createElement('li');
      li.append(time, text);
      return li;
    }));
  });

  chrome.storage.sync.get(CALM_DEFAULTS).then((stored) => {
    settings = { ...CALM_DEFAULTS, ...stored };
    render();
  });
  render();
})();
