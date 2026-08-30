'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Concert, ConcertStatus } from '@/lib/types';
import { PosterImage } from './poster-image';

const week = ['일', '월', '화', '수', '목', '금', '토'];

export function CalendarView({ concerts, onSelect }: { concerts: Concert[]; onSelect: (concert: Concert) => void }) {
  const initial = concerts.length ? new Date(concerts[0].performanceAt) : new Date();
  const [month, setMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [filter, setFilter] = useState<'all' | ConcertStatus>('all');
  const [selectedKey, setSelectedKey] = useState('');
  const filtered = concerts.filter((concert) => filter === 'all' || concert.status === filter);
  const cells = useMemo(() => {
    const firstDay = month.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstDay + 1;
      if (day < 1 || day > days) return null;
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayConcerts = filtered.filter((concert) => localDateKey(concert.performanceAt) === key);
      return { day, key, concerts: dayConcerts };
    });
  }, [filtered, month]);
  const selected = filtered.filter((concert) => localDateKey(concert.performanceAt) === selectedKey);

  return (
    <section className="animate-in fade-in duration-300 pb-28">
      <header className="flex items-start justify-between">
        <div><p className="eyebrow">Photo calendar</p><h1 className="screen-title">기억이 박힌 달력</h1></div>
        <Button variant="outline" size="sm" onClick={() => setMonth(new Date())}>오늘</Button>
      </header>
      <div className="mt-7 flex items-center justify-between">
        <Button variant="ghost" size="icon-lg" aria-label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
        <h2 className="text-xl font-semibold">{month.getFullYear()}년 {month.getMonth() + 1}월</h2>
        <Button variant="ghost" size="icon-lg" aria-label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-black/[0.045] p-1.5">
        {([['all', '전체'], ['scheduled', '예정'], ['attended', '관람 완료']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-xl py-2 text-xs transition ${filter === value ? 'bg-white text-black shadow-sm' : 'text-black/45'}`}>{label}</button>)}
      </div>
      <div className="mt-5 grid grid-cols-7 text-center text-[11px] text-black/35">{week.map((day, i) => <span key={day} className={i === 0 ? 'text-[#e75d54]' : ''}>{day}</span>)}</div>
      <div className="mt-2 grid grid-cols-7 overflow-hidden rounded-3xl border border-black/10 bg-white/75 shadow-sm">
        {cells.map((cell, index) => cell ? (
          <button key={cell.key} onClick={() => setSelectedKey(cell.key)} aria-label={`${cell.key}, 공연 ${cell.concerts.length}개`} className={`relative aspect-[0.82] overflow-hidden border-b border-r border-black/[0.07] text-left ${selectedKey === cell.key ? 'ring-2 ring-inset ring-[#ff6b61]' : ''}`}>
            {cell.concerts[0] ? <PosterImage src={cell.concerts[0].posterUrl} title={cell.concerts[0].title} className="absolute inset-0 h-full w-full object-cover" /> : <span className="absolute inset-0 bg-black/5" />}
            {cell.concerts[0] && <span className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/50" />}
            <span className={`absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full text-[11px] font-semibold ${cell.concerts[0] ? 'bg-black/55 text-white' : 'text-black/45'}`}>{cell.day}</span>
            {cell.concerts.length > 1 && <span className="absolute bottom-1.5 right-1.5 rounded-full bg-[#dfff94] px-1.5 py-0.5 text-[9px] font-bold text-black">+{cell.concerts.length - 1}</span>}
          </button>
        ) : <span key={`empty-${index}`} className="aspect-[0.82] border-b border-r border-black/[0.05] bg-black/[0.012]" />)}
      </div>
      <div className="mt-6">
        {selected.length ? <div className="space-y-3">{selected.map((concert) => <button key={concert.id} onClick={() => onSelect(concert)} className="flex w-full items-center gap-4 rounded-3xl border border-black/10 bg-white/75 p-3 text-left shadow-sm"><PosterImage src={concert.posterUrl} title={concert.title} className="size-20 shrink-0 rounded-2xl object-cover" /><span className="min-w-0 flex-1"><b className="block truncate">{concert.title}</b><span className="mt-1 block text-sm text-black/50">{concert.artists.join(' · ')}</span><span className="mt-2 flex items-center gap-1 text-xs text-black/40"><MapPin className="size-3" />{concert.venue}</span></span><span className={`status-dot ${concert.status}`} /></button>)}</div> : <div className="rounded-3xl border border-dashed border-black/10 p-6 text-center text-sm text-black/35">공연이 있는 날짜를 눌러 기억을 펼쳐보세요.</div>}
      </div>
    </section>
  );
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
