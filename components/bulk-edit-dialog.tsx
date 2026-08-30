'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, LoaderCircle, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Concert } from '@/lib/types';

type BulkField = 'artist' | 'venue' | 'provider';

export function BulkEditDialog({ open, onOpenChange, concerts, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; concerts: Concert[]; onSave: (concerts: Concert[]) => Promise<void> }) {
  const [field, setField] = useState<BulkField>('artist');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const options = useMemo(() => valuesFor(concerts, field), [concerts, field]);
  const affected = useMemo(() => concerts.filter((concert) => matches(concert, field, from)), [concerts, field, from]);

  function changeField(next: BulkField) { setField(next); setFrom(''); setTo(''); setMessage(''); }
  function changeOpen(next: boolean) { if (!next) { setFrom(''); setTo(''); setMessage(''); } onOpenChange(next); }

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const replacement = to.trim();
    if (!from || !replacement) { setMessage('바꿀 기존 값과 새 값을 모두 입력해 주세요.'); return; }
    if (!affected.length) { setMessage('이 값이 들어간 공연 기록이 없어요.'); return; }
    setLoading(true); setMessage('');
    const changed = affected.map((concert) => replaceValue(concert, field, from, replacement));
    try { await onSave(changed); onOpenChange(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : '일괄 변경을 저장하지 못했어요.'); }
    finally { setLoading(false); }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent className="max-h-[90vh] overflow-y-auto border-black/10 bg-[#fbfaf6] text-[#1c1b18] sm:max-w-lg">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Replace className="size-5 text-[#ff6b61]" />기록 일괄 변경</DialogTitle><DialogDescription>같은 이름으로 저장된 값을 모든 공연에서 한 번에 정리해요.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-3 gap-2">{([['artist', '아티스트'], ['venue', '공연장'], ['provider', '예매처']] as const).map(([value, label]) => <Button key={value} type="button" variant={field === value ? 'default' : 'outline'} onClick={() => changeField(value)}>{label}</Button>)}</div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-medium text-black/55">기존 값<select value={from} onChange={(event) => setFrom(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#ff6b61]"><option value="">선택해 주세요</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate rounded-xl bg-black/[0.04] px-3 py-3 text-sm text-black/55">{from || '기존 값'}</span><ArrowRight className="size-4 shrink-0 text-black/30" /><Input value={to} onChange={(event) => setTo(event.target.value)} placeholder={field === 'artist' ? '예: Xdinary Heroes' : '새 이름'} className="h-11 min-w-0 flex-1" /></div>
        <p className="rounded-xl bg-[#f0eee7] p-3 text-xs leading-5 text-black/50">{from ? `${affected.length}개 공연의 ${fieldLabel(field)} ‘${from}’을(를) ‘${to.trim() || '새 값'}’(으)로 바꿉니다.` : `바꿀 ${fieldLabel(field)}을 선택해 주세요.`}{field === 'venue' && ' 기존 주소와 지도 좌표는 그대로 유지됩니다.'}</p>
        {message && <output className="block rounded-xl bg-[#fff0ec] p-3 text-xs text-[#a5413a]">{message}</output>}
        <Button type="submit" disabled={loading || !from || !to.trim() || !affected.length} className="h-12 w-full bg-[#dfff94] text-black hover:bg-[#d5f58d]">{loading && <LoaderCircle className="animate-spin" />}{affected.length}개 기록 일괄 변경</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

function valuesFor(concerts: Concert[], field: BulkField) {
  const values = field === 'artist' ? concerts.flatMap((concert) => concert.artists) : concerts.map((concert) => field === 'venue' ? concert.venue : concert.bookingProvider);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function matches(concert: Concert, field: BulkField, value: string) {
  if (!value) return false;
  return field === 'artist' ? concert.artists.includes(value) : field === 'venue' ? concert.venue === value : concert.bookingProvider === value;
}

function replaceValue(concert: Concert, field: BulkField, from: string, to: string): Concert {
  if (field === 'artist') return { ...concert, artists: [...new Set(concert.artists.map((artist) => artist === from ? to : artist))] };
  if (field === 'venue') return { ...concert, venue: to };
  return { ...concert, bookingProvider: to };
}

function fieldLabel(field: BulkField) { return field === 'artist' ? '아티스트' : field === 'venue' ? '공연장' : '예매처'; }
