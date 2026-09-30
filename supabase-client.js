// ВАЖНО: Замените эти значения на ваши данные из панели Supabase (Project Settings -> API)
const SUPABASE_URL = 'https://sb_publishable_ZTouEu_t4DLs8B12kMe2Yg_P0-DEl9d.supabase.co';
const SUPABASE_ANON_KEY = 'sb_secret_cseQRcr1qke2xtzeK5lBSg_GMDXBkDl';

// Инициализация глобального клиента
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
