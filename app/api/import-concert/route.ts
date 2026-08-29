import { z } from 'zod';

const schema = z.object({ url: z.string().url().max(2048) });
const allowedHosts = new Set(['ticket.interpark.com', 'tickets.interpark.com', 'mobileticket.interpark.com', 'ticket.yes24.com', 'm.ticket.yes24.com', 'ticket.melon.com']);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: '올바른 예매 페이지 URL을 입력해 주세요.' }, { status: 400 });
  let url = new URL(parsed.data.url);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return Response.json({ error: 'NOL 티켓, YES24 티켓, 멜론티켓의 HTTPS 주소만 지원해요.' }, { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const nolGoodsCode = getNolGoodsCode(url);
    if (nolGoodsCode) return Response.json(await importNolConcert(nolGoodsCode, url, controller.signal));

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

async function importNolConcert(goodsCode: string, sourceUrl: URL, signal: AbortSignal) {
  const referer = sourceUrl.toString();
  const summary = await fetchNolJson(`/v1/goods/${goodsCode}/summary?passCode=&seatGrade=&priceGrade=`, referer, signal);
  const goods = summary?.data;
  if (!goods?.goodsName) throw new Error('NOL summary unavailable');

  const [place, priceGroups] = await Promise.all([
    goods.placeCode
      ? fetchNolJson(`/v1/Place/${encodeURIComponent(goods.placeCode)}`, referer, signal).catch(() => null)
      : Promise.resolve(null),
    fetchNolJson(`/v1/goods/${goodsCode}/prices/group`, referer, signal).catch(() => null),
  ]);
  const dateCandidates = parseNolDates(goods.playTime, goods.playStartDate, goods.playEndDate);
  const priceCandidates = collectNolPrices(priceGroups, goods);
  const artists = inferNolArtists(goods.goodsName);
  const posterUrl = absoluteHttpsUrl(goods.goodsLargeImageUrl || goods.goodsSmallImageUrl);
  const warnings: string[] = [];
  if (!artists.length) warnings.push('아티스트를 직접 확인해 주세요.');
  if (dateCandidates.length > 1) warnings.push('공연 회차를 선택해 주세요.');
  if (!dateCandidates.length) warnings.push('관람 회차를 직접 입력해 주세요.');
  if (!priceCandidates.length) warnings.push('티켓 가격을 직접 확인해 주세요.');

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
  return [...new Set([startDate, endDate].map(String).filter((value) => /^20\d{6}$/.test(value)).map((value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+09:00`))];
}

function inferNolArtists(title: unknown) {
  const value = decode(title);
  const beforeYear = value.match(/^(.+?)\s+20\d{2}\b/)?.[1]?.trim();
  return beforeYear ? [beforeYear] : [];
}

function collectNolPrices(priceGroups: any, goods: any) {
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
