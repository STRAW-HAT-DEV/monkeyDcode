# monkeyDcode — Known Problems

Documented honestly. These need to be fixed before monkeyDcode can be considered working.

---

## ~~1. `applyChange` is naive~~ ✅ FIXED

**Fixed in:** `packages/agent/src/build-agent.ts`

Now extracts ALL code blocks, matches each to the right target file via 3-pass matching
(exact filename → partial path → language extension), writes to every target file,
and prompts the LLM to use ` ```lang:filepath ` format.

---

## ~~2. Sampler verifies original files, not modified ones~~ ✅ FIXED

**Fixed in:** `packages/consistency/src/sampler.ts`

`verifyCandidate` now: saves original file contents → writes generated code to actual
project files → runs full pipeline (real tsc/lint/tests context) → always restores
originals in `finally`. Verification runs sequentially to avoid concurrent file conflicts.

---

## 3. Sub-agents have never run against real code

**Files:** `packages/agent/src/sub-agents/bugfix.ts`, `feature.ts`, `refactor.ts`, `debug.ts`

Zoro, Nami, Usopp, Sanji, Robin — all solid architecture, zero battle testing. Unknown failure modes.

---

## ~~4. Python bridge is half-connected~~ ✅ FIXED

**Files:** `packages/python-bridge/src/bridge.ts`, `packages/context/src/signature-index.ts`

The bridge spawns the Python server and connects via Unix socket — but:
- tree-sitter signature extraction flows through the bridge but has never been tested end-to-end
- Knowledge graph neighbors (`knowledgeGraph.neighbors`) is a call to a Python handler that may or may not be registered in `bridge_server.py`
- Vector store indexing and search depends on the bridge being alive, which is not guaranteed

Until the bridge is fully tested, context retrieval (Chopper) returns empty or fails silently.

---

## ~~5. `parseStepsFromResponse` is a stub~~ ✅ FIXED

**Fixed in:** `packages/agent/src/plan-agent.ts`

Now tries 5 strategies in order: json fence → any fence with JSON → bare array → whole text →
numbered list → fallback single step. Normalizes alternative field names (action/files/type).
Never silently returns empty. Tested and confirmed all 5 strategies work.

---

## ~~6. `loadPrompt` is not implemented~~ ✅ FIXED

**Fixed in:** `packages/agent/src/plan-agent.ts` + `src/prompts/`

`loadPrompt` now resolves from `import.meta.url` (works regardless of how agent is invoked).
Created all 6 level prompts (plan-level-1.txt through plan-level-6.txt).
Level-6 is maximally explicit (for weak models), level-1 gives freedom (for strong models).
Falls back gracefully toward level-6 if a specific level file is missing.

---

## Priority order to fix

1. Fix `applyChange` — this is the most critical path, nothing works without it
2. Fix sampler — apply the change to temp files, THEN verify, THEN grade
3. Test Python bridge end-to-end with a real project
4. Battle test sub-agents on a real codebase
5. Harden `parseStepsFromResponse` with proper JSON parsing + fallback
