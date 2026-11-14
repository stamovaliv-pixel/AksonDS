# Статический отчёт проверки Doxi 3.4.1

- TypeScript `transpileModule`: 0 syntax diagnostics.
- Версия Edge Function: `3.4.1`.
- Обычный лимит: `MAX_OUTPUT_TOKENS = 2400`.
- Обычный вызов: `think=false` по умолчанию.
- Глубокий основной черновик: `think=true`, 640 токенов, timeout 95 секунд.
- Планировщик: `think=false`, 180 токенов.
- Проверка глубокого ответа: `think=false`, 260 токенов.
- Proxy max output: 2400; forwarded `think` accepts boolean only.
- Proxy recognizes empty Ollama visible text and emits HTTP 502 code `EMPTY_MODEL_RESPONSE`.
- Edge Function maps this code to its own explicit HTTP 502 diagnostic response.
- Listener remains `127.0.0.1:8787`; shared-secret check retained; model allow-list remains `qwen3.5:9b`.

Ограничение проверки: Windows PowerShell 5.1, Ollama, Cloudflare Tunnel и Supabase в этой среде не запускались. Публикация и production-тестирование не выполнялись.
