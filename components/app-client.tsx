'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Session } from '@supabase/supabase-js';
import { CalendarDays, ChevronRight, LogOut, Map, Plus, Sparkles, Ticket, WalletCards } from 'lucide-react';
import { AddConcertDialog } from './add-concert-dialog';
import { AuthGate } from './auth-gate';
import { CalendarView } from './calendar-view';
import { PosterImage } from './poster-image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { demoConcerts, demoProfile } from '@/lib/demo-data';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Concert, Profile } from '@/lib/types';

type View = 'now' | 'calendar' | 'map';

const JourneyMap = dynamic(() => import('./journey-map').then((module) => module.JourneyMap), {
  ssr: false,
  loading: () => <div className="mt-24 text-center text-sm text-white/40">원정 지도를 펼치는 중...</div>,
});

export function AppClient() {
  const [view, setView] = useState<View>('now');
  const [concerts, setConcerts] = useState<Concert[]>(demoConcerts);
  const [profile, setProfile] = useState<Profile>(demoProfile);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Concert | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session?.user) void loadRemoteData(session.user.id); }, [session?.user]);

  async function loadRemoteData(userId: string) {
    const client = supabase;
    if (!client) return;
    const [{ data: rows }, { data: profileRow }] = await Promise.all([
      client.from('concerts').select('*, concert_artists(artists(name))').order('performance_at'),
      client.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    if (rows) {
      const mapped = await Promise.all(rows.map(async (row: any) => {
        let posterUrl = row.poster_url || '';
        if (row.poster_storage_path) {
          const { data } = await client.storage.from('posters').createSignedUrl(row.poster_storage_path, 3600);
          if (data?.signedUrl) posterUrl = data.signedUrl;
        }
        return rowToConcert(row, posterUrl);
      }));
      setConcerts(mapped);
    }
    if (profileRow) setProfile({ originName: profileRow.origin_name, originAddress: profileRow.origin_address, originLatitude: profileRow.origin_latitude, originLongitude: profileRow.origin_longitude, originCountryCode: profileRow.origin_country_code });
  }

  async function saveConcert(concert: Concert, imageFile?: File) {
    if (!supabase || !session?.user) { setConcerts((items) => [...items, { ...concert, posterUrl: imageFile ? URL.createObjectURL(imageFile) : concert.posterUrl }]); return; }
    let storagePath = '';
    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('invalid image');
      storagePath = `${session.user.id}/${concert.id}.${imageFile.type.split('/')[1]}`;
      const { error } = await supabase.storage.from('posters').upload(storagePath, imageFile, { upsert: true, contentType: imageFile.type });
      if (error) throw error;
    }
    const { error } = await supabase.from('concerts').insert({ id: concert.id, user_id: session.user.id, title: concert.title, performance_at: concert.performanceAt, venue: concert.venue, address: concert.address, latitude: concert.latitude, longitude: concert.longitude, country_code: concert.countryCode, booking_provider: concert.bookingProvider, source_url: concert.sourceUrl || null, list_price: concert.listPrice, paid_amount: concert.paidAmount, status: concert.status, review: concert.review, poster_url: concert.posterUrl || null, poster_storage_path: storagePath || null });
    if (error) throw error;
    for (const name of concert.artists) {
      let { data: artist } = await supabase.from('artists').select('id').eq('name', name).maybeSingle();
      if (!artist) {
        const created = await supabase.from('artists').insert({ name }).select('id').single();
        if (created.error) throw created.error;
        artist = created.data;
      }
      await supabase.from('concert_artists').insert({ concert_id: concert.id, artist_id: artist.id });
    }
    await loadRemoteData(session.user.id);
  }

  async function saveProfile(next: Profile) {
    setProfile(next);
    if (supabase && session?.user) await supabase.from('profiles').upsert({ user_id: session.user.id, origin_name: next.originName, origin_address: next.originAddress, origin_latitude: next.originLatitude, origin_longitude: next.originLongitude, origin_country_code: next.originCountryCode });
  }

  async function updateConcert(next: Concert) {
    setConcerts((items) => items.map((item) => item.id === next.id ? next : item)); setSelected(next);
    if (supabase && session?.user) await supabase.from('concerts').update({ status: next.status, review: next.review }).eq('id', next.id);
  }

  async function deleteConcert(concert: Concert) {
    setConcerts((items) => items.filter((item) => item.id !== concert.id)); setSelected(null);
    if (supabase && session?.user) await supabase.from('concerts').delete().eq('id', concert.id);
  }

  if (!authReady) return <main className="grid min-h-screen place-items-center bg-[#11110f] text-[#dfff94]"><Sparkles className="animate-pulse" /></main>;
  if (isSupabaseConfigured && !session) return <AuthGate />;

  return (
    <main className="min-h-screen bg-[#0c0c0b] text-white">
      <div className="mx-auto min-h-screen max-w-6xl bg-[#11110f] px-5 pb-24 pt-7 sm:px-8 lg:px-10">
        {!isSupabaseConfigured && <div className="mb-5 flex items-center justify-between rounded-2xl border border-[#dfff94]/20 bg-[#dfff94]/10 px-3 py-2 text-[11px] text-[#dfff94]"><span>샘플 데이터로 둘러보는 데모 모드</span><span>외부 연결 준비됨</span></div>}
        {view === 'now' && <NowView concerts={concerts} onAdd={() => setAddOpen(true)} onSelect={setSelected} />}
        {view === 'calendar' && <CalendarView concerts={concerts} onSelect={setSelected} />}
        {view === 'map' && <JourneyMap concerts={concerts} profile={profile} onProfileChange={saveProfile} />}
        <button aria-label="공연 추가" onClick={() => setAddOpen(true)} className="fixed bottom-[90px] right-5 z-20 grid size-12 place-items-center rounded-full bg-[#ff6b61] text-black shadow-xl shadow-black/40 sm:right-[max(24px,calc((100vw-1152px)/2))]"><Plus /></button>
        <nav aria-label="주요 메뉴" className="fixed inset-x-0 bottom-4 z-20 mx-auto flex w-[calc(100%-32px)] max-w-[430px] items-center justify-around rounded-[24px] border border-white/10 bg-[#201f1be8] p-2 shadow-2xl backdrop-blur-xl">
          <NavButton active={view === 'now'} onClick={() => setView('now')} icon={<WalletCards />} label="지금" />
          <NavButton active={view === 'calendar'} onClick={() => setView('calendar')} icon={<CalendarDays />} label="캘린더" />
          <NavButton active={view === 'map'} onClick={() => setView('map')} icon={<Map />} label="원정 지도" />
        </nav>
        {session && <button aria-label="로그아웃" onClick={() => supabase?.auth.signOut()} className="fixed right-4 top-4 rounded-full p-2 text-white/30 hover:text-white"><LogOut className="size-4" /></button>}
      </div>
      <AddConcertDialog open={addOpen} onOpenChange={setAddOpen} onSave={saveConcert} />
      <ConcertDetail concert={selected} onOpenChange={(open) => !open && setSelected(null)} onSave={updateConcert} onDelete={deleteConcert} />
    </main>
  );
}

function NowView({ concerts, onAdd, onSelect }: { concerts: Concert[]; onAdd: () => void; onSelect: (concert: Concert) => void }) {
  const now = new Date();
  const monthAttended = concerts.filter((concert) => { const date = new Date(concert.performanceAt); return concert.status === 'attended' && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const listTotal = sum(monthAttended.map((item) => item.listPrice)); const paidTotal = sum(monthAttended.map((item) => item.paidAmount));
  const counts = monthAttended.flatMap((item) => item.artists).reduce<Record<string, number>>((acc, artist) => ({ ...acc, [artist]: (acc[artist] || 0) + 1 }), {});
  const topArtist = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const upcoming = concerts.filter((concert) => concert.status === 'scheduled').sort((a, b) => a.performanceAt.localeCompare(b.performanceAt));
  return <section className="animate-in fade-in duration-300 pb-20"><header className="flex items-center justify-between"><div><p className="eyebrow">Dukjil log</p><h1 className="screen-title">지금, 나의 공연 생활</h1></div><Button size="icon-lg" className="size-11 rounded-full bg-[#ff6b61] text-black hover:bg-[#ff827a]" onClick={onAdd}><Plus /></Button></header><section className="mt-8 overflow-hidden rounded-[30px] bg-[#f3f0e8] p-5 text-[#181713] lg:p-7"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-black/45">{now.getFullYear()}년 {now.getMonth() + 1}월</p><p className="mt-2 text-4xl font-semibold tracking-[-0.06em]">{monthAttended.length}번의 함성</p></div><Ticket className="size-8 text-[#ff5f55]" /></div><div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="실제 지출" value={money(paidTotal)} /><Metric label="티켓 정가" value={money(listTotal)} /><Metric label="아낀 금액" value={money(Math.max(0, listTotal - paidTotal))} accent /><Metric label="가장 많이 본" value={topArtist ? `${topArtist[0]} · ${topArtist[1]}회` : '아직 없음'} accent /></div></section><div className="mt-8 grid gap-7 lg:grid-cols-[1.35fr_.65fr]"><section><div className="flex items-end justify-between"><div><p className="text-xs text-white/40">Next stage</p><h2 className="mt-1 text-xl font-semibold">기다리고 있는 공연</h2></div><span className="text-xs text-white/35">{upcoming.length}개 예정</span></div><div className="mt-4 space-y-3">{upcoming.length ? upcoming.slice(0, 3).map((concert) => <button key={concert.id} onClick={() => onSelect(concert)} className="group flex w-full items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-3 text-left hover:bg-white/[0.07]"><PosterImage src={concert.posterUrl} title={concert.title} className="size-20 rounded-2xl object-cover" /><span className="min-w-0 flex-1"><b className="block truncate">{concert.title}</b><span className="mt-1 block text-sm text-white/45">{concert.artists.join(' · ')}</span><span className="mt-2 block text-xs text-[#dfff94]">{dateLabel(concert.performanceAt)} · {concert.venue}</span></span><ChevronRight className="size-5 text-white/20 group-hover:text-white/70" /></button>) : <div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">다음 공연을 추가해 설렘을 시작해 보세요.</div>}</div></section><section><p className="text-xs text-white/40">Recent memory</p><h2 className="mt-1 text-xl font-semibold">최근의 여운</h2>{monthAttended.at(-1) ? <button onClick={() => onSelect(monthAttended.at(-1)!)} className="relative mt-4 min-h-56 w-full overflow-hidden rounded-3xl text-left"><PosterImage src={monthAttended.at(-1)!.posterUrl} title={monthAttended.at(-1)!.title} className="absolute inset-0 h-full w-full object-cover" /><span className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" /><span className="absolute inset-x-4 bottom-4"><b className="block">{monthAttended.at(-1)!.title}</b><span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/60">{monthAttended.at(-1)!.review || '아직 후기를 남기지 않았어요.'}</span></span></button> : null}</section></div></section>;
}

function ConcertDetail({ concert, onOpenChange, onSave, onDelete }: { concert: Concert | null; onOpenChange: (open: boolean) => void; onSave: (concert: Concert) => Promise<void>; onDelete: (concert: Concert) => Promise<void> }) {
  const [review, setReview] = useState('');
  useEffect(() => setReview(concert?.review || ''), [concert]);
  if (!concert) return null;
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="overflow-hidden border-white/10 bg-[#1b1a17] p-0 sm:max-w-md"><div className="relative h-48"><PosterImage src={concert.posterUrl} title={concert.title} className="h-full w-full object-cover" /><span className="absolute inset-0 bg-gradient-to-t from-[#1b1a17] to-transparent" /></div><div className="space-y-4 px-5 pb-5"><DialogHeader><DialogTitle className="text-xl">{concert.title}</DialogTitle><DialogDescription>{concert.artists.join(' · ')}<br />{dateLabel(concert.performanceAt)} · {concert.venue}</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-2"><Button variant={concert.status === 'scheduled' ? 'default' : 'outline'} onClick={() => onSave({ ...concert, status: 'scheduled' })}>예정</Button><Button variant={concert.status === 'attended' ? 'default' : 'outline'} onClick={() => onSave({ ...concert, status: 'attended' })}>관람 완료</Button></div><label className="block text-xs text-white/50">나의 후기<Textarea value={review} onChange={(e) => setReview(e.target.value)} maxLength={5000} className="mt-2 min-h-28" placeholder="그날의 마음을 남겨보세요." /></label><Button className="w-full" onClick={() => onSave({ ...concert, review })}>후기 저장</Button><button onClick={() => onDelete(concert)} className="w-full py-1 text-xs text-red-300/65 hover:text-red-300">이 기록 삭제</button></div></DialogContent></Dialog>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex min-w-20 flex-col items-center gap-1 rounded-2xl px-4 py-2 transition ${active ? 'bg-white/10 text-[#dfff94]' : 'text-white/40'}`}><span className="[&>svg]:size-5">{icon}</span><span className="text-[11px]">{label}</span></button>; }
function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className={`rounded-2xl p-4 ${accent ? 'bg-[#dfff94]' : 'bg-black/[0.055]'}`}><p className="text-xs text-black/45">{label}</p><p className="mt-1 truncate text-lg font-semibold">{value}</p></div>; }
function sum(values: Array<number | null>) { return values.reduce<number>((total, value) => total + (value ?? 0), 0); }
function money(value: number) { return `₩${value.toLocaleString('ko-KR')}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function rowToConcert(row: any, posterUrl: string): Concert { return { id: row.id, title: row.title, artists: (row.concert_artists || []).map((item: any) => item.artists?.name).filter(Boolean), performanceAt: row.performance_at, venue: row.venue, address: row.address || '', latitude: row.latitude, longitude: row.longitude, countryCode: row.country_code || 'KR', bookingProvider: row.booking_provider || '', sourceUrl: row.source_url || '', listPrice: row.list_price, paidAmount: row.paid_amount, status: row.status, review: row.review || '', posterUrl, posterStoragePath: row.poster_storage_path || undefined }; }
