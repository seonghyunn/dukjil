'use client';

import { useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';

export function AuthGate() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setLoading(true); setMessage('');
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (result.error) setMessage(result.error.message);
    else if (mode === 'signup' && !result.data.session) setMessage('확인 메일을 보냈어요. 메일 속 링크를 누른 뒤 로그인해 주세요.');
    setLoading(false);
  }

  async function resetPassword() {
    if (!supabase || !email) { setMessage('먼저 이메일을 입력해 주세요.'); return; }
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMessage('비밀번호 재설정 메일을 보냈어요.');
  }

  return <main className="grid min-h-screen place-items-center bg-[#11110f] p-5 text-white"><div className="w-full max-w-sm"><div className="mb-8"><span className="grid size-12 place-items-center rounded-2xl bg-[#dfff94] text-black"><Sparkles /></span><p className="eyebrow mt-6">Dukjil log</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.06em]">공연의 모든 순간을<br />한곳에.</h1></div><form onSubmit={submit} className="space-y-3 rounded-[28px] bg-[#f3f0e8] p-5 text-black"><h2 className="text-lg font-semibold">{mode === 'login' ? '다시 만나 반가워요' : '새 기록을 시작해요'}</h2><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="아이디 (이메일)" autoComplete="email" className="h-11 border-black/10 bg-white" required /><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 8자 이상" minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="h-11 border-black/10 bg-white" required /><Button type="submit" className="h-11 w-full bg-[#ff6b61] text-black hover:bg-[#ff827a]" disabled={loading}>{loading && <LoaderCircle className="animate-spin" />}{mode === 'login' ? '로그인' : '가입하기'}</Button>{message && <p role="status" className="text-xs leading-5 text-black/60">{message}</p>}<div className="flex justify-between text-xs text-black/50"><button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>{mode === 'login' ? '처음이신가요? 가입하기' : '이미 계정이 있어요'}</button>{mode === 'login' && <button type="button" onClick={resetPassword}>비밀번호 재설정</button>}</div></form></div></main>;
}
