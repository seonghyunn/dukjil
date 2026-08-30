'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { GreatCircleLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import MapGL from 'react-map-gl/maplibre';
import { MapPin, Pause, Play, RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Concert, GeocodeCandidate, Profile } from '@/lib/types';
import { formatDistance, greatCircleDistanceKm, interpolateGreatCircle } from '@/lib/distance';
import { PosterImage } from './poster-image';
import 'maplibre-gl/dist/maplibre-gl.css';

type Period = 'month' | 'year' | 'all';

export function JourneyMap({ concerts, profile, onProfileChange }: { concerts: Concert[]; profile: Profile; onProfileChange: (profile: Profile) => Promise<void> }) {
  const [period, setPeriod] = useState<Period>('all');
  const [playing, setPlaying] = useState(false);
  const [tripIndex, setTripIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [query, setQuery] = useState(profile.originAddress);
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
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
        const next = value + delta / 2600;
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
  }, [playing, tripIndex, trips.length, reducedMotion]);

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
    const response = await fetch('/api/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    const data = await response.json() as { candidates?: GeocodeCandidate[] };
    setCandidates(data.candidates || []);
  }

  async function chooseOrigin(candidate: GeocodeCandidate) {
    await onProfileChange({ originName: candidate.name, originAddress: candidate.address, originLatitude: candidate.latitude, originLongitude: candidate.longitude, originCountryCode: candidate.countryCode });
    setEditingOrigin(false); setCandidates([]);
  }

  return (
    <section className="animate-in fade-in duration-300 pb-28">
      <header className="flex items-start justify-between"><div><p className="eyebrow">Tour map</p><h1 className="screen-title">내가 달려간 거리</h1></div><Button variant="outline" size="icon-lg" aria-label="출발지 설정" onClick={() => setEditingOrigin((value) => !value)}><Settings2 /></Button></header>
      <div className="mt-6 grid grid-cols-3 gap-2">
        <Stat label="원정" value={`${trips.length}회`} />
        <Stat label="예상 왕복" value={formatDistance(totalDistance)} />
        <Stat label="도시 · 국가" value={`${cities} · ${countries}`} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-black/[0.045] p-1.5">{([['month', '이번 달'], ['year', '올해'], ['all', '전체']] as const).map(([value, label]) => <button key={value} onClick={() => setPeriod(value)} className={`rounded-xl py-2 text-xs ${period === value ? 'bg-white text-black shadow-sm' : 'text-black/45'}`}>{label}</button>)}</div>
      {editingOrigin && <div className="mt-4 rounded-3xl border border-black/10 bg-white/80 p-4 shadow-sm"><p className="text-xs text-black/50">모든 공연의 왕복 기준점</p><div className="mt-2 flex gap-2"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="도시 또는 주소" className="h-10" /><Button onClick={searchOrigin}>찾기</Button></div>{candidates.length > 0 && <div className="mt-3 space-y-1">{candidates.map((candidate) => <button key={candidate.id} onClick={() => chooseOrigin(candidate)} className="flex w-full gap-2 rounded-xl p-2 text-left text-xs hover:bg-black/5"><MapPin className="size-4 shrink-0 text-[#d94d44]" /><span><b className="block">{candidate.name}</b><span className="text-black/45">{candidate.address}</span></span></button>)}</div>}</div>}
      <div className="relative mt-4 h-[430px] overflow-hidden rounded-[30px] border border-white/10 bg-[#151713]">
        <DeckGL initialViewState={{ longitude: 128.5, latitude: 34.8, zoom: trips.some((trip) => trip.countryCode !== 'KR') ? 3.1 : 5.5, pitch: 20, bearing: 0 }} controller layers={layers} getTooltip={({ object }) => object?.title ? { text: `${object.title}\n${object.venue}` } : null}>
          <MapGL mapStyle="https://tiles.openfreemap.org/styles/dark" attributionControl={{ compact: true }} />
        </DeckGL>
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-3 py-2 text-[11px] text-white/70 backdrop-blur">출발 · {profile.originName}</div>
        {playing && current && progress > 0.86 && progress < 1.14 && <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-2xl bg-black/80 p-3 text-white backdrop-blur"><PosterImage src={current.posterUrl} title={current.title} className="size-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{current.title}</p><p className="text-xs text-white/45">{current.venue} 도착</p></div></div>}
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Button variant="outline" size="icon-lg" aria-label="처음부터" onClick={restart}><RotateCcw /></Button>
        <Button className="h-11 min-w-32 rounded-full bg-[#ff6b61] text-black hover:bg-[#ff827a]" disabled={!trips.length || reducedMotion} onClick={() => setPlaying((value) => !value)}>{playing ? <><Pause />일시정지</> : <><Play />재생하기</>}</Button>
      </div>
      {reducedMotion && <p className="mt-3 text-center text-xs text-black/45">동작 줄이기 설정에 따라 전체 원정 경로를 표시하고 있어요.</p>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-black/10 bg-white/75 p-3 shadow-sm"><p className="text-[10px] text-black/40">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
