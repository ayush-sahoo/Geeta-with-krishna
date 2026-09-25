import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bkwvuckznpaawmqrjjgk.supabase.co';
const supabasePublishableKey = 'sb_publishable_xiYHK1Q_5FcGkaSbug89Qg_yeDuR3KW';

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
