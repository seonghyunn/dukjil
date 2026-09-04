import { NextResponse } from 'next/server';
import { z } from 'zod';

const requestSchema = z.object({
  setlistId: z.string().trim().min(6).max(32).optional(),
  artist: z.string().trim().min(1).max(200).optional(),
  performanceAt: z.iso.datetime({ offset: true }).optional(),
  venue: z.string().trim().max(300).optional(),
});

type ApiSetlist = {
  id?: string;
  url?: string;
  eventDate?: string;
  artist?: { name?: string };
  venue?: { name?: string; city?: { name?: string } };
  sets?: { set?: Array<{ song?: Array<{ name?: string; tape?: boolean }> }> };
};

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '검색할 공연 정보가 올바르지 않아요.' }, { status: 400 });
  const apiKey = process.env.SETLIST_FM_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: 'setlist.fm API 키가 아직 서버에 등록되지 않았어요.' }, { status: 503 });

  const { setlistId, artist, performanceAt } = parsed.data;
  if (!setlistId && (!artist || !performanceAt)) return NextResponse.json({ error: '아티스트와 공연일이 필요해요.' }, { status: 400 });

  const endpoint = setlistId
    ? `https://api.setlist.fm/rest/1.0/setlist/${encodeURIComponent(setlistId)}`
    : searchUrl(artist!, performanceAt!);
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'Accept-Language': 'en', 'x-api-key': apiKey },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) return NextResponse.json({ error: 'setlist.fm에 연결하지 못했어요.' }, { status: 502 });
  if (response.status === 404) return NextResponse.json({ candidates: [] });
  if (!response.ok) return NextResponse.json({ error: response.status === 403 ? 'API 키가 아직 활성화되지 않았거나 사용할 수 없어요.' : `setlist.fm 응답 오류 (${response.status})` }, { status: 502 });

  const payload = await response.json() as ApiSetlist | { setlist?: ApiSetlist[] };
  const rows = setlistId ? [payload as ApiSetlist] : ((payload as { setlist?: ApiSetlist[] }).setlist || []);
  return NextResponse.json({ candidates: rows.map(toCandidate).filter((item) => item.id && item.songs.length) });
}

function searchUrl(artist: string, performanceAt: string) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(performanceAt)).replaceAll('/', '-');
  const params = new URLSearchParams({ artistName: artist, date });
  return `https://api.setlist.fm/rest/1.0/search/setlists?${params}`;
}

function toCandidate(row: ApiSetlist) {
  const songs = (row.sets?.set || []).flatMap((section) => section.song || []).filter((song) => !song.tape && song.name?.trim()).map((song) => song.name!.trim());
  return { id: row.id || '', url: row.url || '', eventDate: row.eventDate || '', artist: row.artist?.name || '', venue: row.venue?.name || '', city: row.venue?.city?.name || '', songs };
}
