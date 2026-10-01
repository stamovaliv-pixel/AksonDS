document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  // Строгая проверка на администратора
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    alert('Доступ запрещен. Страница доступна только Администратору.');
    return window.location.href = 'admin_calendar.html';
  }

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; 
  };

  let supplyTypes = [];

  // Загрузка настроек
  const loadSettings = async () => {
    const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (error) return alert('Ошибка загрузки настроек: ' + error.message);

    document.getElementById('setStartHour').value = data.slot_start_hour;
    document.getElementById('setEndHour').value = data.slot_end_hour;
    document.getElementById('setSlotsPerHour').value = data.slots_per_hour;
    document.getElementById('setDeadline').value = data.booking_deadline_hours;

    // Установка чекбоксов дней недели
    const checkboxes = document.querySelectorAll('#daysGrid input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = data.available_days.includes(parseInt(cb.value));
    });

    supplyTypes = data.supply_types || [];
    renderSupplyTypes();
  };

  // Отрисовка списка типов поставок
  const renderSupplyTypes = () => {
    const list = document.getElementById('supplyTypesList');
    list.innerHTML = '';
    supplyTypes.forEach((st, index) => {
      const li = document.createElement('li');
      li.className = 'supply-item';
      li.innerHTML = `
        <span>${st.name}</span>
        <button class="btn-remove" data-index="${index}">Удалить</button>
      `;
      list.appendChild(li);
    });
  };

  // Добавление нового типа поставки
  document.getElementById('btnAddSupply').onclick = () => {
    const input = document.getElementById('newSupplyName');
    const name = input.value.trim();
    if (!name) return;
    
    // Генерируем уникальный ID для базы (транслит или случайная строка)
    const id = 'type_' + Math.random().toString(36).substr(2, 9);
    supplyTypes.push({ id, name });
    input.value = '';
    renderSupplyTypes();
  };

  // Удаление типа поставки
  document.getElementById('supplyTypesList').addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-remove')) {
      const index = e.target.dataset.index;
      supplyTypes.splice(index, 1);
      renderSupplyTypes();
    }
  });

  // Сохранение настроек в базу
  document.getElementById('btnSaveSettings').onclick = async () => {
    const btn = document.getElementById('btnSaveSettings');
    btn.innerText = 'Сохранение...';
    btn.disabled = true;

    const available_days = Array.from(document.querySelectorAll('#daysGrid input[type="checkbox"]:checked'))
      .map(cb => parseInt(cb.value));

    const payload = {
      slot_start_hour: parseInt(document.getElementById('setStartHour').value),
      slot_end_hour: parseInt(document.getElementById('setEndHour').value),
      slots_per_hour: parseInt(document.getElementById('setSlotsPerHour').value),
      booking_deadline_hours: parseInt(document.getElementById('setDeadline').value),
      available_days,
      supply_types: supplyTypes
    };

    const { error } = await sb.from('app_settings').update(payload).eq('id', 1);
    
    if (error) {
      alert('Ошибка сохранения: ' + error.message);
    } else {
      alert('Настройки успешно сохранены!');
    }
    
    btn.innerText = 'Сохранить настройки';
    btn.disabled = false;
  };

  loadSettings();
});