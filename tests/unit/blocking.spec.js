// Unit tests for src/blocking.js. The extension scripts are plain browser scripts (no modules),
// so they're evaluated in a sandbox, the same way Chrome loads them into a content script.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { URL };
vm.createContext(sandbox);
for (const file of ['src/settings.js', 'src/blocking.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), sandbox, { filename: file });
}
const { calmBlockReason, calmParseSubreddits, calmPageType, calmPostId, calmIsCommentLink } = sandbox;
const DEFAULTS = vm.runInContext('CALM_DEFAULTS', sandbox);

const R = 'https://www.reddit.com';
const reason = (url, overrides = {}, options) => calmBlockReason(url, { ...DEFAULTS, ...overrides }, options);

test.describe('calmBlockReason', () => {
  test('blocks nothing by default', () => {
    for (const url of ['/', '/r/popular/', '/r/all', '/explore', '/search/?q=x', '/user/spez/', '/r/aww/', '/notifications']) {
      expect(reason(R + url), url).toBe('');
    }
  });

  test('blocks nothing when Calm Reddit is off', () => {
    expect(reason(`${R}/`, { enabled: false, blockHome: true })).toBe('');
  });

  test('Home feed, including sort orders', () => {
    for (const url of ['/', '/best/', '/new', '/top/?t=day', '/home']) {
      expect(reason(R + url, { blockHome: true }), url).toContain('Home');
    }
    expect(reason(`${R}/r/aww/`, { blockHome: true })).toBe('');
  });

  test('Popular & All, Explore, Notifications', () => {
    expect(reason(`${R}/r/popular/`, { blockPopular: true })).toContain('r/popular');
    expect(reason(`${R}/r/all/top/`, { blockPopular: true })).toContain('r/all');
    expect(reason(`${R}/explore/`, { blockExplore: true })).toContain('Explore');
    expect(reason(`${R}/notifications`, { blockNotifications: true })).toContain('Notifications');
    expect(reason('https://old.reddit.com/message/inbox/', { blockNotifications: true })).toContain('Notifications');
  });

  test('search, including search inside a subreddit', () => {
    expect(reason(`${R}/search/?q=cats`, { blockSearch: true })).toContain('Search');
    expect(reason(`${R}/r/aww/search/?q=cats`, { blockSearch: true })).toContain('Search');
  });

  test('profiles: other people only, and their posts stay reachable', () => {
    expect(reason(`${R}/user/spez/`, { blockProfiles: true })).toContain('profiles');
    expect(reason(`${R}/u/spez`, { blockProfiles: true })).toContain('profiles');
    expect(reason(`${R}/user/spez/`, { blockProfiles: true }, { ownProfile: true })).toBe('');
    expect(reason(`${R}/user/spez/comments/abc123/title/`, { blockProfiles: true })).toBe('');
  });

  test('subreddit feeds: posts stay reachable', () => {
    expect(reason(`${R}/r/aww/`, { blockSubreddits: true })).toContain('Subreddit feeds');
    expect(reason(`${R}/r/aww/top/?t=week`, { blockSubreddits: true })).toContain('Subreddit feeds');
    expect(reason(`${R}/r/aww/comments/abc123/cute_dog/`, { blockSubreddits: true })).toBe('');
  });

  test('block list covers everything inside the subreddit, ignoring case', () => {
    const s = { subredditMode: 'block', subreddits: ['aww'] };
    expect(reason(`${R}/r/AWW/`, s)).toBe('r/aww is on your block list.');
    expect(reason(`${R}/r/aww/comments/abc123/x/`, s)).toContain('block list');
    expect(reason(`${R}/r/aww/search/?q=x`, s)).toContain('block list');
    expect(reason(`${R}/r/gifs/`, s)).toBe('');
  });

  test('allow list blocks every other subreddit but leaves the rest of Reddit to the page rules', () => {
    const s = { subredditMode: 'allow', subreddits: ['aww'] };
    expect(reason(`${R}/r/aww/`, s)).toBe('');
    expect(reason(`${R}/r/gifs/comments/abc123/x/`, s)).toBe("r/gifs isn't on your allow list.");
    expect(reason(`${R}/r/popular/`, s)).toBe('');
    expect(reason(`${R}/`, s)).toBe('');
  });

  test('a list that is not in use does nothing', () => {
    expect(reason(`${R}/r/aww/`, { subredditMode: 'off', subreddits: ['aww'] })).toBe('');
  });
});

test.describe('calmPageType', () => {
  test('tells the kind of page from its address', () => {
    for (const [path, type] of [
      ['/', 'home'], ['/best/', 'home'], ['/home', 'home'],
      ['/r/popular/', 'popular'], ['/r/all/top/', 'all'], ['/explore/', 'explore'], ['/notifications', 'notifications'],
      ['/r/aww/comments/abc123/cute_dog/', 'post'], ['/user/spez/comments/abc123/x/', 'post'],
      ['/search/', 'search'], ['/r/aww/search/', 'search'],
      ['/r/aww/', 'subreddit'], ['/r/aww/wiki/', 'subreddit'], ['/user/spez/', 'profile'], ['/u/spez', 'profile'],
      ['/settings/', 'other'],
    ]) {
      expect(calmPageType(path), path).toBe(type);
    }
  });
});

test.describe('posts and comments', () => {
  test('calmPostId finds the post in an address', () => {
    expect(calmPostId('/r/aww/comments/abc123/cute_dog/')).toBe('abc123');
    expect(calmPostId('/r/aww/')).toBe('');
  });

  test('calmIsCommentLink tells a link to one comment from a link to the post', () => {
    expect(calmIsCommentLink('/r/aww/comments/abc123/cute_dog/')).toBe(false);
    expect(calmIsCommentLink('/r/aww/comments/abc123/cute_dog/def456/')).toBe(true);
    expect(calmIsCommentLink('/r/aww/comments/abc123/comment/def456/')).toBe(true);
    expect(calmIsCommentLink('/r/aww/comments/abc123/cute_dog/', '?context=3')).toBe(true);
  });
});

test.describe('calmParseSubreddits', () => {
  test('accepts commas, spaces, new lines and r/ prefixes', () => {
    expect([...calmParseSubreddits('r/AskReddit, /r/news/\nhomelab  aww')]).toEqual(['askreddit', 'news', 'homelab', 'aww']);
  });

  test('drops duplicates and invalid names', () => {
    expect([...calmParseSubreddits('aww, AWW, x, not-valid, ' + 'a'.repeat(22))]).toEqual(['aww']);
    expect([...calmParseSubreddits('')]).toEqual([]);
  });
});
