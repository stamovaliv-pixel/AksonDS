# Changelog — Doxi 3.4.1

## Think Fix + 2400 tokens

- Fixed the default Qwen3.5 hidden-thinking budget issue for everyday chat by explicitly disabling thinking on ordinary calls.
- Increased the normal visible answer budget to 2400 tokens.
- Kept internal thinking enabled for the primary draft in the explicit/identified deep-analysis path.
- Kept planner and verifier calls bounded and non-thinking to protect synchronous execution time.
- Added a distinct `EMPTY_MODEL_RESPONSE` error path in proxy and Edge Function.
- Updated the local proxy's allowed output ceiling to 2400 and retained strict boolean handling for the thinking flag.
