document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  
  const sb = window.supabaseClient;
  if (!sb) {
    console.warn("Supabase клиент не инициализирован. Проверьте js/supabase-client.js");
    return;
  }

  // 1. Проверка активной сессии (чтобы уже авторизованного пользователя сразу пускало в календарь)
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    window.location.href = 'app/calendar.html';
    return;
  }

  // 2. Логика формы входа
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const btn = loginForm.querySelector('button[type="submit"]');
      
      // Визуальный отклик и блокировка от двойного клика
      btn.disabled = true;
      btn.innerText = 'Вход...';
      
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert('Ошибка входа: ' + error.message);
        btn.disabled = false;
        btn.innerText = 'Войти';
      } else {
        window.location.href = 'app/calendar.html';
      }
    });
  }

  // 3. Логика формы регистрации
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const password = document.getElementById('password').value;
      const password_repeat = document.getElementById('password_repeat').value;
      
      if (password !== password_repeat) {
        alert('Пароли не совпадают! Пожалуйста, проверьте ввод.');
        return;
      }
      
      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerText = 'Регистрация...';
      
      const email = document.getElementById('email').value;
      const inn = document.getElementById('inn').value;
      const company_name = document.getElementById('company_name').value;
      const full_name = document.getElementById('full_name').value;
      const phone = document.getElementById('phone').value;

      const { data: authData, error: authError } = await sb.auth.signUp({
        email, password
      });

      if (authError) {
        alert('Ошибка регистрации: ' + authError.message);
        btn.disabled = false;
        btn.innerText = 'Зарегистрироваться';
        return;
      }

      if (authData.user) {
        const userId = authData.user.id;
        
        // Создаем запись в profiles
        const { error: profileError } = await sb.from('profiles').insert([
          { id: userId, inn: inn, company_name: company_name, role: 'supplier' }
        ]);

        if (profileError) {
          alert('Профиль создан с ошибкой: ' + profileError.message);
          btn.disabled = false;
          btn.innerText = 'Зарегистрироваться';
        } else {
          // Создаем запись в contacts
          await sb.from('contacts').insert([
            { profile_id: userId, full_name: full_name, phone: phone, is_primary: true }
          ]);
          
          // Сразу перекидываем в календарь, так как Supabase авторизует пользователя после signUp
          window.location.href = 'app/calendar.html';
        }
      }
    });
  }
});
