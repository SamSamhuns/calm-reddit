/*
 * Calm Reddit: which pages are blocked. Decided from the URL alone, so it works on old Reddit too.
 * Pure functions (no DOM, no chrome.*), shared by bridge.js and the unit tests.
 */

// Lowercase subreddit names from free text: "r/AskReddit, /r/news\nhomelab" -> ['askreddit', 'news', 'homelab'].
function calmParseSubreddits(text) {
  const names = String(text || '')
    .split(/[\s,]+/)
    .map((s) => s.replace(/^\/?r\//i, '').replace(/\/+$/, '').toLowerCase())
    .filter((s) => /^[a-z0-9_]{2,21}$/.test(s));
  return [...new Set(names)];
}

// Returns why the page at `url` is blocked, or '' when it's allowed.
// `ownProfile` is true when a /user/ page is your own profile (only bridge.js can tell from the page).
function calmBlockReason(url, settings, { ownProfile = false } = {}) {
  if (!settings.enabled) return '';
  let path;
  try { path = new URL(url).pathname; } catch { return ''; }

  if (/^\/(?:(?:best|hot|new|top|rising|controversial)\/?)?$/i.test(path) || /^\/home(?:\/|$)/i.test(path)) {
    return settings.blockHome ? 'The Home feed is blocked.' : '';
  }
  if (/^\/r\/(?:popular|all)(?:\/|$)/i.test(path)) {
    return settings.blockPopular ? 'r/popular and r/all are blocked.' : '';
  }
  if (/^\/(?:explore|topics)(?:\/|$)/i.test(path)) {
    return settings.blockExplore ? 'Explore is blocked.' : '';
  }
  if (/^\/(?:notifications|message)(?:\/|$)/i.test(path)) {
    return settings.blockNotifications ? 'Notifications are blocked.' : '';
  }

  // Everything inside a subreddit (feed, posts, search, wiki) follows your subreddit list.
  const sub = path.match(/^\/r\/([^/]+)\/?(.*)$/i);
  if (sub) {
    const name = sub[1].toLowerCase();
    const listed = (settings.subreddits || []).includes(name);
    if (settings.subredditMode === 'block' && listed) return `r/${name} is on your block list.`;
    if (settings.subredditMode === 'allow' && !listed) return `r/${name} isn't on your allow list.`;
  }

  if (/^\/(?:r\/[^/]+\/)?search(?:\/|$)/i.test(path)) {
    return settings.blockSearch ? 'Search results are blocked.' : '';
  }

  const profile = path.match(/^\/(?:u|user)\/[^/]+\/?(.*)$/i);
  if (profile) {
    const isPost = /^comments\//i.test(profile[1]);
    return settings.blockProfiles && !isPost && !ownProfile ? 'User profiles are blocked.' : '';
  }

  if (sub) {
    const isPost = /^comments\//i.test(sub[2]);
    return settings.blockSubreddits && !isPost ? 'Subreddit feeds are blocked. Posts you open from a link still work.' : '';
  }
  return '';
}
