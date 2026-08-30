import type { ConcertReview, NotionConcertDraft } from '@/lib/types';

const NOTION_HOSTS = new Set(['notion.so', 'www.notion.so', 'notion.site', 'www.notion.site', 'app.notion.com']);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type NotionRecord = {
  id: string;
  type?: string;
  name?: string;
  space_id?: string;
  parent_id?: string;
  collection_id?: string;
  view_ids?: string[];
  schema?: Record<string, { name?: string; type?: string }>;
  properties?: Record<string, unknown>;
  discussions?: string[] | string;
  comments?: string[];
  text?: unknown;
  created_time?: number;
};

export async function POST(request: Request) {
  try {
    const { url: rawUrl } = await request.json() as { url?: string };
    const sourceUrl = parseNotionUrl(rawUrl || '');
    const pageId = extractPageId(sourceUrl);
    if (!pageId) return Response.json({ error: '노션 페이지 ID를 찾지 못했어요. 공유 링크를 다시 확인해 주세요.' }, { status: 400 });

    const pageData = await notionPost('loadCachedPageChunkV2', {
      page: { id: pageId }, cursor: { stack: [] }, verticalColumns: false,
    });
    const pageMap = pageData.recordMap || {};
    const collections = recordValues(pageMap.collection);
    const collectionViews = recordValues(pageMap.collection_view);
    const blocks = recordValues(pageMap.block);
    const databaseBlocks = blocks.filter((block) =>
      (block.type === 'collection_view' || block.type === 'collection_view_page') && block.collection_id && block.view_ids?.length,
    );
    if (!databaseBlocks.length) {
      return Response.json({ error: '공개된 표 데이터베이스를 찾지 못했어요. 노션 페이지를 웹에 게시했는지 확인해 주세요.' }, { status: 422 });
    }

    const drafts = new Map<string, NotionConcertDraft>();
    const discussionParents = new Map<string, { rowId: string; spaceId: string }>();
    const viewNames = new Set<string>();
    for (const databaseBlock of databaseBlocks.slice(0, 5)) {
      const collection = collections.find((item) => item.id === databaseBlock.collection_id);
      if (!collection?.schema) continue;
      const schema = collection.schema as Record<string, { name?: string; type?: string }>;
      for (const viewId of (databaseBlock.view_ids as string[]).slice(0, 12)) {
        const view = collectionViews.find((item) => item.id === viewId);
        if (view?.name) viewNames.add(String(view.name));
        const result = await notionPost('queryCollection', {
          collectionView: { id: viewId, spaceId: databaseBlock.space_id },
          collectionViewBlock: { id: databaseBlock.id, spaceId: databaseBlock.space_id },
          clientType: 'notion_app', userTimeZone: 'Asia/Seoul', isFullScreen: false, isMobile: false,
        }, databaseBlock.space_id);
        for (const row of recordValues(result.recordMap?.block)) {
          if (row.type !== 'page' || row.parent_id !== databaseBlock.collection_id || drafts.has(row.id)) continue;
          const draft = rowToDraft(row, schema);
          if (draft.title && draft.performanceAt) {
            drafts.set(row.id, draft);
            for (const discussionId of idList(row.discussions)) discussionParents.set(discussionId, { rowId: row.id, spaceId: row.space_id || databaseBlock.space_id || '' });
          }
        }
      }
    }

    let commentsImported = 0;
    try {
      const reviewsByRow = await loadReviews(discussionParents);
      for (const [rowId, reviews] of reviewsByRow) {
        const draft = drafts.get(rowId);
        if (draft) { draft.reviews = reviews; commentsImported += reviews.length; }
      }
    } catch { /* 공연 기본 정보는 유지하고 댓글만 경고로 안내해요. */ }

    const concerts = [...drafts.values()].sort((a, b) => b.performanceAt.localeCompare(a.performanceAt));
    if (!concerts.length) return Response.json({ error: '공연명과 날짜가 있는 행을 찾지 못했어요.' }, { status: 422 });
    return Response.json({
      pageTitle: richText(propertyOf(blocks.find((block) => block.id === pageId), 'title')) || 'Notion 공연 기록',
      views: [...viewNames], concerts, commentsImported,
      warnings: [...(discussionParents.size > 0 && commentsImported === 0 ? ['댓글을 읽지 못했어요. 페이지 댓글 공개 설정을 확인해 주세요.'] : []), '비공개 파일 이미지는 자동 이관되지 않아요.', '공연장 좌표는 가져온 뒤 공연 상세에서 위치를 확인해 주세요.'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '노션 기록을 불러오지 못했어요.';
    return Response.json({ error: message }, { status: message.includes('공개') ? 403 : 500 });
  }
}

function parseNotionUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('올바른 노션 링크를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || !NOTION_HOSTS.has(url.hostname.toLowerCase())) throw new Error('notion.so, notion.site 또는 app.notion.com 링크만 사용할 수 있어요.');
  return url;
}

function extractPageId(url: URL) {
  const match = `${url.pathname}${url.search}`.match(/[0-9a-f]{32}/i)?.[0];
  if (!match) return null;
  return `${match.slice(0, 8)}-${match.slice(8, 12)}-${match.slice(12, 16)}-${match.slice(16, 20)}-${match.slice(20)}`.toLowerCase();
}

async function notionPost(endpoint: string, body: unknown, spaceId?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://app.notion.com/api/v3/${endpoint}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'user-agent': 'DukjilLog/1.0', ...(spaceId ? { 'x-notion-space-id': spaceId } : {}) },
      body: JSON.stringify(body), redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) throw new Error('노션 요청이 다른 주소로 이동되어 중단했어요.');
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('공개되지 않은 노션 페이지예요. 노션에서 웹 게시를 켠 뒤 다시 시도해 주세요.');
      throw new Error('노션이 응답하지 않았어요. 잠시 후 다시 시도해 주세요.');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('노션 기록이 너무 커서 한 번에 가져올 수 없어요.');
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

function recordValues(table: unknown): NotionRecord[] {
  if (!table || typeof table !== 'object') return [];
  return Object.values(table as Record<string, unknown>).map(unwrapRecord).filter((value): value is NotionRecord => value !== null);
}

function unwrapRecord(entry: unknown): NotionRecord | null {
  let value: unknown = entry;
  for (let depth = 0; depth < 4 && isRecord(value) && isRecord(value.value); depth += 1) value = value.value;
  return isRecord(value) && typeof value.id === 'string' ? value as NotionRecord : null;
}

function rowToDraft(row: NotionRecord, schema: Record<string, { name?: string; type?: string }>): NotionConcertDraft {
  const byNames = (names: string[]) => {
    const id = Object.keys(schema).find((key) => names.some((name) => normalize(schema[key]?.name || '') === normalize(name)));
    return id ? row.properties?.[id] : undefined;
  };
  const date = notionDate(byNames(['날짜', '공연일', '공연 날짜', 'Date']));
  return {
    sourceId: row.id,
    title: richText(byNames(['이름', '공연명', 'Name', 'Title'])),
    artists: splitTags(richText(byNames(['누구야', '아티스트', '공연자', 'Artist', 'Artists']))),
    performanceAt: date.start ? `${date.start}T12:00:00+09:00` : '',
    endDate: date.end || undefined,
    venue: richText(byNames(['장소', '공연장', 'Venue', 'Location'])),
    bookingProvider: richText(byNames(['예매처', 'Booking', 'Provider'])),
    listPrice: numberValue(byNames(['티켓 가격', '정가', '가격', 'Price'])),
    paidAmount: numberValue(byNames(['수수료 포함', '실제 결제액', '결제액', 'Paid', 'Amount'])),
    reviews: [],
  };
}

async function loadReviews(discussionParents: Map<string, { rowId: string; spaceId: string }>) {
  const discussions = await syncRecords('discussion', [...discussionParents.keys()], discussionParents);
  const commentParents = new Map<string, { rowId: string; spaceId: string }>();
  for (const discussion of discussions) {
    const parent = discussionParents.get(discussion.id);
    if (!parent) continue;
    for (const commentId of discussion.comments || []) commentParents.set(commentId, parent);
  }
  const comments = await syncRecords('comment', [...commentParents.keys()], commentParents);
  const reviews = new Map<string, ConcertReview[]>();
  for (const comment of comments) {
    const parent = commentParents.get(comment.id);
    const body = richText(comment.text);
    if (!parent || !body) continue;
    const review: ConcertReview = { id: comment.id, body, createdAt: typeof comment.created_time === 'number' ? new Date(comment.created_time).toISOString() : new Date().toISOString() };
    reviews.set(parent.rowId, [...(reviews.get(parent.rowId) || []), review]);
  }
  for (const items of reviews.values()) items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return reviews;
}

async function syncRecords(table: 'discussion' | 'comment', ids: string[], parents: Map<string, { rowId: string; spaceId: string }>) {
  const records: NotionRecord[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const spaceId = parents.get(batch[0])?.spaceId;
    const result = await notionPost('syncRecordValues', { requests: batch.map((id) => ({ table, id, version: -1 })) }, spaceId);
    records.push(...recordValues(result.recordMap?.[table]));
  }
  return records;
}

function propertyOf(block: NotionRecord | undefined, id: string) { return block?.properties?.[id]; }
function normalize(value: string) { return value.replace(/\s+/g, '').toLowerCase(); }
function splitTags(value: string) { return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean); }
function idList(value: string[] | string | undefined) { return Array.isArray(value) ? value : value ? [value] : []; }

function richText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => Array.isArray(part) ? String(part[0] ?? '') : '').join('').trim();
}

function numberValue(value: unknown): number | null {
  const text = richText(value).replace(/[^0-9.-]/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function notionDate(value: unknown): { start: string; end?: string } {
  if (!Array.isArray(value) || !Array.isArray(value[0]) || !Array.isArray(value[0][1])) return { start: '' };
  const datePair = value[0][1].find((item: unknown) => Array.isArray(item) && item[0] === 'd');
  const metadata = Array.isArray(datePair) && isRecord(datePair[1]) ? datePair[1] : undefined;
  return { start: typeof metadata?.start_date === 'string' ? metadata.start_date : '', end: typeof metadata?.end_date === 'string' ? metadata.end_date : undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
