import { z } from 'zod';

const schema = z.object({ query: z.string().trim().min(2).max(200) });

const demos = [
  { id: 'seoul', name: '서울', address: '서울특별시 중구', latitude: 37.5665, longitude: 126.978, countryCode: 'KR' },
  { id: 'gocheok', name: '고척스카이돔', address: '서울특별시 구로구 경인로 430', latitude: 37.4982, longitude: 126.8671, countryCode: 'KR' },
  { id: 'busan', name: '부산 아시아드주경기장', address: '부산광역시 연제구 월드컵대로 344', latitude: 35.1902, longitude: 129.058, countryCode: 'KR' },
  { id: 'inspire', name: '인스파이어 아레나', address: '인천광역시 중구 공항문화로 127', latitude: 37.4654, longitude: 126.4185, countryCode: 'KR' },
  { id: 'zozo', name: 'ZOZO Marine Stadium', address: '1 Mihama, Mihama Ward, Chiba, Japan', latitude: 35.6456, longitude: 140.0308, countryCode: 'JP' },
];

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: '도시, 공연장 또는 주소를 입력해 주세요.' }, { status: 400 });
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    const needle = parsed.data.query.toLowerCase();
    const candidates = demos.filter((item) => `${item.name} ${item.address}`.toLowerCase().includes(needle) || needle.includes(item.name.toLowerCase()));
    return Response.json({ candidates: candidates.length ? candidates : demos.slice(0, 3), demo: true });
  }
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', parsed.data.query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('language', 'ko,en');
  url.searchParams.set('permanent', 'true');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) return Response.json({ error: '장소 검색 서비스가 응답하지 않았어요.' }, { status: 502 });
  const data = await response.json() as { features?: Array<any> };
  return Response.json({ candidates: (data.features || []).map((feature) => ({ id: feature.id, name: feature.properties?.name_preferred || feature.properties?.name || feature.text || parsed.data.query, address: feature.properties?.full_address || feature.place_name || feature.properties?.place_formatted || parsed.data.query, longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1], countryCode: (feature.properties?.context?.country?.country_code || feature.properties?.country_code || '').toUpperCase() })) });
}
