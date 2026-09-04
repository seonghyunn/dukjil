'use client';

import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  Disc3,
  ExternalLink,
  ListMusic,
  LoaderCircle,
  Mic2,
  Music2,
  Save,
  Search,
} from 'lucide-react';
import { PosterImage } from './poster-image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Concert, SetlistCandidate } from '@/lib/types';

type ArtistMatch = { mbid: string; name: string; englishName: string; score: number };
type CachedArtistMatch = { mbid: string; name: string };

type Props = {
  concerts: Concert[];
  onSave: (concert: Concert, songs: string[]) => Promise<void>;
  onLink: (concert: Concert, candidate: SetlistCandidate) => Promise<void>;
};

export function SetlistView({ concerts, onSave, onLink }: Props) {
  const [remoteSongs, setRemoteSongs] = useState<Record<string, string[]>>({});
  const hydratedConcerts = concerts.map((concert) => remoteSongs[concert.id] ? { ...concert, setlist: remoteSongs[concert.id] } : concert);
  const attended = hydratedConcerts
    .filter((concert) => concert.status === 'attended')
    .sort((a, b) => b.performanceAt.localeCompare(a.performanceAt));
  const artists = [
    ...new Set(attended.flatMap((concert) => concert.artists)),
  ].sort((a, b) => a.localeCompare(b, 'ko'));
  const [artist, setArtist] = useState('all');
  const [editing, setEditing] = useState<Concert | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<SetlistCandidate[]>([]);
  const [searchMessage, setSearchMessage] = useState('');

  useEffect(() => {
    const linked = concerts.filter((concert) => concert.setlistSourceId && !remoteSongs[concert.id]);
    if (!linked.length) return;
    let active = true;
    void Promise.all(linked.map(async (concert) => {
      const response = await fetch('/api/import-setlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setlistId: concert.setlistSourceId }) });
      if (!response.ok) return null;
      const payload = await response.json() as { candidates?: SetlistCandidate[] };
      return payload.candidates?.[0] ? [concert.id, payload.candidates[0].songs] as const : null;
    })).then((results) => {
      if (!active) return;
      setRemoteSongs((current) => Object.fromEntries([...Object.entries(current), ...results.filter((result): result is readonly [string, string[]] => Boolean(result))]));
    });
    return () => { active = false; };
  }, [concerts, remoteSongs]);

  const scoped =
    artist === 'all'
      ? attended
      : attended.filter((concert) => concert.artists.includes(artist));
  const songStats = (() => {
    const stats = new Map<
      string,
      { title: string; count: number; concerts: Set<string> }
    >();
    for (const concert of scoped) {
      for (const rawTitle of concert.setlist || []) {
        const title = rawTitle.trim();
        if (!title) continue;
        const key = title.toLocaleLowerCase('ko');
        const current = stats.get(key) || {
          title,
          count: 0,
          concerts: new Set<string>(),
        };
        current.count += 1;
        current.concerts.add(concert.id);
        stats.set(key, current);
      }
    }
    return [...stats.values()].sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ko'),
    );
  })();
  const totalSongs = songStats.reduce((total, song) => total + song.count, 0);

  function openEditor(concert: Concert) {
    setEditing(concert);
    setCandidates([]);
    setSearchMessage('');
    setText(
      (concert.setlist || [])
        .map((song, index) => `${index + 1}. ${song}`)
        .join('\n'),
    );
  }

  async function searchOfficialSetlist() {
    if (!editing) return;
    const original = editing.artists[0] || titleArtistHint(editing.title);
    if (!original) { setSearchMessage('공연 정보에서 아티스트를 확인하지 못했어요.'); return; }
    setSearching(true);
    setSearchMessage('');
    try {
      const resolved = await resolveArtistForSearch(original, editing.title);
      const response = await fetch('/api/import-setlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artist: original, artistMbid: resolved?.mbid, title: editing.title, performanceAt: editing.performanceAt, venue: editing.venue }) });
      const rawPayload = await response.text();
      const payload = (rawPayload ? JSON.parse(rawPayload) : {}) as { candidates?: SetlistCandidate[]; artistMatches?: ArtistMatch[]; error?: string };
      if (!response.ok) throw new Error(payload.error || '셋리스트를 검색하지 못했어요.');
      const next = payload.candidates || [];
      const matches = payload.artistMatches || [];
      setCandidates(next);
      if (resolved) saveArtistAlias(original, resolved);
      else if (matches[0]?.mbid) saveArtistAlias(original, { mbid: matches[0].mbid, name: matches[0].englishName });
      setSearchMessage(next.length ? `${next.length}개의 공연 후보를 찾았어요.` : '해당 날짜에 등록된 셋리스트는 찾지 못했어요.');
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : '셋리스트를 검색하지 못했어요.');
    } finally { setSearching(false); }
  }

  async function chooseCandidate(candidate: SetlistCandidate) {
    if (!editing) return;
    setSaving(true);
    try {
      await onLink(editing, candidate);
      setRemoteSongs((current) => ({ ...current, [editing.id]: candidate.songs }));
      setEditing(null);
    } finally { setSaving(false); }
  }

  async function save() {
    if (!editing) return;
    const songs = parseSongs(text);
    setSaving(true);
    try {
      await onSave(editing, songs);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="animate-in fade-in pb-24 duration-300">
      <header>
        <p className="eyebrow">Live song archive</p>
        <h1 className="screen-title">내가 라이브로 들은 노래</h1>
        <p className="mt-2 text-sm text-black/45">
          공연별 셋리스트를 적어두면 아티스트별 곡과 들은 횟수가 자동으로
          쌓여요.
        </p>
      </header>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <SetlistMetric
          icon={<Music2 />}
          label="서로 다른 곡"
          value={`${songStats.length}곡`}
        />
        <SetlistMetric
          icon={<Disc3 />}
          label="라이브 감상"
          value={`${totalSongs}번`}
        />
        <SetlistMetric
          icon={<Mic2 />}
          label="기록한 공연"
          value={`${scoped.filter((concert) => concert.setlist?.length).length}회`}
        />
      </div>

      <label className="mt-5 block">
        <span className="sr-only">아티스트 선택</span>
        <select
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
          className="h-11 w-full rounded-2xl border border-black/10 bg-white px-4 text-sm font-semibold outline-none sm:w-auto"
        >
          <option value="all">모든 아티스트</option>
          {artists.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <section className="mt-4 overflow-hidden rounded-[28px] border border-black/10 bg-white/70 shadow-sm">
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-black/35">
              Song collection
            </p>
            <h2 className="mt-1 font-semibold">누적 라이브 곡</h2>
          </div>
          <span className="rounded-full bg-[var(--theme-highlight)] px-3 py-1.5 text-xs font-semibold">
            {artist === 'all' ? '전체' : artist}
          </span>
        </div>
        {songStats.length ? (
          <ol className="divide-y divide-black/[0.06]">
            {songStats.map((song, index) => (
              <li
                key={song.title.toLocaleLowerCase('ko')}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="w-6 text-center text-xs font-semibold text-black/25">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {song.title}
                </span>
                <span className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-semibold text-black/55">
                  {song.count}번
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="p-10 text-center">
            <ListMusic className="mx-auto size-7 text-black/20" />
            <p className="mt-3 text-sm text-black/40">
              아직 기록된 셋리스트가 없어요.
            </p>
            <p className="mt-1 text-xs text-black/30">
              아래 공연에서 곡 목록을 붙여넣어 보세요.
            </p>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div>
          <p className="text-xs text-black/35">Concert setlists</p>
          <h2 className="mt-1 text-xl font-semibold">공연별 셋리스트</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {scoped.map((concert) => (
            <button
              key={concert.id}
              type="button"
              onClick={() => openEditor(concert)}
              className="flex min-w-0 items-center gap-3 rounded-[24px] border border-black/10 bg-white/75 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--theme-accent)]/40"
            >
              <PosterImage
                src={concert.posterUrl}
                title={concert.title}
                className="size-16 shrink-0 rounded-2xl object-cover"
              />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-sm">{concert.title}</b>
                <span className="mt-1 flex items-center gap-1 text-[11px] text-black/40">
                  <CalendarDays className="size-3" />
                  {new Intl.DateTimeFormat('ko-KR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date(concert.performanceAt))}
                </span>
                <span className="mt-2 block text-xs font-semibold text-[var(--theme-accent-deep)]">
                  {concert.setlist?.length
                    ? `${concert.setlist.length}곡 기록됨 · 수정`
                    : '셋리스트 기록하기'}
                </span>
                {concert.setlistSourceUrl && <span className="mt-1 block text-[10px] text-black/35">setlist.fm 연동됨</span>}
              </span>
            </button>
          ))}
        </div>
        {!scoped.length && (
          <p className="mt-4 rounded-2xl border border-dashed border-black/10 p-8 text-center text-sm text-black/35">
            이 아티스트의 관람 완료 공연이 없어요.
          </p>
        )}
      </section>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="w-[calc(100vw-24px)] max-w-lg overflow-x-hidden bg-[#fbfaf6] text-[#1c1b18]">
          <DialogHeader>
            <DialogTitle>{editing?.title}</DialogTitle>
            <DialogDescription>
              한 줄에 한 곡씩 입력하세요. 번호나 글머리표는 저장할 때 자동으로
              정리돼요.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-[var(--theme-highlight)]/45 p-3 text-xs leading-5 text-black/55">
            화면의 공연명과 아티스트명은 바꾸지 않고, 검색할 때만 setlist.fm에 맞는 아티스트를 내부에서 찾아 연결해요. 결과가 없거나 다른 회차라면 아래에서 직접 입력할 수 있어요.
          </div>
          <Button type="button" variant="outline" onClick={searchOfficialSetlist} disabled={searching || saving} className="h-11 w-full border-[var(--theme-accent)]/30 bg-white">
            {searching ? <LoaderCircle className="animate-spin" /> : <Search />}{searching ? '공식 셋리스트 검색 중…' : 'setlist.fm에서 찾아보기'}
          </Button>
          {searchMessage && <output className="block text-xs leading-5 text-black/50">{searchMessage}</output>}
          {candidates.length > 0 && <div className="max-h-52 space-y-2 overflow-y-auto rounded-2xl bg-black/[0.035] p-2">{candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => void chooseCandidate(candidate)} disabled={saving} className="flex w-full min-w-0 items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm hover:ring-1 hover:ring-[var(--theme-accent)]"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--theme-highlight)]"><Check className="size-4" /></span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{editing?.title}</b><span className="block truncate text-[11px] text-black/45">{candidate.eventDate} · {candidate.venue}{candidate.city ? `, ${candidate.city}` : ''}</span><span className="mt-1 block text-[11px] font-semibold text-[var(--theme-accent-deep)]">{candidate.songs.length}곡 선택</span></span></button>)}</div>}
          {editing?.setlistSourceUrl && <a href={editing.setlistSourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-black/45 underline"><ExternalLink className="size-3" />현재 연결된 셋리스트 출처 보기</a>}
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-black/30"><span className="h-px flex-1 bg-black/10" /><span>또는 직접 입력</span><span className="h-px flex-1 bg-black/10" /></div>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'1. 첫 번째 곡\n2. 두 번째 곡\n앵콜 곡'}
            className="min-h-64 resize-y"
          />
          <div className="flex items-center justify-between text-xs text-black/35">
            <span>{parseSongs(text).length}곡</span>
            <button
              type="button"
              onClick={() => setText('')}
              className="hover:text-black"
            >
              모두 지우기
            </button>
          </div>
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-11 w-full bg-[var(--theme-accent)] text-black hover:brightness-105"
          >
            <Save />
            {saving ? '저장 중…' : '셋리스트 저장'}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function parseSongs(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 200);
}

function readArtistAliases(): Record<string, CachedArtistMatch> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem('dukjil-setlist-artist-aliases') || '{}') as Record<string, CachedArtistMatch>; }
  catch { return {}; }
}

function saveArtistAlias(original: string, resolved: CachedArtistMatch) {
  if (typeof window === 'undefined' || !original || !resolved.mbid) return;
  window.localStorage.setItem('dukjil-setlist-artist-aliases', JSON.stringify({ ...readArtistAliases(), [original]: resolved }));
}

async function resolveArtistForSearch(original: string, title: string): Promise<CachedArtistMatch | null> {
  const cached = readArtistAliases()[original];
  if (cached?.mbid) return cached;
  for (const query of new Set([original, titleArtistHint(title)].filter(Boolean))) {
    const params = new URLSearchParams({ query, fmt: 'json', limit: '3' });
    const response = await fetch(`https://musicbrainz.org/ws/2/artist/?${params}`).catch(() => null);
    if (!response?.ok) continue;
    const payload = await response.json() as { artists?: Array<{ id?: string; name?: string; score?: number }> };
    const match = (payload.artists || []).find((artist) => artist.id && artist.name && Number(artist.score || 0) >= 75);
    if (match?.id && match.name) return { mbid: match.id, name: match.name };
  }
  return null;
}

function titleArtistHint(title: string) {
  return title.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b(world\s+tour|tour|concert|live|festival|fan\s*meeting|in\s+(seoul|korea|busan))\b/gi, ' ').replace(/(월드\s*투어|투어|콘서트|공연|내한|페스티벌|팬미팅)/g, ' ').replace(/[<>{}[\]():|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function SetlistMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[22px] border border-black/10 bg-white/75 p-3 shadow-sm sm:p-4">
      <span className="grid size-8 place-items-center rounded-xl bg-[var(--theme-highlight)] text-black [&>svg]:size-4">
        {icon}
      </span>
      <p className="mt-3 truncate text-[10px] text-black/40">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{value}</p>
    </div>
  );
}
