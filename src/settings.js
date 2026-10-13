/* Calm Reddit: shared defaults, used by the content script, the popup and the welcome page. */

// Protections start ON. Everything from grayscale down is an opt-in extra.
const CALM_DEFAULTS = Object.freeze({
  enabled: true,          // master switch
  paginate: true,         // pages instead of infinite scroll
  pageSize: 10,           // posts per page
  hideRecs: true,         // suggested posts, sidebars, trending, Popular/Explore links
  hideCounts: true,       // votes, comment counts, awards
  hideAds: true,          // promoted posts and ad slots
  blurMedia: true,        // blur images/video in feeds until hovered
  noAutoplay: true,       // videos only play when you press play
  gateComments: true,     // comments behind a "Show comments" button
  pause: true,            // breather screen when you arrive
  pauseSeconds: 10,
  pauseAwayMinutes: 15,   // how long away counts as a new visit
  grayscale: false,
  hideSidebars: false,    // left menu and right sidebar on every page
  hideLogo: false,        // the Reddit logo (a shortcut to the Home feed)
  hideVideos: false,      // video and GIF posts in feeds
  // Pages replaced by a short note (see src/blocking.js).
  blockHome: false,
  blockPopular: false,    // r/popular and r/all
  blockExplore: false,
  blockSearch: false,
  blockSubreddits: false, // subreddit feeds; posts opened from a link still work
  blockProfiles: false,   // other people's profiles
  blockNotifications: false,
  subredditMode: 'off',   // off | allow (only listed subreddits) | block (listed subreddits)
  subreddits: [],         // lowercase names without "r/"
});

// Setting key -> token written to <html> for calm.css and page.js.
// Features that default ON are listed in data-calm-off while turned off, so they apply before settings load.
// Opt-in extras are listed in data-calm-on while turned on.
const CALM_FEATURES = Object.freeze([
  ['paginate', 'paginate'],
  ['hideRecs', 'recs'],
  ['hideCounts', 'counts'],
  ['hideAds', 'ads'],
  ['blurMedia', 'blur'],
  ['noAutoplay', 'autoplay'],
  ['gateComments', 'comments'],
  ['grayscale', 'grayscale'],
  ['hideSidebars', 'sidebars'],
  ['hideLogo', 'logo'],
  ['hideVideos', 'videos'],
]);
