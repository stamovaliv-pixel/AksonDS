# Patch notes — Doxi Learning Loop v1.0

## Изменённые файлы

- `supabase/functions/doxi-chat/index.ts` — DOXI_RELEASE 3.4.11; детектор затруднений; безопасная запись журнала; Super Admin actions для dashboard/list/export/manual add/dismiss/import.
- `supabase/migrations/20261118_doxi_learning_loop.sql` — новая таблица журнала с RLS и доступом только service_role.
- `app/ai_ds_management.html` — панель «Опыт и обучение», сворачиваемые разделы, cache-buster.
- `js/ai-ds-management.js` — статистика, прогресс, CSV export, JSON template, manual case, import, list/dismiss.
- `css/ai-ds-management.css` — стили accordion и learning dashboard.

## Не изменялось

- `js/ai-ds.js` и интерфейс чата;
- логика supplier arrival v3.4.10;
- аналитика бронирований и верификации;
- таблицы `bookings`, `profiles`, `booking_verification`;
- права DockSlot, настройки уведомлений, Proxy, Ollama и модель;
- логотипы, таймеры Dx 115 сек / DS 5 сек.

## Важные детали

- Learning table не добавляется в `doxi_table_permissions`; она не доступна модели через generic table tool.
- Для импорта знаний используется только существующее право `can_insert` таблицы `doxi_knowledge_documents`; обновление существующих материалов через import не выполняется.
- Повторная загрузка идентичного решения идемпотентна по source_name `doxi-learning:<case_id>`.
