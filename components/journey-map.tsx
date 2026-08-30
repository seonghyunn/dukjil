'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GreatCircleLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import MapGL from 'react-map-gl/maplibre';
import { LoaderCircle, MapPin, Pause, Play, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Concert, GeocodeCandidate, Profile } from '@/lib/types';
import { formatDistance, greatCircleDistanceKm, interpolateGreatCircle } from '@/lib/distance';
import { PosterImage } from './poster-image';
import 'maplibre-gl/dist/maplibre-gl.css';

type Period = 'month' | 'year' | 'all';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function JourneyMap({ concerts, profile, onProfileChange }: { concerts: Concert[]; profile: Profile; onProfileChange: (profile: Profile) => Promise<void> }) {
  const [period, setPeriod] = useState<Period>('all');
  const [playing, setPlaying] = useState(false);
  const [tripIndex, setTripIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [editingOrigin, setEditingOrigin] = useState(!profile.originConfigured);
  const [query, setQuery] = useState(profile.originAddress);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const animation = useRef<number | null>(null);
  const last = useRef<number>(0);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const referenceDate = useMemo(() => {
    const attended = concerts.filter((item) => item.status === 'attended').sort((a, b) => b.performanceAt.localeCompare(a.performanceAt));
    return attended[0] ? new Date(attended[0].performanceAt) : new Date();
  }, [concerts]);
  const trips = useMemo(() => concerts.filter((concert) => {
    if (concert.status !== 'attended' || concert.longitude === null || concert.latitude === null) return false;
    const date = new Date(concert.performanceAt);
    if (period === 'month') return date.getFullYear() === referenceDate.getFullYear() && date.getMonth() === referenceDate.getMonth();
    if (period === 'year') return date.getFullYear() === referenceDate.getFullYear();
    return true;
  }).sort((a, b) => a.performanceAt.localeCompare(b.performanceAt)), [concerts, period, referenceDate]);

  const origin: [number, number] = [profile.originLongitude, profile.originLatitude];
  const totalDistance = trips.reduce((sum, trip) => sum + greatCircleDistanceKm(origin, [trip.longitude!, trip.latitude!]) * 2, 0);
  const cities = new Set(trips.map((trip) => `${trip.countryCode}:${trip.venue}`)).size;
  const countries = new Set(trips.map((trip) => trip.countryCode)).size;
  const current = trips[Math.min(tripIndex, Math.max(0, trips.length - 1))];

  useEffect(() => {
    if (!playing || reducedMotion || trips.length === 0) return;
    const step = (now: number) => {
      if (!last.current) last.current = now;
      const delta = Math.min(now - last.current, 100);
      last.current = now;
      setProgress((value) => {
        const next = value + (delta * speed) / 2600;
        if (next >= 2) {
          if (tripIndex >= trips.length - 1) { setPlaying(false); return 2; }
          setTripIndex((index) => index + 1); return 0;
        }
        return next;
      });
      animation.current = requestAnimationFrame(step);
    };
    animation.current = requestAnimationFrame(step);
    return () => { if (animation.current) cancelAnimationFrame(animation.current); animation.current = null; last.current = 0; };
  }, [playing, tripIndex, trips.length, reducedMotion, speed]);

  useEffect(() => { setPlaying(false); setTripIndex(0); setProgress(0); }, [period]);

  const fraction = progress <= 1 ? progress : 2 - progress;
  const destination: [number, number] | null = current ? [current.longitude!, current.latitude!] : null;
  const marker = destination ? interpolateGreatCircle(origin, destination, Math.max(0, Math.min(1, fraction))) : origin;
  const visibleTrips = reducedMotion || (!playing && progress >= 2) ? trips : trips.slice(0, Math.min(trips.length, tripIndex + 1));
  const layers = [
    new GreatCircleLayer({ id: 'journey-arcs', data: visibleTrips, getSourcePosition: () => origin, getTargetPosition: (d: Concert) => [d.longitude!, d.latitude!], getSourceColor: [223, 255, 148, 175], getTargetColor: [255, 107, 97, 220], getWidth: 3, greatCircle: true, pickable: true }),
    new ScatterplotLayer({ id: 'venues', data: trips, getPosition: (d: Concert) => [d.longitude!, d.latitude!], getRadius: 13000, radiusMinPixels: 4, radiusMaxPixels: 9, getFillColor: [255, 107, 97, 235], stroked: true, getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 1, pickable: true }),
    new ScatterplotLayer({ id: 'origin', data: [{ position: origin }], getPosition: (d: { position: [number, number] }) => d.position, getRadius: 15000, radiusMinPixels: 5, radiusMaxPixels: 10, getFillColor: [223, 255, 148, 255], stroked: true, getLineColor: [20, 20, 18, 255], lineWidthMinPixels: 2 }),
    ...(playing && !reducedMotion ? [new ScatterplotLayer({ id: 'traveler', data: [{ position: marker }], getPosition: (d: { position: [number, number] }) => d.position, getRadius: 22000, radiusMinPixels: 7, radiusMaxPixels: 12, getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: [255, 107, 97, 255], lineWidthMinPixels: 3 })] : []),
  ];

  function restart() { setTripIndex(0); setProgress(0); setPlaying(!reducedMotion); }

  async function searchOrigin() {
    if (!query.trim()) return;
    setSearching(true); setSearchMessage(''); setCandidates([]);
    try {
      const response = await fetch('/api/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: query.trim() }) });
      const data = await response.json() as { candidates?: GeocodeCandidate[]; error?: string };
      if (!response.ok) throw new Error(data.error || '장소를 찾지 못했어요.');
      const results = data.candidates || [];
      setCandidates(results);
      if (!results.length) setSearchMessage('검색 결과가 없어요. 도시명이나 도로명 주소로 다시 검색해 주세요.');
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : '장소 검색 중 문제가 생겼어요.');
    } finally { setSearching(false); }
  }

  async function chooseOrigin(candidate: GeocodeCandidate) {
    await onProfileChange({ originConfigured: true, originName: candidate.name, originAddress: candidate.address, originLatitude: candidate.latitude, originLongitude: candidate.longitude, originCountryCode: candidate.countryCode });
    setEditingOrigin(false); setCandidates([]);
  }

  return (
    <section className="animate-in fade-in duration-300 pb-28">
      <header className="flex items-start justify-between"><div><p className="eyebrow">Tour map</p><h1 className="screen-title">내가 달려간 거리</h1></div><Button variant="outline" size="icon-lg" aria-label="출발지 설정" onClick={() => setEditingOrigin((value) => !value)}><Settings2 /></Button></header>
      {!profile.originConfigured ? <div className="mt-6 rounded-[30px] border border-black/10 bg-[#f3f0e8] p-5 shadow-sm sm:p-7"><p className="text-xs font-medium text-[#d94d44]">첫 원정을 시작하기 전에</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">출발지를 직접 정해 주세요</h2><p className="mt-2 text-sm leading-6 text-black/45">도시나 가까운 역처럼 대략적인 출발점을 검색하면, 모든 공연의 예상 왕복거리를 이곳부터 계산해요.</p><div className="mt-5 flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchOrigin(); }} placeholder="예: 대전역, 부산 해운대구" className="h-11" /><Button onClick={searchOrigin} disabled={!query.trim() || searching} className="h-11 bg-[#ff6b61] text-black hover:bg-[#ff827a]">{searching && <LoaderCircle className="animate-spin" />}{searching ? '검색 중' : '찾기'}</Button></div><p className="mt-2 text-[10px] leading-4 text-black/35">개인정보 보호를 위해 상세 집주소보다 가까운 역이나 도시 검색을 권장해요. 검색 데이터 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap 기여자</a></p>{searchMessage && <p role="status" className="mt-3 rounded-xl bg-white/70 p-3 text-xs text-[#a5413a]">{searchMessage}</p>}{candidates.length > 0 && <div className="mt-3 space-y-1 rounded-2xl bg-white/70 p-2">{candidates.map((candidate) => <button key={candidate.id} onClick={() => chooseOrigin(candidate)} className="flex w-full gap-2 rounded-xl p-2 text-left text-xs hover:bg-black/5"><MapPin className="size-4 shrink-0 text-[#d94d44]" /><span><b className="block">{candidate.name}</b><span className="text-black/45">{candidate.address}</span></span></button>)}</div>}</div> : <>
      <div className="mt-6 grid grid-cols-3 gap-2">
        <Stat label="원정" value={`${trips.length}회`} />
        <Stat label="예상 왕복" value={formatDistance(totalDistance)} />
        <Stat label="도시 · 국가" value={`${cities} · ${countries}`} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-black/[0.045] p-1.5">{([['month', '이번 달'], ['year', '올해'], ['all', '전체']] as const).map(([value, label]) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-xl py-2 text-xs ${period === value ? 'bg-white text-black shadow-sm' : 'text-black/45'}`}>{label}</button>)}</div>
      {editingOrigin && <div className="mt-4 rounded-3xl border border-black/10 bg-white/80 p-4 shadow-sm"><p className="text-xs text-black/50">모든 공연의 왕복 기준점</p><div className="mt-2 flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchOrigin(); }} placeholder="도시 또는 주소" className="h-10" /><Button onClick={searchOrigin} disabled={!query.trim() || searching}>{searching ? '검색 중' : '찾기'}</Button></div><p className="mt-2 text-[10px] text-black/35">검색 데이터 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap 기여자</a></p>{searchMessage && <p role="status" className="mt-3 text-xs text-[#a5413a]">{searchMessage}</p>}{candidates.length > 0 && <div className="mt-3 space-y-1">{candidates.map((candidate) => <button key={candidate.id} onClick={() => chooseOrigin(candidate)} className="flex w-full gap-2 rounded-xl p-2 text-left text-xs hover:bg-black/5"><MapPin className="size-4 shrink-0 text-[#d94d44]" /><span><b className="block">{candidate.name}</b><span className="text-black/45">{candidate.address}</span></span></button>)}</div>}</div>}
      <div className="relative mt-4 h-[430px] overflow-hidden rounded-[30px] border border-black/10 bg-[#e6ece7] shadow-[0_18px_50px_rgba(75,66,47,.14)]">
        <DeckGL style={{ position: 'absolute', inset: '0px' }} initialViewState={{ longitude: 128.5, latitude: 34.8, zoom: trips.some((trip) => trip.countryCode !== 'KR') ? 3.1 : 5.5, pitch: 20, bearing: 0 }} controller layers={layers} getTooltip={({ object }) => object?.title ? { text: `${object.title}\n${object.venue}` } : null}>
          <MapGL style={{ width: '100%', height: '100%' }} mapStyle={MAP_STYLE} attributionControl={{ compact: true }} reuseMaps />
        </DeckGL>
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-3 py-2 text-[11px] text-white/70 backdrop-blur">출발 · {profile.originName}</div>
        {playing && current && progress > 0.86 && progress < 1.14 && <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-black/80 p-3 text-white backdrop-blur"><PosterImage src={current.posterUrl} title={current.title} className="size-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{current.title}</p><p className="text-xs text-white/45">{current.venue} 도착</p></div></div>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" size="icon-lg" aria-label="처음부터" onClick={restart}><RotateCcw /></Button>
        <Button className="h-11 min-w-32 rounded-full bg-[#ff6b61] text-black hover:bg-[#ff827a]" disabled={!trips.length || reducedMotion} onClick={() => setPlaying((value) => !value)}>{playing ? <><Pause />일시정지</> : <><Play />재생하기</>}</Button>
        <label className="flex h-11 items-center gap-2 rounded-full border border-black/10 bg-white px-4 text-xs text-black/50"><span>배속</span><select aria-label="지도 왕복 재생 속도" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="bg-transparent font-semibold text-black outline-none"><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
      </div>
      {reducedMotion && <p className="mt-3 text-center text-xs text-black/45">동작 줄이기 설정에 따라 전체 원정 경로를 표시하고 있어요.</p>}
      </>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-black/10 bg-white/75 p-3 shadow-sm"><p className="text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
