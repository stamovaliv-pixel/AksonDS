document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  // 1. Проверка авторизации
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  // 2. Логика выхода
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });
  }

  // 3. Элементы DOM
  const orgInn = document.getElementById('orgInn');
  const orgName = document.getElementById('orgName');
  
  const profileNameInput = document.getElementById('profileName');
  const profilePhoneInput = document.getElementById('profilePhone');
  const profileEmailInput = document.getElementById('profileEmail');
  
  const profileForm = document.getElementById('profileForm');
  const saveProfileBtn = document.getElementById('saveProfileBtn');

  // 4. Загрузка данных пользователя из таблицы profiles
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Ошибка загрузки профиля:', error);
    orgInn.innerText = 'Ошибка';
    orgName.innerText = 'Ошибка';
  } else if (profile) {
    // Заполняем статичные поля организации (если они есть в БД)
    orgInn.innerText = profile.inn || 'Не указан';
    orgName.innerText = profile.company_name || 'Не указано';
    
    // Заполняем редактируемые поля
    profileNameInput.value = profile.full_name || '';
    profilePhoneInput.value = profile.phone || '';
    // Если email не сохранен в profiles, берем его из объекта авторизации
    profileEmailInput.value = profile.email || user.email || '';
  }

  // 5. Обработка сохранения формы
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Блокируем кнопку на время отправки
    saveProfileBtn.innerText = 'Сохранение...';
    saveProfileBtn.disabled = true;

    // Собираем новые данные
    const updates = {
      full_name: profileNameInput.value.trim(),
      phone: profilePhoneInput.value.trim(),
      email: profileEmailInput.value.trim()
    };

    // Отправляем в базу
    const { error: updateError } = await sb
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (updateError) {
      alert('Ошибка при сохранении: ' + updateError.message);
    } else {
      // Кратковременно меняем текст кнопки для визуального подтверждения
      saveProfileBtn.innerText = 'Успешно сохранено!';
      saveProfileBtn.style.backgroundColor = '#10b981'; // Зеленый цвет успеха
      
      setTimeout(() => {
        saveProfileBtn.innerText = 'Сохранить изменения';
        saveProfileBtn.style.backgroundColor = 'var(--color-primary)';
      }, 2000);
    }

    saveProfileBtn.disabled = false;
  });
});
