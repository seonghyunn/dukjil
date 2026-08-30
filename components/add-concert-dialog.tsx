'use client';

import { useEffect, useState } from 'react';
import { Database, ImagePlus, Link2, LoaderCircle, MapPin, PenLine, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RatingPicker } from '@/components/rating-picker';
import type { Concert, GeocodeCandidate, ImportDraft, NotionConcertDraft } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (concerts: Concert[], imageFile?: File) => Promise<void>;
  concerts: Concert[];
};

const emptyForm = {
  title: '', artists: '', performanceAt: '2026-08-31T18:00', venue: '', address: '',
  bookingProvider: '직접 입력', sourceUrl: '', listPrice: '', paidAmount: '', initialReview: '', posterUrl: '',
};

export function AddConcertDialog({ open, onOpenChange, onSave, concerts }: Props) {
  const [mode, setMode] = useState<'url' | 'direct' | 'notion'>('url');
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<'scheduled' | 'attended'>('scheduled');
  const [statusOverridden, setStatusOverridden] = useState(false);
  const [initialRating, setInitialRating] = useState<number | null>(null);
  const [coords, setCoords] = useState<GeocodeCandidate | null>(null);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [imageFile, setImageFile] = useState<File>();
  const [dateCandidates, setDateCandidates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [priceCandidates, setPriceCandidates] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notionUrl, setNotionUrl] = useState('');
  const [notionDrafts, setNotionDrafts] = useState<NotionConcertDraft[]>([]);
  const [selectedNotionIds, setSelectedNotionIds] = useState<string[]>([]);
  const [notionTitle, setNotionTitle] = useState('');
  const artistSuggestions = [...new Set(concerts.flatMap((concert) => concert.artists))].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 10);
  const venueSuggestions = [...new Map(concerts.filter((concert) => concert.venue).map((concert) => [concert.venue, concert])).values()].slice(0, 8);
  const providerSuggestions = [...new Set(concerts.map((concert) => concert.bookingProvider).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')).slice(0, 8);
  const selectedArtists = form.artists.split(',').map((value) => value.trim()).filter(Boolean);

  useEffect(() => {
    if (!open) {
      setForm(emptyForm); setStatus('scheduled'); setStatusOverridden(false); setInitialRating(null); setCoords(null); setCandidates([]); setImageFile(undefined); setDateCandidates([]); setSelectedDates([]); setPriceCandidates([]); setMessage(''); setNotionDrafts([]); setSelectedNotionIds([]); setNotionTitle('');
    }
  }, [open]);

  const update = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  async function importUrl() {
    if (!form.sourceUrl) return;
    setLoading(true); setMessage('');
    try {
      const response = await fetch('/api/import-concert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: form.sourceUrl }) });
      const data = (await response.json()) as ImportDraft & { error?: string };
      if (!response.ok) throw new Error(data.error || '공연 정보를 불러오지 못했어요.');
      setForm((prev) => ({
        ...prev,
        title: data.title || prev.title,
        artists: data.artists.join(', ') || prev.artists,
        venue: data.venue || prev.venue,
        address: data.address || prev.address,
        bookingProvider: data.bookingProvider || prev.bookingProvider,
        posterUrl: data.posterUrl || prev.posterUrl,
        performanceAt: data.dateCandidates[0] ? toDateTimeInput(data.dateCandidates[0]) : prev.performanceAt,
        listPrice: data.priceCandidates[0]?.toString() || prev.listPrice,
      }));
      setDateCandidates(data.dateCandidates || []);
      setSelectedDates(data.dateCandidates?.[0] ? [data.dateCandidates[0]] : []);
      setPriceCandidates(data.priceCandidates || []);
      setMessage(data.warnings.join(' ') || '정보를 불러왔어요. 날짜와 가격을 꼭 확인해 주세요.');
      setMode('direct');
      if (data.venue || data.address) void resolveVenue(data.venue, data.address);
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} 직접 입력으로 이어갈게요.` : '직접 입력으로 이어갈게요.');
      setMode('direct');
    } finally { setLoading(false); }
  }

  async function findVenue() {
    const query = venueSearchQuery(form.venue, form.address);
    if (!query) return;
    setLoading(true);
    try {
      const response = await fetch('/api/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      const data = await response.json() as { candidates?: GeocodeCandidate[]; error?: string };
      if (!response.ok) throw new Error(data.error || '장소를 찾지 못했어요.');
      setCandidates(data.candidates || []);
      if (data.candidates?.length === 1) setCoords(data.candidates[0]);
    } catch (error) { setMessage(error instanceof Error ? error.message : '장소를 찾지 못했어요.'); }
    finally { setLoading(false); }
  }

  async function importNotion() {
    if (!notionUrl.trim()) return;
    setLoading(true); setMessage(''); setNotionDrafts([]);
    try {
      const response = await fetch('/api/import-notion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: notionUrl.trim() }) });
      const data = await response.json() as { pageTitle?: string; concerts?: NotionConcertDraft[]; views?: string[]; warnings?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || '노션 기록을 불러오지 못했어요.');
      const drafts = data.concerts || [];
      const existingKeys = new Set(concerts.map((concert) => `${concert.title.trim().toLowerCase()}|${concert.performanceAt.slice(0, 10)}`));
      const selectable = drafts.filter((draft) => !existingKeys.has(`${draft.title.trim().toLowerCase()}|${draft.performanceAt.slice(0, 10)}`));
      setNotionDrafts(drafts); setSelectedNotionIds(selectable.map((draft) => draft.sourceId)); setNotionTitle(data.pageTitle || 'Notion 공연 기록');
      const duplicateCount = drafts.length - selectable.length;
      setMessage(`${data.views?.length || 1}개 보기에서 ${drafts.length}개를 찾았어요.${duplicateCount ? ` 기존 기록과 같은 ${duplicateCount}개는 선택에서 뺐어요.` : ''} ${(data.warnings || []).join(' ')}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '노션 기록을 불러오지 못했어요.'); }
    finally { setLoading(false); }
  }

  async function saveNotionConcerts() {
    const selected = notionDrafts.filter((draft) => selectedNotionIds.includes(draft.sourceId));
    if (!selected.length) { setMessage('이관할 공연을 하나 이상 선택해 주세요.'); return; }
    setLoading(true);
    const imported: Concert[] = selected.map((draft) => ({
      id: crypto.randomUUID(), title: draft.title, artists: draft.artists, performanceAt: new Date(draft.performanceAt).toISOString(),
      venue: draft.venue || '장소 미입력', address: draft.venue || '', latitude: null, longitude: null, countryCode: 'KR',
      bookingProvider: draft.bookingProvider || '노션에서 가져옴', sourceUrl: notionUrl.trim(), listPrice: draft.listPrice,
      paidAmount: draft.paidAmount, status: initialStatusFor(draft.performanceAt), rating: null, reviews: [], posterUrl: '', officialPosterUrl: '', posterSource: 'official',
    }));
    try { await onSave(imported); onOpenChange(false); }
    catch (error) { setMessage(error instanceof Error ? `저장하지 못했어요: ${error.message}` : '노션 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }

  async function resolveVenue(venue: string, address: string) {
    const query = venueSearchQuery(venue, address);
    if (!query) return;
    try {
      const response = await fetch('/api/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      const data = await response.json() as { candidates?: GeocodeCandidate[] };
      const next = data.candidates?.[0];
      setCandidates(data.candidates || []);
      if (next) { setCoords(next); setForm((current) => ({ ...current, address: next.address })); }
    } catch { /* 사용자가 직접 위치를 확인할 수 있도록 폼을 유지해요. */ }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title || !form.artists || !form.performanceAt || !form.venue) {
      setMessage('공연명, 아티스트, 일시와 장소를 입력해 주세요.'); return;
    }
    setLoading(true);
    const performances = selectedDates.length ? selectedDates : [toKoreanPerformanceIso(form.performanceAt)];
    const concerts: Concert[] = performances.map((performanceAt) => ({
      id: crypto.randomUUID(), title: form.title.trim(),
      artists: form.artists.split(',').map((value) => value.trim()).filter(Boolean),
      performanceAt, venue: form.venue.trim(),
      address: form.address.trim(), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
      countryCode: coords?.countryCode || 'KR', bookingProvider: form.bookingProvider.trim(), sourceUrl: form.sourceUrl.trim(),
      listPrice: form.listPrice === '' ? null : Number(form.listPrice), paidAmount: form.paidAmount === '' ? null : Number(form.paidAmount),
      status: statusOverridden ? status : initialStatusFor(performanceAt), rating: initialRating, reviews: form.initialReview.trim() ? [{ id: crypto.randomUUID(), body: form.initialReview.trim(), createdAt: new Date().toISOString() }] : [], posterUrl: form.posterUrl.trim(), officialPosterUrl: form.posterUrl.trim(), posterSource: imageFile ? 'upload' : 'official',
    }));
    try { await onSave(concerts, imageFile); onOpenChange(false); }
    catch { setMessage('저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-black/10 bg-[#fbfaf6] p-0 text-[#1c1b18] sm:max-w-xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-xl">공연 한 편 기록하기</DialogTitle>
          <DialogDescription>자동으로 채워진 정보도 저장 전에 한 번 확인해 주세요.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 px-5">
          <Button type="button" variant={mode === 'url' ? 'default' : 'outline'} onClick={() => setMode('url')} className="flex-1 px-2"><Link2 />예매 URL</Button>
          <Button type="button" variant={mode === 'direct' ? 'default' : 'outline'} onClick={() => setMode('direct')} className="flex-1 px-2"><PenLine />직접 입력</Button>
          <Button type="button" variant={mode === 'notion' ? 'default' : 'outline'} onClick={() => setMode('notion')} className="flex-1 px-2"><Database />Notion</Button>
        </div>
        {mode === 'url' ? (
          <div className="space-y-4 px-5 pb-6">
            <label className="block text-sm font-medium">예매 페이지 URL
              <Input value={form.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="https://ticket..." className="mt-2 h-11" />
            </label>
            <p className="text-xs leading-5 text-black/45">NOL 티켓, YES24 티켓, 멜론티켓을 우선 지원합니다. 불러오지 못해도 입력한 URL은 유지돼요.</p>
            <Button className="h-11 w-full bg-[#ff6b61] text-[#17120f] hover:bg-[#ff827a]" onClick={importUrl} disabled={loading || !form.sourceUrl}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}정보 불러오기</Button>
          </div>
        ) : mode === 'direct' ? (
          <form onSubmit={submit} className="space-y-4 px-5 pb-6">
            {dateCandidates.length > 1 && <CandidateGroup label={`공연 회차 선택 · ${selectedDates.length}개 선택됨`}>{dateCandidates.map((candidate) => { const checked = selectedDates.includes(candidate); return <button key={candidate} type="button" aria-pressed={checked} onClick={() => setSelectedDates((dates) => checked ? dates.filter((date) => date !== candidate) : [...dates, candidate])} className={`rounded-full border px-3 py-2 text-xs ${checked ? 'border-[#dfff94] bg-[#dfff94] text-black' : 'border-black/15 text-black/60'}`}>{checked ? '✓ ' : ''}{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(candidate))}</button>; })}<p className="basis-full pt-1 text-[11px] text-black/40">선택한 회차마다 공연 장부에 별도 기록이 생겨요.</p></CandidateGroup>}
            {priceCandidates.length > 1 && <CandidateGroup label="가격 후보">{priceCandidates.map((candidate) => <button key={candidate} type="button" onClick={() => update('listPrice', candidate.toString())} className={`rounded-full border px-3 py-2 text-xs ${form.listPrice === candidate.toString() ? 'border-[#dfff94] bg-[#dfff94] text-black' : 'border-black/15 text-black/60'}`}>₩{candidate.toLocaleString('ko-KR')}</button>)}</CandidateGroup>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="공연명"><Input value={form.title} onChange={(e) => update('title', e.target.value)} /></Field>
              <Field label="아티스트"><div className="space-y-2"><Input value={form.artists} onChange={(e) => update('artists', e.target.value)} placeholder="쉼표로 구분" />{artistSuggestions.length > 0 && <SuggestionRow label="기존 기록에서 선택">{artistSuggestions.map((artist) => { const selected = selectedArtists.includes(artist); return <button key={artist} type="button" data-selected={selected} onClick={() => update('artists', (selected ? selectedArtists.filter((value) => value !== artist) : [...selectedArtists, artist]).join(', '))} className="suggestion-chip">{artist}</button>; })}</SuggestionRow>}</div></Field>
              <Field label={selectedDates.length > 1 ? '대표 공연 일시' : '공연 일시'}><Input type="datetime-local" value={form.performanceAt} onChange={(e) => { update('performanceAt', e.target.value); setSelectedDates([]); }} /></Field>
              <Field label="예매처"><div className="space-y-2"><Input value={form.bookingProvider} onChange={(e) => update('bookingProvider', e.target.value)} />{providerSuggestions.length > 0 && <SuggestionRow label="기존 기록에서 선택">{providerSuggestions.map((provider) => <button key={provider} type="button" data-selected={form.bookingProvider === provider} onClick={() => update('bookingProvider', provider)} className="suggestion-chip">{provider}</button>)}</SuggestionRow>}</div></Field>
              <Field label="공연장"><div className="space-y-2"><Input value={form.venue} onChange={(e) => { update('venue', e.target.value); setCoords(null); }} />{venueSuggestions.length > 0 && <SuggestionRow label="기존 기록에서 선택">{venueSuggestions.map((concert) => <button key={concert.venue} type="button" data-selected={form.venue === concert.venue} onClick={() => { update('venue', concert.venue); update('address', concert.address); setCoords(concert.latitude == null || concert.longitude == null ? null : { id: `saved-${concert.id}`, name: concert.venue, address: concert.address, latitude: concert.latitude, longitude: concert.longitude, countryCode: concert.countryCode }); }} className="suggestion-chip">{concert.venue}</button>)}</SuggestionRow>}</div></Field>
              <Field label="주소"><div className="flex gap-2"><Input value={form.address} onChange={(e) => update('address', e.target.value)} /><Button type="button" variant="outline" size="icon-lg" aria-label="위치 찾기" onClick={findVenue}><MapPin /></Button></div></Field>
              <Field label="정가"><Input inputMode="numeric" value={form.listPrice} onChange={(e) => update('listPrice', e.target.value.replace(/\D/g, ''))} placeholder="원" /></Field>
              <Field label="실제 결제액"><Input inputMode="numeric" value={form.paidAmount} onChange={(e) => update('paidAmount', e.target.value.replace(/\D/g, ''))} placeholder="원" /></Field>
            </div>
            {candidates.length > 0 && <div className="space-y-2 rounded-2xl bg-black/5 p-3">{candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => { setCoords(candidate); update('address', candidate.address); }} className={`flex w-full items-start gap-2 rounded-xl p-2 text-left text-xs ${coords?.id === candidate.id ? 'bg-[#dfff94] text-black' : 'hover:bg-black/5'}`}><MapPin className="mt-0.5 size-4 shrink-0" /><span><b className="block">{candidate.name}</b>{candidate.address}</span></button>)}<p className="px-2 pt-1 text-[10px] text-black/35">검색 데이터 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap 기여자</a></p></div>}
            <Field label="공식 이미지 URL"><Input value={form.posterUrl} onChange={(e) => update('posterUrl', e.target.value)} placeholder="자동 추출 또는 직접 입력" /></Field>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-black/15 p-4 text-sm text-black/60 hover:border-black/30"><ImagePlus className="size-5" /><span>{imageFile?.name || '이미지가 없으면 직접 추가 (최대 5MB)'}</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setImageFile(e.target.files?.[0])} /></label>
            <div><div className="grid grid-cols-2 gap-2"><Button type="button" variant={(statusOverridden ? status : initialStatusFor(selectedDates[0] || form.performanceAt)) === 'scheduled' ? 'default' : 'outline'} onClick={() => { setStatus('scheduled'); setStatusOverridden(true); }}>예정</Button><Button type="button" variant={(statusOverridden ? status : initialStatusFor(selectedDates[0] || form.performanceAt)) === 'attended' ? 'default' : 'outline'} onClick={() => { setStatus('attended'); setStatusOverridden(true); }}>관람 완료</Button></div><p className="mt-2 text-[11px] text-black/35">공연일이 오늘이거나 지난 경우 관람 완료, 내일부터는 예정으로 자동 설정돼요.</p></div>
            <Field label="공연 별점 (선택)"><RatingPicker value={initialRating} onChange={setInitialRating} /></Field>
            <Field label="첫 댓글 (선택)"><Textarea value={form.initialReview} onChange={(e) => update('initialReview', e.target.value)} maxLength={2000} placeholder="별점과 별개로 댓글을 남겨요. 저장 후 여러 개를 더 추가할 수 있어요." className="min-h-24" /></Field>
            {message && <p role="status" className="rounded-xl bg-black/5 p-3 text-xs leading-5 text-[#5d7b27]">{message}</p>}
            <Button type="submit" className="h-12 w-full bg-[#ff6b61] text-[#17120f] hover:bg-[#ff827a]" disabled={loading}>{loading && <LoaderCircle className="animate-spin" />}{selectedDates.length > 1 ? `${selectedDates.length}개 회차 각각 저장하기` : '공연 저장하기'}</Button>
          </form>
        ) : (
          <div className="space-y-4 px-5 pb-6">
            <div className="rounded-2xl bg-[#f0eee7] p-4"><p className="text-sm font-semibold">기존 노션 기록 한 번에 옮기기</p><p className="mt-1 text-xs leading-5 text-black/45">공개된 노션 페이지의 표를 읽어 공연명, 날짜, 가격, 아티스트, 예매처와 장소를 옮겨요. 저장 전 원하는 행만 고를 수 있어요.</p></div>
            <div><label htmlFor="notion-share-url" className="block text-sm font-medium">노션 공유 링크</label><Input id="notion-share-url" value={notionUrl} onChange={(event) => { setNotionUrl(event.target.value); setNotionDrafts([]); setMessage(''); }} placeholder="https://app.notion.com/p/..." className="mt-2 h-11" /></div>
            <Button type="button" className="h-11 w-full bg-[#ff6b61] text-[#17120f] hover:bg-[#ff827a]" onClick={importNotion} disabled={loading || !notionUrl.trim()}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}노션 기록 확인하기</Button>
            {notionDrafts.length > 0 && <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/70">
              <div className="flex items-center justify-between border-b border-black/10 p-3"><div><b className="text-sm">{notionTitle}</b><p className="mt-0.5 text-[11px] text-black/40">{selectedNotionIds.length} / {notionDrafts.length}개 선택</p></div><button type="button" onClick={() => setSelectedNotionIds(selectedNotionIds.length === notionDrafts.length ? [] : notionDrafts.map((draft) => draft.sourceId))} className="rounded-full bg-black/5 px-3 py-1.5 text-xs">{selectedNotionIds.length === notionDrafts.length ? '전체 해제' : '전체 선택'}</button></div>
              <div className="max-h-72 overflow-y-auto">{notionDrafts.map((draft) => { const checked = selectedNotionIds.includes(draft.sourceId); return <label key={draft.sourceId} className="flex cursor-pointer gap-3 border-b border-black/[0.06] p-3 last:border-0 hover:bg-[#fff8f4]"><input type="checkbox" aria-label={`${draft.title} 이관 선택`} checked={checked} onChange={() => setSelectedNotionIds((ids) => checked ? ids.filter((id) => id !== draft.sourceId) : [...ids, draft.sourceId])} className="mt-1 accent-[#ff6b61]" /><span className="min-w-0 flex-1"><b className="block truncate text-sm">{draft.title}</b><span className="mt-1 block text-[11px] leading-4 text-black/45">{notionDateLabel(draft.performanceAt, draft.endDate)} · {draft.artists.join(' · ') || '아티스트 미입력'}<br />{draft.venue || '장소 미입력'} · {draft.paidAmount == null ? '금액 미입력' : `₩${draft.paidAmount.toLocaleString('ko-KR')}`}</span></span></label>; })}</div>
            </div>}
            {message && <output className="block rounded-xl bg-black/5 p-3 text-xs leading-5 text-[#5d7b27]">{message}</output>}
            {notionDrafts.length > 0 && <Button type="button" onClick={saveNotionConcerts} disabled={loading || !selectedNotionIds.length} className="h-12 w-full bg-[#dfff94] text-[#17120f] hover:bg-[#d5f58d]">선택한 {selectedNotionIds.length}개 공연 이관하기</Button>}
            <p className="text-[11px] leading-5 text-black/35">비공개 노션은 읽을 수 없어요. 노션의 공유 메뉴에서 ‘웹에 게시’를 켠 뒤 이관하고, 완료 후 다시 꺼도 됩니다.</p>
          </div>
        )}
        {mode === 'url' && message && <p role="status" className="mx-5 mb-5 rounded-xl bg-black/5 p-3 text-xs text-[#5d7b27]">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="group" aria-label={label} className="block text-xs font-medium text-black/60"><span className="mb-2 block">{label}</span>{children}</div>;
}

function CandidateGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="rounded-2xl bg-black/5 p-3"><legend className="px-1 text-xs text-black/50">{label}</legend><div className="mt-1 flex flex-wrap gap-2">{children}</div></fieldset>;
}

function SuggestionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-[11px] text-black/40">{label}</p><div className="flex flex-wrap gap-1.5">{children}</div></div>;
}

function toDateTimeInput(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function venueSearchQuery(venue: string, address: string) {
  const combined = `${venue} ${address}`.trim();
  const knownName = ['올림픽홀', 'KSPO DOME', '인스파이어 아레나', '고척스카이돔', '잠실실내체육관'].find((name) => combined.toLowerCase().includes(name.toLowerCase()));
  if (knownName) return knownName;
  const inside = combined.match(/(?:내|內)\s*([^,()]+?(?:홀|아레나|돔|스타디움|체육관|극장|공연장|센터))/)?.[1];
  return (inside || venue || address).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function initialStatusFor(value: string): 'scheduled' | 'attended' {
  const performance = new Date(hasTimeZone(value) ? value : `${value}:00+09:00`);
  if (Number.isNaN(performance.getTime())) return 'scheduled';
  const dateKey = (date: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return dateKey(performance) <= dateKey(new Date()) ? 'attended' : 'scheduled';
}

function toKoreanPerformanceIso(value: string) {
  return new Date(hasTimeZone(value) ? value : `${value}:00+09:00`).toISOString();
}

function hasTimeZone(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

function notionDateLabel(start: string, end?: string) {
  const startLabel = start.slice(0, 10).replaceAll('-', '.');
  return end ? `${startLabel} ~ ${end.replaceAll('-', '.')}` : startLabel;
}
