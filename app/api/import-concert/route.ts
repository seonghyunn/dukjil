import { z } from 'zod';

const schema = z.object({ url: z.string().url().max(2048) });
const allowedHosts = new Set(['ticket.interpark.com', 'tickets.interpark.com', 'ticket.yes24.com', 'm.ticket.yes24.com', 'ticket.melon.com']);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: '올바른 예매 페이지 URL을 입력해 주세요.' }, { status: 400 });
  let url = new URL(parsed.data.url);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) return Response.json({ error: 'NOL 티켓, YES24 티켓, 멜론티켓의 HTTPS 주소만 지원해요.' }, { status: 400 });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 7000);
  try {
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
    const metadata = extractMetadata(html, url);
    return Response.json(metadata);
  } catch {
    return Response.json({ error: '예매처가 자동 불러오기를 허용하지 않거나 페이지가 응답하지 않았어요.' }, { status: 502 });
  } finally { clearTimeout(timer); }
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
  const prices = [...new Set([...html.matchAll(/(?:KRW|₩|가격|티켓가)?\s*([1-9]\d{1,2}(?:,\d{3})+)\s*원?/g)].map((match) => Number(match[1].replaceAll(',', ''))).filter((value) => value >= 1000 && value <= 10_000_000))].slice(0, 8);
  const provider = url.hostname.includes('yes24') ? 'YES24 티켓' : url.hostname.includes('melon') ? '멜론티켓' : 'NOL 티켓';
  const poster = decode(event?.image?.url || event?.image?.[0] || event?.image || meta('og:image') || meta('twitter:image'));
  const warnings = [];
  if (!title) warnings.push('공연명을 찾지 못했어요.');
  if (!dates.length) warnings.push('관람 회차를 직접 선택해 주세요.');
  if (!prices.length) warnings.push('티켓 가격을 직접 확인해 주세요.');
  return { title, artists, venue, address, bookingProvider: provider, sourceUrl: url.toString(), posterUrl: poster, dateCandidates: dates, priceCandidates: prices, warnings };
}

function matchFirst(value: string, pattern: RegExp) { return value.match(pattern)?.[1] || ''; }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function decode(value: unknown) { return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }
