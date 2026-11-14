# Patch notes — Doxi 3.4.1

- Ordinary dialogue: `think=false`, max output `num_predict=2400`.
- Standard upstream timeout: 110 seconds.
- Deep primary draft: `think=true`, `num_predict=640`, timeout 95 seconds.
- Planner and independent verification pass keep `think=false` with their bounded token budgets.
- Proxy forwards only a strict boolean `think` flag and raises its output ceiling to 2400.
- Empty Ollama visible responses no longer become HTTP 200 with an empty string; proxy emits `EMPTY_MODEL_RESPONSE` as HTTP 502 and Edge Function returns a distinct diagnostic message/code.
- Model, context 8192, 8 HTTP workers, cap 24, loopback binding and shared-secret check are preserved.
- No frontend, SQL, RLS, or role changes.
