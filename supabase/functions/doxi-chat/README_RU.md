# Аудированный точечный фикс DOXI 3.5.4 — журнал обучения

## Почему возникла ошибка

`20261118_doxi_learning_loop.sql` намеренно выполняет `REVOKE ALL ... FROM anon, authenticated` и выдаёт CRUD только `service_role`. Журнал не добавляется в `doxi_table_permissions`; читать и управлять им можно только через специальные Super Admin действия Edge Function.

В загруженном `index.zip` 11 обращений к `doxi_learning_cases` использовали `userDataClient`, который передаёт пользовательский JWT. Для этой внутренней таблицы PostgreSQL закономерно возвращал `42501 permission denied`.

## Что изменено в index.ts

- Создан типизированный `learningJournalClient`, который принимает только имя таблицы `doxi_learning_cases` и маршрутизирует операции через существующий серверный `adminClient` (`service_role`).
- Все 11 чтений/записей журнала и автоматический capture переведены на этот узкий адаптер.
- Все UI-действия журнала остаются за существующей серверной проверкой `role === 'super_admin'`.
- Автоматическая запись кейса остаётся серверным действием для авторизованного пользователя; сохраняются `user_id` и `user_role`, текст предварительно очищается и ограничивается. Это не даёт пользователю читать журнал.
- `doxi_learning_cases` дополнительно исключена из универсального Data Engine (защита в трёх местах). Таблица не попадает в матрицу и не передаётся модели.
- `doxi_knowledge_documents` намеренно оставлена на `userDataClient` и под проверками пользовательской матрицы доступа.
- Остальные пользовательские таблицы, универсальный CRUD, auth, SQL, UI и бизнес-логика не менялись.
- `DOXI_RELEASE` сохранён: `3.5.4-favorite-bookings-priority`.

## Установка

Заменить текущий `supabase/functions/doxi-chat/index.ts` этим файлом и опубликовать Edge Function. SQL повторять не нужно, если миграция `20261118_doxi_learning_loop.sql` уже применена и проверки GRANT подтвердили права `service_role`.

## Статические проверки

- 11 операций с `doxi_learning_cases` идут через `learningJournalClient`.
- 0 обращений к `doxi_learning_cases` через `userDataClient` или напрямую через `adminClient`.
- Все 6 UI-действий журнала остаются под проверкой Super Admin.
- 8 обращений к `doxi_knowledge_documents` остаются на пользовательском JWT.
- `DOXI_RELEASE` не изменён.
- Выполнена проверка синтаксиса TypeScript; подключение к production Supabase из этой среды не выполнялось.
