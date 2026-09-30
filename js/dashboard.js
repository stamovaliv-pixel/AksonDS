document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });
  }

  const orgInn = document.getElementById('orgInn');
  const orgName = document.getElementById('orgName');
  
  const profileNameInput = document.getElementById('profileName');
  const profilePhoneInput = document.getElementById('profilePhone');
  const profileEmailInput = document.getElementById('profileEmail');

  let contactId = null;

  // 1. Загружаем реквизиты из profiles
  const { data: profile } = await sb
    .from('profiles')
    .select('inn, company_name')
    .eq('id', user.id)
    .single();

  if (profile) {
    orgInn.innerText = profile.inn || 'Не указан';
    orgName.innerText = profile.company_name || 'Не указано';
  }

  // 2. Загружаем контакты из contacts
  const { data: contact } = await sb
    .from('contacts')
    .select('id, full_name, phone')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (contact) {
    contactId = contact.id;
    profileNameInput.value = contact.full_name || '';
    profilePhoneInput.value = contact.phone || '';
  } else {
    profileNameInput.value = '';
    profilePhoneInput.value = '';
  }

  profileEmailInput.value = user.email || '';

  // 3. Логика посимвольного редактирования (кнопки карандаш и галочка)
  const editButtons = document.querySelectorAll('.edit-btn');

  editButtons.forEach(editBtn => {
    editBtn.addEventListener('click', (e) => {
      const targetId = editBtn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const row = editBtn.closest('.input-row');
      const saveBtn = row.querySelector('.save-btn');

      // Разблокируем поле и ставим фокус
      input.disabled = false;
      input.focus();

      // Скрываем карандаш, показываем галочку сохранения
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
    });
  });

  // Логика сохранения при клике на галочку
  const saveButtons = document.querySelectorAll('.save-btn');

  saveButtons.forEach(saveBtn => {
    saveBtn.addEventListener('click', async () => {
      const fieldName = saveBtn.getAttribute('data-field'); // full_name или phone
      const row = saveBtn.closest('.input-row');
      const input = row.querySelector('input');
      const editBtn = row.querySelector('.edit-btn');

      const newValue = input.value.trim();

      // Отправляем в базу
      const updatedData = {
        profile_id: user.id,
        [fieldName]: newValue,
        is_primary: true
      };

      let saveError = null;

      if (contactId) {
        const { error } = await sb
          .from('contacts')
          .update({ [fieldName]: newValue })
          .eq('id', contactId);
        saveError = error;
      } else {
        const { data: newContact, error } = await sb
          .from('contacts')
          .insert([updatedData])
          .select('id')
          .single();
        
        if (newContact) contactId = newContact.id;
        saveError = error;
      }

      if (saveError) {
        alert('Ошибка сохранения: ' + saveError.message);
      } else {
        // Блокируем поле обратно
        input.disabled = true;
        // Возвращаем карандаш, прячем галочку
        saveBtn.style.display = 'none';
        editBtn.style.display = 'inline-flex';
      }
    });
  });
});
