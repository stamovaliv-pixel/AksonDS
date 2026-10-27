(function () {
  'use strict';
  const KEY = 'akson-dockslot-theme';
  const moon = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.463.402.807a6.5 6.5 0 0 0 8.268 8.268c.344-.215.829-.003.803.397Z"></path></svg>';
  const sun = '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>';
  function normalize(theme) { return theme === 'dark' ? 'dark' : 'light'; }
  function apply(theme) {
    const isDark = normalize(theme) === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const hint = isDark ? 'Перейти на светлую сторону' : 'Перейти на темную сторону';
      button.innerHTML = isDark ? sun : moon;
      button.title = hint;
      button.setAttribute('aria-label', hint);
      button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    });
  }
  let saved = 'light';
  try { saved = normalize(localStorage.getItem(KEY) || 'light'); } catch (_) { saved = 'light'; }
  apply(saved);
  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (_) { /* Theme remains active for the current page. */ }
    apply(next);
  });
  window.addEventListener('storage', function (event) {
    if (event.key === KEY) apply(normalize(event.newValue || 'light'));
  });
})();
