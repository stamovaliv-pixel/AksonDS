document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'operator' && profile.role !== 'admin')) return window.location.href = 'calendar.html';

  document.getElementById('logoutBtn').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; };

  let allSuppliers = [];

  const renderSuppliers = (filterText = '') => {
    const list = document.getElementById('suppliersList');
    list.innerHTML = '';
    const lowerFilter = filterText.toLowerCase();

    const filtered = allSuppliers.filter(s => 
      s.company_name.toLowerCase().includes(lowerFilter) || 
      s.inn.includes(lowerFilter) || 
      (s.email && s.email.toLowerCase().includes(lowerFilter))
    );

    if(filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">Ничего не найдено</div>';
      return;
    }

    filtered.forEach(s => {
      const card = document.createElement('div');
      card.className = `supplier-card ${s.is_blocked ? 'blocked' : ''}`;
      card.innerHTML = `
        <div class="sup-info">
          <div class="sup-name">${s.company_name} (ИНН: ${s.inn})</div>
          <div class="sup-details">Email: ${s.email || 'Нет данных'} • Дата регистрации: ${new Date(s.created_at).toLocaleDateString()}</div>
        </div>
        <button class="btn-toggle ${s.is_blocked ? 'btn-unblock' : 'btn-block'}" data-id="${s.id}" data-status="${s.is_blocked}">
          ${s.is_blocked ? 'Разблокировать' : 'Заблокировать'}
        </button>
      `;
      list.appendChild(card);
    });
  };

  const loadData = async () => {
    const { data } = await sb.from('profiles').select('*').eq('role', 'supplier').order('created_at', { ascending: false });
    if (data) allSuppliers = data;
    renderSuppliers();
  };

  document.getElementById('searchInput').addEventListener('input', (e) => renderSuppliers(e.target.value));

  document.getElementById('suppliersList').addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-toggle')) {
      const id = e.target.dataset.id;
      const currentStatus = e.target.dataset.status === 'true';
      const newStatus = !currentStatus;
      
      if(confirm(`Вы уверены, что хотите ${newStatus ? 'заблокировать' : 'разблокировать'} этого поставщика?`)) {
        e.target.innerText = '...';
        const { error } = await sb.from('profiles').update({ is_blocked: newStatus }).eq('id', id);
        if(!error) await loadData();
        else alert('Ошибка: ' + error.message);
      }
    }
  });

  loadData();
});