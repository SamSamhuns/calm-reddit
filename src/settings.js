/* Calm Reddit: shared defaults, used by the content script, the popup and the welcome page. */

// Every protection starts ON. Grayscale is the only opt-in extra.
const CALM_DEFAULTS = Object.freeze({
  enabled: true,          // master switch
  paginate: true,         // pages instead of infinite scroll
  pageSize: 10,           // posts per page
  hideRecs: true,         // suggested posts, sidebars, trending, Popular/Explore links
  hideCounts: true,       // votes, comment counts, awards
  blurMedia: true,        // blur images/video in feeds until hovered
  noAutoplay: true,       // videos only play when you press play
  gateComments: true,     // comments behind a "Show comments" button
  pause: true,            // breather screen when you arrive
  pauseSeconds: 10,
  pauseAwayMinutes: 15,   // how long away counts as a new visit
  grayscale: false,
});

// Setting key -> token written to <html data-calm-off="..."> when that feature is off.
const CALM_FEATURES = Object.freeze([
  ['paginate', 'paginate'],
  ['hideRecs', 'recs'],
  ['hideCounts', 'counts'],
  ['blurMedia', 'blur'],
  ['noAutoplay', 'autoplay'],
  ['gateComments', 'comments'],
]);
