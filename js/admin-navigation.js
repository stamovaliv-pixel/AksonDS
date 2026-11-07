/* Shared navigation treatment for administrative pages. */
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const nav = document.querySelector('.header-nav');
  if (!sb || !nav) return;

  let authUser = null;
  try {
    const { data, error: authError } = await sb.auth.getUser();
    if (authError) return;
    authUser = data?.user || null;
  } catch (error) {
    console.warn('Не удалось проверить административную навигацию:', error);
    return;
  }
  if (!authUser) return;

  const { data: profile, error } = await sb
    .from('profiles')
    .select('role, is_blocked')
    .eq('id', authUser.id)
    .single();
  if (error || !profile || profile.is_blocked) return;

  const overviewHref = 'admin_overview.html';
  let overviewLink = nav.querySelector(`a[href="${overviewHref}"]`);

  if (profile.role === 'admin' && !overviewLink) {
    overviewLink = document.createElement('a');
    overviewLink.href = overviewHref;
    overviewLink.className = 'nav-icon admin-overview-link';
    overviewLink.title = 'Обзор';
    overviewLink.setAttribute('aria-label', 'Обзор');
    overviewLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><rect x="3" y="3" width="8" height="8" rx="1.5"></rect><rect x="13" y="3" width="8" height="5" rx="1.5"></rect><rect x="13" y="10" width="8" height="11" rx="1.5"></rect><rect x="3" y="13" width="8" height="8" rx="1.5"></rect></svg>';
  }

  if (profile.role === 'admin' && overviewLink) {
    const themeButton = nav.querySelector('[data-theme-toggle]');
    if (themeButton && themeButton.nextElementSibling !== overviewLink) {
      themeButton.insertAdjacentElement('afterend', overviewLink);
    } else if (!overviewLink.isConnected) {
      nav.prepend(overviewLink);
    }
  }

  const page = window.location.pathname.split('/').pop();
  const activePage = page === 'admin_day.html' ? 'admin_calendar.html' : page;
  nav.querySelectorAll('a.nav-icon[href]').forEach((link) => {
    const target = link.getAttribute('href');
    const isActive = target === activePage;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
});
