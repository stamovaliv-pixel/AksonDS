document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  
  const sb = window.supabaseClient;
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('togglePasswordVisibility');
  let passwordRevealTimer = null;

  const hidePassword = () => {
    if (!passwordInput || !passwordToggle) return;
    if (passwordRevealTimer) clearTimeout(passwordRevealTimer);
    passwordRevealTimer = null;
    passwordInput.type = 'password';
    passwordToggle.setAttribute('aria-pressed', 'false');
    passwordToggle.setAttribute('aria-label', 'Показать пароль на 3 секунды');
    passwordToggle.title = 'Показать пароль на 3 секунды';
    passwordToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  };

  if (passwordInput && passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      if (passwordInput.type === 'text') {
        hidePassword();
        return;
      }
      passwordInput.type = 'text';
      passwordToggle.setAttribute('aria-pressed', 'true');
      passwordToggle.setAttribute('aria-label', 'Скрыть пароль');
      passwordToggle.title = 'Скрыть пароль';
      passwordToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 5.2A11.7 11.7 0 0 1 12 5c6.4 0 10 7 10 7a15.7 15.7 0 0 1-3.1 3.8"></path><path d="M6.6 6.6C3.6 8.2 2 12 2 12s3.6 7 10 7a10.6 10.6 0 0 0 4.2-.9"></path></svg>';
      if (passwordRevealTimer) clearTimeout(passwordRevealTimer);
      passwordRevealTimer = setTimeout(hidePassword, 3000);
    });
    passwordInput.addEventListener('blur', hidePassword);
  }

  if (!sb) {
    console.warn("Supabase клиент не инициализирован. Проверьте js/supabase-client.js");
    return;
  }

  // Функция перенаправления на основе роли (Production вариант)
  const redirectBasedOnRole = async (userId) => {
    const { data, error } = await sb.from('profiles').select('role, is_blocked').eq('id', userId).single();
    
    // Если произошла ошибка БД (например, упал интернет или сбились политики)
    if (error) {
      console.error("Системная ошибка проверки профиля:", error.message);
      alert("Произошла ошибка при проверке прав доступа. Пожалуйста, обратитесь в поддержку.");
      await sb.auth.signOut(); // Принудительно разлогиниваем для безопасности
      window.location.href = '../index.html';
      return;
    }

    if (!data || data.is_blocked) {
      await sb.auth.signOut();
      alert(data?.is_blocked ? 'Доступ запрещен. Ваш аккаунт заблокирован администратором.' : 'Профиль не найден. Обратитесь в поддержку.');
      window.location.href = '../index.html';
      return;
    }

    // Если всё хорошо, направляем по ролям
    if (['operator', 'admin', 'viewer'].includes(data.role)) {
      window.location.href = 'app/admin_calendar.html';
    } else {
      window.location.href = 'app/calendar.html';
    }
  };

  // Проверка активной сессии (чтобы авторизованного пользователя сразу пускало в портал)
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await redirectBasedOnRole(session.user.id);
    return;
  }

  // Логика формы входа
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const btn = loginForm.querySelector('button[type="submit"]');
      
      btn.disabled = true; 
      btn.innerText = 'Вход...';
      
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert('Ошибка входа: ' + error.message);
        btn.disabled = false; 
        btn.innerText = 'Войти';
      } else {
        // Проверяем статус блокировки пользователя
        const { data: profile } = await sb.from('profiles').select('is_blocked').eq('id', data.user.id).single();
        
        if (profile && profile.is_blocked) {
          await sb.auth.signOut();
          alert('Доступ запрещен. Ваш аккаунт заблокирован администратором.');
          btn.disabled = false; 
          btn.innerText = 'Войти';
          return;
        }
        
        await redirectBasedOnRole(data.user.id);
      }
    });
  }

  // Логика формы регистрации
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

      // Передаем данные формы прямо в системную регистрацию в виде метаданных
      const { data: authData, error: authError } = await sb.auth.signUp({
        email: email, 
        password: password,
        options: {
          data: {
            inn: inn,
            company_name: company_name,
            full_name: full_name,
            phone: phone
          }
        }
      });

      if (authError) {
        alert('Ошибка регистрации: ' + authError.message);
        btn.disabled = false; 
        btn.innerText = 'Зарегистрироваться';
        return;
      }

      // Если системных ошибок нет, база данных САМА создаст профиль через триггер.
      // Нам остается только перенаправить пользователя внутрь системы.
      if (authData.user) {
        await redirectBasedOnRole(authData.user.id);
      }
    });
  }
});
