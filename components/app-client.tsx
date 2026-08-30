'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Session } from '@supabase/supabase-js';
import { CalendarClock, CalendarDays, ChevronRight, CircleDollarSign, LogOut, Map, Plus, Sparkles, Ticket, Trophy, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AddConcertDialog } from './add-concert-dialog';
import { AuthGate } from './auth-gate';
import { CalendarView } from './calendar-view';
import { PosterImage } from './poster-image';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { demoConcerts, demoProfile } from '@/lib/demo-data';
import { isSupabaseConfigured, isTestMode, supabase } from '@/lib/supabase';
import type { Concert, Profile } from '@/lib/types';

type View = 'now' | 'calendar' | 'map';

const JourneyMap = dynamic(() => import('./journey-map').then((module) => module.JourneyMap), {
  ssr: false,
  loading: () => <div className="mt-24 text-center text-sm text-black/40">원정 지도를 펼치는 중...</div>,
});

export function AppClient() {
  const [view, setView] = useState<View>('now');
  const [concerts, setConcerts] = useState<Concert[]>(demoConcerts);
  const [profile, setProfile] = useState<Profile>(demoProfile);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(isTestMode || !isSupabaseConfigured);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Concert | null>(null);

  useEffect(() => {
    if (!supabase || isTestMode) return;
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

  if (!authReady) return <main className="grid min-h-screen place-items-center bg-[#f3f0e8] text-[#ff6b61]"><Sparkles className="animate-pulse" /></main>;
  if (isSupabaseConfigured && !isTestMode && !session) return <AuthGate />;

  return (
    <main className="min-h-screen bg-[#ebe5da] text-[#1c1b18]">
      <div className="mx-auto min-h-screen max-w-6xl bg-[#f8f5ee] px-5 pb-24 pt-7 shadow-[0_0_70px_rgba(71,54,31,.08)] sm:px-8 lg:px-10">
        {(isTestMode || !isSupabaseConfigured) && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-[#ff6b61]/20 bg-[#fff0ec] px-3 py-2 text-[11px] text-[#a5413a]">
            <span>{isTestMode ? '테스트 모드 · 로그인 없이 둘러보는 중' : '샘플 데이터로 둘러보는 데모 모드'}</span>
            <span className="shrink-0">새로고침하면 입력이 초기화돼요</span>
          </div>
        )}
        {view === 'now' && <NowView concerts={concerts} onAdd={() => setAddOpen(true)} onSelect={setSelected} />}
        {view === 'calendar' && <CalendarView concerts={concerts} onSelect={setSelected} />}
        {view === 'map' && <JourneyMap concerts={concerts} profile={profile} onProfileChange={saveProfile} />}
        <button aria-label="공연 추가" onClick={() => setAddOpen(true)} className="fixed bottom-[90px] right-5 z-20 grid size-12 place-items-center rounded-full bg-[#ff6b61] text-black shadow-xl shadow-black/40 sm:right-[max(24px,calc((100vw-1152px)/2))]"><Plus /></button>
        <nav aria-label="주요 메뉴" className="fixed inset-x-0 bottom-4 z-20 mx-auto flex w-[calc(100%-32px)] max-w-[430px] items-center justify-around rounded-[24px] border border-black/10 bg-[#fffdf8e8] p-2 shadow-[0_16px_45px_rgba(46,35,20,.18)] backdrop-blur-xl">
          <NavButton active={view === 'now'} onClick={() => setView('now')} icon={<WalletCards />} label="지금" />
          <NavButton active={view === 'calendar'} onClick={() => setView('calendar')} icon={<CalendarDays />} label="캘린더" />
          <NavButton active={view === 'map'} onClick={() => setView('map')} icon={<Map />} label="원정 지도" />
        </nav>
        {session && <button aria-label="로그아웃" onClick={() => supabase?.auth.signOut()} className="fixed right-4 top-4 rounded-full p-2 text-black/30 hover:text-black"><LogOut className="size-4" /></button>}
      </div>
      <AddConcertDialog open={addOpen} onOpenChange={setAddOpen} onSave={saveConcert} />
      <ConcertDetail concert={selected} onOpenChange={(open) => !open && setSelected(null)} onSave={updateConcert} onDelete={deleteConcert} />
    </main>
  );
}

function NowView({ concerts, onAdd, onSelect }: { concerts: Concert[]; onAdd: () => void; onSelect: (concert: Concert) => void }) {
  const now = new Date();
  const availableYears = [...new Set([now.getFullYear(), ...concerts.map((concert) => new Date(concert.performanceAt).getFullYear())])].sort((a, b) => b - a);
  const [year, setYear] = useState(now.getFullYear());
  const [filter, setFilter] = useState<'all' | 'attended' | 'scheduled'>('all');
  const yearConcerts = concerts.filter((concert) => new Date(concert.performanceAt).getFullYear() === year);
  const attended = yearConcerts.filter((concert) => concert.status === 'attended');
  const monthAttended = concerts.filter((concert) => { const date = new Date(concert.performanceAt); return concert.status === 'attended' && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const monthPaid = sum(monthAttended.map((item) => item.paidAmount));
  const monthList = sum(monthAttended.map((item) => item.listPrice));
  const artistCounts = attended.flatMap((item) => item.artists).reduce<Record<string, number>>((acc, artist) => ({ ...acc, [artist]: (acc[artist] || 0) + 1 }), {});
  const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];
  const nextConcert = concerts.filter((concert) => concert.status === 'scheduled' && new Date(concert.performanceAt) >= now).sort((a, b) => a.performanceAt.localeCompare(b.performanceAt))[0];
  const overdueCount = concerts.filter((concert) => concert.status === 'scheduled' && new Date(concert.performanceAt) < now).length;
  const annualPaid = sum(yearConcerts.map((item) => item.paidAmount));
  const monthlyData = Array.from({ length: 12 }, (_, month) => {
    const items = yearConcerts.filter((concert) => new Date(concert.performanceAt).getMonth() === month);
    return { month: `${month + 1}월`, attended: items.filter((item) => item.status === 'attended').length, scheduled: items.filter((item) => item.status === 'scheduled').length };
  });
  const visibleConcerts = yearConcerts.filter((concert) => filter === 'all' || concert.status === filter).sort((a, b) => b.performanceAt.localeCompare(a.performanceAt));

  return <section className="animate-in fade-in pb-20 duration-300">
    <header className="flex items-end justify-between gap-4"><div><p className="eyebrow">Dukjil log</p><h1 className="screen-title">공연 생활, 한눈에</h1><p className="mt-2 text-sm text-black/45">기록이 쌓일수록 나만의 공연 취향이 선명해져요.</p></div><Button size="icon-lg" className="size-11 shrink-0 rounded-full bg-[#ff6b61] text-black hover:bg-[#ff827a]" onClick={onAdd}><Plus /></Button></header>

    <div className="mt-7 grid gap-4 lg:grid-cols-[1.55fr_.75fr]">
      <section className="overflow-hidden rounded-[30px] bg-[#f3f0e8] p-5 text-[#181713] sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-black/45">Yearly archive</p><h2 className="mt-1 text-3xl font-semibold tracking-[-0.055em]">{year}년 공연 장부</h2></div><label className="relative"><span className="sr-only">연도 선택</span><select value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold outline-none">{availableYears.map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <div className="mt-7 grid grid-cols-3 gap-2 border-t border-black/10 pt-5"><OverviewNumber label="기록한 공연" value={`${yearConcerts.length}회`} /><OverviewNumber label="관람 완료" value={`${attended.length}회`} /><OverviewNumber label="총 결제액" value={money(annualPaid)} /></div>
      </section>
      <button onClick={() => nextConcert && onSelect(nextConcert)} disabled={!nextConcert} className="group relative min-h-44 overflow-hidden rounded-[30px] border border-[#ff6b61]/15 bg-[#ffe5df] p-5 text-left shadow-sm disabled:cursor-default">
        {nextConcert && <PosterImage src={nextConcert.posterUrl} title={nextConcert.title} className="absolute inset-y-0 right-0 h-full w-2/5 object-cover opacity-45 [mask-image:linear-gradient(to_right,transparent,black)]" />}
        <span className="relative block text-xs text-[#d94d44]">Next stage</span><b className="relative mt-3 block max-w-[72%] text-xl leading-tight">{nextConcert?.title || '예정된 공연이 없어요'}</b><span className="relative mt-3 block max-w-[72%] text-xs leading-5 text-black/50">{nextConcert ? `${dateLabel(nextConcert.performanceAt)} · ${nextConcert.venue}` : '새 공연을 추가해 다음 무대를 기다려 보세요.'}</span>{nextConcert && <ChevronRight className="absolute bottom-5 right-5 size-5 text-black/40 transition group-hover:translate-x-1" />}
      </button>
    </div>

    <section className="mt-4 rounded-[30px] bg-[#f3f0e8] p-4 text-[#181713] sm:p-6">
      <div className="flex items-center justify-between"><div><p className="text-xs text-black/40">Monthly rhythm</p><h2 className="mt-1 text-lg font-semibold">월별 공연 개수</h2></div><div className="flex gap-3 text-[10px] text-black/45"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#ff6b61]" />관람 완료</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#b8e96c]" />예정</span></div></div>
      <div className="mt-4 h-56 w-full" aria-label={`${year}년 월별 공연 개수 그래프`}><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyData} margin={{ top: 14, right: 0, left: -28, bottom: 0 }}><CartesianGrid vertical={false} stroke="rgba(0,0,0,.08)" strokeDasharray="3 4" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'rgba(0,0,0,.42)', fontSize: 10 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'rgba(0,0,0,.35)', fontSize: 10 }} /><Tooltip cursor={{ fill: 'rgba(0,0,0,.035)' }} contentStyle={{ border: 0, borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontSize: 12 }} /><Bar dataKey="attended" name="관람 완료" stackId="count" fill="#ff6b61" radius={[0, 0, 4, 4]} maxBarSize={24} /><Bar dataKey="scheduled" name="예정" stackId="count" fill="#b8e96c" radius={[5, 5, 0, 0]} maxBarSize={24} /></BarChart></ResponsiveContainer></div>
    </section>

    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardMetric icon={<CalendarClock />} label={`${now.getMonth() + 1}월 관람`} value={`${monthAttended.length}회`} detail={overdueCount ? `완료 확인 ${overdueCount}건` : '모두 정리했어요'} /><DashboardMetric icon={<CircleDollarSign />} label={`${now.getMonth() + 1}월 지출`} value={money(monthPaid)} detail={`정가 ${money(monthList)}`} /><DashboardMetric icon={<Ticket />} label="이번 달 절약" value={money(Math.max(0, monthList - monthPaid))} detail="정가 대비" accent /><DashboardMetric icon={<Trophy />} label={`${year} 최애`} value={topArtist?.[0] || '아직 없음'} detail={topArtist ? `${topArtist[1]}번 만났어요` : '첫 관람을 기록해 보세요'} accent /></div>

    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-black/35">Concert ledger</p><h2 className="mt-1 text-xl font-semibold">공연냠냠</h2></div><div className="flex rounded-full border border-black/10 bg-black/[0.035] p-1">{([['all', '전체'], ['attended', '관람 완료'], ['scheduled', '예정']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs transition ${filter === value ? 'bg-[#dfff94] text-black' : 'text-black/45 hover:text-black'}`}>{label}</button>)}</div></div>
      <div className="mt-4 overflow-hidden rounded-[26px] border border-black/10 bg-white/70 shadow-sm">
        <div className="hidden grid-cols-[76px_1fr_150px_120px] gap-4 border-b border-black/10 px-4 py-3 text-[10px] uppercase tracking-wider text-black/35 sm:grid"><span>날짜</span><span>공연</span><span>장소</span><span className="text-right">결제액</span></div>
        {visibleConcerts.length ? visibleConcerts.map((concert) => <button key={concert.id} onClick={() => onSelect(concert)} className="grid w-full grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-black/[0.07] px-3 py-3 text-left last:border-0 hover:bg-[#fff8f4] sm:grid-cols-[60px_1fr_150px_120px] sm:px-4"><span className="text-center"><b className="block text-lg leading-none">{new Date(concert.performanceAt).getDate()}</b><span className="mt-1 block text-[10px] text-black/40">{new Date(concert.performanceAt).getMonth() + 1}월</span></span><span className="flex min-w-0 items-center gap-3"><PosterImage src={concert.posterUrl} title={concert.title} className="size-11 shrink-0 rounded-xl object-cover" /><span className="min-w-0"><b className="block truncate text-sm">{concert.title}</b><span className="mt-1 flex items-center gap-2 text-[11px] text-black/40"><i className={`status-dot ${concert.status}`} />{concert.artists.join(' · ') || '아티스트 미입력'} · {concert.status === 'attended' ? '관람 완료' : '예정'}</span></span></span><span className="hidden truncate text-xs text-black/45 sm:block">{concert.venue}</span><span className="text-right text-xs font-medium text-black/65">{concert.paidAmount == null ? '미입력' : money(concert.paidAmount)}</span></button>) : <div className="p-10 text-center text-sm text-black/35">이 조건에 맞는 공연이 아직 없어요.</div>}
      </div>
    </section>
  </section>;
}

function ConcertDetail({ concert, onOpenChange, onSave, onDelete }: { concert: Concert | null; onOpenChange: (open: boolean) => void; onSave: (concert: Concert) => Promise<void>; onDelete: (concert: Concert) => Promise<void> }) {
  const [review, setReview] = useState('');
  useEffect(() => setReview(concert?.review || ''), [concert]);
  if (!concert) return null;
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="overflow-hidden border-black/10 bg-[#fbfaf6] p-0 text-[#1c1b18] sm:max-w-md"><div className="relative h-48"><PosterImage src={concert.posterUrl} title={concert.title} className="h-full w-full object-cover" /><span className="absolute inset-0 bg-gradient-to-t from-[#fbfaf6] to-transparent" /></div><div className="space-y-4 px-5 pb-5"><DialogHeader><DialogTitle className="text-xl">{concert.title}</DialogTitle><DialogDescription>{concert.artists.join(' · ')}<br />{dateLabel(concert.performanceAt)} · {concert.venue}</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-2"><Button variant={concert.status === 'scheduled' ? 'default' : 'outline'} onClick={() => onSave({ ...concert, status: 'scheduled' })}>예정</Button><Button variant={concert.status === 'attended' ? 'default' : 'outline'} onClick={() => onSave({ ...concert, status: 'attended' })}>관람 완료</Button></div><label className="block text-xs text-black/50">나의 후기<Textarea value={review} onChange={(e) => setReview(e.target.value)} maxLength={5000} className="mt-2 min-h-28" placeholder="그날의 마음을 남겨보세요." /></label><Button className="w-full" onClick={() => onSave({ ...concert, review })}>후기 저장</Button><button onClick={() => onDelete(concert)} className="w-full py-1 text-xs text-red-500/65 hover:text-red-600">이 기록 삭제</button></div></DialogContent></Dialog>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex min-w-20 flex-col items-center gap-1 rounded-2xl px-4 py-2 transition ${active ? 'bg-[#1f1d19] text-[#dfff94]' : 'text-black/40'}`}><span className="[&>svg]:size-5">{icon}</span><span className="text-[11px]">{label}</span></button>; }
function OverviewNumber({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-lg font-semibold tracking-[-0.035em] sm:text-2xl">{value}</p></div>; }
function DashboardMetric({ icon, label, value, detail, accent = false }: { icon: React.ReactNode; label: string; value: string; detail: string; accent?: boolean }) { return <div className={`min-w-0 rounded-[24px] border p-4 shadow-sm ${accent ? 'border-[#b9df75]/45 bg-[#eff8dc]' : 'border-black/10 bg-white/75'}`}><span className={`grid size-8 place-items-center rounded-xl [&>svg]:size-4 ${accent ? 'bg-[#dfff94] text-black' : 'bg-[#ffe1dc] text-[#d94d44]'}`}>{icon}</span><p className="mt-4 text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-lg font-semibold tracking-[-0.035em]">{value}</p><p className="mt-1 truncate text-[10px] text-black/35">{detail}</p></div>; }
function sum(values: Array<number | null>) { return values.reduce<number>((total, value) => total + (value ?? 0), 0); }
function money(value: number) { return `₩${value.toLocaleString('ko-KR')}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function rowToConcert(row: any, posterUrl: string): Concert { return { id: row.id, title: row.title, artists: (row.concert_artists || []).map((item: any) => item.artists?.name).filter(Boolean), performanceAt: row.performance_at, venue: row.venue, address: row.address || '', latitude: row.latitude, longitude: row.longitude, countryCode: row.country_code || 'KR', bookingProvider: row.booking_provider || '', sourceUrl: row.source_url || '', listPrice: row.list_price, paidAmount: row.paid_amount, status: row.status, review: row.review || '', posterUrl, posterStoragePath: row.poster_storage_path || undefined }; }
