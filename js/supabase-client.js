// ВАЖНО: Замените эти значения на ваши данные из панели Supabase (Project Settings -> API)
const SUPABASE_URL = 'https://jfvwpfjuhqjythhmuypf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmdndwZmp1aHFqeXRoaG11eXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NDQ4NzIsImV4cCI6MjEwNjMyMDg3Mn0.jDkr7bfN9EMqlOt0yrSxpK9SsW08Bg6EdyqMWfY_bgg';

// Инициализация глобального клиента
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
