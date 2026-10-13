/*
 * Calm Reddit: page script. Runs inside reddit.com's own JavaScript world (manifest "world": "MAIN").
 *
 * Things that can only be done from inside the page:
 *   1. Stop Reddit loading more posts on its own. The loader at the bottom of the feed is hidden by
 *      calm.css, and gated in two places: the observer that watches it, and its loadContent() method
 *      (which Reddit's prefetching and scroll handlers call directly). Only "Next page" lets a batch through.
 *      Network requests are deliberately not wrapped: Chrome would then blame every warning about
 *      Reddit's own requests on this file.
 *   2. Style elements inside Reddit's web-component shadow roots (vote counts, trending searches).
 *   3. Block video autoplay started by Reddit's own code.
 *
 * Settings arrive as attributes on <html> (data-calm-off, data-calm-on, data-calm-pagesize), written by bridge.js.
 * Until they arrive, every protection is on and every opt-in extra is off.
 */
(() => {
  'use strict';
  if (window.__calmRedditPage) return;
  Object.defineProperty(window, '__calmRedditPage', { value: true });

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[Calm Reddit]', ...args); };
  const attempt = (fn, ...args) => {
    try { return fn(...args); } catch (err) { log(err); return undefined; }
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const html = document.documentElement;

  // Counters for the "Copy diagnostics" button in the popup.
  const stats = { heldObserver: 0, blockedLoadContent: 0, batchesRequested: 0 };

  /* ================================================================ Reddit's names */

  // Every name from Reddit's pages that page.js depends on. When Reddit renames something, change it here, and in
  // calm.css, which hides some of the same elements. The landmarks (below) find a name that stopped matching.
  const REDDIT = Object.freeze({
    main: 'main, #main-content',
    // The page's frame (app, header, sidebars): a search for a recommendation section stops there.
    frame: 'shreddit-app, reddit-header-large, #right-sidebar-container, #right-sidebar-contents, #left-sidebar-container, #flex-left-nav-container, reddit-sidebar-nav',
    feed: 'shreddit-feed',
    post: 'shreddit-post',
    adPost: 'shreddit-ad-post',
    unit: 'article',                  // holds one post in a feed (an <hr> can follow it)
    postIdPrefix: 't3_',              // a post's element id is t3_<post id>
    // The loader: loads part of a page. With slot="load-after" it loads the next batch of a feed, from the address in
    // its src, which has a paging cursor in it. Reddit calls its loadContent() method directly; "Next page" does too.
    loader: 'faceplate-partial',
    loaderSlot: 'load-after',
    loaderSrc: 'src',
    loaderMethod: 'loadContent',
    cursors: ['after', 'cursor'],
    comment: 'shreddit-comment',
    commentTree: 'shreddit-comment-tree',
    commentsStart: 'comment-body-header, shreddit-comment-tree, #comment-tree, comment-forest-empty-state',
    number: 'faceplate-number',       // vote scores and comment counts
    awards: 'award-button, shreddit-award-button, awards-bar, [data-post-click-location="award"], button[aria-label*="award" i]',
    // Trending searches under the search field, and their heading.
    trending: '#reddit-trending-searches-partial-container, [id*="trending-searches" i], div:has(+ #reddit-trending-searches-partial-container):not(:has(input, a, li, ul))',
    videoPost: ':is([post-type="video"], [post-type="gif"], [domain*="youtube.com"], [domain="youtu.be"], [domain*="redgifs.com"], [domain*="streamable.com"], [domain*="twitch.tv"])',
    // Why Reddit shows a post. Logged in, almost every Home post has a source; "subscribed…" is a community you joined.
    recSource: 'recommendation-source',
    recSourceJoined: /^subscribed/i,
    recContext: 'recommendation-context',
    joinButton: 'shreddit-join-button',
    joined: 'subscribed',             // the join button's attribute: "true" for a community you joined
    postLabel: '[id="-post-rtjson-content"]', // the line above a post, e.g. "Because you visited r/…"
    // Reddit's wording (English only): labels of suggested posts, and headings of sections that exist to keep you clicking.
    recLabel: /^(because you|similar to\b|popular on reddit|popular near you|popular in your (country|area|region)|suggested for you|recommended for you|you might like|based on your)/i,
    recHeading: /^(recent posts|recently viewed( posts)?|popular communities|related communities|similar communities|communities (you may|you might) like|more posts you may like|more posts from\b|related posts|similar posts|you might also like|recommended( for you)?|suggested( for you| communities| posts)?|trending( today| now| on reddit)?|top communities|people also search(ed)? for|related answers|related searches|keep (browsing|exploring)|popular (posts|right now|today))\b/i,
  });
  const FEED_LOADER = `${REDDIT.loader}[slot="${REDDIT.loaderSlot}"]`;
  const ANY_POST = `${REDDIT.post}, ${REDDIT.adPost}`;
  const COMMENTS = `${REDDIT.commentTree}, ${REDDIT.comment}`;
  const hasCursor = (src) => REDDIT.cursors.some((name) => new RegExp(`[?&]${name}=`).test(src || '')); // a loader address with a paging cursor

  /* ================================================================ settings */

  const tokens = (attr) => ` ${html.getAttribute(attr) || ''} `;
  const isOn = (feature) => !tokens('data-calm-off').includes(` ${feature} `);       // protections (default on)
  const isOptedIn = (extra) => tokens('data-calm-on').includes(` ${extra} `);       // extras (default off)
  const pageSize = () => {
    const n = parseInt(html.getAttribute('data-calm-pagesize'), 10);
    return Number.isFinite(n) && n >= 3 && n <= 50 ? n : 10;
  };

  /* ================================================================ state */

  let address = {};         // what the address means: { type, post, comment } from blocking.js (see readAddress)
  let pageKind = '';        // address.type: home | popular | all | explore | post | subreddit | profile | …
  let lastLocation = '';
  let feedState = null;     // pagination state for the current main feed
  let cameBack = false;     // true after back/forward, so we restore your page number
  try { cameBack = performance.getEntriesByType('navigation')[0]?.type === 'back_forward'; } catch { /* ignore */ }

  // blocking.js runs in bridge.js's world. bridge.js writes what the address means on <html>, and also at once
  // when page.js asks with this event (DOM events reach the listeners of both worlds before dispatchEvent returns).
  function readAddress() {
    document.dispatchEvent(new CustomEvent('calm:address'));
    try { return JSON.parse(html.getAttribute('data-calm-address')) || {}; } catch { return {}; }
  }

  function checkLocation() {
    const key = location.pathname + location.search;
    if (key === lastLocation) return;
    const next = readAddress();
    if (!next.type) return; // bridge.js has not started yet: ask again on the next refresh
    const firstLoad = lastLocation === '';
    lastLocation = key;
    address = next;
    pageKind = next.type;
    html.setAttribute('data-calm-page', pageKind);
    html.removeAttribute('data-calm-comments-open');
    if (!firstLoad) resetFeed();
  }

  /* ================================================================ 1. gate Reddit's own loading */

  // The loader Reddit puts at the bottom of a feed: inside <shreddit-feed>, or right next to it.
  // (Loaders inside comment threads and other lists are left alone.)
  const isLoadSentinel = (el) =>
    !!el && el.nodeType === 1 && el.matches(FEED_LOADER) && !el.closest(COMMENTS) &&
    (!!el.closest(REDDIT.feed) || !!el.parentElement?.querySelector(`:scope > ${REDDIT.feed}`));

  // Identify a batch by its endpoint + "after" cursor.
  function batchKey(url) {
    if (!url) return '';
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return '';
      const cursor = REDDIT.cursors.map((name) => u.searchParams.get(name)).find(Boolean) || '';
      return `${u.pathname}|${cursor || u.search}`;
    } catch {
      return '';
    }
  }

  // Batches we've decided to load (because you clicked Next, or the current page isn't full yet).
  const permits = new Map(); // batchKey -> expiry time
  const grant = (key) => { if (key) permits.set(key, performance.now() + 15000); };
  const permitted = (key) => {
    const until = permits.get(key);
    if (!until) return false;
    if (until < performance.now()) { permits.delete(key); return false; }
    return true;
  };
  const gating = () => isOn('paginate');

  // 1a. Observer: the loader never reports itself as visible.
  const NativeIO = window.IntersectionObserver;
  if (typeof NativeIO === 'function') {
    const quiet = (e) => ({
      target: e.target,
      time: e.time,
      rootBounds: e.rootBounds,
      boundingClientRect: e.boundingClientRect,
      intersectionRect: new DOMRectReadOnly(0, 0, 0, 0),
      intersectionRatio: 0,
      isIntersecting: false,
      isVisible: false,
    });
    class CalmIntersectionObserver extends NativeIO {
      constructor(callback, options) {
        if (typeof callback !== 'function') {
          super(callback, options); // let the browser throw its usual error
          return;
        }
        super(function calmCallback(entries, observer) {
          const list = entries.map((e) => {
            if (gating() && attempt(() => isLoadSentinel(e.target) || isLoadSentinel(e.target.closest?.(REDDIT.loader)))) {
              if (e.isIntersecting) stats.heldObserver++;
              return quiet(e);
            }
            return e;
          });
          return callback.call(this, list, observer);
        }, options);
      }
    }
    window.IntersectionObserver = CalmIntersectionObserver;
  }

  // 1b. loadContent(): Reddit's code (prefetching, scroll handlers) can call it directly.
  function gateLoadContent(original) {
    const gated = function loadContent(...args) {
      if (gating() && isLoadSentinel(this) && !permitted(batchKey(this.getAttribute(REDDIT.loaderSrc)))) {
        stats.blockedLoadContent++;
        return Promise.resolve();
      }
      return original.apply(this, args);
    };
    gated.__calmGate = true;
    return gated;
  }
  const LOAD = REDDIT.loaderMethod;
  function patchLoaderClass() {
    const proto = customElements.get(REDDIT.loader)?.prototype;
    if (proto && typeof proto[LOAD] === 'function' && !proto[LOAD].__calmGate) proto[LOAD] = gateLoadContent(proto[LOAD]);
  }
  function patchLoaderInstance(el) { // in case the method is an own property of the element
    if (Object.prototype.hasOwnProperty.call(el, LOAD) && typeof el[LOAD] === 'function' && !el[LOAD].__calmGate) {
      el[LOAD] = gateLoadContent(el[LOAD]);
    }
  }
  customElements.whenDefined(REDDIT.loader).then(() => attempt(patchLoaderClass)).catch(() => {});

  const sanitizePath = (path) => path.replace(/\/(r|u|user)\/[^/]+/gi, '/$1/…').slice(0, 120);

  /* ================================================================ 2. styles inside shadow roots */

  // This sheet is adopted by every shadow root on the page, so keep its selectors cheap:
  // Chrome checks a compound selector left to right, so put the cheap sibling test before :not(:has(…)).
  const shadowSheet = new CSSStyleSheet();
  const SHADOW_RULES = {
    counts: `${REDDIT.number}, ${REDDIT.awards} { display: none !important; }`,
    recs: `${REDDIT.trending} { display: none !important; }`,
  };
  function updateShadowSheet() {
    let css = '';
    if (isOn('counts')) css += SHADOW_RULES.counts;
    if (isOn('recs')) css += SHADOW_RULES.recs;
    attempt(() => shadowSheet.replaceSync(css));
  }

  const adoptedRoots = new WeakSet();
  const sheetsProp = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'adoptedStyleSheets');

  function adopt(root) {
    if (!root || adoptedRoots.has(root)) return;
    adoptedRoots.add(root);
    attempt(() => {
      const current = sheetsProp ? sheetsProp.get.call(root) : root.adoptedStyleSheets;
      if (!Array.prototype.includes.call(current, shadowSheet)) {
        const next = [...current, shadowSheet];
        if (sheetsProp) sheetsProp.set.call(root, next); else root.adoptedStyleSheets = next;
      }
    });
    root.addEventListener('play', onMediaPlay, true);
  }

  // Components (Lit) assign their own sheets after creating the root; keep ours at the end.
  if (sheetsProp && sheetsProp.set) {
    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
      configurable: true,
      enumerable: sheetsProp.enumerable,
      get() { return sheetsProp.get.call(this); },
      set(list) {
        let next = list;
        if (adoptedRoots.has(this)) {
          next = Array.from(list || []);
          if (!next.includes(shadowSheet)) next.push(shadowSheet);
        }
        sheetsProp.set.call(this, next);
      },
    });
  }

  // Roots created by script.
  const nativeAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(init) {
    const root = nativeAttachShadow.call(this, init);
    attempt(adopt, root);
    return root;
  };

  // Roots that arrived pre-rendered in the HTML (declarative shadow DOM).
  function scanForShadowRoots(root) {
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const sr = all[i].shadowRoot;
      if (sr && !adoptedRoots.has(sr)) {
        adopt(sr);
        scanForShadowRoots(sr);
      }
    }
  }

  /* ================================================================ 3. no autoplay */

  // A video may play when the last click/keypress (within 5 s) was on that video's own player.
  let lastGesture = { path: [], time: -Infinity };
  const noteGesture = (e) => { lastGesture = { path: e.composedPath(), time: performance.now() }; };
  window.addEventListener('pointerdown', noteGesture, true);
  window.addEventListener('keydown', noteGesture, true);

  const userStarted = new WeakSet();
  const PLAYER_BOUNDARY = new Set([REDDIT.post, REDDIT.unit, REDDIT.feed, 'main', 'body', 'html']);

  function startedByUser(media) {
    if (userStarted.has(media)) return true;
    if (performance.now() - lastGesture.time > 5000) return false;
    let node = media;
    for (let i = 0; node && i < 40; i++) {
      if (node.nodeType === 1 && PLAYER_BOUNDARY.has(node.localName)) return false;
      if (lastGesture.path.includes(node)) {
        userStarted.add(media);
        return true;
      }
      const parent = node.parentNode;
      node = parent && parent.nodeType === 11 ? parent.host : parent;
    }
    return false;
  }

  const blockAutoplay = (media) => isOn('autoplay') && !startedByUser(media);

  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(...args) {
    if (attempt(blockAutoplay, this)) {
      return Promise.reject(new DOMException('Autoplay is turned off by Calm Reddit.', 'NotAllowedError'));
    }
    return nativePlay.apply(this, args);
  };

  function onMediaPlay(e) {
    const media = e.target;
    if (media instanceof HTMLMediaElement && attempt(blockAutoplay, media)) media.pause();
  }
  document.addEventListener('play', onMediaPlay, true);

  /* ================================================================ 4. recommended posts */

  // Returns a reason string when a feed post is a recommendation rather than something you follow.
  function recommendationReason(post, unit, st) {
    const label = unit.querySelector(REDDIT.postLabel);
    if (label && REDDIT.recLabel.test(label.textContent.trim())) return 'label';
    const source = post.getAttribute(REDDIT.recSource);
    if (source ? !REDDIT.recSourceJoined.test(source) : post.hasAttribute(REDDIT.recContext)) return 'attr';
    if (st.joinFilter) {
      // On Home, a "Join" button means the post comes from a community you haven't joined.
      const join = unit.querySelector(REDDIT.joinButton);
      if (join) {
        const subscribed = join.getAttribute(REDDIT.joined);
        if (subscribed === null || subscribed === 'false') return 'join';
      }
    }
    return '';
  }

  /* ================================================================ 5. pagination */

  // Flags live in data attributes (Reddit rewrites class attributes on re-render).
  const setFlag = (el, name, on) => { if (el.hasAttribute(name) !== on) el.toggleAttribute(name, on); };
  const unitOf = (post) => post.closest(REDDIT.unit) || post;
  const countPosts = (feed) => feed.querySelectorAll(REDDIT.post).length;

  function feedLoaders(feed) {
    let all = [...feed.querySelectorAll(FEED_LOADER)];
    if (!all.length && feed.parentElement) all = [...feed.parentElement.querySelectorAll(`:scope > ${FEED_LOADER}`)];
    return all.filter(isLoadSentinel);
  }
  function lastSentinel(feed) {
    const all = feedLoaders(feed);
    return all.length ? all[all.length - 1] : null;
  }

  function mainFeed() {
    if (pageKind === 'post') return null;
    const feeds = document.querySelectorAll(REDDIT.feed);
    for (const feed of feeds) if (feed.closest(REDDIT.main)) return feed;
    return feeds[0] || null;
  }

  const pageKey = () => `calm-reddit-page:${location.pathname}${location.search}`;
  const savedPage = () => {
    try { return Math.max(0, parseInt(sessionStorage.getItem(pageKey()), 10) || 0); } catch { return 0; }
  };
  const savePage = (page) => { try { sessionStorage.setItem(pageKey(), String(page)); } catch { /* blocked */ } };

  // Batches a page may load before giving up: a feed whose posts are all hidden (e.g. nothing but
  // suggestions) must not load forever. Restoring page N after Back needs N pages' worth.
  const batchBudget = (page) => 4 + page * 3;

  // r/popular, r/all and Explore are nothing but suggestions, so filtering them would empty them.
  // You chose to open them (keeping them out of reach is what "Block pages" is for).
  const RECOMMENDATION_FEEDS = new Set(['popular', 'all', 'explore']);

  function resetFeed() {
    feedState?.pager?.remove();
    feedState = null;
  }

  // Runs synchronously from the MutationObserver, so new posts are hidden before they're painted.
  function syncFeed() {
    const feed = mainFeed();
    if (!feed) {
      if (feedState) resetFeed();
      return null;
    }
    if (!feedState || feedState.feed !== feed) {
      resetFeed();
      const page = cameBack ? savedPage() : 0;
      feedState = {
        feed,
        page,
        size: pageSize(),
        total: 0,
        filling: false,
        stalled: 0,
        budget: batchBudget(page),
        filterRecs: !RECOMMENDATION_FEEDS.has(pageKind),
        joinFilter: pageKind === 'home',
        nextAt: 0,              // performance.now() time when "Next page" unlocks
        pager: null, prev: null, info: null, next: null,
      };
      cameBack = false;
    }
    const st = feedState;
    if (st.size !== pageSize()) {
      st.size = pageSize();
      st.page = 0;
      st.budget = batchBudget(0);
      savePage(0);
    }
    layout(st);
    return st;
  }

  function refreshFeed() {
    const st = syncFeed();
    if (!st) return;
    for (const el of feedLoaders(st.feed)) patchLoaderInstance(el);
    if (!isOn('paginate')) {
      st.pager?.remove();
      return;
    }
    ensurePager(st);
    fill(st);
  }

  // Mark recommended, video and duplicate posts, and hide every post that isn't on the current page.
  function layout(st) {
    const paging = isOn('paginate');
    const recsOn = isOn('recs') && st.filterRecs;
    const hideVideos = isOptedIn('videos');
    const ids = new Set();
    let index = -1;
    let seen = 0;
    let hiddenByJoin = 0;
    let lastUnit = null;
    for (const post of st.feed.querySelectorAll(ANY_POST)) {
      const unit = unitOf(post);
      let reason = '';
      let video = false;
      let duplicate = false;
      if (post.localName === REDDIT.post) {
        if (post.id && ids.has(post.id)) {
          duplicate = true;
        } else {
          if (post.id) ids.add(post.id);
          seen++;
          reason = recsOn ? recommendationReason(post, unit, st) : '';
          if (reason === 'join') hiddenByJoin++;
          video = hideVideos && post.matches(REDDIT.videoPost); // also links to video sites
          if (!reason && !video) index++;
        }
      }
      const off = paging && Math.floor(Math.max(index, 0) / st.size) !== st.page;
      for (const el of [unit, unit.nextElementSibling?.localName === 'hr' ? unit.nextElementSibling : null]) {
        if (!el) continue;
        setFlag(el, 'data-calm-rec', !!reason);
        setFlag(el, 'data-calm-video', video);
        setFlag(el, 'data-calm-dup', duplicate);
        setFlag(el, 'data-calm-offpage', off);
      }
      lastUnit = unit;
    }
    st.total = index + 1;
    hideTrailing(st, lastUnit, paging);
    // Safety net: if the Join-button rule hides everything (e.g. logged out), stop using it.
    if (st.joinFilter && seen >= 6 && st.total === 0 && hiddenByJoin > 0) {
      st.joinFilter = false;
      layout(st);
    }
  }

  // Loaders and placeholders Reddit adds after the last post stay hidden while paginating.
  function hideTrailing(st, lastUnit, paging) {
    let anchor = lastUnit;
    while (anchor && anchor.parentElement !== st.feed) anchor = anchor.parentElement;
    let after = false;
    for (const child of st.feed.children) {
      if (child === anchor) { after = true; continue; }
      const trailing = paging && after && !child.matches(ANY_POST) && !child.querySelector(ANY_POST);
      setFlag(child, 'data-calm-trailing', trailing);
    }
  }

  function ensurePager(st) {
    if (!st.pager) buildPager(st);
    if (!st.pager.isConnected || st.pager.previousElementSibling !== st.feed) st.feed.after(st.pager);
    updatePager(st);
  }

  function buildPager(st) {
    const nav = document.createElement('nav');
    nav.id = 'calm-pager';
    nav.setAttribute('aria-label', 'Feed pages');
    const button = (cls, text, act) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.dataset.act = act;
      return b;
    };
    st.prev = button('calm-btn', '← Previous', 'prev');
    st.info = document.createElement('span');
    st.info.className = 'calm-info';
    st.info.setAttribute('aria-live', 'polite');
    st.next = button('calm-btn calm-primary', 'Next page →', 'next');
    nav.append(st.prev, st.info, st.next);
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled || feedState !== st) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.act === 'retry') {
        st.stalled = 0;
        st.budget = batchBudget(0);
        fill(st);
      } else {
        goTo(st, st.page + (btn.dataset.act === 'next' ? 1 : -1));
      }
    });
    st.pager = nav;
  }

  // Text is only written when it changes: each write is a DOM mutation, which schedules another refresh.
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function updatePager(st) {
    if (!st.pager) return;
    const pageFull = st.total >= (st.page + 1) * st.size;
    const sentinel = !!lastSentinel(st.feed);
    const more = st.total > (st.page + 1) * st.size || sentinel;
    const failed = st.stalled >= 3;
    const stuck = !st.filling && (failed || st.budget <= 0) && !pageFull && sentinel;
    const wait = Math.ceil((st.nextAt - performance.now()) / 1000);
    st.prev.disabled = st.page === 0 || st.filling;
    st.next.disabled = st.filling || wait > 0 || (!more && !stuck);
    st.next.dataset.act = stuck ? 'retry' : 'next';
    setText(st.next, stuck ? (failed ? 'Try again' : 'Keep looking') : wait > 0 ? `Next page in ${wait}s` : 'Next page →');
    let info = `Page ${st.page + 1}`;
    if (st.filling) info = 'Loading…';
    else if (stuck) info = failed ? `Page ${st.page + 1} · couldn’t load more` : `Page ${st.page + 1} · the rest were hidden`;
    else if (!more) info = `Page ${st.page + 1} · that’s the end`;
    setText(st.info, info);
  }

  async function goTo(st, page) {
    if (page < 0 || st.filling) return;
    st.page = page;
    st.stalled = 0;
    st.budget = batchBudget(page);
    st.nextAt = 0;
    savePage(page);
    layout(st);
    updatePager(st);
    const top = st.feed.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    await fill(st);
    if (page >= 2) lockNext(st);
  }

  // From page 3 on, "Next page" unlocks after a random 3 to 6 s, so each new page is a choice.
  function lockNext(st) {
    st.nextAt = performance.now() + (3 + Math.random() * 3) * 1000;
    const timer = setInterval(() => {
      if (feedState === st) updatePager(st);
      if (feedState !== st || performance.now() >= st.nextAt) clearInterval(timer);
    }, 250);
    updatePager(st);
  }

  const upgraded = (el) => Promise.race([customElements.whenDefined(el.localName), sleep(4000)]);

  // Load exactly one more batch for this feed.
  async function requestBatch(st) {
    const sentinel = lastSentinel(st.feed);
    if (!sentinel) return false;
    grant(batchKey(sentinel.getAttribute(REDDIT.loaderSrc)));
    stats.batchesRequested++;
    if (typeof sentinel[LOAD] !== 'function') {
      await upgraded(sentinel);
      attempt(patchLoaderClass);
      attempt(patchLoaderInstance, sentinel);
    }
    if (!sentinel.isConnected) return true; // already replaced by the new posts
    if (typeof sentinel[LOAD] !== 'function') return false;
    try { sentinel[LOAD](); } catch (err) { log('loading a batch failed', err); }
    return true;
  }

  // Load batches until the current page is full, within the page's batch budget.
  async function fill(st) {
    if (st.filling) return;
    const need = (st.page + 1) * st.size;
    if (st.total >= need || st.stalled >= 3 || st.budget <= 0 || !lastSentinel(st.feed)) {
      updatePager(st);
      return;
    }
    st.filling = true;
    updatePager(st);
    try {
      while (feedState === st && isOn('paginate') && st.total < need && st.budget > 0) {
        const before = countPosts(st.feed);
        if (!(await requestBatch(st))) break;
        const grew = await waitForMorePosts(st.feed, before);
        st.budget -= grew ? 1 : 2;
        if (!grew) st.stalled++;
        layout(st);
        if (!grew && st.stalled >= 3) break;
      }
    } finally {
      st.filling = false;
      if (feedState === st) {
        layout(st);
        updatePager(st);
      }
    }
  }

  function waitForMorePosts(feed, before, timeout = 8000) {
    const start = performance.now();
    return new Promise((resolve) => {
      (function poll() {
        if (countPosts(feed) > before) return resolve(true);
        if (performance.now() - start > timeout || !feed.isConnected) return resolve(false);
        setTimeout(poll, 100);
      })();
    });
  }

  /* ================================================================ 6. post pages */

  function mainPostOnPostPage() {
    return (address.post && document.getElementById(REDDIT.postIdPrefix + address.post)) ||
      document.querySelector(`:is(${REDDIT.main}) ${REDDIT.post}`);
  }

  // Any feed on a post page ("More posts you may like" etc.) is a recommendation.
  function refreshPostPage() {
    if (pageKind !== 'post') return;
    const mainPost = mainPostOnPostPage();
    if (!mainPost) return;
    for (const feed of document.querySelectorAll(REDDIT.feed)) {
      setFlag(feed, 'data-calm-rec', !feed.contains(mainPost));
    }
  }

  function openComments() {
    html.setAttribute('data-calm-comments-open', '');
    document.getElementById('calm-comments-gate')?.remove();
  }

  function buildGate() {
    const box = document.createElement('div');
    box.id = 'calm-comments-gate';
    const text = document.createElement('div');
    text.className = 'calm-gate-text';
    const strong = document.createElement('strong');
    strong.textContent = 'Comments are tucked away. ';
    text.append(strong, 'Read the post first, then open the thread only if you need it.');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calm-btn calm-primary';
    btn.textContent = 'Show comments';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openComments();
    });
    box.append(text, btn);
    return box;
  }

  function refreshComments() {
    let gate = document.getElementById('calm-comments-gate');
    const gated = pageKind === 'post' && isOn('comments') && !html.hasAttribute('data-calm-comments-open');
    if (!gated) {
      gate?.remove();
      return;
    }
    if (address.comment) { // you followed a link to one comment: show it
      openComments();
      return;
    }
    const anchor = document.querySelector(REDDIT.commentsStart);
    const post = mainPostOnPostPage();
    if (!anchor && !post) return;
    if (!gate) gate = buildGate();
    if (anchor) {
      if (gate.nextElementSibling !== anchor) anchor.before(gate);
    } else {
      const unit = unitOf(post);
      if (gate.previousElementSibling !== unit) unit.after(gate);
    }
  }

  /* ================================================================ 7. recommendation sections */

  // Sections are found by their heading (REDDIT.recHeading). The search skips posts and comments, and stops at the page's frame.
  const SKIP_TAGS = new Set([REDDIT.post, REDDIT.comment, REDDIT.adPost, REDDIT.feed, REDDIT.commentTree, REDDIT.unit, 'textarea', 'input', 'script', 'style', 'noscript', 'template', 'svg']);
  const STOP = `${REDDIT.main}, ${REDDIT.frame}, body, html, header`;
  // Real content a section must never contain (feeds already marked as recommendations don't count).
  const CONTENT = `${REDDIT.feed}:not([data-calm-rec]), ${REDDIT.post}:not([data-calm-rec] *), ${REDDIT.commentTree}, ${REDDIT.main}, form, input, textarea`;

  // True when `el` holds more than a heading row: the heading branch plus a list of items or real text.
  function looksLikeSection(el, headingBranch) {
    if (el.childElementCount < 2) return false;
    let items = 0;
    let textLength = 0;
    for (const child of el.children) {
      if (child === headingBranch) continue;
      if (child.matches('li, a, img, article')) items++;
      items += child.querySelectorAll('li, a, img, article').length;
      textLength += (child.textContent || '').trim().length;
    }
    return items >= 2 || textLength >= 30;
  }

  // Smallest ancestor that holds the heading plus its list, without swallowing other sections.
  function sectionFor(textNode) {
    let branch = null; // the child of `el` that contains the heading
    let el = textNode.parentElement;
    for (let depth = 0; el && depth < 9; depth++, branch = el, el = el.parentElement) {
      if (el.matches(STOP)) return null;
      if (!looksLikeSection(el, branch)) continue;
      if (el.querySelector(CONTENT)) return null;
      if (el.querySelectorAll('h1:not([data-calm-rec] *), h2:not([data-calm-rec] *)').length > 1) return null;
      if ((el.textContent || '').length > 6000 && !el.querySelector('[data-calm-rec]')) return null;
      return el;
    }
    return null;
  }

  let lastRecScan = 0;
  let recScanTimer = 0;
  function refreshRecSections() {
    if (!isOn('recs') || !document.body) return;
    const wait = 700 - (performance.now() - lastRecScan);
    if (wait > 0) {
      if (!recScanTimer) recScanTimer = setTimeout(() => { recScanTimer = 0; attempt(refreshRecSections); }, wait);
      return;
    }
    lastRecScan = performance.now();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === 1) {
          return SKIP_TAGS.has(node.localName) || node.hasAttribute('data-calm-rec') || node.id === 'calm-pager'
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        const value = node.nodeValue;
        return value.length < 80 && REDDIT.recHeading.test(value.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const hits = [];
    while (walker.nextNode()) hits.push(walker.currentNode);
    for (const textNode of hits) {
      const box = sectionFor(textNode);
      if (box) box.setAttribute('data-calm-rec', '');
    }
  }

  /* ================================================================ landmarks */

  // What the protections need to find on Reddit's pages, and the protections (data-calm-off tokens) that need it.
  // checkLandmarks() gives true for a landmark it finds, and false when Reddit changed it: a general signal shows that
  // the page has the thing (for example links to posts), but the names in REDDIT no longer find it. A landmark that
  // does not apply to the page is left out, so "missing" is never a guess.
  const LANDMARKS = {
    posts: ['paginate', 'recs'],
    feed: ['paginate'],
    loader: ['paginate'],
    counts: ['counts'],
    post: ['comments'],
    comments: ['comments'],
  };
  const FEED_PAGES = new Set(['home', 'popular', 'all', 'subreddit']);
  const POST_LINK = 'a[href*="/comments/"]'; // a link to a post (see calmPostId in blocking.js)

  // True when `root`, or a shadow root inside it, has an element that matches `selector`.
  function deepHas(root, selector) {
    if (root.querySelector(selector) || (root.shadowRoot && deepHas(root.shadowRoot, selector))) return true;
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot && deepHas(el.shadowRoot, selector)) return true;
    return false;
  }

  function checkLandmarks() {
    const found = {};
    const main = document.querySelector(REDDIT.main);
    if (FEED_PAGES.has(pageKind) && main && main.querySelectorAll(POST_LINK).length >= 3) {
      const posts = [...main.querySelectorAll(REDDIT.post)];
      const feed = posts[0]?.closest(REDDIT.feed);
      found.posts = posts.length > 0;
      if (posts.length) {
        found.feed = !!feed;
        found.counts = posts.some((post) => deepHas(post, REDDIT.number));
      }
      // The general signal for the loader: an element in or next to the feed loads from an address with a paging cursor.
      const next = feed ? [...feed.querySelectorAll(`[${REDDIT.loaderSrc}]`), ...(feed.parentElement?.children || [])]
        .filter((el) => hasCursor(el.getAttribute(REDDIT.loaderSrc))) : [];
      if (next.length) {
        const Loader = customElements.get(REDDIT.loader);
        found.loader = next.some(isLoadSentinel) && (!Loader || typeof Loader.prototype[LOAD] === 'function');
      }
    }
    if (pageKind === 'post' && document.readyState === 'complete') {
      found.post = !!mainPostOnPostPage();
      if (found.post) found.comments = !!document.querySelector(REDDIT.commentsStart);
    }
    return found;
  }

  // The protections that are on, but need a landmark that Reddit changed.
  const affectedFeatures = (found) =>
    [...new Set(Object.keys(found).filter((name) => !found[name]).flatMap((name) => LANDMARKS[name]))].filter(isOn);

  // The toolbar icon shows "!" while a protection may not work on this page (bridge.js passes the list on). The check
  // runs when the page has been quiet for 2 s, so a page that is still loading does not count.
  let healthTimer = 0;
  let healthSent = '';
  function scheduleHealthCheck() {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      const affected = JSON.stringify(attempt(() => affectedFeatures(checkLandmarks())) || []);
      if (affected === healthSent) return;
      healthSent = affected;
      document.dispatchEvent(new CustomEvent('calm:health', { detail: affected }));
    }, 2000);
  }

  /* ================================================================ diagnostics */

  function buildReport() {
    const feed = feedState?.feed || mainFeed();
    const posts = feed ? [...feed.querySelectorAll(REDDIT.post)] : [];
    const visible = (el) => (el.checkVisibility ? el.checkVisibility() : getComputedStyle(el).display !== 'none');
    const chain = [];
    for (let n = posts[0]; n && chain.length < 8; n = n.parentElement) chain.push(n.localName);
    const children = feed ? [...feed.children].map((c) => c.localName) : [];
    const loaders = [...document.querySelectorAll(REDDIT.loader)].slice(0, 12).map((s) => ({
      slot: s.getAttribute('slot'),
      loading: s.getAttribute('loading'),
      path: sanitizePath((s.getAttribute(REDDIT.loaderSrc) || '').split('?')[0]),
      cursor: hasCursor(s.getAttribute(REDDIT.loaderSrc)),
      upgraded: typeof s[LOAD] === 'function',
      inFeed: !!s.closest(REDDIT.feed),
      hidden: !visible(s),
    }));
    const landmarks = checkLandmarks();
    return {
      page: pageKind,
      landmarks,
      affected: affectedFeatures(landmarks),
      off: html.getAttribute('data-calm-off'),
      on: html.getAttribute('data-calm-on'),
      pageSize: pageSize(),
      feeds: document.querySelectorAll(REDDIT.feed).length,
      feedInMain: !!feed?.closest(REDDIT.main),
      posts: posts.length,
      visiblePosts: posts.filter((p) => visible(unitOf(p))).length,
      state: feedState && {
        page: feedState.page, total: feedState.total, filling: feedState.filling, stalled: feedState.stalled,
        budget: feedState.budget, filterRecs: feedState.filterRecs, joinFilter: feedState.joinFilter,
        pager: !!feedState.pager?.isConnected,
      },
      // Why posts count as suggestions, e.g. { global_popular_hot_sort: 21, none: 4 }.
      recommendationSources: posts.reduce((counts, p) => {
        const source = p.getAttribute(REDDIT.recSource) || 'none';
        counts[source] = (counts[source] || 0) + 1;
        return counts;
      }, {}),
      postParents: chain,
      inArticle: !!posts[0]?.closest(REDDIT.unit),
      feedChildren: { count: children.length, first: children.slice(0, 6), last: children.slice(-6) },
      loaders,
      defined: {
        feed: !!customElements.get(REDDIT.feed),
        post: !!customElements.get(REDDIT.post),
        partial: !!customElements.get(REDDIT.loader),
        gated: !!customElements.get(REDDIT.loader)?.prototype?.[LOAD]?.__calmGate,
      },
      stats,
      scroll: { y: Math.round(window.scrollY), height: html.scrollHeight, viewport: window.innerHeight },
    };
  }
  document.addEventListener('calm:diagnose', () => {
    const report = attempt(buildReport) || { error: 'report failed' };
    document.dispatchEvent(new CustomEvent('calm:diagnostics', { detail: JSON.stringify(report) }));
  });

  /* ================================================================ refresh loop */

  let refreshTimer = 0;
  let pendingNodes = [];
  let needFullScan = true;

  function scheduleRefresh(delay = 120) {
    if (!refreshTimer) refreshTimer = setTimeout(runRefresh, delay);
  }

  function scanPending() {
    if (needFullScan || pendingNodes.length > 400) {
      needFullScan = false;
      pendingNodes = [];
      scanForShadowRoots(document);
      return;
    }
    const nodes = pendingNodes;
    pendingNodes = [];
    for (const node of nodes) {
      if (!node.isConnected) continue;
      if (node.shadowRoot && !adoptedRoots.has(node.shadowRoot)) {
        adopt(node.shadowRoot);
        scanForShadowRoots(node.shadowRoot);
      }
      scanForShadowRoots(node);
    }
  }

  function runRefresh() {
    refreshTimer = 0;
    attempt(checkLocation);
    attempt(scanPending);
    attempt(refreshFeed);
    attempt(refreshPostPage);
    attempt(refreshComments);
    attempt(refreshRecSections);
    scheduleHealthCheck();
  }

  const FEEDISH = `${ANY_POST}, ${REDDIT.unit}, ${REDDIT.feed}`;
  const touchesFeed = (node) => node.matches(FEEDISH) || (node.firstElementChild !== null && node.querySelector(FEEDISH) !== null);

  new MutationObserver((records) => {
    let feedChanged = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        pendingNodes.push(node);
        if (!feedChanged && touchesFeed(node)) feedChanged = true;
      }
    }
    if (pendingNodes.length > 5000) {
      pendingNodes = [];
      needFullScan = true;
    }
    // Lay the feed out right now, before the browser paints the new posts.
    if (feedChanged) {
      attempt(checkLocation);
      attempt(syncFeed);
    }
    scheduleRefresh();
  }).observe(document, { childList: true, subtree: true });

  // Settings changed in the popup.
  new MutationObserver(() => {
    updateShadowSheet();
    attempt(syncFeed);
    scheduleRefresh(0);
  }).observe(html, { attributes: true, attributeFilter: ['data-calm-off', 'data-calm-on', 'data-calm-pagesize'] });

  // Reddit navigates without full page loads in some places.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      scheduleRefresh(30);
      return result;
    };
  }
  window.addEventListener('popstate', () => { cameBack = true; scheduleRefresh(30); });
  window.addEventListener('pageshow', () => scheduleRefresh(0));
  document.addEventListener('DOMContentLoaded', () => { needFullScan = true; scheduleRefresh(0); });
  window.addEventListener('load', () => { needFullScan = true; scheduleRefresh(0); });

  checkLocation();
  updateShadowSheet();
  scheduleRefresh(0);
})();
