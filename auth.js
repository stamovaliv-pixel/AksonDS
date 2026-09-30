document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const logoutBtn = document.getElementById('logoutBtn');
  const sb = window.supabaseClient;

  // Логика ВХОДА
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert('Ошибка входа: ' + error.message);
      } else {
        window.location.href = 'app/dashboard.html';
      }
    });
  }

  // Логика РЕГИСТРАЦИИ
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Сбор данных формы
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const inn = document.getElementById('inn').value;
      const company_name = document.getElementById('company_name').value;
      const full_name = document.getElementById('full_name').value;
      const phone = document.getElementById('phone').value;

      // 1. Регистрация пользователя в Supabase Auth
      const { data: authData, error: authError } = await sb.auth.signUp({
        email, password
      });

      if (authError) {
        alert('Ошибка регистрации: ' + authError.message);
        return;
      }

      // 2. Создание профиля и контактов (в реальном проекте лучше делать через Trigger на сервере, но можно и здесь)
      if (authData.user) {
        const userId = authData.user.id;
        
        const { error: profileError } = await sb.from('profiles').insert([
          { id: userId, inn: inn, company_name: company_name, role: 'supplier' }
        ]);

        if (profileError) {
          alert('Профиль создан с ошибкой: ' + profileError.message);
        } else {
          await sb.from('contacts').insert([
            { profile_id: userId, full_name: full_name, phone: phone, is_primary: true }
          ]);
          alert('Регистрация успешна! Теперь вы можете войти.');
          window.location.href = 'index.html';
        }
      }
    });
  }

  // Логика ВЫХОДА
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });
  }
});
