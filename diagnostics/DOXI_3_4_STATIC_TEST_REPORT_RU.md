# Doxi 3.4.0 — отчёт статической проверки

Дата сборки: 14.11.2026

## Пройдено

- TypeScript parser/transpile check: 0 синтаксических diagnostics.
- Frontend JavaScript parse check: OK.
- 14 HTML-страниц содержат cache-busting `3-4-cognitive-agent` для `ai-ds.js` и `ai-ds.css`.
- В Edge Function нет импорта `input-understanding.ts`; для Supabase Dashboard требуется только один файл `index.ts`.
- Сохранён импорт `npm:node-xlsx@0.25.0` для CSV/XLS/XLSX.
- Сохранены серверные обработчики карточек/commit бронирования, личной памяти, заметок, напоминаний и чтения данных DockSlot.
- Проверено, что поставщик ограничен собственными записями в read-only выборке.
- Brave key встречается только в коде Edge Function; в frontend bundle ключ не зашит.
- `web_search` требует фактическую роль `super_admin`; URL источников для UI принимаются только по HTTPS.
- Proxy allow-list содержит только `qwen3.5:9b`, работает loopback-only и принимает формат JSON для planner.

## Фокусные unit/helper-сценарии

Успешно проверены:

1. `s vtyz nfr gjybvftim&` → `ты меня так понимаешь?`.
2. Консервативная коррекция `пажалуйста`.
3. Сохранность ВзУ и UUID без изменения.
4. Planner JSON, фильтр инструментов до read-only allow-list.
5. Отбрасывание идентификаторов из `search_terms`.
6. Порог уверенности для уточняющего вопроса.
7. Блокировка ВзУ/email для Brave Search.
8. Разрешение обычной публичной поисковой фразы.
9. Нормализация источников Brave с отбрасыванием HTTP URL.
10. Включение планировщика для комплексного аналитического вопроса.
11. Разбор напоминания с отдельным текстом «с текстом …» и датой/временем.

Все локальные helper tests завершились PASS.

## Не проверено в этой среде

- Реальная сборка и публикация Edge Function в проекте Supabase пользователя.
- Запуск PowerShell proxy на Windows PowerShell 5.1 (в среде сборки нет Windows PowerShell).
- Фактический вызов Ollama через обновлённый proxy.
- Живой Brave API-вызов с пользовательским `BRAVE_SEARCH_API_KEY`.
- End-to-end сценарии под каждой ролью в production.

Успешная статическая проверка не заменяет публикацию и приёмочные испытания в реальном проекте.
