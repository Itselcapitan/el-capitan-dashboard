/**
 * Daily IG Scrape — Apify → Firebase
 *
 * Scrapes Instagram profile + latest posts via Apify actors,
 * transforms data into MSE.ig format, writes to Firebase Realtime DB.
 *
 * Env vars: APIFY_TOKEN, FIREBASE_DB_URL
 */

import { ApifyClient } from 'apify-client';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://el-capitan-dashboard-default-rtdb.firebaseio.com';
const IG_USERNAME = 'itselcapitan_';

if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN environment variable');
  process.exit(1);
}

const client = new ApifyClient({ token: APIFY_TOKEN });

async function scrapeProfile() {
  console.log('Scraping IG profile...');
  const run = await client.actor('apify/instagram-profile-scraper').call({
    usernames: [IG_USERNAME],
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  if (!items.length) throw new Error('No profile data returned');
  return items[0];
}

async function scrapePosts() {
  console.log('Scraping IG posts...');
  const run = await client.actor('apify/instagram-post-scraper').call({
    username: [IG_USERNAME],
    resultsLimit: 12,
  });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

function transformData(profile, posts) {
  const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
  const totalEng = totalLikes + totalComments;
  const engRate = profile.followersCount > 0
    ? ((totalEng / posts.length) / profile.followersCount * 100).toFixed(1)
    : '0';

  const ig = {
    followers: profile.followersCount || 0,
    following: profile.followsCount || 0,
    posts: profile.postsCount || 0,
    bio: profile.biography || '',
    profilePic: profile.profilePicUrl || '',
    verified: profile.verified || false,
    isBusinessAccount: profile.isBusinessAccount || false,
    engRate: parseFloat(engRate),
    avgLikes: posts.length ? Math.round(totalLikes / posts.length) : 0,
    avgComments: posts.length ? Math.round(totalComments / posts.length) : 0,
  };

  const postData = posts.map(p => ({
    id: p.id || p.shortCode,
    shortCode: p.shortCode,
    caption: (p.caption || '').slice(0, 200),
    likesCount: p.likesCount || 0,
    commentsCount: p.commentsCount || 0,
    type: p.type || p.productType || 'unknown',
    timestamp: p.timestamp,
    url: p.url,
    hashtags: p.hashtags || [],
  }));

  return { ig, posts: postData };
}

async function writeToFirebase(path, data) {
  const url = `${FIREBASE_DB_URL}/${path}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase PUT ${path} failed: ${res.status} ${text}`);
  }
  console.log(`Wrote ${path} to Firebase`);
}

async function main() {
  const now = new Date().toISOString();
  const dateKey = now.slice(0, 10); // YYYY-MM-DD

  // Run both scrapers in parallel
  const [profile, posts] = await Promise.all([
    scrapeProfile(),
    scrapePosts(),
  ]);

  console.log(`Profile: ${profile.followersCount} followers, ${profile.postsCount} posts`);
  console.log(`Posts: ${posts.length} scraped`);

  const { ig, posts: postData } = transformData(profile, posts);

  const payload = {
    scrapedAt: now,
    ig,
    posts: postData,
  };

  // Write latest snapshot + daily history entry in parallel
  await Promise.all([
    writeToFirebase('analytics/latest', payload),
    writeToFirebase(`analytics/history/${dateKey}`, {
      scrapedAt: now,
      ig,
    }),
  ]);

  console.log('Done! Scraped and saved to Firebase.');
}

main().catch(err => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
