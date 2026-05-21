import { env } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = env.PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
