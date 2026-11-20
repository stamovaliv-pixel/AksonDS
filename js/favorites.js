/* Per-user supplier favourites shared by admin pages and Doxi. */
(() => {
  const TABLE = 'admin_favorite_suppliers';
  const state = { ids: new Set(), loadedFor: null };

  async function load(sb, userId) {
    if (!sb || !userId) throw new Error('Не удалось определить пользователя для избранного.');
    const { data, error } = await sb.from(TABLE).select('supplier_profile_id').eq('user_id', userId);
    if (error) throw error;
    state.ids = new Set((data || []).map(row => String(row.supplier_profile_id)));
    state.loadedFor = String(userId);
    return new Set(state.ids);
  }

  async function toggle(sb, userId, supplierId) {
    const id = String(supplierId);
    const exists = state.ids.has(id);
    if (exists) {
      const { error } = await sb.from(TABLE).delete().eq('user_id', userId).eq('supplier_profile_id', id);
      if (error) throw error;
      state.ids.delete(id);
    } else {
      const { error } = await sb.from(TABLE).upsert(
        { user_id: userId, supplier_profile_id: id },
        { onConflict: 'user_id,supplier_profile_id', ignoreDuplicates: true }
      );
      if (error) throw error;
      state.ids.add(id);
    }
    return !exists;
  }

  function setFilterButtonState(button, active) {
    if (!button) return;
    const tooltip = active ? 'Показать всех поставщиков' : 'Показать избранных поставщиков';
    button.setAttribute('aria-pressed', String(Boolean(active)));
    button.classList.toggle('is-active', Boolean(active));
    const star = button.querySelector('.favorite-filter-star');
    if (star) star.textContent = active ? '★' : '☆';
    button.removeAttribute('title');
    button.setAttribute('data-tooltip', tooltip);
    button.setAttribute('aria-label', tooltip);
  }

  function createFilterButton(mount, onChange) {
    if (!mount) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'favorite-filter-btn';
    button.innerHTML = '<span class="favorite-filter-star" aria-hidden="true">☆</span>';
    button.setAttribute('data-favorite-filter', 'true');
    setFilterButtonState(button, false);
    button.addEventListener('click', () => {
      const active = button.getAttribute('aria-pressed') !== 'true';
      setFilterButtonState(button, active);
      onChange?.(active);
    });
    mount.appendChild(button);
    return button;
  }

  function syncStar(button, active) {
    button.classList.toggle('is-favorite', active);
    button.textContent = active ? '★' : '☆';
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Убрать из избранного' : 'Добавить в избранное';
    button.setAttribute('aria-label', button.title);
  }

  window.DockSlotFavorites = {
    load,
    toggle,
    ids: () => new Set(state.ids),
    createFilterButton,
    setFilterButtonState,
    syncStar
  };
})();
