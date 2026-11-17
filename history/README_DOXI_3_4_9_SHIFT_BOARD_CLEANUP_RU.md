# DOXI 3.4.9 — очистка остаточных ссылок на «Доску смены»

## Что меняется

1. В `supabase/functions/doxi-chat/index.ts` удалена запись `shift_board_settings` из каталога таблиц Докси.
2. Из распознавания запросов Докси удалено специальное сопоставление «доска смены» → `shift_board_settings`.
3. `DOXI_RELEASE` обновлён до `3.4.9`.
4. Добавлена миграция `supabase/migrations/20261117_doxi_remove_shift_board_settings.sql`: она удаляет только строку `shift_board_settings` из `doxi_table_permissions` и исключает имя из CHECK-ограничения матрицы.
5. Добавлен read-only аудит зависимостей таблицы `public.shift_board_settings`.

Edge Function основана на последнем подготовленном `doxi-chat-index-v3.4.8.ts`, поэтому сохраняет исправления аналитики прибытия и подсчёта верификации. Она не откатывается к старому index.ts v3.4.4 из базового архива.

## Что не меняется

- Таблица `public.shift_board_settings` пока НЕ удаляется.
- Не меняются `bookings`, `arrival_time`, `departure_time`, `gate_number`, их RLS, триггеры и SQL-функции.
- Не меняются `admin_day.html`, `day.html`, календарь и штатные процессы склада.
- Не выполняется `DROP ... CASCADE`.
- Историческая миграция `20261116_doxi_table_access_matrix.sql` не переписывается. Для отката истории и воспроизводимости она остаётся неизменной; очистка оформлена отдельной новой миграцией.
- Сохранены redirect-страница старой доски и автоматическая отправка стартовых вопросов Докси.

## Порядок установки

1. Сделайте резервную копию проекта и текущей Edge Function.
2. В Supabase → Edge Functions → `doxi-chat` замените `index.ts` файлом из архива и выполните Deploy. `Verify JWT` оставьте включённым.
3. В Supabase → SQL Editor выполните миграцию `20261117_doxi_remove_shift_board_settings.sql`.
4. Проверьте, что запрос ниже возвращает 0 строк:

   ```sql
   select * from public.doxi_table_permissions
   where table_name = 'shift_board_settings';
   ```

5. В матрице доступа Докси убедитесь, что список стал на одну таблицу короче (24 записи вместо 25).

## Проверка перед удалением самой таблицы

Выполните каждый SELECT из `diagnostics/READ_ONLY_audit_shift_board_settings_dependencies.sql`. Сначала проверьте количество строк, затем внешние ключи, представления, функции, триггеры и RLS-политики.

Таблицу `public.shift_board_settings` пока оставьте. Удалять её можно только после проверки результатов аудита и резервного сохранения содержимого. Если все зависимости отсутствуют и данные больше не нужны, используйте только `DROP TABLE public.shift_board_settings RESTRICT` — без `CASCADE`. Если PostgreSQL обнаружит зависимость, команда безопасно завершится ошибкой и покажет, что мешает удалению.

## Проверки этой сборки

- TypeScript transpile/syntax check: PASS.
- Поиск `shift_board_settings` в актуальной Edge Function: 0 совпадений.
- В исходном проекте старое имя остаётся только в исторической миграции и в документации/аудите как историческая либо диагностическая ссылка.
- Живой Deploy, SQL-миграция и чтение production Supabase отсюда не выполнялись.
