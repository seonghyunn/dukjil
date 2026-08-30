'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Session } from '@supabase/supabase-js';
import { CalendarClock, CalendarDays, ChevronRight, CircleDollarSign, ImagePlus, Link2, LoaderCircle, LogOut, Map as MapIcon, MessageCircle, Plus, Replace, Send, Sparkles, Trash2, Trophy, WalletCards, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AddConcertDialog } from './add-concert-dialog';
import { BulkEditDialog } from './bulk-edit-dialog';
import { AuthGate } from './auth-gate';
import { CalendarView } from './calendar-view';
import { PosterImage } from './poster-image';
import { RatingPicker } from './rating-picker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { demoConcerts, demoProfile } from '@/lib/demo-data';
import { isSupabaseConfigured, isTestMode, supabase } from '@/lib/supabase';
import type { Concert, ImportDraft, Profile } from '@/lib/types';

type View = 'now' | 'calendar' | 'map';
const CHART_COLORS = ['#ff6b61', '#b8e96c', '#6c8cff', '#f3b85b', '#a775d2', '#54b9b0', '#ef8db4'];

const JourneyMap = dynamic(() => import('./journey-map').then((module) => module.JourneyMap), {
  ssr: false,
  loading: () => <div className="mt-24 text-center text-sm text-black/40">원정 지도를 펼치는 중...</div>,
});

export function AppClient() {
  const [view, setView] = useState<View>('now');
  const [statsYear, setStatsYear] = useState(new Date().getFullYear());
  const [concerts, setConcerts] = useState<Concert[]>(demoConcerts);
  const [profile, setProfile] = useState<Profile>(demoProfile);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(isTestMode || !isSupabaseConfigured);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
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
      client.from('concerts').select('*, concert_artists(artists(name)), concert_reviews(id, body, created_at)').order('performance_at'),
      client.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    if (rows) {
      const mapped = await Promise.all(rows.map(async (row: any) => {
        let posterUrl = row.official_poster_url || row.poster_url || '';
        if (row.poster_source === 'upload' && row.poster_storage_path) {
          const { data } = await client.storage.from('posters').createSignedUrl(row.poster_storage_path, 3600);
          if (data?.signedUrl) posterUrl = data.signedUrl;
        }
        return rowToConcert(row, posterUrl);
      }));
      setConcerts(mapped);
    }
    if (profileRow) setProfile({ originConfigured: Boolean(profileRow.origin_configured), originName: profileRow.origin_name, originAddress: profileRow.origin_address, originLatitude: profileRow.origin_latitude, originLongitude: profileRow.origin_longitude, originCountryCode: profileRow.origin_country_code });
  }

  async function saveConcerts(nextConcerts: Concert[], imageFile?: File) {
    if (!supabase || !session?.user) {
      const prepared = nextConcerts.map((concert) => ({ ...concert, posterUrl: imageFile ? URL.createObjectURL(imageFile) : concert.posterUrl, posterSource: imageFile ? 'upload' as const : 'official' as const }));
      setConcerts((items) => [...items, ...prepared]);
    } else {
      for (const concert of nextConcerts) await saveConcert(concert, imageFile, false);
      await loadRemoteData(session.user.id);
    }
    const latest = [...nextConcerts].sort((a, b) => b.performanceAt.localeCompare(a.performanceAt))[0];
    if (latest) setStatsYear(new Date(latest.performanceAt).getFullYear());
    setView('now');
  }

  async function saveConcert(concert: Concert, imageFile?: File, reload = true) {
    if (!supabase || !session?.user) return;
    let storagePath = '';
    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('invalid image');
      storagePath = `${session.user.id}/${concert.id}.${imageFile.type.split('/')[1]}`;
      const { error } = await supabase.storage.from('posters').upload(storagePath, imageFile, { upsert: true, contentType: imageFile.type });
      if (error) throw error;
    }
    const { error } = await supabase.from('concerts').insert({ id: concert.id, user_id: session.user.id, title: concert.title, performance_at: concert.performanceAt, venue: concert.venue, address: concert.address, latitude: concert.latitude, longitude: concert.longitude, country_code: concert.countryCode, booking_provider: concert.bookingProvider, source_url: concert.sourceUrl || null, list_price: concert.listPrice, paid_amount: concert.paidAmount, status: concert.status, rating: concert.rating, review: '', poster_url: concert.officialPosterUrl || concert.posterUrl || null, official_poster_url: concert.officialPosterUrl || concert.posterUrl || null, poster_source: imageFile ? 'upload' : 'official', poster_storage_path: storagePath || null });
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
    for (const review of concert.reviews) await supabase.from('concert_reviews').insert({ id: review.id, concert_id: concert.id, user_id: session.user.id, body: review.body, created_at: review.createdAt });
    if (reload) await loadRemoteData(session.user.id);
  }

  async function bulkUpdateConcerts(changed: Concert[]) {
    const byId = new Map(changed.map((concert) => [concert.id, concert]));
    if (!supabase || !session?.user) { setConcerts((items) => items.map((concert) => byId.get(concert.id) || concert)); return; }
    for (const concert of changed) {
      const { error } = await supabase.from('concerts').update({ venue: concert.venue, address: concert.address, latitude: concert.latitude, longitude: concert.longitude, country_code: concert.countryCode, booking_provider: concert.bookingProvider }).eq('id', concert.id);
      if (error) throw error;
      const deleted = await supabase.from('concert_artists').delete().eq('concert_id', concert.id);
      if (deleted.error) throw deleted.error;
      for (const name of concert.artists) {
        let { data: artist } = await supabase.from('artists').select('id').eq('name', name).maybeSingle();
        if (!artist) {
          const created = await supabase.from('artists').insert({ name }).select('id').single();
          if (created.error) throw created.error;
          artist = created.data;
        }
        const linked = await supabase.from('concert_artists').insert({ concert_id: concert.id, artist_id: artist.id });
        if (linked.error) throw linked.error;
      }
    }
    await loadRemoteData(session.user.id);
  }

  async function saveProfile(next: Profile) {
    setProfile(next);
    if (supabase && session?.user) await supabase.from('profiles').upsert({ user_id: session.user.id, origin_configured: next.originConfigured, origin_name: next.originName, origin_address: next.originAddress, origin_latitude: next.originLatitude, origin_longitude: next.originLongitude, origin_country_code: next.originCountryCode });
  }

  async function updateConcert(next: Concert, imageFile?: File) {
    let posterUrl = next.posterUrl;
    let posterStoragePath = next.posterSource === 'official' ? undefined : next.posterStoragePath;
    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('invalid image');
      if (supabase && session?.user) {
        posterStoragePath = `${session.user.id}/${next.id}.${imageFile.type.split('/')[1]}`;
        const { error } = await supabase.storage.from('posters').upload(posterStoragePath, imageFile, { upsert: true, contentType: imageFile.type });
        if (error) throw error;
        const { data } = await supabase.storage.from('posters').createSignedUrl(posterStoragePath, 3600);
        posterUrl = data?.signedUrl || posterUrl;
      } else posterUrl = URL.createObjectURL(imageFile);
    }
    const saved = { ...next, posterUrl: next.posterSource === 'official' ? next.officialPosterUrl || '' : posterUrl, posterSource: imageFile ? 'upload' as const : next.posterSource, posterStoragePath };
    setConcerts((items) => items.map((item) => item.id === saved.id ? saved : item)); setSelected(saved);
    if (supabase && session?.user) {
      const { error } = await supabase.from('concerts').update({ title: saved.title, performance_at: saved.performanceAt, venue: saved.venue, address: saved.address, latitude: saved.latitude, longitude: saved.longitude, country_code: saved.countryCode, booking_provider: saved.bookingProvider, source_url: saved.sourceUrl || null, list_price: saved.listPrice, paid_amount: saved.paidAmount, status: saved.status, rating: saved.rating, poster_url: saved.officialPosterUrl || null, official_poster_url: saved.officialPosterUrl || null, poster_source: saved.posterSource || 'official', poster_storage_path: saved.posterStoragePath || null }).eq('id', saved.id);
      if (error) throw error;
      await supabase.from('concert_artists').delete().eq('concert_id', saved.id);
      for (const name of saved.artists) {
        let { data: artist } = await supabase.from('artists').select('id').eq('name', name).maybeSingle();
        if (!artist) artist = (await supabase.from('artists').insert({ name }).select('id').single()).data;
        if (artist) await supabase.from('concert_artists').insert({ concert_id: saved.id, artist_id: artist.id });
      }
    }
  }

  async function addReview(concert: Concert, body: string) {
    const review = { id: crypto.randomUUID(), body: body.trim(), createdAt: new Date().toISOString() };
    if (!review.body) return;
    const next = { ...concert, reviews: [...concert.reviews, review] };
    setConcerts((items) => items.map((item) => item.id === next.id ? next : item)); setSelected(next);
    if (supabase && session?.user) await supabase.from('concert_reviews').insert({ id: review.id, concert_id: concert.id, user_id: session.user.id, body: review.body, created_at: review.createdAt });
  }

  async function deleteReview(concert: Concert, reviewId: string) {
    const next = { ...concert, reviews: concert.reviews.filter((review) => review.id !== reviewId) };
    setConcerts((items) => items.map((item) => item.id === next.id ? next : item)); setSelected(next);
    if (supabase && session?.user) await supabase.from('concert_reviews').delete().eq('id', reviewId);
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
        {view === 'now' && <NowView concerts={concerts} year={statsYear} onYearChange={setStatsYear} onSelect={setSelected} onBulkEdit={() => setBulkEditOpen(true)} />}
        {view === 'calendar' && <CalendarView concerts={concerts} onSelect={setSelected} />}
        {view === 'map' && <JourneyMap concerts={concerts} profile={profile} onProfileChange={saveProfile} />}
        <button aria-label="공연 추가" onClick={() => setAddOpen(true)} className="fixed bottom-[90px] right-5 z-20 grid size-12 place-items-center rounded-full bg-[#ff6b61] text-black shadow-xl shadow-black/40 sm:right-[max(24px,calc((100vw-1152px)/2))]"><Plus /></button>
        <nav aria-label="주요 메뉴" className="fixed inset-x-0 bottom-4 z-20 mx-auto flex w-[calc(100%-32px)] max-w-[430px] items-center justify-around rounded-[24px] border border-black/10 bg-[#fffdf8e8] p-2 shadow-[0_16px_45px_rgba(46,35,20,.18)] backdrop-blur-xl">
          <NavButton active={view === 'now'} onClick={() => setView('now')} icon={<WalletCards />} label="지금" />
          <NavButton active={view === 'calendar'} onClick={() => setView('calendar')} icon={<CalendarDays />} label="캘린더" />
          <NavButton active={view === 'map'} onClick={() => setView('map')} icon={<MapIcon />} label="원정 지도" />
        </nav>
        {session && <button aria-label="로그아웃" onClick={() => supabase?.auth.signOut()} className="fixed right-4 top-4 rounded-full p-2 text-black/30 hover:text-black"><LogOut className="size-4" /></button>}
      </div>
      <AddConcertDialog open={addOpen} onOpenChange={setAddOpen} onSave={saveConcerts} concerts={concerts} />
      <BulkEditDialog open={bulkEditOpen} onOpenChange={setBulkEditOpen} concerts={concerts} onSave={bulkUpdateConcerts} />
      <ConcertDetail concert={selected} concerts={concerts} onOpenChange={(open) => !open && setSelected(null)} onSave={updateConcert} onAddReview={addReview} onDeleteReview={deleteReview} onDelete={deleteConcert} />
    </main>
  );
}

function NowView({ concerts, year, onYearChange, onSelect, onBulkEdit }: { concerts: Concert[]; year: number; onYearChange: (year: number) => void; onSelect: (concert: Concert) => void; onBulkEdit: () => void }) {
  const now = new Date();
  const availableYears = [...new Set([now.getFullYear(), ...concerts.map((concert) => new Date(concert.performanceAt).getFullYear())])].sort((a, b) => b - a);
  const [filter, setFilter] = useState<'all' | 'attended' | 'scheduled'>('all');
  const [chartMode, setChartMode] = useState<'monthly-count' | 'monthly-spend' | 'artist-count' | 'artist-spend'>('monthly-count');
  const [statScope, setStatScope] = useState<'all' | 'attended' | 'scheduled'>('all');
  const yearConcerts = concerts.filter((concert) => new Date(concert.performanceAt).getFullYear() === year);
  const attended = yearConcerts.filter((concert) => concert.status === 'attended');
  const statConcerts = yearConcerts.filter((concert) => statScope === 'all' || concert.status === statScope);
  const monthAttended = concerts.filter((concert) => { const date = new Date(concert.performanceAt); return concert.status === 'attended' && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const monthRecords = concerts.filter((concert) => { const date = new Date(concert.performanceAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
  const monthPaid = sum(monthRecords.map((item) => item.paidAmount));
  const monthList = sum(monthRecords.map((item) => item.listPrice));
  const artistCounts = statConcerts.flatMap((item) => item.artists).reduce<Record<string, number>>((acc, artist) => ({ ...acc, [artist]: (acc[artist] || 0) + 1 }), {});
  const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];
  const nextConcert = concerts.filter((concert) => concert.status === 'scheduled' && new Date(concert.performanceAt) >= now).sort((a, b) => a.performanceAt.localeCompare(b.performanceAt))[0];
  const overdueCount = concerts.filter((concert) => concert.status === 'scheduled' && new Date(concert.performanceAt) < now).length;
  const annualPaid = sum(yearConcerts.map((item) => item.paidAmount));
  const monthlyData = Array.from({ length: 12 }, (_, month) => {
    const items = statConcerts.filter((concert) => new Date(concert.performanceAt).getMonth() === month);
    return { month: `${month + 1}월`, attended: items.filter((item) => item.status === 'attended').length, scheduled: items.filter((item) => item.status === 'scheduled').length, spend: sum(items.filter((item) => item.status === 'attended').map((item) => item.paidAmount)) };
  });
  const artistSpend = statConcerts.reduce<Record<string, number>>((acc, concert) => { concert.artists.forEach((artist) => { acc[artist] = (acc[artist] || 0) + (concert.paidAmount ?? 0); }); return acc; }, {});
  const artistData = Object.keys({ ...artistCounts, ...artistSpend }).map((artist) => ({ artist, count: artistCounts[artist] || 0, spend: artistSpend[artist] || 0 })).sort((a, b) => chartMode === 'artist-spend' ? b.spend - a.spend : b.count - a.count).slice(0, 7);
  const barData = chartMode === 'artist-spend'
    ? artistData.map((item) => ({ label: item.artist, attended: 0, scheduled: 0, spend: item.spend }))
    : monthlyData.map((item) => ({ label: item.month, attended: item.attended, scheduled: item.scheduled, spend: item.spend }));
  const paidRecords = statConcerts.filter((item) => item.paidAmount != null);
  const averagePaid = paidRecords.length ? Math.round(sum(paidRecords.map((item) => item.paidAmount)) / paidRecords.length) : 0;
  const visibleConcerts = yearConcerts.filter((concert) => filter === 'all' || concert.status === filter).sort((a, b) => b.performanceAt.localeCompare(a.performanceAt));

  return <section className="animate-in fade-in pb-20 duration-300">
    <header><p className="eyebrow">Dukjil log</p><h1 className="screen-title">공연 생활, 한눈에</h1><p className="mt-2 text-sm text-black/45">기록이 쌓일수록 나만의 공연 취향이 선명해져요.</p></header>

    <div className="mt-7">
      <section className="overflow-hidden rounded-[30px] bg-[#f3f0e8] p-5 text-[#181713] sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-black/45">Yearly archive</p><h2 className="mt-1 text-3xl font-semibold tracking-[-0.055em]">{year}년 공연 장부</h2></div><label className="relative"><span className="sr-only">연도 선택</span><select value={year} onChange={(event) => onYearChange(Number(event.target.value))} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold outline-none">{availableYears.map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <div className="mt-7 grid grid-cols-3 gap-2 border-t border-black/10 pt-5"><OverviewNumber label="기록한 공연" value={`${yearConcerts.length}회`} /><OverviewNumber label="관람 완료" value={`${attended.length}회`} /><OverviewNumber label="총 결제액" value={money(annualPaid)} /></div>
      </section>
    </div>

    <section className="mt-4 rounded-[30px] bg-[#f3f0e8] p-4 text-[#181713] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-black/40">My fandom insight</p><h2 className="mt-1 text-lg font-semibold">덕질 통계</h2></div><div className="flex flex-wrap justify-end gap-2"><label><span className="sr-only">공연 상태 범위</span><select value={statScope} onChange={(event) => setStatScope(event.target.value as typeof statScope)} className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold outline-none"><option value="all">전체 기록</option><option value="attended">관람 완료</option><option value="scheduled">예정 공연</option></select></label><label><span className="sr-only">통계 종류</span><select value={chartMode} onChange={(event) => setChartMode(event.target.value as typeof chartMode)} className="rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-semibold outline-none"><option value="monthly-count">월별 공연 개수</option><option value="artist-count">아티스트별 관람 비중</option><option value="monthly-spend">월별 지출액</option><option value="artist-spend">아티스트별 누적 사용액</option></select></label></div></div>
      <div className="mt-4 h-64 w-full" aria-label={`${year}년 덕질 통계 그래프`}><ResponsiveContainer width="100%" height="100%">{chartMode === 'artist-count' ? <PieChart><Pie data={artistData} dataKey="count" nameKey="artist" innerRadius={48} outerRadius={82} paddingAngle={3}>{artistData.map((item, index) => <Cell key={item.artist} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip formatter={(value) => `${String(value)}회`} contentStyle={{ border: 0, borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontSize: 12 }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /></PieChart> : <BarChart data={barData} margin={{ top: 14, right: 0, left: chartMode.includes('spend') ? 4 : -28, bottom: 0 }}><CartesianGrid vertical={false} stroke="rgba(0,0,0,.08)" strokeDasharray="3 4" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'rgba(0,0,0,.42)', fontSize: 10 }} /><YAxis allowDecimals={false} tickFormatter={(value) => chartMode.includes('spend') ? `${Math.round(Number(value) / 10000)}만` : String(value)} axisLine={false} tickLine={false} tick={{ fill: 'rgba(0,0,0,.35)', fontSize: 10 }} /><Tooltip formatter={(value) => chartMode.includes('spend') ? money(Number(value)) : `${String(value)}회`} cursor={{ fill: 'rgba(0,0,0,.035)' }} contentStyle={{ border: 0, borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontSize: 12 }} />{chartMode === 'monthly-count' ? <><Bar dataKey="attended" name="관람 완료" stackId="count" fill="#ff6b61" maxBarSize={24} /><Bar dataKey="scheduled" name="예정" stackId="count" fill="#b8e96c" radius={[5, 5, 0, 0]} maxBarSize={24} /></> : <Bar dataKey="spend" name={chartMode === 'monthly-spend' ? '지출액' : '누적 사용액'} fill="#ff6b61" radius={[6, 6, 0, 0]} maxBarSize={34} />}</BarChart>}</ResponsiveContainer></div>
      {chartMode === 'artist-spend' && <p className="mt-1 text-center text-[10px] text-black/35">여러 아티스트가 함께한 공연은 각 아티스트의 누적액에 결제액 전체가 포함돼요.</p>}
    </section>

    <button onClick={() => nextConcert && onSelect(nextConcert)} disabled={!nextConcert} className="group relative mt-4 min-h-40 w-full overflow-hidden rounded-[30px] border border-[#ff6b61]/15 bg-[#ffe5df] p-5 text-left shadow-sm disabled:cursor-default sm:p-6">
      {nextConcert && <PosterImage src={nextConcert.posterUrl} title={nextConcert.title} className="absolute inset-y-0 right-0 h-full w-2/5 object-cover opacity-45 [mask-image:linear-gradient(to_right,transparent,black)]" />}
      <span className="relative block text-xs text-[#d94d44]">Next stage</span><b className="relative mt-3 block max-w-[72%] text-xl leading-tight">{nextConcert?.title || '예정된 공연이 없어요'}</b><span className="relative mt-3 block max-w-[72%] text-xs leading-5 text-black/50">{nextConcert ? `${dateLabel(nextConcert.performanceAt)} · ${nextConcert.venue}` : '새 공연을 추가해 다음 무대를 기다려 보세요.'}</span>{nextConcert && <ChevronRight className="absolute bottom-5 right-5 size-5 text-black/40 transition group-hover:translate-x-1" />}
    </button>

    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><DashboardMetric icon={<CalendarClock />} label={`${now.getMonth() + 1}월 관람`} value={`${monthAttended.length}회`} detail={overdueCount ? `완료 확인 ${overdueCount}건` : '모두 정리했어요'} /><DashboardMetric icon={<CircleDollarSign />} label={`${now.getMonth() + 1}월 지출`} value={money(monthPaid)} detail={`예정 포함 · 정가 ${money(monthList)}`} /><DashboardMetric icon={<Trophy />} label={`${year} 관심 아티스트`} value={topArtist?.[0] || '아직 없음'} detail={topArtist ? `${topArtist[1]}개 공연 기록` : '첫 공연을 기록해 보세요'} accent /><DashboardMetric icon={<WalletCards />} label="공연당 평균" value={money(averagePaid)} detail={`${year} · ${statScope === 'all' ? '전체 기록' : statScope === 'attended' ? '관람 완료' : '예정 공연'} 기준`} /></div>

    <section className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-black/35">Concert ledger</p><h2 className="mt-1 text-xl font-semibold">공연냠냠</h2></div><div className="flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={onBulkEdit} className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-2 text-xs text-black/55 hover:border-[#ff6b61]/40 hover:text-black"><Replace className="size-3.5" />일괄 변경</button><div className="flex rounded-full border border-black/10 bg-black/[0.035] p-1">{([['all', '전체'], ['attended', '관람 완료'], ['scheduled', '예정']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-xs transition ${filter === value ? 'bg-[#dfff94] text-black' : 'text-black/45 hover:text-black'}`}>{label}</button>)}</div></div></div>
      <div className="mt-4 overflow-hidden rounded-[26px] border border-black/10 bg-white/70 shadow-sm">
        <div className="hidden grid-cols-[76px_1fr_150px_120px] gap-4 border-b border-black/10 px-4 py-3 text-[10px] uppercase tracking-wider text-black/35 sm:grid"><span>날짜</span><span>공연</span><span>장소</span><span className="text-right">결제액</span></div>
        {visibleConcerts.length ? visibleConcerts.map((concert) => <button key={concert.id} onClick={() => onSelect(concert)} className="grid w-full grid-cols-[56px_1fr_auto] items-center gap-3 border-b border-black/[0.07] px-3 py-3 text-left last:border-0 hover:bg-[#fff8f4] sm:grid-cols-[60px_1fr_150px_120px] sm:px-4"><span className="text-center"><b className="block text-lg leading-none">{new Date(concert.performanceAt).getDate()}</b><span className="mt-1 block text-[10px] text-black/40">{new Date(concert.performanceAt).getMonth() + 1}월</span></span><span className="flex min-w-0 items-center gap-3"><PosterImage src={concert.posterUrl} title={concert.title} className="size-11 shrink-0 rounded-xl object-cover" /><span className="min-w-0"><b className="block truncate text-sm">{concert.title}</b><span className="mt-1 flex items-center gap-2 text-[11px] text-black/40"><i className={`status-dot ${concert.status}`} />{concert.artists.join(' · ') || '아티스트 미입력'} · {concert.status === 'attended' ? '관람 완료' : '예정'}</span></span></span><span className="hidden truncate text-xs text-black/45 sm:block">{concert.venue}</span><span className="text-right text-xs font-medium text-black/65">{concert.paidAmount == null ? '미입력' : money(concert.paidAmount)}</span></button>) : <div className="p-10 text-center text-sm text-black/35">이 조건에 맞는 공연이 아직 없어요.</div>}
      </div>
    </section>
  </section>;
}

function ConcertDetail({ concert, concerts, onOpenChange, onSave, onAddReview, onDeleteReview, onDelete }: { concert: Concert | null; concerts: Concert[]; onOpenChange: (open: boolean) => void; onSave: (concert: Concert, imageFile?: File) => Promise<void>; onAddReview: (concert: Concert, body: string) => Promise<void>; onDeleteReview: (concert: Concert, reviewId: string) => Promise<void>; onDelete: (concert: Concert) => Promise<void> }) {
  const [draft, setDraft] = useState<Concert | null>(concert);
  const [comment, setComment] = useState('');
  const [imageFile, setImageFile] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [urlImporting, setUrlImporting] = useState(false);
  const [urlMessage, setUrlMessage] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => { setDraft(concert); setImageFile(undefined); setUrlMessage(''); setDeleteConfirm(false); }, [concert]);
  if (!concert || !draft) return null;
  const artistSuggestions = [...new Set(concerts.flatMap((item) => item.artists))].slice(0, 10);
  const venueSuggestions = [...new globalThis.Map(concerts.filter((item) => item.venue).map((item) => [item.venue, item])).values()].slice(0, 8);
  const providerSuggestions = [...new Set(concerts.map((item) => item.bookingProvider).filter(Boolean))].slice(0, 8);
  const update = <K extends keyof Concert>(key: K, value: Concert[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  async function saveDetails() { setSaving(true); try { await onSave(draft!, imageFile); setImageFile(undefined); } finally { setSaving(false); } }
  async function postComment() { if (!comment.trim()) return; await onAddReview(concert!, comment); setComment(''); }
  async function importBookingUrl() {
    if (!draft?.sourceUrl.trim()) { setUrlMessage('예매 페이지 URL을 입력해 주세요.'); return; }
    setUrlImporting(true); setUrlMessage('');
    try {
      const response = await fetch('/api/import-concert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: draft.sourceUrl.trim() }) });
      const data = await response.json() as ImportDraft & { error?: string };
      if (!response.ok) throw new Error(data.error || '예매 페이지 정보를 불러오지 못했어요.');
      setDraft((current) => current ? {
        ...current,
        title: data.title || current.title,
        artists: data.artists?.length ? data.artists : current.artists,
        performanceAt: data.dateCandidates?.[0] || current.performanceAt,
        venue: data.venue || current.venue,
        address: data.address || current.address,
        latitude: data.venue || data.address ? null : current.latitude,
        longitude: data.venue || data.address ? null : current.longitude,
        bookingProvider: data.bookingProvider || current.bookingProvider,
        listPrice: data.priceCandidates?.[0] ?? current.listPrice,
        officialPosterUrl: data.posterUrl || current.officialPosterUrl,
        posterUrl: current.posterSource === 'official' && data.posterUrl ? data.posterUrl : current.posterUrl,
      } : current);
      setUrlMessage(`정보를 덮어썼어요. ${data.dateCandidates?.length > 1 ? `날짜 후보 ${data.dateCandidates.length}개 중 첫 날짜를 적용했어요. ` : ''}아래 내용을 확인한 뒤 ‘상세 정보 저장’을 눌러 주세요.`);
    } catch (error) { setUrlMessage(error instanceof Error ? error.message : '예매 페이지 정보를 불러오지 못했어요.'); }
    finally { setUrlImporting(false); }
  }
  return <Dialog open onOpenChange={onOpenChange}><DialogContent showCloseButton={false} className="max-h-[92vh] w-[calc(100vw-24px)] max-w-xl overflow-x-hidden overflow-y-auto border-black/10 bg-[#fbfaf6] p-0 text-[#1c1b18]">
    <div className="pointer-events-none sticky top-0 z-40 flex h-0 justify-end pr-3 pt-3"><button type="button" aria-label="공연 상세 닫기" onClick={() => onOpenChange(false)} className="pointer-events-auto grid size-9 place-items-center rounded-full border border-black/10 bg-[#fffdf8]/95 text-black/55 shadow-md backdrop-blur hover:text-black"><X className="size-4" /></button></div>
    <div className="relative h-44"><PosterImage src={draft.posterUrl} title={draft.title} className="h-full w-full object-cover" /><span className="absolute inset-0 bg-gradient-to-t from-[#fbfaf6] to-transparent" /><span className="absolute bottom-3 right-4 rounded-full bg-black/65 px-3 py-1.5 text-[11px] text-white backdrop-blur">{draft.posterSource === 'upload' ? '직접 업로드 사진' : '공식 이미지'}</span></div>
    <div className="space-y-5 px-5 pb-6">
      <DialogHeader><DialogTitle className="text-xl">공연 상세 편집</DialogTitle><DialogDescription>장부에서 바로 공연 정보와 사진을 수정할 수 있어요.</DialogDescription></DialogHeader>
      <div><p className="mb-2 text-xs font-medium text-black/50">대표 사진 선택</p><div className="grid grid-cols-2 gap-2"><Button type="button" variant={draft.posterSource !== 'upload' ? 'default' : 'outline'} disabled={!draft.officialPosterUrl} onClick={() => { setImageFile(undefined); setDraft((current) => current ? { ...current, posterSource: 'official', posterUrl: current.officialPosterUrl || '', posterStoragePath: undefined } : current); }}>공식 이미지</Button><label className={`flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-medium transition ${draft.posterSource === 'upload' ? 'border-transparent bg-[#1f1d19] text-white' : 'border-black/15 bg-white hover:bg-black/[0.04]'}`}><ImagePlus className="size-4" />{imageFile?.name ? '사진 선택됨' : '직접 업로드'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setImageFile(file); setDraft((current) => current ? { ...current, posterSource: 'upload', posterUrl: URL.createObjectURL(file) } : current); }} /></label></div>{!draft.officialPosterUrl && <p className="mt-2 text-[11px] text-black/35">불러온 공식 이미지가 없어 공식 이미지 선택을 사용할 수 없어요.</p>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField label="공연명"><Input value={draft.title} onChange={(event) => update('title', event.target.value)} /></DetailField>
        <DetailField label="아티스트"><div className="space-y-2"><Input value={draft.artists.join(', ')} onChange={(event) => update('artists', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder="쉼표로 구분" />{artistSuggestions.length > 0 && <QuickChoices label="기존 기록에서 선택">{artistSuggestions.map((artist) => { const selected = draft.artists.includes(artist); return <button key={artist} type="button" data-selected={selected} className="suggestion-chip" onClick={() => update('artists', selected ? draft.artists.filter((value) => value !== artist) : [...draft.artists, artist])}>{artist}</button>; })}</QuickChoices>}</div></DetailField>
        <DetailField label="공연 일시"><Input type="datetime-local" value={toDateTimeInput(draft.performanceAt)} onChange={(event) => update('performanceAt', new Date(event.target.value).toISOString())} /></DetailField>
        <DetailField label="예매처"><div className="space-y-2"><Input value={draft.bookingProvider} onChange={(event) => update('bookingProvider', event.target.value)} />{providerSuggestions.length > 0 && <QuickChoices label="기존 기록에서 선택">{providerSuggestions.map((provider) => <button key={provider} type="button" data-selected={draft.bookingProvider === provider} className="suggestion-chip" onClick={() => update('bookingProvider', provider)}>{provider}</button>)}</QuickChoices>}</div></DetailField>
        <DetailField label="공연장"><div className="space-y-2"><Input value={draft.venue} onChange={(event) => update('venue', event.target.value)} />{venueSuggestions.length > 0 && <QuickChoices label="기존 기록에서 선택">{venueSuggestions.map((item) => <button key={item.venue} type="button" data-selected={draft.venue === item.venue} className="suggestion-chip" onClick={() => setDraft((current) => current ? { ...current, venue: item.venue, address: item.address, latitude: item.latitude, longitude: item.longitude, countryCode: item.countryCode } : current)}>{item.venue}</button>)}</QuickChoices>}</div></DetailField>
        <DetailField label="주소"><Input value={draft.address} onChange={(event) => update('address', event.target.value)} /></DetailField>
        <DetailField label="정가"><Input inputMode="numeric" value={draft.listPrice ?? ''} onChange={(event) => update('listPrice', event.target.value ? Number(event.target.value.replace(/\D/g, '')) : null)} /></DetailField>
        <DetailField label="실제 결제액"><Input inputMode="numeric" value={draft.paidAmount ?? ''} onChange={(event) => update('paidAmount', event.target.value ? Number(event.target.value.replace(/\D/g, '')) : null)} /></DetailField>
        <DetailField label="예매 페이지 URL"><div className="space-y-2"><Input type="url" value={draft.sourceUrl} onChange={(event) => { update('sourceUrl', event.target.value); setUrlMessage(''); }} placeholder="https://ticket..." /><Button type="button" variant="outline" onClick={importBookingUrl} disabled={urlImporting || !draft.sourceUrl.trim()} className="w-full"><Link2 />{urlImporting ? '불러오는 중…' : 'URL 정보로 덮어쓰기'}{urlImporting && <LoaderCircle className="animate-spin" />}</Button></div></DetailField>
      </div>
      {urlMessage && <output className="block rounded-xl bg-[#f0eee7] p-3 text-xs leading-5 text-[#5d7b27]">{urlMessage}</output>}
      <div><p className="mb-2 text-xs font-medium text-black/50">공연 별점</p><RatingPicker value={draft.rating} onChange={(value) => update('rating', value)} /><p className="mt-2 text-[11px] text-black/35">공연 전체에 하나만 저장되며 언제든 수정할 수 있어요.</p></div>
      <div className="grid grid-cols-2 gap-2"><Button variant={draft.status === 'scheduled' ? 'default' : 'outline'} onClick={() => update('status', 'scheduled')}>예정</Button><Button variant={draft.status === 'attended' ? 'default' : 'outline'} onClick={() => update('status', 'attended')}>관람 완료</Button></div>
      <Button className="h-11 w-full bg-[#1f1d19] text-white hover:bg-black" onClick={saveDetails} disabled={saving}>{saving ? '저장 중…' : '상세 정보 저장'}</Button>

      <section className="border-t border-black/10 pt-5"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-[#d94d44]" />공연 후기</h3><span className="text-[11px] text-black/35">{concert.reviews.length}개</span></div>
        <div className="mt-3 min-w-0 space-y-2">{concert.reviews.length ? concert.reviews.map((review) => <article key={review.id} className="group min-w-0 rounded-2xl bg-[#f1eee6] p-3"><div className="flex items-start justify-between gap-3"><p className="break-words whitespace-pre-wrap text-sm leading-6 text-black/75 [overflow-wrap:anywhere]">{review.body}</p><button aria-label="후기 삭제" onClick={() => onDeleteReview(concert, review.id)} className="shrink-0 rounded-full p-1 text-black/20 hover:bg-white hover:text-red-500"><Trash2 className="size-3.5" /></button></div><time className="mt-2 block text-[10px] text-black/30">{new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(review.createdAt))}</time></article>) : <p className="rounded-2xl border border-dashed border-black/10 p-5 text-center text-xs text-black/35">첫 댓글을 남겨보세요.</p>}</div>
        <div className="mt-3 flex items-end gap-2"><Textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} className="min-h-20 resize-none" placeholder="별점과 별개로 댓글을 여러 개 남길 수 있어요." /><Button size="icon-lg" aria-label="후기 등록" className="shrink-0 bg-[#ff6b61] text-black hover:bg-[#ff827a]" onClick={postComment} disabled={!comment.trim()}><Send /></Button></div>
      </section>
      {deleteConfirm ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-semibold text-red-700">이 공연 기록을 정말 삭제할까요?</p><p className="mt-1 text-xs leading-5 text-red-600/70">공연 정보와 후기까지 함께 삭제되며 되돌릴 수 없어요.</p><div className="mt-3 grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={() => setDeleteConfirm(false)}>취소</Button><Button type="button" onClick={() => onDelete(concert)} className="bg-red-600 text-white hover:bg-red-700"><Trash2 />삭제하기</Button></div></div> : <button type="button" onClick={() => setDeleteConfirm(true)} className="w-full py-1 text-xs text-red-500/65 hover:text-red-600">이 기록 삭제</button>}
    </div>
  </DialogContent></Dialog>;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) { return <div role="group" aria-label={label} className="block min-w-0 text-xs font-medium text-black/50"><span className="mb-1.5 block">{label}</span>{children}</div>; }
function QuickChoices({ label, children }: { label: string; children: React.ReactNode }) { return <div className="min-w-0"><p className="mb-2 text-[11px] text-black/40">{label}</p><div className="flex min-w-0 flex-wrap gap-1.5">{children}</div></div>; }

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex min-w-20 flex-col items-center gap-1 rounded-2xl px-4 py-2 transition ${active ? 'bg-[#1f1d19] text-[#dfff94]' : 'text-black/40'}`}><span className="[&>svg]:size-5">{icon}</span><span className="text-[11px]">{label}</span></button>; }
function OverviewNumber({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><p className="text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-lg font-semibold tracking-[-0.035em] sm:text-2xl">{value}</p></div>; }
function DashboardMetric({ icon, label, value, detail, accent = false }: { icon: React.ReactNode; label: string; value: string; detail: string; accent?: boolean }) { return <div className={`min-w-0 rounded-[24px] border p-4 shadow-sm ${accent ? 'border-[#b9df75]/45 bg-[#eff8dc]' : 'border-black/10 bg-white/75'}`}><span className={`grid size-8 place-items-center rounded-xl [&>svg]:size-4 ${accent ? 'bg-[#dfff94] text-black' : 'bg-[#ffe1dc] text-[#d94d44]'}`}>{icon}</span><p className="mt-4 text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-lg font-semibold tracking-[-0.035em]">{value}</p><p className="mt-1 truncate text-[10px] text-black/35">{detail}</p></div>; }
function sum(values: Array<number | null>) { return values.reduce<number>((total, value) => total + (value ?? 0), 0); }
function money(value: number) { return `₩${value.toLocaleString('ko-KR')}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function toDateTimeInput(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
function rowToConcert(row: any, posterUrl: string): Concert { return { id: row.id, title: row.title, artists: (row.concert_artists || []).map((item: any) => item.artists?.name).filter(Boolean), performanceAt: row.performance_at, venue: row.venue, address: row.address || '', latitude: row.latitude, longitude: row.longitude, countryCode: row.country_code || 'KR', bookingProvider: row.booking_provider || '', sourceUrl: bookingSourceUrl(row.source_url), listPrice: row.list_price, paidAmount: row.paid_amount, status: row.status, rating: row.rating == null ? null : Number(row.rating), reviews: (row.concert_reviews || []).map((review: any) => ({ id: review.id, body: review.body, createdAt: review.created_at })).sort((a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt)), posterUrl, officialPosterUrl: row.official_poster_url || row.poster_url || '', posterSource: row.poster_source || (row.poster_storage_path ? 'upload' : 'official'), posterStoragePath: row.poster_storage_path || undefined }; }
function bookingSourceUrl(value: unknown) { if (typeof value !== 'string') return ''; try { const host = new URL(value).hostname.toLowerCase(); return host.endsWith('notion.so') || host.endsWith('notion.site') || host === 'app.notion.com' ? '' : value; } catch { return ''; } }
