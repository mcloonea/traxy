import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

export const supabase = createClient(
  'https://vkzdifzdripyloijoxmt.supabase.co',
  'sb_publishable_jMR4S2AsDNOYYd55bTspPw_Kq2b3Oo4'
);

// Fill in the deployed function name when it is ready.
export const CHAT_FUNCTION_NAME = 'traxly-chat';
