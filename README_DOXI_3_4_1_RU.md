# DOXI 3.4.1 — Think Fix + 2400 tokens

## Назначение

Исправляет пустые ответы `qwen3.5:9b`, возникавшие, когда внутреннее рассуждение модели расходовало лимит генерации и не оставляло места для видимого ответа. Увеличивает максимальный размер обычного ответа до 2400 токенов, сохраняя отдельный режим глубокого анализа.

Диагностика на компьютере пользователя подтвердила:
- прямой запрос к Ollama с `think:false` вернул непустой ответ за 7 выходных токенов;
- запрос через прежний прокси мог завершаться пустым `response` после примерно 79,8 секунды;
- новый публичный Quick Tunnel прошёл `/health`: `ok=true`, `base_model=true`;
- Ollama и локальный прокси по отдельности возвращали непустой ответ.

## Принятые настройки

| Режим | Thinking | Лимит `num_predict` | Тайм-аут вызова модели |
|---|---:|---:|---:|
| Обычный диалог | `false` | **2400** | 110 секунд |
| Внутренний планировщик | `false` | 180 | 10 секунд |
| Глубокий анализ — основной черновик | `true` | 640 | 95 секунд |
| Проверка ответа в глубоком режиме | `false` | 260 | 12 секунд |
| Резюме диалога | `false` | 500 | 55 секунд |

`2400` — максимальный бюджет обычного ответа, а не требование выдавать ровно 2400 токенов. Модель может завершить ответ раньше.

В глубоком режиме внутреннее рассуждение включается только для основного черновика. Отдельный планировщик и проверочный проход оставлены с `think:false`, чтобы не расходовать их небольшие бюджеты на скрытый thinking. Глубокий путь сохраняет планирование, сбор контекста, рассуждение основного прохода и независимую проверку черновика.

## Что изменено

### Supabase Edge Function `doxi-chat/index.ts`
- Обычные вызовы передают `think:false`.
- Основной вызов глубокого режима передаёт `think:true`.
- Максимум обычного ответа увеличен с 512 до 2400 токенов.
- Обычный upstream timeout увеличен до 110 секунд; глубокий основной проход — до 95 секунд.
- Пустой ответ обрабатывается отдельно: Edge Function возвращает HTTP 502 с кодом `EMPTY_MODEL_RESPONSE` и понятным сообщением вместо общей ошибки подключения.
- При HTTP-ошибке прокси Edge Function читает безопасный JSON-код ответа, не раскрывая секреты.

### Локальный прокси `ollama-proxy-6workers-v34.1.ps1`
- Максимальный разрешённый `num_predict` — 2400.
- По умолчанию прокси выставляет `think:false`.
- Прокси принимает только булево поле `think`; никакие произвольные параметры Ollama не пересылаются.
- Только Edge Function может по штатному маршруту запросить `think:true` для глубокого черновика.
- Пустой ответ Ollama возвращается как HTTP 502 с кодом `EMPTY_MODEL_RESPONSE`, а не как ложный HTTP 200 с пустым текстом.

## Что не меняется

- Модель: `qwen3.5:9b`.
- Контекст: 8192 токена.
- 8 HTTP workers; accepted in-flight cap 24.
- Ollama timeout на стороне прокси: 600 секунд.
- Listener остаётся только на `127.0.0.1:8787`.
- Проверка `X-Akson-Secret` и файл `C:\cloudflared\secret.txt` сохраняются.
- Cloudflare Tunnel продолжает направлять трафик на `http://127.0.0.1:8787`.
- Frontend, SQL, роли, RLS и таблицы не меняются.
- В Supabase не нужно менять `DOXI_TUNNEL_URL` или `DOXI_PROXY_SECRET`, если текущие значения уже проверены.

## Порядок установки

### 1. Резервные копии

Сохраните текущие файлы:
- локальный proxy `.ps1`;
- текущий `index.ts` функции `doxi-chat`.

### 2. Обновить локальный proxy — сначала

Скопируйте файл из `ollama/ollama-proxy-6workers-v34.1.ps1` в:

`C:\cloudflared\ollama-proxy-6workers-v34.1.ps1`

Остановите только текущий Trace-процесс, если он ещё работает. Откройте новое окно PowerShell и выполните:

```powershell
$old = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and
    $_.CommandLine -match 'ollama-proxy-6workers-v34-trace\.ps1'
})
if ($old.Count -eq 1) {
    Stop-Process -Id $old[0].ProcessId -Force
    Start-Sleep -Seconds 2
    Write-Host 'Trace proxy stopped.' -ForegroundColor Green
} elseif ($old.Count -eq 0) {
    Write-Host 'Trace proxy process not found; nothing stopped.' -ForegroundColor Yellow
} else {
    Write-Host "Found $($old.Count) matching processes; stopping none." -ForegroundColor Red
}
```

Не останавливайте PID 4/System, `ollama.exe` или `cloudflared.exe`.

Запустите новый proxy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\cloudflared\ollama-proxy-6workers-v34.1.ps1"
```

Ожидаемый баннер содержит:

`Think: disabled by default (deep draft may enable) | Context: 8192 | Output limit: 2400`

Оставьте окно открытым. Cloudflare Tunnel не перезапускайте: он уже направлен на порт 8787.

### 3. Проверить локальный и публичный health

Локальная проверка:

```powershell
$secret = (Get-Content -LiteralPath "C:\cloudflared\secret.txt" -Raw).Trim()
Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get -Headers @{ "X-Akson-Secret" = $secret } | Format-List *
$secret = $null
```

Затем проверьте существующий публичный адрес Quick Tunnel в браузере/PowerShell через `/health`. Не используйте старый адрес, если Quick Tunnel был создан заново.

### 4. Обновить Supabase Edge Function

1. Supabase → Edge Functions → `doxi-chat` → Code.
2. Сохраните резервную копию текущего `index.ts`.
3. Полностью замените содержимое только `index.ts` файлом из `supabase/functions/doxi-chat/index.ts`.
4. Не добавляйте отдельные `.ts` модули.
5. Нажмите Deploy updates. Verify JWT оставьте включённым.

Secrets повторно менять не нужно, если `DOXI_TUNNEL_URL` уже содержит проверенный актуальный URL Quick Tunnel, а `DOXI_PROXY_SECRET` совпадает с `C:\cloudflared\secret.txt`.

### 5. Приёмочные тесты

1. Настройки Докси → тест соединения: ожидается успешное подключение.
2. Обычный короткий диалог: `Ты меня понимаешь?` — ответ без долгого thinking.
3. Обычный развёрнутый запрос: `Расскажи, что ты умеешь.` — должен прийти связный развёрнутый ответ.
4. Следующее сообщение в том же диалоге: `Что ещё ты умеешь?` — проверка продолжения контекста.
5. Глубокий запрос с префиксом `/глубоко` — проверка отдельного thinking-прохода и проверки черновика.
6. Для роли `super_admin` в payload ответа проверить `doxi_version: "3.4.1"`; глубокий запрос должен иметь `deep_reasoning: true`.

Если модель всё же вернёт пустой видимый ответ, функция должна вернуть код `EMPTY_MODEL_RESPONSE` с отдельным сообщением, а не маскировать его под ошибку сети.

## Откат

- Вернуть резервную копию `index.ts` в Supabase и повторно Deploy.
- Вернуть сохранённый предыдущий proxy `.ps1` и запустить его.
- Не менять Cloudflare Tunnel, пока его адрес и маршрут остаются рабочими.

## Границы проверки

В пакете выполнена статическая проверка TypeScript transpile: 0 синтаксических diagnostics. Проверены ожидаемые флаги и лимиты в обоих файлах, а архив проверяется на целостность. Среда сборки не содержит Windows PowerShell 5.1 и не имеет доступа к твоей Ollama/Supabase, поэтому реальный запуск proxy на Windows, публикация Edge Function и production acceptance tests должны быть выполнены на твоём компьютере.
