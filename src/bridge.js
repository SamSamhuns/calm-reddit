/*
 * Calm Reddit: isolated-world content script.
 *  - Mirrors your settings onto <html data-calm-*> so calm.css and page.js react instantly.
 *  - Shows the pause screen when you arrive on Reddit after being away.
 *  - Keeps a small "You came here for…" reminder in the corner.
 */
(() => {
  'use strict';
  if (window.top !== window) return;

  const html = document.documentElement;
  const LAST_ACTIVE = 'calmLastActive';   // chrome.storage.local: last time any Reddit tab was in use
  const INTENT = 'calmIntent';            // chrome.storage.local: { text, at, dismissed }
  const TICK_MS = 20 * 1000;

  let settings = { ...CALM_DEFAULTS };
  let pause = null;   // { host, timer } while the pause screen is up
  let chip = null;    // { host, text } while the reminder is shown

  // Keep the page hidden for the few milliseconds it takes to decide whether to pause.
  html.setAttribute('data-calm-pausing', '');

  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const visible = () => document.visibilityState === 'visible';
  const pauseWanted = () => settings.enabled && settings.pause;
  const awayMs = () => Math.max(1, Number(settings.pauseAwayMinutes) || 15) * 60 * 1000;
  const reveal = () => { if (!pause) html.removeAttribute('data-calm-pausing'); };

  function applySettings() {
    const off = CALM_FEATURES.filter(([key]) => !settings.enabled || !settings[key]).map(([, token]) => token);
    html.setAttribute('data-calm-off', off.length ? off.join(' ') : 'none');
    html.setAttribute('data-calm-on', settings.enabled && settings.grayscale ? 'grayscale' : '');
    html.setAttribute('data-calm-pagesize', String(settings.pageSize));
  }

  async function awayTooLong() {
    const got = await chrome.storage.local.get(LAST_ACTIVE);
    return Date.now() - (Number(got[LAST_ACTIVE]) || 0) > awayMs();
  }

  function markActive() {
    if (!alive() || pause) return;
    chrome.storage.local.set({ [LAST_ACTIVE]: Date.now() }).catch(() => {});
  }

  function whenBody(fn) {
    if (document.body) return fn();
    const mo = new MutationObserver(() => {
      if (!document.body) return;
      mo.disconnect();
      fn();
    });
    mo.observe(html, { childList: true });
  }

  // Tiny DOM helper (no innerHTML).
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...children);
    return el;
  }

  function makeHost(id, fixedStyles) {
    const host = document.createElement('div');
    host.id = id;
    const base = { all: 'initial', position: 'fixed', 'z-index': '2147483647', visibility: 'visible', display: 'block' };
    for (const [k, v] of Object.entries({ ...base, ...fixedStyles })) host.style.setProperty(k, v, 'important');
    // Keep keystrokes typed into our UI away from Reddit's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());
    const root = host.attachShadow({ mode: 'closed' });
    return { host, root };
  }

  function sheet(css) {
    const s = new CSSStyleSheet();
    s.replaceSync(css);
    return s;
  }

  /* ------------------------------------------------------------------ pause screen */

  const PAUSE_CSS = `
    :host { all: initial; }
    .backdrop {
      position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
      overflow: auto;
      background: radial-gradient(1200px 800px at 50% 25%, #f1f6f3 0%, #e4ede9 50%, #d6e3dd 100%);
      color: #1d2b27;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .card { width: min(440px, 100%); text-align: center; }
    .brand { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; opacity: .55; }
    .breath { position: relative; width: 136px; height: 136px; margin: 28px auto 22px; }
    .ring {
      position: absolute; inset: 0; border-radius: 50%;
      background: radial-gradient(circle, rgba(63,143,132,.38) 0%, rgba(63,143,132,.16) 55%, rgba(63,143,132,0) 72%);
      animation: breathe 8s ease-in-out infinite;
    }
    .count {
      position: absolute; inset: 0; display: grid; place-items: center;
      font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums;
    }
    .cue { font-size: 12px; opacity: .55; margin-top: -10px; margin-bottom: 18px; min-height: 1em; }
    @keyframes breathe { 0%, 100% { transform: scale(.7); } 50% { transform: scale(1); } }
    h1 { font-size: 28px; line-height: 1.2; font-weight: 650; margin: 0 0 8px; letter-spacing: -.01em; }
    .lede { margin: 0 0 18px; opacity: .8; font-size: 16px; line-height: 1.4; }
    input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; padding: 12px 14px;
      border-radius: 12px; border: 1px solid rgba(29,43,39,.22); background: rgba(255,255,255,.8); color: inherit;
      outline: none;
    }
    input:focus { border-color: #3f8f84; box-shadow: 0 0 0 3px rgba(63,143,132,.25); }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
    button {
      font: inherit; font-size: 14px; font-weight: 600; border-radius: 999px; padding: 11px 18px;
      cursor: pointer; border: 1px solid transparent;
    }
    button:focus-visible { outline: 2px solid #3f8f84; outline-offset: 2px; }
    .primary { background: #2f7a70; color: #fff; min-width: 170px; }
    .primary:disabled { opacity: .45; cursor: default; }
    .ghost { background: transparent; border-color: rgba(29,43,39,.25); color: inherit; }
    .hint { margin: 16px 0 0; font-size: 12.5px; line-height: 1.4; opacity: .6; }
    @media (prefers-color-scheme: dark) {
      .backdrop { background: radial-gradient(1200px 800px at 50% 25%, #1d2a27 0%, #16211e 55%, #111a18 100%); color: #e5eee9; }
      input { background: rgba(255,255,255,.06); border-color: rgba(229,238,233,.2); }
      .ghost { border-color: rgba(229,238,233,.3); }
    }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; transform: scale(.85); } }
  `;

  function showPause() {
    if (pause) return;
    pause = { host: null, timer: 0 };
    html.setAttribute('data-calm-pausing', '');
    for (const media of document.querySelectorAll('video, audio')) { try { media.pause(); } catch { /* ignore */ } }
    if (alive()) chrome.storage.local.remove(INTENT).catch(() => {}); // a new visit starts with a new intention
    removeChip();
    whenBody(buildPause);
  }

  function buildPause() {
    if (!pause || pause.host) return;
    const { host, root } = makeHost('calm-reddit-pause', { inset: '0' });
    root.adoptedStyleSheets = [sheet(PAUSE_CSS)];

    const seconds = Math.max(3, Number(settings.pauseSeconds) || 10);
    const count = h('div', { class: 'count' }, String(seconds));
    const cue = h('div', { class: 'cue' }, 'Breathe in…');
    const input = h('input', {
      type: 'text', maxlength: '140', autocomplete: 'off', spellcheck: 'false',
      'aria-label': 'What did you come to Reddit for?',
      placeholder: 'e.g. check replies on my post in r/homelab',
    });
    const go = h('button', { class: 'primary', type: 'button', disabled: '' }, `Continue in ${seconds}s`);
    const leave = h('button', { class: 'ghost', type: 'button' }, 'Never mind, close tab');

    root.append(h('div', { class: 'backdrop' },
      h('div', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'calm-title' },
        h('div', { class: 'brand' }, 'Calm Reddit'),
        h('div', { class: 'breath', 'aria-hidden': 'true' }, h('div', { class: 'ring' }), count),
        cue,
        h('h1', { id: 'calm-title' }, 'Take a breath.'),
        h('p', { class: 'lede' }, 'What did you come to Reddit for?'),
        input,
        h('div', { class: 'actions' }, leave, go),
        h('p', { class: 'hint' }, 'Reddit opens when the timer ends. Your answer stays in the corner as a reminder.'),
      ),
    ));

    let remaining = seconds * 1000;
    let last = performance.now();
    const started = last;
    pause.timer = setInterval(() => {
      const now = performance.now();
      if (visible()) remaining -= now - last; // the timer only runs while you're looking at it
      last = now;
      const secs = Math.max(0, Math.ceil(remaining / 1000));
      count.textContent = String(secs);
      cue.textContent = secs > 0 ? (Math.floor((now - started) / 4000) % 2 ? 'Breathe out…' : 'Breathe in…') : '';
      go.disabled = secs > 0;
      go.textContent = secs > 0 ? `Continue in ${secs}s` : 'Continue to Reddit';
      if (secs === 0) clearInterval(pause.timer);
    }, 200);

    const proceed = () => {
      if (go.disabled) return;
      const text = input.value.trim().slice(0, 140);
      if (alive()) {
        const data = { [LAST_ACTIVE]: Date.now() };
        if (text) data[INTENT] = { text, at: Date.now(), dismissed: false };
        chrome.storage.local.set(data).catch(() => {});
      }
      closePause();
      if (text) showChip(text);
    };
    go.addEventListener('click', proceed);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') proceed(); });
    leave.addEventListener('click', closeTab);

    html.appendChild(host);
    pause.host = host;
    if (visible()) setTimeout(() => input.focus(), 50);
  }

  function closePause() {
    if (!pause) return;
    clearInterval(pause.timer);
    pause.host?.remove();
    pause = null;
    reveal();
  }

  function closeTab() {
    if (alive()) chrome.runtime.sendMessage({ type: 'calm:close-tab' }).catch(() => {});
    setTimeout(() => location.replace('about:blank'), 500); // only reached if the tab couldn't be closed
  }

  /* ------------------------------------------------------------------ intention reminder */

  const CHIP_CSS = `
    :host { all: initial; }
    .chip {
      position: fixed; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 10px;
      max-width: min(440px, calc(100vw - 32px)); box-sizing: border-box;
      padding: 7px 7px 7px 14px; border-radius: 999px;
      background: #1f3a35; color: #eef5f2; box-shadow: 0 6px 24px rgba(0,0,0,.2);
      font: 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .label { opacity: .7; white-space: nowrap; }
    .text { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    button {
      font: inherit; font-weight: 600; border: 0; border-radius: 999px; cursor: pointer;
      padding: 6px 12px; background: rgba(255,255,255,.14); color: inherit; white-space: nowrap;
    }
    button:hover { background: rgba(255,255,255,.24); }
    button.x { padding: 6px 9px; background: transparent; opacity: .7; }
    button:focus-visible { outline: 2px solid #8fd3c7; outline-offset: 2px; }
  `;

  function showChip(text) {
    if (!pauseWanted() || pause) return;
    if (chip) {
      chip.textEl.textContent = text;
      chip.textEl.title = text;
      return;
    }
    chip = { host: null, textEl: h('span', { class: 'text', title: text }, text) };
    whenBody(() => {
      if (!chip || chip.host) return;
      const { host, root } = makeHost('calm-reddit-intent', { left: '0', bottom: '0', width: '0', height: '0' });
      root.adoptedStyleSheets = [sheet(CHIP_CSS)];
      const done = h('button', { type: 'button', title: 'Close this tab' }, 'Done');
      const dismiss = h('button', { class: 'x', type: 'button', title: 'Hide reminder', 'aria-label': 'Hide reminder' }, '✕');
      done.addEventListener('click', closeTab);
      dismiss.addEventListener('click', () => {
        if (alive()) {
          chrome.storage.local.get(INTENT).then((got) => {
            const intent = got[INTENT];
            if (intent) chrome.storage.local.set({ [INTENT]: { ...intent, dismissed: true } });
          }).catch(() => {});
        }
        removeChip();
      });
      root.append(h('div', { class: 'chip', role: 'status' }, h('span', { class: 'label' }, 'Here for:'), chip.textEl, done, dismiss));
      html.appendChild(host);
      chip.host = host;
    });
  }

  function removeChip() {
    chip?.host?.remove();
    chip = null;
  }

  async function syncChip() {
    if (!alive() || pause) return;
    let intent = null;
    try { intent = (await chrome.storage.local.get(INTENT))[INTENT]; } catch { /* ignore */ }
    if (pauseWanted() && intent && intent.text && !intent.dismissed) showChip(intent.text);
    else removeChip();
  }

  /* ------------------------------------------------------------------ wiring */

  function onStorageChanged(changes, area) {
    if (area === 'sync') {
      let touched = false;
      for (const key of Object.keys(changes)) {
        if (key in CALM_DEFAULTS) {
          settings[key] = changes[key].newValue ?? CALM_DEFAULTS[key];
          touched = true;
        }
      }
      if (!touched) return;
      applySettings();
      if (!pauseWanted()) closePause();
      syncChip();
    } else if (area === 'local' && INTENT in changes) {
      syncChip();
    }
  }

  async function onVisibilityChange() {
    if (!visible()) {
      markActive(); // remember when you left
      return;
    }
    if (pause || !pauseWanted() || !alive()) return;
    try {
      if (await awayTooLong()) showPause();
      else markActive();
    } catch { /* extension reloaded */ }
  }

  // "Copy diagnostics" in the popup: collects structure info (no post content) from this tab.
  function listenForDiagnostics() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== 'calm:diagnose') return undefined;
      let answered = false;
      const finish = (pageReport) => {
        if (answered) return;
        answered = true;
        document.removeEventListener('calm:diagnostics', onReport);
        sendResponse({
          host: location.hostname,
          settings,
          pausing: html.hasAttribute('data-calm-pausing'),
          pauseOpen: Boolean(pause),
          page: pageReport,
        });
      };
      const onReport = (e) => {
        let parsed = null;
        try { parsed = JSON.parse(e.detail); } catch { parsed = { error: 'unreadable report' }; }
        finish(parsed);
      };
      document.addEventListener('calm:diagnostics', onReport);
      document.dispatchEvent(new CustomEvent('calm:diagnose'));
      setTimeout(() => finish(null), 1000); // old Reddit has no page script
      return true;
    });
  }

  async function init() {
    if (alive()) listenForDiagnostics();
    try {
      settings = { ...CALM_DEFAULTS, ...(await chrome.storage.sync.get(CALM_DEFAULTS)) };
    } catch {
      html.removeAttribute('data-calm-pausing');
      return;
    }
    applySettings();
    chrome.storage.onChanged.addListener(onStorageChanged);

    let needsPause = false;
    if (pauseWanted()) {
      try { needsPause = await awayTooLong(); } catch { needsPause = false; }
    }
    if (needsPause) {
      showPause();
    } else {
      reveal();
      if (visible()) markActive();
      syncChip();
    }

    setInterval(() => { if (visible()) markActive(); }, TICK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', markActive);
  }

  init();
})();
