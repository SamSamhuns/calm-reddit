/*
 * Calm Reddit: what Reddit's addresses mean (page types, posts, comments) and which pages are blocked.
 * Decided from the URL alone, so it works on old Reddit too. Pure functions (no DOM, no chrome.*), shared by
 * bridge.js, page.js (in Reddit's own JS world), the popup and the unit tests.
 */

// The kind of Reddit page at `path`: home | popular | all | explore | notifications | post | search | subreddit | profile | other.
function calmPageType(path) {
  if (/^\/(?:(?:best|hot|new|top|rising|controversial)\/?)?$/i.test(path) || /^\/home(?:\/|$)/i.test(path)) return 'home';
  if (/^\/r\/popular(?:\/|$)/i.test(path)) return 'popular';
  if (/^\/r\/all(?:\/|$)/i.test(path)) return 'all';
  if (/^\/(?:explore|topics)(?:\/|$)/i.test(path)) return 'explore';
  if (/^\/(?:notifications|message)(?:\/|$)/i.test(path)) return 'notifications';
  if (calmPostId(path)) return 'post';
  if (/^\/(?:r\/[^/]+\/)?search(?:\/|$)/i.test(path)) return 'search';
  if (/^\/r\/[^/]+/i.test(path)) return 'subreddit';
  if (/^\/(?:u|user)\/[^/]+/i.test(path)) return 'profile';
  return 'other';
}

// The id of the post at `path` ("abc123" in /r/aww/comments/abc123/title/), or ''.
function calmPostId(path) {
  return (String(path).match(/\/comments\/([a-z0-9]+)/i) || [])[1] || '';
}

// True when the address points to one comment in a thread, not to the whole post.
function calmIsCommentLink(path, search = '') {
  return /\/comments\/[a-z0-9]+\/[^/]+\/[a-z0-9]+\/?$/i.test(path) ||
    /\/comments\/[a-z0-9]+\/comment\/[a-z0-9]+/i.test(path) ||
    /[?&](comment|context)=/i.test(search);
}

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
  const type = calmPageType(path);

  if (type === 'home') return settings.blockHome ? 'The Home feed is blocked.' : '';
  if (type === 'popular' || type === 'all') return settings.blockPopular ? 'r/popular and r/all are blocked.' : '';
  if (type === 'explore') return settings.blockExplore ? 'Explore is blocked.' : '';
  if (type === 'notifications') return settings.blockNotifications ? 'Notifications are blocked.' : '';

  // Everything inside a subreddit (feed, posts, search, wiki) follows your subreddit list.
  const sub = path.match(/^\/r\/([^/]+)/i);
  if (sub) {
    const name = sub[1].toLowerCase();
    const listed = (settings.subreddits || []).includes(name);
    if (settings.subredditMode === 'block' && listed) return `r/${name} is on your block list.`;
    if (settings.subredditMode === 'allow' && !listed) return `r/${name} isn't on your allow list.`;
  }

  // Posts you open from a link (type 'post') still work, also from profiles and subreddits.
  if (type === 'search') return settings.blockSearch ? 'Search results are blocked.' : '';
  if (type === 'profile') return settings.blockProfiles && !ownProfile ? 'User profiles are blocked.' : '';
  if (type === 'subreddit') {
    return settings.blockSubreddits ? 'Subreddit feeds are blocked. Posts you open from a link still work.' : '';
  }
  return '';
}
