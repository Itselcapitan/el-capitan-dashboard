#!/usr/bin/env node
// ─── SoundCloud Scraper ─────────────────────────────────────────
// Uses soundcloud.ts (no Apify, no login, no API key needed)
// Fetches profile stats + per-track analytics from public API
// Stores to Firebase at analytics/latest (sc + scTracks)

import { Soundcloud } from 'soundcloud.ts';

const SC_URL = 'https://soundcloud.com/itselcapitan';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET;

if (!FIREBASE_DB_URL || !FIREBASE_DB_SECRET) {
  console.error('❌ Missing FIREBASE_DB_URL or FIREBASE_DB_SECRET');
  process.exit(1);
}

async function fbPatch(path, data) {
  const url = `${FIREBASE_DB_URL}/${path}.json?auth=${FIREBASE_DB_SECRET}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PATCH ${path}: ${res.status} ${await res.text()}`);
}

async function fbGet(path) {
  const url = `${FIREBASE_DB_URL}/${path}.json?auth=${FIREBASE_DB_SECRET}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  console.log('🔊 SoundCloud Scraper (soundcloud.ts)\n');

  // Initialize — auto-discovers client_id
  const sc = new Soundcloud();

  // Fetch user profile
  console.log('📡 Fetching profile...');
  const user = await sc.users.get(SC_URL);
  console.log(`  ✓ @${user.permalink}: ${user.followers_count} followers, ${user.track_count} tracks`);

  // Fetch all tracks
  console.log('📡 Fetching tracks...');
  const tracks = await sc.users.tracks(SC_URL);
  console.log(`  ✓ ${tracks.length} tracks found`);

  // Build track data
  const scTracks = tracks.map(t => ({
    id: String(t.id),
    title: t.title || '(untitled)',
    permalink_url: t.permalink_url,
    playback_count: t.playback_count || 0,
    likes_count: t.likes_count || 0,
    comment_count: t.comment_count || 0,
    reposts_count: t.reposts_count || 0,
    download_count: t.download_count || 0,
    duration: t.duration || 0,
    genre: t.genre || '',
    created_at: t.created_at,
    artwork_url: t.artwork_url,
  })).sort((a, b) => b.playback_count - a.playback_count);

  // Calculate totals
  const totalPlays = scTracks.reduce((s, t) => s + t.playback_count, 0);
  const totalLikes = scTracks.reduce((s, t) => s + t.likes_count, 0);
  const totalComments = scTracks.reduce((s, t) => s + t.comment_count, 0);
  const totalReposts = scTracks.reduce((s, t) => s + t.reposts_count, 0);

  console.log(`\n📊 Totals: ${totalPlays} plays, ${totalLikes} likes, ${totalComments} comments, ${totalReposts} reposts`);

  // Print track table
  console.log('\n  Track                              Plays    Likes  Comments  Reposts');
  console.log('  ' + '─'.repeat(75));
  scTracks.forEach(t => {
    const name = t.title.substring(0, 35).padEnd(35);
    console.log(`  ${name} ${String(t.playback_count).padStart(7)}  ${String(t.likes_count).padStart(6)}  ${String(t.comment_count).padStart(8)}  ${String(t.reposts_count).padStart(7)}`);
  });

  // Get previous data for deltas
  const prev = await fbGet('analytics/latest/sc');
  const prevTracks = await fbGet('analytics/latest/scTracks');

  const scData = {
    followers: user.followers_count || 0,
    following: user.followings_count || 0,
    tracks: user.track_count || 0,
    totalPlays,
    totalLikes,
    totalComments,
    totalReposts,
    avgPlays: scTracks.length ? Math.round(totalPlays / scTracks.length) : 0,
    avgLikes: scTracks.length ? Math.round(totalLikes / scTracks.length) : 0,
  };

  // Calculate deltas if we have previous data
  if (prev && prev.followers !== undefined) {
    const deltas = {
      followers: { value: scData.followers - (prev.followers || 0) },
      totalPlays: { value: scData.totalPlays - (prev.totalPlays || 0) },
      totalLikes: { value: scData.totalLikes - (prev.totalLikes || 0) },
    };
    console.log(`\n📈 Deltas: followers ${deltas.followers.value >= 0 ? '+' : ''}${deltas.followers.value}, plays ${deltas.totalPlays.value >= 0 ? '+' : ''}${deltas.totalPlays.value}, likes ${deltas.totalLikes.value >= 0 ? '+' : ''}${deltas.totalLikes.value}`);

    // Update SC deltas
    await fbPatch('analytics/latest/deltas', { sc: deltas });
  }

  // Write to Firebase
  console.log('\n💾 Writing to Firebase...');
  await Promise.all([
    fbPatch('analytics/latest', {
      sc: scData,
      scTracks,
      scScrapedAt: new Date().toISOString(),
    }),
  ]);

  console.log(`\n✅ Done! ${scTracks.length} tracks | ${scData.followers} followers | ${totalPlays} total plays`);
}

main().catch(err => {
  console.error('❌ SoundCloud scrape failed:', err);
  process.exit(1);
});
