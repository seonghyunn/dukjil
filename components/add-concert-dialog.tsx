'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Link2, LoaderCircle, MapPin, PenLine, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Concert, GeocodeCandidate, ImportDraft } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (concert: Concert, imageFile?: File) => Promise<void>;
};

const emptyForm = {
  title: '', artists: '', performanceAt: '2026-08-31T18:00', venue: '', address: '',
  bookingProvider: '직접 입력', sourceUrl: '', listPrice: '', paidAmount: '', review: '', posterUrl: '',
};

export function AddConcertDialog({ open, onOpenChange, onSave }: Props) {
  const [mode, setMode] = useState<'url' | 'direct'>('url');
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<'scheduled' | 'attended'>('scheduled');
  const [coords, setCoords] = useState<GeocodeCandidate | null>(null);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [imageFile, setImageFile] = useState<File>();
  const [dateCandidates, setDateCandidates] = useState<string[]>([]);
  const [priceCandidates, setPriceCandidates] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) {
      setForm(emptyForm); setCoords(null); setCandidates([]); setImageFile(undefined); setDateCandidates([]); setPriceCandidates([]); setMessage('');
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
      setPriceCandidates(data.priceCandidates || []);
      setMessage(data.warnings.join(' ') || '정보를 불러왔어요. 날짜와 가격을 꼭 확인해 주세요.');
      setMode('direct');
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} 직접 입력으로 이어갈게요.` : '직접 입력으로 이어갈게요.');
      setMode('direct');
    } finally { setLoading(false); }
  }

  async function findVenue() {
    const query = form.address || form.venue;
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title || !form.artists || !form.performanceAt || !form.venue) {
      setMessage('공연명, 아티스트, 일시와 장소를 입력해 주세요.'); return;
    }
    setLoading(true);
    const concert: Concert = {
      id: crypto.randomUUID(), title: form.title.trim(),
      artists: form.artists.split(',').map((value) => value.trim()).filter(Boolean),
      performanceAt: new Date(form.performanceAt).toISOString(), venue: form.venue.trim(),
      address: form.address.trim(), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
      countryCode: coords?.countryCode || 'KR', bookingProvider: form.bookingProvider.trim(), sourceUrl: form.sourceUrl.trim(),
      listPrice: form.listPrice === '' ? null : Number(form.listPrice), paidAmount: form.paidAmount === '' ? null : Number(form.paidAmount),
      status, review: form.review.trim(), posterUrl: form.posterUrl.trim(),
    };
    try { await onSave(concert, imageFile); onOpenChange(false); }
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
          <Button type="button" variant={mode === 'url' ? 'default' : 'outline'} onClick={() => setMode('url')} className="flex-1"><Link2 />URL로 불러오기</Button>
          <Button type="button" variant={mode === 'direct' ? 'default' : 'outline'} onClick={() => setMode('direct')} className="flex-1"><PenLine />직접 입력</Button>
        </div>
        {mode === 'url' ? (
          <div className="space-y-4 px-5 pb-6">
            <label className="block text-sm font-medium">예매 페이지 URL
              <Input value={form.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="https://ticket..." className="mt-2 h-11" />
            </label>
            <p className="text-xs leading-5 text-black/45">NOL 티켓, YES24 티켓, 멜론티켓을 우선 지원합니다. 불러오지 못해도 입력한 URL은 유지돼요.</p>
            <Button className="h-11 w-full bg-[#ff6b61] text-[#17120f] hover:bg-[#ff827a]" onClick={importUrl} disabled={loading || !form.sourceUrl}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}정보 불러오기</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-5 pb-6">
            {dateCandidates.length > 1 && <CandidateGroup label="공연 회차 후보">{dateCandidates.map((candidate) => <button key={candidate} type="button" onClick={() => update('performanceAt', toDateTimeInput(candidate))} className={`rounded-full border px-3 py-2 text-xs ${form.performanceAt === toDateTimeInput(candidate) ? 'border-[#dfff94] bg-[#dfff94] text-black' : 'border-black/15 text-black/60'}`}>{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(candidate))}</button>)}</CandidateGroup>}
            {priceCandidates.length > 1 && <CandidateGroup label="가격 후보">{priceCandidates.map((candidate) => <button key={candidate} type="button" onClick={() => update('listPrice', candidate.toString())} className={`rounded-full border px-3 py-2 text-xs ${form.listPrice === candidate.toString() ? 'border-[#dfff94] bg-[#dfff94] text-black' : 'border-black/15 text-black/60'}`}>₩{candidate.toLocaleString('ko-KR')}</button>)}</CandidateGroup>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="공연명"><Input value={form.title} onChange={(e) => update('title', e.target.value)} /></Field>
              <Field label="아티스트"><Input value={form.artists} onChange={(e) => update('artists', e.target.value)} placeholder="쉼표로 구분" /></Field>
              <Field label="공연 일시"><Input type="datetime-local" value={form.performanceAt} onChange={(e) => update('performanceAt', e.target.value)} /></Field>
              <Field label="예매처"><Input value={form.bookingProvider} onChange={(e) => update('bookingProvider', e.target.value)} /></Field>
              <Field label="공연장"><Input value={form.venue} onChange={(e) => update('venue', e.target.value)} /></Field>
              <Field label="주소"><div className="flex gap-2"><Input value={form.address} onChange={(e) => update('address', e.target.value)} /><Button type="button" variant="outline" size="icon-lg" aria-label="위치 찾기" onClick={findVenue}><MapPin /></Button></div></Field>
              <Field label="정가"><Input inputMode="numeric" value={form.listPrice} onChange={(e) => update('listPrice', e.target.value.replace(/\D/g, ''))} placeholder="원" /></Field>
              <Field label="실제 결제액"><Input inputMode="numeric" value={form.paidAmount} onChange={(e) => update('paidAmount', e.target.value.replace(/\D/g, ''))} placeholder="원" /></Field>
            </div>
            {candidates.length > 0 && <div className="space-y-2 rounded-2xl bg-black/5 p-3">{candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => { setCoords(candidate); update('address', candidate.address); }} className={`flex w-full items-start gap-2 rounded-xl p-2 text-left text-xs ${coords?.id === candidate.id ? 'bg-[#dfff94] text-black' : 'hover:bg-black/5'}`}><MapPin className="mt-0.5 size-4 shrink-0" /><span><b className="block">{candidate.name}</b>{candidate.address}</span></button>)}</div>}
            <Field label="공식 이미지 URL"><Input value={form.posterUrl} onChange={(e) => update('posterUrl', e.target.value)} placeholder="자동 추출 또는 직접 입력" /></Field>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-black/15 p-4 text-sm text-black/60 hover:border-black/30"><ImagePlus className="size-5" /><span>{imageFile?.name || '이미지가 없으면 직접 추가 (최대 5MB)'}</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setImageFile(e.target.files?.[0])} /></label>
            <div className="grid grid-cols-2 gap-2"><Button type="button" variant={status === 'scheduled' ? 'default' : 'outline'} onClick={() => setStatus('scheduled')}>예정</Button><Button type="button" variant={status === 'attended' ? 'default' : 'outline'} onClick={() => setStatus('attended')}>관람 완료</Button></div>
            <Field label="짧은 후기"><Textarea value={form.review} onChange={(e) => update('review', e.target.value)} maxLength={5000} placeholder="그날의 마음을 남겨보세요." className="min-h-24" /></Field>
            {message && <p role="status" className="rounded-xl bg-black/5 p-3 text-xs leading-5 text-[#5d7b27]">{message}</p>}
            <Button type="submit" className="h-12 w-full bg-[#ff6b61] text-[#17120f] hover:bg-[#ff827a]" disabled={loading}>{loading && <LoaderCircle className="animate-spin" />}공연 저장하기</Button>
          </form>
        )}
        {mode === 'url' && message && <p role="status" className="mx-5 mb-5 rounded-xl bg-black/5 p-3 text-xs text-[#5d7b27]">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-black/60"><span className="mb-2 block">{label}</span>{children}</label>;
}

function CandidateGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <fieldset className="rounded-2xl bg-black/5 p-3"><legend className="px-1 text-xs text-black/50">{label}</legend><div className="mt-1 flex flex-wrap gap-2">{children}</div></fieldset>;
}

function toDateTimeInput(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
