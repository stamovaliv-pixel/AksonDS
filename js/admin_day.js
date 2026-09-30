document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'admin_calendar.html';

  document.getElementById('dateDisplay').innerText = new Date(selectedDate).toLocaleDateString('ru-RU');

  // Извлекаем записи с привязанными данными профиля
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, order_number, order_type, supply_type, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const container = document.getElementById('hoursContainer');
  
  for (let hour = 9; hour <= 17; hour++) {
    const hourBookings = (bookings || []).filter(b => b.slot_hour === hour);
    
    const block = document.createElement('div');
    block.className = 'hour-block';
    
    let cardsHtml = hourBookings.map(b => `
      <div class="booking-card" data-id="${b.id}" data-hour="${b.slot_hour}" data-doc="${b.order_number}" data-company="${b.profiles?.company_name}">
        <strong>${b.profiles?.company_name || 'Неизвестно'}</strong><br>
        <span style="color:#64748b;">${b.order_type} №${b.order_number}</span>
      </div>
    `).join('');

    if (hourBookings.length === 0) cardsHtml = '<span style="color:#94a3b8; font-size:14px;">Слоты свободны</span>';

    block.innerHTML = `
      <div class="hour-header">${hour}:00 - ${hour+1}:00 <span style="font-size:14px; color:#64748b; font-weight:normal;">(Занято: ${hourBookings.length}/5)</span></div>
      <div class="cards-container">${cardsHtml}</div>
    `;
    container.appendChild(block);
  }

  // Логика модального окна редактирования
  const modal = document.getElementById('editModal');
  
  container.addEventListener('click', (e) => {
    const card = e.target.closest('.booking-card');
    if (!card) return;

    document.getElementById('mId').value = card.dataset.id;
    document.getElementById('mHour').value = card.dataset.hour;
    document.getElementById('mDoc').value = card.dataset.doc;
    document.getElementById('mCompany').innerText = card.dataset.company;
    
    modal.style.display = 'flex';
  });

  document.getElementById('closeModal').onclick = () => modal.style.display = 'none';

  // Обновление слота админом
  document.getElementById('btnUpdate').onclick = async () => {
    if (!confirm('Подтверждаете изменение записи?')) return;
    const id = document.getElementById('mId').value;
    const hour = parseInt(document.getElementById('mHour').value);
    const doc = document.getElementById('mDoc').value;

    const { error } = await sb.from('bookings').update({ slot_hour: hour, order_number: doc }).eq('id', id);
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
});