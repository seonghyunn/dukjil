import { z } from 'zod';

const schema = z.object({ url: z.string().url().max(2048) });
const allowedHosts = new Set(['ticket.interpark.com', 'tickets.interpark.com', 'mobileticket.interpark.com', 'ticket.yes24.com', 'm.ticket.yes24.com', 'ticket.melon.com', 'm.ticket.melon.com']);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: '올바른 예매 페이지 URL을 입력해 주세요.' }, { status: 400 });
  let url = new URL(parsed.data.url);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return Response.json({ error: 'NOL 티켓, YES24 티켓, 멜론티켓의 HTTPS 주소만 지원해요.' }, { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const nolGoodsCode = getNolGoodsCode(url);
    if (nolGoodsCode) return Response.json(await importNolConcert(nolGoodsCode, url, controller.signal));
    const melonProdId = getMelonProdId(url);
    if (melonProdId) return Response.json(await importMelonConcert(melonProdId, url, controller.signal));

    let response: Response | null = null;
    for (let redirects = 0; redirects < 4; redirects += 1) {
      response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'DukjilLog/1.0 (+concert metadata import)' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); if (!location) break;
      url = new URL(location, url);
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error('unsafe redirect');
    }
    if (!response?.ok) throw new Error('fetch failed');
    if (!(response.headers.get('content-type') || '').includes('text/html')) return Response.json({ error: 'HTML 공연 페이지만 불러올 수 있어요.' }, { status: 415 });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 2_000_000) return Response.json({ error: '페이지가 너무 커서 자동으로 불러올 수 없어요.' }, { status: 413 });
    const html = (await response.text()).slice(0, 2_000_000);
    const metadata = url.hostname.toLowerCase().includes('yes24.com') ? extractYes24Metadata(html, url) : extractMetadata(html, url);
    return Response.json(metadata);
  } catch (error) {
    console.error('concert import failed', error);
    return Response.json({ error: '예매처가 자동 불러오기를 허용하지 않거나 페이지가 응답하지 않았어요.' }, { status: 502 });
  } finally { clearTimeout(timer); }
}

function extractYes24Metadata(html: string, url: URL) {
  const meta = (property: string) => decode(matchFirst(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`, 'i')) || matchFirst(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`, 'i')));
  const field = (label: string) => stripTags(matchFirst(html, new RegExp(`<dt[^>]*>\\s*${escapeRegex(label)}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i')));
  const title = meta('og:title').replace(/^\[예스24 티켓\]\s*/, '').trim() || decode(matchFirst(html, /<em[^>]+class=["'][^"']*gd_name[^"']*["'][^>]*>([\s\S]*?)<\/em>/i));
  const period = field('일시') || meta('description').match(/일시:\s*(20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*~\s*20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2})/)?.[1] || '';
  const range = period.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})\s*~\s*(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  const single = period.match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  const dateCandidates = range
    ? expandKoreanDateRange(`${range[1]}-${range[2].padStart(2, '0')}-${range[3].padStart(2, '0')}`, `${range[4]}-${range[5].padStart(2, '0')}-${range[6].padStart(2, '0')}`)
    : single ? [`${single[1]}-${single[2].padStart(2, '0')}-${single[3].padStart(2, '0')}T00:00:00+09:00`] : [];
  const priceSection = matchFirst(html, /<dl[^>]+class=["'][^"']*gd_priceDl[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i);
  const priceCandidates = [...new Set([...stripTags(priceSection).matchAll(/([1-9]\d{0,2}(?:,\d{3})+)\s*원/g)].map((match) => Number(match[1].replaceAll(',', ''))))].filter((value) => value >= 1000 && value <= 10_000_000);
  const leadRole = decode(matchFirst(html, /id=["']HidLeadRole["'][^>]+value=["']([^"']*)["']/i) || matchFirst(html, /value=["']([^"']*)["'][^>]+id=["']HidLeadRole["']/i));
  const artists = leadRole && leadRole !== '-' ? leadRole.split(/[,/]/).map((value) => value.trim()).filter(Boolean) : [];
  const address = decode(matchFirst(html, /id=["']HidRegionName["'][^>]+value=["']([^"']*)["']/i) || matchFirst(html, /value=["']([^"']*)["'][^>]+id=["']HidRegionName["']/i));
  const warnings: string[] = [];
  if (!artists.length) warnings.push('출연진을 직접 확인해 주세요.');
  if (dateCandidates.length > 1) warnings.push(`${period.trim()} 기간 중 실제 관람일을 선택해 주세요.`);
  if (!dateCandidates.length) warnings.push('공연 날짜를 직접 확인해 주세요.');
  if (!priceCandidates.length) warnings.push('티켓 가격을 직접 확인해 주세요.');
  return { title, artists, venue: field('장소').replace(/\s*>\s*$/, ''), address, bookingProvider: 'YES24 티켓', sourceUrl: url.toString(), posterUrl: meta('og:image'), dateCandidates, priceCandidates, warnings };
}

function expandKoreanDateRange(start: string, end: string) {
  const startParts = start.split('-').map(Number);
  const endParts = end.split('-').map(Number);
  const startTime = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
  const endTime = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  const result: string[] = [];
  for (let cursor = startTime; cursor <= endTime && result.length < 31; cursor += 86_400_000) result.push(`${new Date(cursor).toISOString().slice(0, 10)}T00:00:00+09:00`);
  return result;
}

function stripTags(value: string) {
  return decode(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function getNolGoodsCode(url: URL) {
  if (!url.hostname.toLowerCase().includes('interpark.com')) return '';
  return url.pathname.match(/\/goods\/(\d{8})(?:\/|$)/i)?.[1] || url.searchParams.get('GoodsCode')?.match(/^\d{8}$/)?.[0] || '';
}

function getMelonProdId(url: URL) {
  if (!url.hostname.toLowerCase().includes('melon.com')) return '';
  const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?') + 1) : '';
  const value = url.searchParams.get('prodId') || new URLSearchParams(hashQuery).get('prodId') || '';
  return /^\d{1,10}$/.test(value) ? value : '';
}

async function importMelonConcert(prodId: string, sourceUrl: URL, signal: AbortSignal) {
  const detailResponse = await fetchMelonJson(`/poc/performance/detail.json?prodId=${encodeURIComponent(prodId)}&v=1`, signal);
  const product = detailResponse?.result === 0 ? detailResponse.data : null;
  if (!product?.title) throw new Error('Melon detail unavailable');
  const placeResponse = product.placeId
    ? await fetchMelonJson(`/poc/place/detail.json?placeId=${encodeURIComponent(String(product.placeId))}&v=1`, signal).catch(() => null)
    : null;
  const place = placeResponse?.result === 0 ? placeResponse.data : null;
  const hall = Array.isArray(place?.placeHallVoList) ? place.placeHallVoList.find((item: any) => Number(item?.hallId) === Number(product.hallId)) : null;
  const venueBase = decode(place?.name || product.placeName);
  const hallName = decode(hall?.name || product.availPlaceInfo);
  const venue = hallName && hallName !== venueBase ? `${venueBase} ${hallName}` : venueBase;
  const artists = parseMelonArtists(product.actorJson);
  const priceCandidates = parseMelonPrices(product);
  const dateCandidates = parseMelonDates(product.perfTimeInfo, product.periodInfo, product.compsVO);
  const warnings: string[] = [];
  if (!artists.length) warnings.push('아티스트를 직접 확인해 주세요.');
  if (dateCandidates.length > 1) warnings.push('관람한 공연일을 선택해 주세요.');
  if (!dateCandidates.length) warnings.push('공연 날짜를 직접 확인해 주세요.');
  if (!priceCandidates.length) warnings.push('티켓 가격을 직접 확인해 주세요.');
  return {
    title: decode(product.title),
    artists,
    venue,
    address: decode(place?.addr || ''),
    bookingProvider: '멜론티켓',
    sourceUrl: sourceUrl.toString(),
    posterUrl: melonAssetUrl(product.posterImg || product.coverImg),
    dateCandidates,
    priceCandidates,
    warnings,
  };
}

async function fetchMelonJson(path: string, signal: AbortSignal) {
  const response = await fetch(`https://tktapi.melon.com${path}`, {
    redirect: 'manual', signal,
    headers: {
      accept: 'application/json',
      origin: 'https://m.ticket.melon.com',
      referer: 'https://m.ticket.melon.com/',
      'user-agent': 'Mozilla/5.0 (compatible; DukjilLog/1.0; +concert metadata import)',
    },
  });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('Melon API unavailable');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 1_000_000) throw new Error('Melon response too large');
  return JSON.parse((await response.text()).slice(0, 1_000_000));
}

function parseMelonArtists(value: unknown) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const list = Array.isArray((parsed as any)?.data?.list) ? (parsed as any).data.list : [];
    return [...new Set(list.map((item: any) => decode(item?.artistRepNm || item?.artistNameWebList)).filter(Boolean))].slice(0, 20) as string[];
  } catch { return []; }
}

function parseMelonPrices(product: any) {
  const values: number[] = [];
  if (Array.isArray(product?.gradelist)) product.gradelist.forEach((item: any) => values.push(Number(item?.basePrice)));
  try {
    const parsed = typeof product?.seatGradeJson === 'string' ? JSON.parse(product.seatGradeJson) : product?.seatGradeJson;
    if (Array.isArray(parsed?.data?.list)) parsed.data.list.forEach((item: any) => values.push(Number(item?.basePrice)));
  } catch { /* gradelist 값으로 계속 진행해요. */ }
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 1000 && value <= 10_000_000))].sort((a, b) => a - b).slice(0, 12);
}

function parseMelonDates(perfTimeInfo: unknown, periodInfo: unknown, comps: any) {
  const text = stripTags(String(perfTimeInfo || '')).replace(/\s+/g, ' ');
  const range = text.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?\s*~\s*(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?(?:\s*(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?)?/);
  if (range) {
    const hour = koreanHour(range[8], range[7]);
    const minute = Number(range[9] || 0);
    const start = `${range[1]}-${range[2].padStart(2, '0')}-${range[3].padStart(2, '0')}`;
    const end = `${range[4] || range[1]}-${range[5].padStart(2, '0')}-${range[6].padStart(2, '0')}`;
    return expandKoreanDateRange(start, end).map((value) => value.replace('T00:00:00', `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`));
  }
  const explicit = [...text.matchAll(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\([^)]*\))?(?:\s*(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?)?/g)].map((match) => {
    const hour = koreanHour(match[5], match[4]);
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(Number(match[6] || 0)).padStart(2, '0')}:00+09:00`;
  });
  if (explicit.length) return [...new Set(explicit)];
  const period = String(periodInfo || '').match(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})\s*[-~]\s*(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
  const compactStart = String(comps?.performanceStartDay || '');
  const compactEnd = String(comps?.performanceEndDay || '');
  const start = period ? `${period[1]}-${period[2].padStart(2, '0')}-${period[3].padStart(2, '0')}` : /^20\d{6}$/.test(compactStart) ? `${compactStart.slice(0, 4)}-${compactStart.slice(4, 6)}-${compactStart.slice(6, 8)}` : '';
  const end = period ? `${period[4]}-${period[5].padStart(2, '0')}-${period[6].padStart(2, '0')}` : /^20\d{6}$/.test(compactEnd) ? `${compactEnd.slice(0, 4)}-${compactEnd.slice(4, 6)}-${compactEnd.slice(6, 8)}` : start;
  return start ? expandKoreanDateRange(start, end || start) : [];
}

function koreanHour(value: unknown, period: unknown) {
  let hour = Number(value || 0);
  if (period === '오후' && hour < 12) hour += 12;
  if (period === '오전' && hour === 12) hour = 0;
  return hour;
}

function melonAssetUrl(value: unknown) {
  const path = decode(value);
  if (path.startsWith('https://')) return path;
  if (path.startsWith('//')) return `https:${path}`;
  return path.startsWith('/') ? `https://cdnticket.melon.co.kr${path}` : '';
}

async function importNolConcert(goodsCode: string, sourceUrl: URL, signal: AbortSignal) {
  const referer = sourceUrl.toString();
  const [summary, playMetadata] = await Promise.all([
    fetchNolJson(`/v1/goods/${goodsCode}/summary?passCode=&seatGrade=&priceGrade=`, referer, signal).catch(() => null),
    fetchNolPlayMetadata(goodsCode, signal).catch(() => null),
  ]);
  const goods = summary?.data?.goodsName ? summary.data : playMetadata;
  if (!goods?.goodsName) throw new Error('NOL summary unavailable');

  const [place, priceGroups, info] = await Promise.all([
    goods.placeCode
      ? fetchNolJson(`/v1/Place/${encodeURIComponent(goods.placeCode)}`, referer, signal).catch(() => null)
      : Promise.resolve(null),
    fetchNolJson(`/v1/goods/${goodsCode}/prices/group`, referer, signal).catch(() => null),
    fetchNolJson(`/v1/goods/${goodsCode}/tab/info?goodsCode=${goodsCode}&topingInclude=false`, referer, signal).catch(() => null),
  ]);
  const dateCandidates = parseNolDates(goods.playTime, goods.playStartDate, goods.playEndDate);
  const priceCandidates = collectNolPrices(priceGroups, goods, info?.data);
  const artists = collectNolArtists(info?.data, goods.goodsName);
  const posterUrl = absoluteHttpsUrl(goods.goodsLargeImageUrl || goods.goodsSmallImageUrl);
  const warnings: string[] = [];
  if (!artists.length) warnings.push('아티스트를 직접 확인해 주세요.');
  if (dateCandidates.length > 1) warnings.push('공연 회차를 선택해 주세요.');
  if (!dateCandidates.length) warnings.push('관람 회차를 직접 입력해 주세요.');
  if (!priceCandidates.length) warnings.push('NOL 페이지에서 가격을 텍스트로 제공하지 않아 티켓 가격을 직접 확인해 주세요.');

  return {
    title: decode(goods.goodsName),
    artists,
    venue: decode(place?.data?.placeName || goods.placeName),
    address: decode(place?.data?.placeAddress || ''),
    bookingProvider: 'NOL 티켓',
    sourceUrl: sourceUrl.toString(),
    posterUrl,
    dateCandidates,
    priceCandidates,
    warnings,
  };
}

async function fetchNolPlayMetadata(goodsCode: string, signal: AbortSignal) {
  const meta = await fetchNolJson(`/v1/meta/${goodsCode}/performance?goodsCode=${goodsCode}`, `https://tickets.interpark.com/goods/${goodsCode}`, signal);
  const slug = meta?.data?.slug;
  if (!slug) return null;
  const response = await fetch(`https://mobileticket.interpark.com/play/performance/${encodeURIComponent(slug)}`, { signal, headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (compatible; DukjilLog/1.0; +concert metadata import)' } });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return null;
  const html = (await response.text()).slice(0, 1_500_000);
  const metaValue = (property: string) => decode(matchFirst(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`, 'i')) || matchFirst(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`, 'i')));
  const title = metaValue('og:title').replace(/^NOL 티켓\s*\|\s*/, '') || decode(matchFirst(html, /<title[^>]*>([^<]+)<\/title>/i));
  const venue = decode(matchFirst(html, /\\"venueName\\":\\"([^"\\]+)\\"/i) || matchFirst(html, /<span[^>]*>([^<]+)<\/span><\/li><li><span>20\d{2}[.\/-]/i));
  const start = matchFirst(html, /\\"performStartDate\\":\\"(20\d{2}-\d{2}-\d{2})\\"/i);
  const end = matchFirst(html, /\\"performEndDate\\":\\"(20\d{2}-\d{2}-\d{2})\\"/i);
  const placeCode = matchFirst(html, /\\"ticket2000PlaceCode\\":\\"([^"\\]+)\\"/i);
  return { goodsName: title, placeName: venue, placeCode, playStartDate: start, playEndDate: end, goodsLargeImageUrl: metaValue('og:image') };
}

async function fetchNolJson(path: string, referer: string, signal: AbortSignal) {
  const response = await fetch(`https://api-ticketfront.interpark.com${path}`, {
    redirect: 'manual', signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'ko-KR,ko;q=0.9',
      origin: 'https://mobileticket.interpark.com',
      referer,
      'user-agent': 'Mozilla/5.0 (compatible; DukjilLog/1.0; +concert metadata import)',
    },
  });
  if (response.status >= 300 && response.status < 400) throw new Error('Unexpected NOL redirect');
  if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('NOL API unavailable');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 1_000_000) throw new Error('NOL response too large');
  return JSON.parse((await response.text()).slice(0, 1_000_000));
}

function parseNolDates(playTime: unknown, startDate: unknown, endDate: unknown) {
  const text = String(playTime || '');
  const matches = [...text.matchAll(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/gi)];
  const dates = matches.map((match) => {
    let hour = Number(match[4]);
    const period = match[6].toUpperCase();
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${match[5]}:00+09:00`;
  });
  if (dates.length) return [...new Set(dates)];
  const normalize = (value: unknown) => { const text = String(value || ''); return /^20\d{6}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text : ''; };
  const start = normalize(startDate); const end = normalize(endDate);
  return start && end ? expandKoreanDateRange(start, end) : [...new Set([start, end].filter(Boolean).map((value) => `${value}T00:00:00+09:00`))];
}

function inferNolArtists(title: unknown) {
  const value = decode(title);
  const beforeYear = value.match(/^(.+?)\s+20\d{2}\b/)?.[1]?.trim();
  return beforeYear ? [beforeYear] : [];
}

function collectNolArtists(info: unknown, title: unknown) {
  const values: string[] = [];
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && /manName|artistName|performerName|castName/i.test(key) && value.trim()) values.push(decode(value));
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(info);
  return [...new Set(values.length ? values : inferNolArtists(title))].slice(0, 20);
}

function collectNolPrices(priceGroups: any, goods: any, info?: unknown) {
  const values: number[] = [];
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'number' && /price/i.test(key)) values.push(value);
    else if (typeof value === 'string' && /price|amount|cost/i.test(key)) {
      for (const match of value.matchAll(/[1-9]\d{0,2}(?:,\d{3})+/g)) values.push(Number(match[0].replaceAll(',', '')));
    } else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(priceGroups);
  visit({ minPrice: goods.minSalesPrice, maxPrice: goods.maxSalesPrice, basicPrice: goods.basicPriceHtml });
  visit(info);
  return [...new Set(values.filter((value) => value >= 1000 && value <= 10_000_000))].sort((a, b) => a - b).slice(0, 8);
}

function absoluteHttpsUrl(value: unknown) {
  const url = decode(value);
  if (url.startsWith('//')) return `https:${url}`;
  return url.startsWith('https://') ? url : '';
}

function extractMetadata(html: string, url: URL) {
  const meta = (property: string) => decode(matchFirst(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`, 'i')) || matchFirst(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`, 'i')));
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => { try { return JSON.parse(match[1]); } catch { return null; } }).flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
  const event = jsonLd.find((item: any) => String(item?.['@type'] || '').toLowerCase().includes('event')) as any;
  const title = decode(event?.name || meta('og:title') || matchFirst(html, /<title[^>]*>([^<]+)<\/title>/i)).replace(/\s*[-|｜]\s*(NOL|인터파크|YES24|멜론티켓).*$/i, '').trim();
  const performers = Array.isArray(event?.performer) ? event.performer : event?.performer ? [event.performer] : [];
  const artists = performers.map((item: any) => decode(typeof item === 'string' ? item : item?.name)).filter(Boolean);
  const venue = decode(event?.location?.name || meta('event:location') || '');
  const addressValue = event?.location?.address;
  const address = decode(typeof addressValue === 'string' ? addressValue : addressValue ? [addressValue.streetAddress, addressValue.addressLocality, addressValue.addressCountry].filter(Boolean).join(' ') : '');
  const dates = [...new Set([event?.startDate, ...([...html.matchAll(/20\d{2}[.\/-]\s?\d{1,2}[.\/-]\s?\d{1,2}/g)].map((match) => match[0]))].filter(Boolean))].slice(0, 8);
  const prices = [...new Set([...html.matchAll(/([1-9]\d{1,2}(?:,\d{3})+)\s*원/g)].map((match) => Number(match[1].replaceAll(',', ''))).filter((value) => value >= 1000 && value <= 10_000_000))].slice(0, 8);
  const provider = url.hostname.includes('yes24') ? 'YES24 티켓' : url.hostname.includes('melon') ? '멜론티켓' : 'NOL 티켓';
  const eventImage = typeof event?.image === 'string' ? event.image : Array.isArray(event?.image) ? event.image[0] : event?.image?.url;
  const poster = decode(eventImage || meta('og:image') || meta('twitter:image'));
  const warnings = [];
  if (!title) warnings.push('공연명을 찾지 못했어요.');
  if (!dates.length) warnings.push('관람 회차를 직접 선택해 주세요.');
  if (!prices.length) warnings.push('티켓 가격을 직접 확인해 주세요.');
  return { title, artists, venue, address, bookingProvider: provider, sourceUrl: url.toString(), posterUrl: poster, dateCandidates: dates, priceCandidates: prices, warnings };
}

function matchFirst(value: string, pattern: RegExp) { return value.match(pattern)?.[1] || ''; }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function decode(value: unknown) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }
