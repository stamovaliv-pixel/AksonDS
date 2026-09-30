document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'admin_calendar.html';

  const dateObj = new Date(selectedDate);
  document.getElementById('dateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  // Словари для перевода на русский (как у пользователя)
  const supplyTypes = { 'orders_im': 'Заказы ИМ', 'mix': 'МИКС', 'return': 'Возврат' };
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // 1. Загружаем все бронирования на этот день
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, order_number, order_type, supply_type, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  // 2. Загружаем список всех поставщиков для выпадающего списка при создании
  let allProfiles = [];
  const { data: profilesData } = await sb.from('profiles').select('id, company_name, inn').eq('role', 'supplier');
  if (profilesData) {
    allProfiles = profilesData;
    const dataList = document.getElementById('suppliersList');
    profilesData.forEach(p => {
      const option = document.createElement('option');
      option.value = `${p.company_name} (ИНН: ${p.inn})`;
      option.dataset.id = p.id;
      dataList.appendChild(option);
    });
  }

  // Привязка выбранного поставщика к скрытому полю ID
  document.getElementById('cSupplierSearch').addEventListener('input', function() {
    const val = this.value;
    const option = document.querySelector(`#suppliersList option[value="${val}"]`);
    document.getElementById('cProfileId').value = option ? option.dataset.id : '';
  });

  const container = document.getElementById('hoursContainer');
  container.innerHTML = '';
  
  // 3. Отрисовка сетки часов (с 9 до 17)
  for (let hour = 9; hour <= 17; hour++) {
    const hourBookings = (bookings || []).filter(b => b.slot_hour === hour);
    const block = document.createElement('div');
    block.className = 'hour-block';
    
    // Генерируем красные карточки для занятых слотов
    let cardsHtml = hourBookings.map(b => {
      const sType = supplyTypes[b.supply_type] || b.supply_type;
      const oType = orderTypes[b.order_type] || b.order_type;
      const compName = b.profiles?.company_name || 'Неизвестно';
      const inn = b.profiles?.inn || '';
      
      // JSON прячем в атрибут, чтобы легко достать при клике
      const dataStr = encodeURIComponent(JSON.stringify({
        id: b.id, hour: b.slot_hour, doc: b.order_number, sTypeRaw: b.supply_type, oTypeRaw: b.order_type,
        fullCompany: `${compName} (ИНН: ${inn})`
      }));

      return `
        <div class="booking-card" data-info="${dataStr}">
          <strong style="display:block; margin-bottom:4px; color:#1f2937;">${compName}</strong>
          <div style="color:#64748b; font-size:13px;">${oType} №${b.order_number} • ${sType}</div>
        </div>
      `;
    }).join('');

    // Если мест меньше 5, добавляем синюю кнопку "Создать запись"
    if (hourBookings.length < 5) {
      cardsHtml += `<div class="btn-add-slot" data-hour="${hour}">+ Добавить запись (${5 - hourBookings.length} мест)</div>`;
    }

    block.innerHTML = `
      <div class="hour-header">
        <span>${hour}:00 - ${hour+1}:00</span>
        <span style="font-size:14px; color:#64748b; font-weight:normal;">Занято: <strong style="color:${hourBookings.length===5?'#ef4444':'#10b981'}">${hourBookings.length}/5</strong></span>
      </div>
      <div class="cards-container">${cardsHtml}</div>
    `;
    container.appendChild(block);
  }

  // --- Логика модальных окон ---
  const editModal = document.getElementById('editModal');
  const createModal = document.getElementById('createModal');
  
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';
  document.getElementById('closeCreateModal').onclick = () => createModal.style.display = 'none';

  // Делегирование кликов по карточкам и кнопкам добавления
  container.addEventListener('click', (e) => {
    // Открытие окна РЕДАКТИРОВАНИЯ
    const card = e.target.closest('.booking-card');
    if (card) {
      const data = JSON.parse(decodeURIComponent(card.dataset.info));
      document.getElementById('mId').value = data.id;
      document.getElementById('mHour').value = data.hour;
      document.getElementById('mDoc').value = data.doc;
      document.getElementById('mSupplyType').value = data.sTypeRaw;
      document.getElementById('mOrderType').value = data.oTypeRaw;
      document.getElementById('mCompany').innerText = data.fullCompany;
      editModal.style.display = 'flex';
      return;
    }

    // Открытие окна СОЗДАНИЯ
    const addBtn = e.target.closest('.btn-add-slot');
    if (addBtn) {
      document.getElementById('cHour').value = addBtn.dataset.hour;
      createModal.style.display = 'flex';
    }
  });

  // Обновление слота админом
  document.getElementById('btnUpdate').onclick = async () => {
    if (!confirm('Подтверждаете изменение записи?')) return;
    const id = document.getElementById('mId').value;
    const payload = {
      slot_hour: parseInt(document.getElementById('mHour').value),
      order_number: document.getElementById('mDoc').value.trim(),
      supply_type: document.getElementById('mSupplyType').value,
      order_type: document.getElementById('mOrderType').value
    };

    const { error } = await sb.from('bookings').update(payload).eq('id', id);
    if (error) alert('Ошибка обновления: ' + error.message);
    else window.location.reload();
  };

  // Удаление слота админом
  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
    const id = document.getElementById('mId').value;
    const { error } = await sb.from('bookings').delete().eq('id', id);
    if (error) alert('Ошибка удаления: ' + error.message);
    else window.location.reload();
  };

  // Создание слота админом
  document.getElementById('createForm').onsubmit = async (e) => {
    e.preventDefault();
    const profileId = document.getElementById('cProfileId').value;
    if (!profileId) return alert('Пожалуйста, выберите поставщика из выпадающего списка.');

    const btn = document.getElementById('btnCreate');
    btn.disabled = true; btn.innerText = 'Запись...';

    const payload = {
      profile_id: profileId,
      slot_date: selectedDate,
      slot_hour: parseInt(document.getElementById('cHour').value),
      supply_type: document.getElementById('cSupplyType').value,
      order_type: document.getElementById('cOrderType').value,
      order_number: document.getElementById('cDoc').value.trim(),
      status: 'active'
    };

    const { error: insertError } = await sb.from('bookings').insert([payload]);

    if (insertError) {
      alert('Ошибка записи: ' + insertError.message);
      btn.disabled = false; btn.innerText = 'Записать поставщика';
    } else {
      window.location.reload();
    }
  };
});
