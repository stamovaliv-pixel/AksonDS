/* Secure prepared-booking registry upload for the current Doxi user. */
document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const status = $('doxiRecordStatus');
  const details = $('doxiRecordDetails');
  const form = $('doxiRegistryForm');
  const fileInput = $('doxiRegistryFile');
  const uploadButton = $('doxiRegistryUpload');
  const sb = window.supabaseClient;
  const params = new URLSearchParams(window.location.search);
  const bookingId = params.get('booking_id') || '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const showStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
    status.classList.toggle('is-ok', !error);
  };
  const invoke = async (body) => {
    const { data, error } = await sb.functions.invoke('doxi-chat', { body });
    if (error) throw new Error(error.message || 'Не удалось обратиться к Докси.');
    if (!data || data.error) throw new Error(data?.error || 'Сервер вернул пустой ответ.');
    return data;
  };
  const addDetail = (label, value) => {
    const row = document.createElement('div'); row.className = 'doxi-record-detail';
    const name = document.createElement('small'); name.textContent = label;
    const text = document.createElement('strong'); text.textContent = value || '—';
    row.append(name, text); details.append(row);
  };

  try {
    const auth = await window.dockslotGetAuthProfile();
    if (!auth?.user || auth.error || !auth.profile || auth.profile.is_blocked || !['super_admin','admin','operator','supplier'].includes(String(auth.profile.role || '').toLowerCase())) {
      window.location.replace('../index.html'); return;
    }
    if (!uuid.test(bookingId)) throw new Error('Некорректная ссылка на подготовленную запись. Вернись в чат Докси и открой ссылку ещё раз.');
    const result = await invoke({ action: 'admin_get_created_booking', booking_id: bookingId });
    const role = String(auth.profile.role || '').toLowerCase();
    const back = document.querySelector('.doxi-record-back');
    if (back) back.href = role === 'supplier' ? 'calendar.html' : (role === 'admin' || role === 'operator' ? 'admin_calendar.html' : 'admin_overview.html');
    const booking = result.booking;
    if (!booking) throw new Error('Подготовленная запись не найдена или больше недоступна.');
    details.replaceChildren();
    const company = Array.isArray(booking.profiles) ? booking.profiles[0]?.company_name : booking.profiles?.company_name;
    addDetail('Поставщик', company || 'Поставщик DockSlot');
    addDetail('Дата', booking.slot_date);
    addDetail('Время', `${String(booking.slot_hour).padStart(2,'0')}:00`);
    addDetail('Номер документа', booking.order_number || 'Без номера');
    addDetail('Тип документа', booking.order_type || '—');
    addDetail('Типы поставки', Array.isArray(booking.supply_types) ? booking.supply_types.join(', ') : (booking.supply_type || '—'));
    addDetail('Транспортная компания', booking.is_tk ? 'Да' : 'Нет');
    addDetail('Реестр', booking.registry_file_url ? 'Уже прикреплён' : 'Ожидает загрузки');
    details.hidden = false;
    if (booking.registry_file_url) {
      showStatus('Реестр уже прикреплён к этой записи. Повторная загрузка через Докси не требуется.');
      form.hidden = true;
    } else {
      showStatus('Запись подтверждена. Выбери актуальный реестр и загрузи его.');
      form.hidden = false;
    }
  } catch (error) {
    showStatus(error.message || 'Не удалось загрузить подготовленную запись.', true);
    form.hidden = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) { showStatus('Сначала выбери файл реестра.', true); return; }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv','xls','xlsx'].includes(extension)) { showStatus('Разрешены только CSV, XLS и XLSX.', true); return; }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) { showStatus('Размер файла должен быть не более 10 МБ.', true); return; }
    const formData = new FormData();
    formData.append('action', 'upload_registry');
    formData.append('booking_id', bookingId);
    formData.append('file', file, file.name);
    uploadButton.disabled = true; uploadButton.textContent = 'Загружаю…';
    showStatus('Загружаю реестр в защищённое хранилище…');
    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', { body: formData });
      if (error) throw new Error(error.message || 'Не удалось загрузить реестр.');
      if (!data || data.error) throw new Error(data?.error || 'Сервер не подтвердил загрузку.');
      showStatus('Реестр успешно прикреплён к записи. Теперь можно вернуться в DockSlot.');
      fileInput.disabled = true;
      uploadButton.textContent = 'Реестр загружен';
    } catch (error) {
      showStatus(error.message || 'Ошибка загрузки реестра.', true);
      uploadButton.disabled = false; uploadButton.textContent = 'Повторить загрузку';
    }
  });
});
