document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const sb = window.supabaseClient;
  
  if (!sb) return;

  // Функция перенаправления на основе роли
  const redirectBasedOnRole = async (userId) => {
    const { data } = await sb.from('profiles').select('role').eq('id', userId).single();
    if (data && (data.role === 'operator' || data.role === 'admin')) {
      window.location.href = 'app/admin_calendar.html';
    } else {
      window.location.href = 'app/calendar.html';
    }
  };

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await redirectBasedOnRole(session.user.id);
    return;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const btn = loginForm.querySelector('button[type="submit"]');
      
      btn.disabled = true; btn.innerText = 'Вход...';
      
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      
      if (error) {
        alert('Ошибка входа: ' + error.message);
        btn.disabled = false; btn.innerText = 'Войти';
      } else {
        await redirectBasedOnRole(data.user.id);
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      if (password !== document.getElementById('password_repeat').value) return alert('Пароли не совпадают!');
      
      const btn = registerForm.querySelector('button[type="submit"]');
      btn.disabled = true; btn.innerText = 'Регистрация...';
      
      const { data: authData, error: authError } = await sb.auth.signUp({
        email: document.getElementById('email').value, password
      });

      if (authError) {
        alert('Ошибка: ' + authError.message);
        btn.disabled = false; btn.innerText = 'Зарегистрироваться';
        return;
      }

      if (authData.user) {
        await sb.from('profiles').insert([{ 
          id: authData.user.id, inn: document.getElementById('inn').value, 
          company_name: document.getElementById('company_name').value, role: 'supplier' 
        }]);
        await sb.from('contacts').insert([{ 
          profile_id: authData.user.id, full_name: document.getElementById('full_name').value, 
          phone: document.getElementById('phone').value, is_primary: true 
        }]);
        await redirectBasedOnRole(authData.user.id);
      }
    });
  }
});
