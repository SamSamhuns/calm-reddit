/* Calm Reddit: first-run page. Shows live whether "Allow in Incognito" is on. */
(() => {
  'use strict';
  const state = document.getElementById('incognito-state');
  const step = document.getElementById('step-incognito');

  function check() {
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      state.textContent = allowed ? 'Done' : 'Not yet';
      state.classList.toggle('ok', Boolean(allowed));
      step.classList.toggle('done', Boolean(allowed));
    });
  }

  document.getElementById('open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  check();
  setInterval(check, 1500);
  document.addEventListener('visibilitychange', check);
})();
