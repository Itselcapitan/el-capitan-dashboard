#!/usr/bin/env node
// ─── SoundCloud Scraper ─────────────────────────────────────────
// Uses soundcloud.ts (no Apify, no login, no API key needed)
// Fetches profile stats + per-track analytics from public API
// Stores to Firebase at analytics/latest (sc + scTracks)

import { Soundcloud } from 'soundcloud.ts';
import { ApifyClient } from 'apify-client';

const SC_URL = 'https://soundcloud.com/itselcapitan';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
const FIREBASE_DB_SECRET = process.env.FIREBASE_DB_SECRET;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

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

  // Fetch all tracks (with fallback for datacenter IP 403s)
  console.log('📡 Fetching tracks...');
  let tracks = [];
  try {
    tracks = await sc.users.tracks(SC_URL);
    console.log(`  ✓ ${tracks.length} tracks found (via soundcloud.ts)`);
  } catch (err) {
    console.warn(`  ⚠️ soundcloud.ts tracks failed: ${err.message}`);
    console.log('  📡 Trying direct v2 API fallback...');
    try {
      const clientId = sc.api.clientID;
      const userId = user.id;
      const v2Url = `https://api-v2.soundcloud.com/users/${userId}/tracks?client_id=${clientId}&limit=50&offset=0`;
      const v2Res = await fetch(v2Url);
      if (!v2Res.ok) throw new Error(`v2 API returned ${v2Res.status}`);
      const v2Data = await v2Res.json();
      tracks = v2Data.collection || v2Data || [];
      console.log(`  ✓ ${tracks.length} tracks found (via v2 API fallback)`);
    } catch (err2) {
      console.warn(`  ⚠️ v2 API fallback also failed: ${err2.message}`);
      // Fallback 3: Apify SoundCloud scraper (runs on Apify's proxied infra, avoids datacenter IP blocks)
      if (APIFY_TOKEN) {
        console.log('  📡 Trying Apify SoundCloud scraper fallback...');
        try {
          const client = new ApifyClient({ token: APIFY_TOKEN });
          const run = await client.actor('cryptosignals/soundcloud-scraper').call({
            action: 'user',
            url: SC_URL,
            maxItems: 50,
          });
          const { items } = await client.dataset(run.defaultDatasetId).listItems();
          // Actor returns a single user object with trackList array
          const userData = items[0];
          if (userData?.trackList?.length) {
            // Map Apify field names to soundcloud.ts format
            tracks = userData.trackList.map(t => ({
              id: t.id,
              title: t.title,
              permalink_url: t.url,
              playback_count: t.plays || 0,
              likes_count: t.likes || 0,
              comment_count: t.comments || 0,
              reposts_count: t.reposts || 0,
              download_count: 0,
              duration: t.duration || 0,
              genre: t.genre || '',
              created_at: t.createdAt,
              artwork_url: t.imageUrl,
            }));
            console.log(`  ✓ ${tracks.length} tracks found (via Apify actor)`);
          } else {
            console.log(`  ⚠️ Apify returned profile but no trackList`);
          }
        } catch (err3) {
          console.warn(`  ⚠️ Apify fallback failed: ${err3.message}`);
        }
      }
      if (!tracks.length) {
        console.log('  ℹ️ Continuing with profile-only data (no tracks)');
      }
    }
  }

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
  console.log('\n  Track                              Released      Plays    Likes  Comments  Reposts');
  console.log('  ' + '─'.repeat(90));
  scTracks.forEach(t => {
    const name = t.title.substring(0, 35).padEnd(35);
    const released = (t.created_at || '').substring(0, 10).padEnd(10) || '—'.padEnd(10);
    console.log(`  ${name} ${released}  ${String(t.playback_count).padStart(7)}  ${String(t.likes_count).padStart(6)}  ${String(t.comment_count).padStart(8)}  ${String(t.reposts_count).padStart(7)}`);
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

  // If no tracks fetched, preserve previous tracks from Firebase
  const finalTracks = scTracks.length > 0 ? scTracks : (prevTracks || []);
  if (!scTracks.length && prevTracks && prevTracks.length) {
    console.log(`\n📌 Preserving ${prevTracks.length} previous tracks from Firebase (no fresh track data)`);
  }

  // Write to Firebase
  console.log('\n💾 Writing to Firebase...');
  await Promise.all([
    fbPatch('analytics/latest', {
      sc: scData,
      scTracks: finalTracks,
      scScrapedAt: new Date().toISOString(),
    }),
  ]);

  console.log(`\n✅ Done! ${finalTracks.length} tracks | ${scData.followers} followers | ${totalPlays} total plays`);
}

main().catch(err => {
  console.error('❌ SoundCloud scrape failed:', err);
  process.exit(1);
});
