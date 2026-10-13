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

  const pageTitle = document.querySelector('.page-title');
  const profileNameInput = document.getElementById('profileName');
  const profilePhoneInput = document.getElementById('profilePhone');
  const profileEmailInput = document.getElementById('profileEmail');

  let contactId = null;

  // 1. Загружаем реквизиты из profiles (с безопасной обработкой ошибок)
  try {
    const { data: profile, error: profileErr } = await sb
      .from('profiles')
      .select('inn, company_name')
      .eq('id', user.id)
      .maybeSingle(); // maybeSingle не вызывает краш скрипта при отсутствии данных

    if (profile && pageTitle) {
      const inn = profile.inn || 'Не указан';
      const name = profile.company_name || 'Не указано';
      pageTitle.innerText = `Личный кабинет: ${name} (ИНН: ${inn})`;
    } else if (pageTitle) {
      pageTitle.innerText = `Личный кабинет`;
    }
  } catch (err) {
    console.error('Ошибка загрузки профиля:', err);
    if (pageTitle) pageTitle.innerText = `Личный кабинет`;
  }

  // 2. Загружаем контакты из contacts
  try {
    const { data: contact, error: contactErr } = await sb
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
  } catch (err) {
    console.error('Ошибка загрузки контактов:', err);
    profileNameInput.value = '';
    profilePhoneInput.value = '';
  }

  // Устанавливаем email авторизованного пользователя
  if (profileEmailInput) {
    profileEmailInput.value = user.email || '';
  }

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
      const fieldName = saveBtn.getAttribute('data-field');
      const row = saveBtn.closest('.input-row');
      const input = row.querySelector('input');
      const editBtn = row.querySelector('.edit-btn');

      const newValue = input.value.trim();
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

  // 4. Логика расчета рейтинга и гистограммы за последние 30 дней
  const calculateRating = async () => {
    try {
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const dateStr = thirtyDaysAgo.toISOString().split('T')[0];

      const { data: bookings, error } = await sb
        .from('bookings')
        .select('status, is_late') 
        .eq('profile_id', user.id)
        .gte('slot_date', dateStr);

      if (error) throw error;

      let total = 0;
      let late = 0;
      let noshow = 0;

      if (bookings) {
        total = bookings.length;
        bookings.forEach(b => {
          if (b.status === 'noshow' || b.status === 'срыв') {
            noshow++;
          } else if (b.status === 'late' || b.status === 'опоздание' || b.is_late === true) {
            late++;
          }
        });
      }

      let rating = 5.0;
      if (total > 0) {
        const penaltyWeight = (noshow * (2/3)) + (late * (1/3));
        rating = 5.0 * (1 - (penaltyWeight / total));
      }
      
      rating = Math.max(0.1, Math.min(5.0, rating));
      const finalRating = (Math.round(rating * 10) / 10).toFixed(1);

      const ratingEl = document.getElementById('ratingNum');
      if (ratingEl) ratingEl.innerText = finalRating;

      const totalVal = document.getElementById('histTotalVal');
      const lateVal = document.getElementById('histLateVal');
      const noshowVal = document.getElementById('histNoshowVal');
      
      if (totalVal) totalVal.innerText = total;
      if (lateVal) lateVal.innerText = late;
      if (noshowVal) noshowVal.innerText = noshow;

      if (total > 0) {
        const totalBar = document.getElementById('histTotalBar');
        const lateBar = document.getElementById('histLateBar');
        const noshowBar = document.getElementById('histNoshowBar');
        
        if (totalBar) totalBar.style.height = '100%';
        if (lateBar) lateBar.style.height = `${(late / total) * 100}%`;
        if (noshowBar) noshowBar.style.height = `${(noshow / total) * 100}%`;
      }
    } catch (err) {
      console.error('Ошибка загрузки рейтинга:', err);
    }
  };

  await calculateRating();

  // 5. Логика копирования адреса и координат в буфер обмена
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-copy');
      const textElement = document.getElementById(targetId);
      if (textElement) {
        const textToCopy = textElement.innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalHTML = btn.innerHTML;
          btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => {
            btn.innerHTML = originalHTML;
          }, 2000);
        }).catch(err => {
          console.error('Ошибка копирования:', err);
        });
      }
    });
  });
});
