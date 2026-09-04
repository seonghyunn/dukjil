import { z } from 'zod';

const schema = z.object({ query: z.string().trim().min(2).max(200) });

const demos = [
  {
    id: 'seoul',
    name: '서울',
    address: '서울특별시 중구',
    latitude: 37.5665,
    longitude: 126.978,
    countryCode: 'KR',
  },
  {
    id: 'gocheok',
    name: '고척스카이돔',
    address: '서울특별시 구로구 경인로 430',
    latitude: 37.4982,
    longitude: 126.8671,
    countryCode: 'KR',
  },
  {
    id: 'busan',
    name: '부산 아시아드주경기장',
    address: '부산광역시 연제구 월드컵대로 344',
    latitude: 35.1902,
    longitude: 129.058,
    countryCode: 'KR',
  },
  {
    id: 'inspire',
    name: '인스파이어 아레나',
    address: '인천광역시 중구 공항문화로 127',
    latitude: 37.4654,
    longitude: 126.4185,
    countryCode: 'KR',
  },
  {
    id: 'olympic-hall',
    name: '올림픽홀',
    address: '서울특별시 송파구 올림픽로 424 올림픽공원',
    latitude: 37.5141,
    longitude: 127.1274,
    countryCode: 'KR',
  },
  {
    id: 'kspo-dome',
    name: 'KSPO DOME',
    address: '서울특별시 송파구 올림픽로 424 올림픽공원',
    latitude: 37.5193,
    longitude: 127.127,
    countryCode: 'KR',
  },
  {
    id: 'jamsil-arena',
    name: '잠실실내체육관',
    address: '서울특별시 송파구 올림픽로 25',
    latitude: 37.5161,
    longitude: 127.0767,
    countryCode: 'KR',
  },
  {
    id: 'zozo',
    name: 'ZOZO Marine Stadium',
    address: '1 Mihama, Mihama Ward, Chiba, Japan',
    latitude: 35.6456,
    longitude: 140.0308,
    countryCode: 'JP',
  },
];

type Candidate = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  countryCode: string;
};
const searchCache = new Map<
  string,
  { expiresAt: number; candidates: Candidate[] }
>();
let lastOpenStreetMapRequest = 0;

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: '도시, 공연장 또는 주소를 입력해 주세요.' },
      { status: 400 },
    );
  const needle = parsed.data.query.toLowerCase();
  const savedCandidates = demos
    .filter(
      (item) =>
        `${item.name} ${item.address}`.toLowerCase().includes(needle) ||
        needle.includes(item.name.toLowerCase()),
    )
    .sort((a, b) => b.name.length - a.name.length);
  if (savedCandidates.length)
    return Response.json({ candidates: savedCandidates, provider: 'saved' });

  const cached = searchCache.get(needle);
  if (cached && cached.expiresAt > Date.now())
    return Response.json({
      candidates: cached.candidates,
      provider: 'openstreetmap-cache',
    });

  const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
  searchUrl.searchParams.set('q', parsed.data.query);
  searchUrl.searchParams.set('format', 'jsonv2');
  searchUrl.searchParams.set('addressdetails', '1');
  searchUrl.searchParams.set('accept-language', 'ko,en');
  searchUrl.searchParams.set('limit', '5');
  try {
    const waitMs = Math.max(0, 1000 - (Date.now() - lastOpenStreetMapRequest));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastOpenStreetMapRequest = Date.now();
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'user-agent':
          'DukjilLog/1.0 (https://dukjil-log.withgrshsh.chatgpt.site)',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!searchResponse.ok)
      return Response.json(
        { error: '장소 검색 서비스가 잠시 응답하지 않아요.' },
        { status: 502 },
      );
    const data = (await searchResponse.json()) as Array<{
      place_id: number;
      osm_type?: string;
      osm_id?: number;
      name?: string;
      display_name: string;
      lat: string;
      lon: string;
      address?: { country_code?: string };
    }>;
    const candidates = data
      .map((item) => ({
        id: `osm-${item.osm_type || 'place'}-${item.osm_id || item.place_id}`,
        name: item.name || item.display_name.split(',')[0] || parsed.data.query,
        address: item.display_name,
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        countryCode: (item.address?.country_code || '').toUpperCase(),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
      );
    searchCache.set(needle, {
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      candidates,
    });
    if (searchCache.size > 100)
      searchCache.delete(searchCache.keys().next().value as string);
    return Response.json({ candidates, provider: 'openstreetmap' });
  } catch {
    return Response.json(
      {
        error: '장소 검색 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.',
      },
      { status: 502 },
    );
  }
}
