// Этот скрипт проверяет права пользователя и блокирует запрещенные действия для Наблюдателя
document.addEventListener("DOMContentLoaded", async () => {
    // Получаем текущего пользователя из Supabase
    const { data: { user } } = await supabase.auth.getUser();

    if (user && user.user_metadata?.role === 'observer') {
        
        // 1. Блокируем доступ к странице Настроек и Поставщиков
        const restrictedPages = ['settings.html', 'suppliers.html'];
        const currentPage = window.location.pathname.split('/').pop();
        
        if (restrictedPages.includes(currentPage)) {
            alert("У вас нет прав для просмотра этой страницы.");
            window.location.href = "calendar.html"; // Перенаправляем на календарь
        }

        // 2. Скрываем пункты меню (Настройки и Поставщики) в сайдбаре/навигации
        const settingsMenuLink = document.querySelector('a[href*="settings.html"]');
        const suppliersMenuLink = document.querySelector('a[href*="suppliers.html"]');
        
        if (settingsMenuLink) settingsMenuLink.style.display = 'none';
        if (suppliersMenuLink) suppliersMenuLink.style.display = 'none';

        // 3. Убираем права на редактирование, удаление и добавление слотов
        // Находим все кнопки с классами или атрибутами сохранения/удаления и удаляем их из DOM
        const actionButtons = document.querySelectorAll('.btn-add-slot, .btn-edit, .btn-delete, .save-btn');
        actionButtons.forEach(btn => btn.remove());

        // 4. Делаем все формы ввода на странице календаря/дня только для чтения
        const inputFields = document.querySelectorAll('input, textarea, select');
        inputFields.forEach(input => {
            input.setAttribute('readonly', true);
            input.setAttribute('disabled', true);
        });
    }
});