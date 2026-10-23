// В браузере используется только публичный anon key. Никогда не помещайте сюда service_role key.
const SUPABASE_URL = 'https://jfvwpfjuhqjythhmuypf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhbGciOiJIUzI1NiIsInJlZiI6ImpmdndwZmp1aHFqeXRoaG11eXBmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NDQ4NzIsImV4cCI6MjEwNjMyMDg3Mn0.jDkr7bfN9EMqlOt0yrSxpK9SsW08Bg6EdyqMWfY_bgg';
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Единый безопасный клиент приватного bucket. В БД сохраняется путь объекта, не публичный URL.
window.registryStorage = {
  bucket: 'registries',
  maxBytes: 10 * 1024 * 1024,
  allowedExtensions: ['csv', 'xlsx', 'xls'],
  normalizePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    let path = value.trim();
    // Мягкая совместимость с прежними URL только для этого же проекта и bucket.
    if (/^https?:\/\//i.test(path)) {
      try {
        const url = new URL(path);
        const project = new URL(SUPABASE_URL);
        if (url.origin !== project.origin) return null;
        const marker = `/storage/v1/object/public/${this.bucket}/`;
        const signedMarker = `/storage/v1/object/sign/${this.bucket}/`;
        const markerIndex = url.pathname.indexOf(marker);
        const signedIndex = url.pathname.indexOf(signedMarker);
        if (markerIndex >= 0) path = url.pathname.slice(markerIndex + marker.length);
        else if (signedIndex >= 0) path = url.pathname.slice(signedIndex + signedMarker.length);
        else return null;
      } catch (_) { return null; }
    }
    try { path = decodeURIComponent(path); } catch (_) { return null; }
    if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || /[\u0000-\u001F]/.test(path)) return null;
    return path;
  },
  async upload(file, path) {
    const safePath = this.normalizePath(path);
    if (!safePath) throw new Error('Некорректный путь файла.');
    if (!(file instanceof File) || file.size <= 0 || file.size > this.maxBytes) {
      throw new Error('Файл пустой или превышает ограничение 10 МБ.');
    }
    const ext = String(file.name.split('.').pop() || '').toLowerCase();
    if (!this.allowedExtensions.includes(ext)) throw new Error('Допустимы только файлы CSV, XLS и XLSX.');
    const { data, error } = await window.supabaseClient.storage.from(this.bucket).upload(safePath, file, {
      upsert: false,
      contentType: ext === 'csv' ? 'text/csv' : (ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    });
    if (error) throw error;
    return data.path;
  },
  async signedUrl(value, expiresIn = 3600) {
    const path = this.normalizePath(value);
    if (!path) throw new Error('Ссылка на реестр некорректна или относится к другому хранилищу.');
    const { data, error } = await window.supabaseClient.storage.from(this.bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Не удалось сформировать временную ссылку на файл.');
    return data.signedUrl;
  }
};

window.escapeHtml = window.escapeHtml || ((value) => String(value == null ? '' : value).replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch])));
