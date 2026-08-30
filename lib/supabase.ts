import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && key);
export const isTestMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export const supabase = isSupabaseConfigured
  ? createBrowserClient(url!, key!)
  : null;
