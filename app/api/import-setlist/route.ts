import { NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  setlistId: z.string().trim().min(6).max(32).optional(),
  artist: z.string().trim().min(1).max(200).optional(),
  artistMbid: z.uuid().optional(),
  title: z.string().trim().max(400).optional(),
  performanceAt: z.iso.datetime({ offset: true }).optional(),
  venue: z.string().trim().max(300).optional(),
});

type ApiSetlist = { id?: string; url?: string; eventDate?: string; artist?: { name?: string }; venue?: { name?: string; city?: { name?: string } }; sets?: { set?: Array<{ song?: Array<{ name?: string; tape?: boolean }> }> } };
type SetlistArtist = { mbid?: string; name?: string };
type ArtistMatch = { mbid: string; name: string; score: number; englishName: string };

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '검색할 공연 정보가 올바르지 않아요.' }, { status: 400 });
  const apiKey = process.env.SETLIST_FM_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: 'setlist.fm API 키가 아직 서버에 등록되지 않았어요.' }, { status: 503 });
  const { setlistId, artist, artistMbid, title, performanceAt } = parsed.data;
  if (setlistId) return fetchById(setlistId, apiKey);
  if (!artist || !performanceAt) return NextResponse.json({ error: '검색용 아티스트명과 공연일이 필요해요.' }, { status: 400 });

  let resolvedQuery = artist;
  let artistMatches = artistMbid ? [{ mbid: artistMbid, name: artist, englishName: artist, score: 100 }] : await resolveArtists(artist, apiKey);
  const titleHint = title ? artistHintFromTitle(title) : '';
  if (!artistMatches.length && titleHint && titleHint !== artist) {
    resolvedQuery = titleHint;
    artistMatches = await resolveArtists(titleHint, apiKey);
  }
  const date = concertDate(performanceAt);
  const searches = artistMatches.length
    ? artistMatches.slice(0, 3).map((match) => fetchSetlists(new URLSearchParams({ artistMbid: match.mbid, date }), apiKey))
    : [fetchSetlists(new URLSearchParams({ artistName: artist, date }), apiKey)];
  let results: ApiSetlist[];
  try {
    results = (await Promise.all(searches)).flat();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'setlist.fm에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    );
  }
  const candidates = uniqueSetlists(results).map(toCandidate).filter((item) => item.id && item.songs.length);
  return NextResponse.json({ query: artist, resolvedQuery, title: title || '', artistMatches, candidates });
}

async function fetchById(setlistId: string, apiKey: string) {
  const response = await setlistFetch(`https://api.setlist.fm/rest/1.0/setlist/${encodeURIComponent(setlistId)}`, apiKey).catch(() => null);
  if (!response) return NextResponse.json({ error: 'setlist.fm에 연결하지 못했어요.' }, { status: 502 });
  if (response.status === 404) return NextResponse.json({ candidates: [] });
  if (!response.ok) return apiError(response.status);
  const payload = await response.json() as ApiSetlist;
  return NextResponse.json({ candidates: [toCandidate(payload)].filter((item) => item.id && item.songs.length) });
}

async function resolveArtists(query: string, apiKey: string): Promise<ArtistMatch[]> {
  const params = new URLSearchParams({ artistName: query, p: '1', sort: 'relevance' });
  const response = await setlistFetch(`https://api.setlist.fm/rest/1.0/search/artists?${params}`, apiKey).catch(() => null);
  if (!response || response.status === 404 || !response.ok) return [];
  const payload = await response.json() as { artist?: SetlistArtist[] };
  return (payload.artist || []).filter((item) => item.mbid && item.name).slice(0, 5).map((item, index) => ({ mbid: item.mbid!, name: item.name!, englishName: item.name!, score: Math.max(60, 100 - index * 10) }));
}

async function fetchSetlists(params: URLSearchParams, apiKey: string): Promise<ApiSetlist[]> {
  const response = await setlistFetch(`https://api.setlist.fm/rest/1.0/search/setlists?${params}`, apiKey).catch(() => null);
  if (!response) throw new Error('setlist.fm에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(response.status === 403 ? 'API 키가 아직 활성화되지 않았거나 사용할 수 없어요.' : `setlist.fm 응답 오류 (${response.status})`);
  const payload = await response.json() as { setlist?: ApiSetlist[] };
  return payload.setlist || [];
}

function setlistFetch(url: string, apiKey: string) {
  return fetch(url, { headers: { Accept: 'application/json', 'x-api-key': apiKey }, signal: AbortSignal.timeout(10000) });
}

function apiError(status: number) {
  return NextResponse.json({ error: status === 403 ? 'API 키가 아직 활성화되지 않았거나 사용할 수 없어요.' : `setlist.fm 응답 오류 (${status})` }, { status: 502 });
}

function concertDate(performanceAt: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(performanceAt)).replaceAll('/', '-');
}

function artistHintFromTitle(title: string) {
  return title.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b(world\s+tour|tour|concert|live|festival|fan\s*meeting|in\s+(seoul|korea|busan))\b/gi, ' ').replace(/(월드\s*투어|투어|콘서트|공연|내한|페스티벌|팬미팅)/g, ' ').replace(/[<>{}[\]():|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueSetlists(rows: ApiSetlist[]) {
  return [...new Map(rows.filter((row) => row.id).map((row) => [row.id!, row])).values()];
}

function toCandidate(row: ApiSetlist) {
  const songs = (row.sets?.set || []).flatMap((section) => section.song || []).filter((song) => !song.tape && song.name?.trim()).map((song) => song.name!.trim());
  return { id: row.id || '', url: row.url || '', eventDate: row.eventDate || '', artist: row.artist?.name || '', venue: row.venue?.name || '', city: row.venue?.city?.name || '', songs };
}
