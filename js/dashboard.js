document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("Supabase клиент не найден!");
    return;
  }

  // 1. Проверяем, авторизован ли пользователь
  const { data: { user }, error: authError } = await sb.auth.getUser();
  
  if (authError || !user) {
    // Если пользователь не вошел в систему, отправляем его на страницу входа
    window.location.href = '../index.html';
    return;
  }

  // 2. Запрашиваем профиль пользователя из таблицы profiles
  const { data: profileData, error: profileError } = await sb
    .from('profiles')
    .select('inn, company_name')
    .eq('id', user.id)
    .single();

  // 3. Выводим данные на экран
  const innElement = document.getElementById('orgInn');
  const nameElement = document.getElementById('orgName');

  if (profileError) {
    console.error("Ошибка загрузки профиля:", profileError);
    innElement.innerText = "Ошибка загрузки данных";
    nameElement.innerText = "Ошибка загрузки данных";
  } else if (profileData) {
    innElement.innerText = profileData.inn;
    nameElement.innerText = profileData.company_name;
  }

  // 4. Логика кнопки "Выйти"
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut(); // Разлогиниваемся в Supabase
      window.location.href = '../index.html'; // Возвращаемся на главную
    });
  }
});
