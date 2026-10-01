# STATE.md — what monkeyDcode actually does today

Truth pass, 2026-09-18. Every claim in `README.md` and `INSTALLATION.md` checked
against the code and, wherever possible, against a live run.

**Verdicts**

| Mark | Meaning |
| --- | --- |
| **works** | Reachable from the real CLI with default config, and it does what the docs say. |
| **partly** | Exists and runs, but is scoped down, off by default, or has a defect a real user will hit. |
| **broken** | Exists but a user relying on it gets a wrong result or a failure. |
| **absent** | The docs describe it; nothing implements it. |

**Test environment.** macOS 26.6 (Apple M5 Pro, 24 GB), Bun 1.4.2, Ollama 0.34.2
with `qwen2.5-coder:7b`, Docker (Debian bookworm-slim) for the clean-box install.
Clean clone of `main` at `d4c200c`.

**Baseline health.** `bun install` clean in 2.4 s. `bun run typecheck` passes in
all 14 packages. `bun test packages` is **193 pass / 7 fail**. `bun run lint` and
`bun run build` both fail. There is no CI.

---

## 1. The thesis (README "How it actually works")

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 1.1 | Detect model capability tier (1 frontier … 6 small local) | partly | Exact-match table of ~20 model ids in `model-capability/registry.ts:3`. `qwen2.5-coder:7b` resolves to 6 correctly. Any model **not** in that table falls to a live probe that never runs its own tests, so an unknown model lands at level 1 or level 6 and nothing in between. |
| 1.2 | Plan at the right granularity — atomic steps for weak models | partly | Six real prompt files, level selected by tier. But `enforceLevelConstraints` (`plan-agent.ts:238`) slices the plan to `MAX_DEPTH` steps (6 at level 6) with no warning, so a 7B that emits 9 atomic steps silently loses the last three and the run still reports "Done". |
| 1.3 | Sample N candidates per step at different temperatures | **works** | `sampler.ts:50` — level 5/6 gets `[0.3, 0.4, 0.5, 0.6]`, level 3/4 gets two, level 1/2 gets **one** (so frontier models get no sampling at all). Confirmed live: telemetry from my run records four candidates per step. |
| 1.4 | Verify every candidate with real tools: syntax → typecheck → lint → tests → asset resolution → browser render | partly | Only `syntax, typecheck, lint, tests` are on by default, and **`assets` and `browser` cannot be turned on at all** — `load-config.ts:6` filters them out of user config before the pipeline sees them. The four default stages do run real tools. See §6 for how often they pass vacuously. |
| 1.5 | Targeted repair with the exact error, not a blind resample | partly | The loop is real (`sampler.ts:133`). The error text often isn't: a `bun test` failure parses to **zero** errors (`test-existing.ts:160`), so the repair prompt gets an empty list and the model is asked to fix nothing in particular. |
| 1.6 | Escalate just the stuck step to a stronger model, then drop back to local | partly | Correctly implemented and per-step (`sampler.ts:196`), but off by default and only reached after the local model burns 4 temps × 3 attempts × 4 rounds = 48 generations. |
| 1.7 | Patch applied via hashline — detects and rejects a stale patch instead of silently corrupting the file | **broken** | Stale-*tag* rejection works. "Never silently applied wrong" does not — see §2. |
| 1.8 | 3-round actor-critic review, then done | partly | Real three-round Actor → Critic → Consensus (`review-agent.ts:88`). Skipped entirely when the task only creates new files, when the directory isn't a git repo, or when the repo has no commit — which includes **every benchmark run**. |

---

## 2. Hashline — the headline differentiator

This is the claim the project is sold on, so it gets its own section. I ran an
adversarial suite against it.

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 2.1 | A stale patch is detected and rejected | **works** | Tag mismatch is caught in `apply.ts:66` and returns `stale: true` with a re-read hint. This part is solid. |
| 2.2 | Per-line fingerprints detect drift inside a file | **broken** | `build-agent.ts:475` re-records the snapshot from live disk immediately before applying, so the fingerprints being compared are always the ones just taken from the current file. They can never mismatch. The mechanism is dead code in the CLI. |
| 2.3 | …never silently applied wrong | **broken** | Confirmed silent-corruption paths: body escaping is inverted, so a line starting with `+` or `-` loses its first character (`parse.ts:13`); unknown op headers are skipped, yielding `ok: true` partial applies (`parse.ts:174`); overlapping ops discard the inner edit (`apply.ts:25`); a section whose path doesn't match falls back to `targetFiles[0]` (`apply.ts:140`); CRLF and BOM are rewritten on every patch, turning a one-line edit into a whole-file diff (`apply.ts:135`). |
| 2.4 | The winner is verified, then applied via hashline | **broken** | **`packages/consistency/src/sampler.ts` contains no reference to hashline or `applyPatch`.** I verified this directly: the sampler's verification step writes the raw patch DSL text into the target file as if it were source code. Every hashline candidate therefore fails verification, scores 0, and is then applied *unverified* by the build agent. For hashline edits, the verify-then-apply thesis does not hold at all. |
| 2.5 | Weak models get full-file rewrites; strong models get surgical patches | partly | True as coded (`build-agent.ts:282`), but it means the 7B the README targets **never uses hashline** for files under 150 lines. Above ~12 KB the file is shown truncated while the tag is computed from the truncated text (`build-agent.ts:268`), so those patches are always rejected as stale. Hashline is effectively reachable only in the 150-line-to-12 KB band, where it is applied unverified per 2.4. |

Adversarial suite left at `packages/hashline/test/adversarial.test.ts` (new, untracked):
**49 cases, 25 pass, 24 fail.** Each failure is one of the defects above. It is not
part of `bun test packages` yet — I am leaving it out of the counted suite until
Phase 2 fixes the behaviour it documents, rather than committing 24 known-red tests.

---

## 3. Install

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 3.1 | macOS/Linux: `curl … install.sh \| bash` gives a working `mdc` | **works** | Verified twice: clean `debian:bookworm-slim` container (mdc linked to `/usr/local/bin`, `mdc version` and `mdc doctor` both fine) and on this Mac (linked to `~/.local/bin`). |
| 3.2 | …reliably, on any machine | partly | `install.sh:2` sets `set -euo pipefail` and `:51` runs the Python bridge unguarded, **before** the `mdc` symlinks are created at `:56`. Any failure in the optional bridge — and it installs `uv` plus a torch-sized dependency set needing Python ≥ 3.14 — aborts the installer and leaves the user with no `mdc` at all. It also runs `curl … astral.sh/uv/install.sh \| sh` and a 918 MB `uv sync` with no prompt. |
| 3.3 | Windows: clone + `.\scripts\install.ps1` | **unverified** | I could not install PowerShell on this machine, so this is the one row I could not test live. By reading: `Set-Content -Encoding ASCII` (`install.ps1:73`) corrupts any non-ASCII path in `%USERPROFILE%`; under PS 5.1 `$ErrorActionPreference = "Stop"` does not catch native-exe failures, so a failed `bun install` still prints "Done."; the docs never mention that the default ExecutionPolicy blocks the script; and the README Quick start shows the script without the required clone step. |
| 3.4 | Manual clone + `bash scripts/install.sh` (Option B) | partly | `install.sh:33` only uses your clone when `MONKEYDCODE_INSTALL_FROM_REPO=1`, which INSTALLATION.md never mentions. Following the docs literally clones a **second** copy into `~/.monkeydcode` and links `mdc` to that one, so your local edits do nothing. |
| 3.5 | Prerequisites: Bun 1.3+, Git, optional Python 3 + uv | partly | Nothing checks the Bun version. "Python 3" understates it: `tools/pyproject.toml:7` requires **≥ 3.14** and pulls chromadb and sentence-transformers. `.nvmrc` pins Node v24 although no code path uses Node. |
| 3.6 | `bin/monkeydcode` is runnable from a clone | **broken** | Committed non-executable (`-rw-r--r--`). It only works after `install.sh` chmods it. |

---

## 4. First run and the CLI surface

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 4.1 | First run walks you through provider and model, zero config files | **works** | Verified end to end through a real pty: provider menu → Ollama → base URL → live model list from `/api/tags` → writes `~/.config/monkeydcode/config.toml` + `credentials.json` (mode 0600) → drops into the working prompt. All seven documented providers exist and every one has a registered route. |
| 4.2 | Clear errors when Ollama isn't running | partly | **Interactive:** genuinely good — "Can't reach the model server. Is it running? Start it with `ollama serve`". **One-shot** (`mdc "task"`): a raw Bun stack trace. Verified both. |
| 4.3 | Clear errors when the model isn't pulled | partly | You get `model 'qwen2.5-coder:1.5b' not found` with no hint to run `ollama pull`. `isOllamaModelAvailable()` exists but is never called on the startup path. |
| 4.4 | `mdc` with no config, non-interactive | **broken** | Raw uncaught stack trace out of `model-setup.ts:317`. Reproduced in the clean container and locally. `MDCODE_SKIP_SETUP=1` with no config is worse: `Unknown provider ""`. |
| 4.5 | `mdc setup` / `doctor` / `version` / `shell-init` | **works** | All four verified, all four shells emit correct snippets. |
| 4.6 | Slash commands `/help /model /setup /clear /quit` | **works** | Verified live. `/crew` and `/status` also exist and work but are undocumented. `packages/tui/src/slash-commands.ts` is dead code — the real handler is inline in `index.tsx:228`. |
| 4.7 | `mdc mcp-server` exposes `mdc_build` / `mdc_verify` / `mdc_check_assets` | **works** | Real JSON-RPC `initialize` + `tools/list` over stdio returned all three tools with correct schemas. |
| 4.8 | `mdc acp` speaks the Agent Client Protocol | **works** | Real `initialize` + `session/new` handshake returned a protocol version and session id. Reply arrives as one chunk, not token deltas — which the code documents honestly. |

---

## 5. The core loop on a real repo with a real 7B

Two live end-to-end runs against `qwen2.5-coder:7b` on real multi-file git repos.

| Run | Task | Result |
| --- | --- | --- |
| A | Benchmark task 11 (fix a todo-store bug without changing the public API) | **Correct fix**, 7 min. All five hidden expected tests pass. |
| B | Benchmark task 12 (add a `deleteUser` handler following existing conventions) | **Correct file**, 2 min 51 s. All three hidden expected tests pass. |

So the loop does work, and that is the strongest evidence in this document. Three
things it exposed:

- **Run B was routed to the asset-fixer.** The console says `Done (asset_fix)`.
  `isAssetBug()` (`orchestrator.ts:410`) fires on the words "link" or "404" near
  "not"/"missing". I tested six ordinary phrasings; **five** misroute, including
  "add pagination … return an empty page" and "should return 404 for unknown ids".
  It recovered only because the fallback path runs a normal build.
- **Both runs left artifacts in the user's repo**: a `.monkeydcode/` state
  directory and a model-written `test/bugfix-repro.test.ts` that **fails**
  (it asserts `list()` returns strings; it returns objects). Nothing gitignores
  `.monkeydcode/` for a user's project.
- **The Python bridge sprays multi-line ENOENT stack traces** into the output on
  every retrieval when `uv` isn't on PATH, rather than degrading quietly.

Sampler telemetry from run A shows the honest inner picture: for the steps it
logged, all four candidates failed verification, both repair attempts failed, and
it exhausted all three resample rounds — `verificationPassed: [false, false, false, false]`.
The fix still landed, via the score-0 give-up path that applies the best failing
candidate. **The verification gate did not select that fix; it was applied in
spite of failing.**

---

## 6. Verification pipeline — where it passes vacuously

The pipeline claim is the other half of the thesis, so these matter.

| # | Behaviour | Verdict | Detail |
| --- | --- | --- | --- |
| 6.1 | `typecheck` on a project without a `typecheck` script | **broken** | `bun run typecheck` fails with "script not found"; `parseTscErrors` finds no `TSxxxx` lines in that output, returns zero errors, and the stage **passes**. Every benchmark fixture is in exactly this state. |
| 6.2 | `tests` on a TS project with no test files | **broken** | Verified: `bun test` exits 1 on "no tests found", so the stage returns `passed: false` with **zero** error details. Every candidate fails, and repair gets nothing to work with. |
| 6.3 | `tests` failure details | **broken** | `parseBunTestOutput` looks for `✗`; Bun prints `(fail)`. Assertion failures parse to zero errors. |
| 6.4 | `lint` with no linter configured | partly | Passes vacuously when no biome/eslint config exists — defensible, but it means the advertised lint gate is inert on most projects. |
| 6.5 | HTML/CSS/Markdown-only changes | partly | The static-safe selector drops every code stage, and `assets`/`browser` are unreachable, so such a change is "verified" by nothing and scores 1.0. |
| 6.6 | `verification.test_timeout` from user config | **broken** | Read, then discarded — `load-config.ts:18` always assigns the default timeout table. |
| 6.7 | Candidate verification writes into your real files | partly | It saves originals in memory and restores them in a `finally`, but there is no on-disk backup. A crash or Ctrl-C mid-verification leaves candidate code in your working tree. |

---

## 7. Sandboxing

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 7.1 | Every spawned process gets an environment allowlist, so API keys can't leak into a spawned test run | **broken** | Only the tool loop's RUN diagnostics and MCP servers use it. The **verification pipeline** — the thing that actually runs your tests, typecheck and lint — uses Bun's `$` and inherits the full parent environment. |
| 7.2 | Real OS-level sandboxing on macOS via `sandbox-exec` | **broken** | The generated profile denies writes to `/` with only the cwd and `/tmp` allowed, which blocks `/dev/null`. I reproduced it directly: `sandbox-exec -p '<the profile>' git status` fails with `fatal: could not open '/dev/null' for reading and writing: Operation not permitted`, exit 128. Because `executeRun` returns `r.stdout \|\| "(clean)"` and discards stderr and exit code, **the agent is told the working tree is clean when it is not.** This is the cause of 2 of the 7 failing tests, and it means `RUN git-status` / `RUN git-diff` have been fabricating results on every Mac. |
| 7.3 | bubblewrap on Linux | **unverified** | Not reproduced. By reading, `--ro-bind / /` plus a read-only `$HOME` will break package-runner MCP servers that need to write to `~/.npm`. |
| 7.4 | Local MCP servers are sandboxed | **broken** | Same profile denies `$HOME` and `$TMPDIR`, so an `npx`-based MCP server cannot start on macOS. |

---

## 8. Benchmark — "Prove it yourself"

| # | Claim | Verdict | What is actually true |
| --- | --- | --- | --- |
| 8.1 | We publish a falsifiable uplift number | **absent** | No three-arm run has ever been executed. `benchmarks/results/report.md` is a **verify-only** run from 2026-06-11 that measures nothing but the fixtures themselves, and its one committed JSON contains 10 rows of `"model": "verify-only"`. The README's own text admits the number doesn't exist. This is the single biggest gap. |
| 8.2 | Three-arm comparison across 14 tasks | partly | All three arms exist and dispatch correctly; `bun run bench:raw -- --task 02 --model 7b` works (6 s, PASS). But the comparison it would produce is not fair — see 8.3–8.6. |
| 8.3 | The tasks are non-trivial | **broken for 2 of 14** | With the **unmodified** starter, `02-fix-off-by-one` (6/6) and `08-add-typescript-types` (4/4) already pass. Task 02's starter binary search is actually correct despite the `// BUG` comments; task 08 has no tsconfig, so untyped parameters typecheck fine. Both are free passes for all three arms and inflate every arm's floor equally. |
| 8.4 | The raw arm is a fair floor | **broken** | `applyChange` fans out: I verified that one unlabeled `typescript` block against three target files writes that same block into **all three**, destroying two unrelated files. The raw and baseline arms feed exactly that shape of response into exactly that function. Their floor is depressed by a harness bug, not by the model — so any uplift measured against it is partly measuring our own bug. |
| 8.5 | The agent arm is the full agent | partly | The benchmark work dir is not a git repo, so the actor-critic review stage never runs in any benchmark run. |
| 8.6 | `bun run bench:compare` diffs two result runs | **broken** | `compare.ts:22` looks for `*-with-consistency.json`; `run.ts:379` writes `*-consistency.json`. Verified: it errors out. With no args it would also silently pick up the stale June file. |

---

## 9. Everything else

| # | Claim | Verdict | Note |
| --- | --- | --- | --- |
| 9.1 | MCP as a client; the README's TOML example | partly | The example parses as written, but the config reader is a hand-rolled line parser: an ordinary multi-line `command = [` array drops the server silently, and a trailing `# comment` mangles it. |
| 9.2 | Only configured servers are reachable | **works** | The closed-menu invariant holds. Model text can only select an already-listed tool. |
| 9.3 | Fine-grained permissions | **works** | Gates RUN diagnostics, MCP tools and web search exactly as documented. Note it does not gate file writes. |
| 9.4 | `AGENTS.md`/`CLAUDE.md` picked up automatically | partly | Read and folded into the task text, but only reaches the planner — not the review prompts, the test generator, or the sampler. |
| 9.5 | Test-first step execution | partly | Real, and it does delete a check whose step failed. But "genuinely red" is exit-code-only, so a check that fails because it has a syntax error counts as red and then poisons every candidate. |
| 9.6 | Specialist sub-agents | partly | `asset-fix` is a genuine specialist. `bug-fix`, `feature` and `debug` are plan+build with an extra prompt. `refactor` takes the first word after "refactor" as the target, so "refactor the database layer" targets the literal string `the`. |
| 9.7 | Self-tuning from telemetry | partly | Wired and writes to `.monkeydcode/telemetry/`, but only retunes on a ≥ 0.4 pass-rate gap between temperatures, which is rare. No data leaves the machine — I checked; that part is true. |
| 9.8 | Real browser verification (Playwright) | **broken** as a stage | Cannot be enabled as a verification stage (6.1's filter). It works only as a `RUN check-render` recon command, and Playwright is in no `package.json` — you must install it inside the monkeyDcode checkout, which is documented nowhere. |
| 9.9 | Python bridge (tree-sitter, vector store, graph) in the architecture diagram | partly | Real code, but needs `uv` + Python ≥ 3.14. Without it, tree-sitter AST grading silently degrades to whitespace comparison and retrieval dumps stack traces. |
| 9.10 | `bun run lint` | **broken** | `biome check .` — biome is not a dependency and there is no `biome.json`. |
| 9.11 | `bun run build` | **broken** | No package defines a `build` script. |
| 9.12 | `MDCODE_ECHO=1 bun run dev` | **unverified** | Routes through the vendored opencode engine; not exercised by any test. |
| 9.13 | Prompts fit the local model's context window | partly | Nothing in the code sets `num_ctx`, so Ollama serves `qwen2.5-coder:7b` at its **4096-token default** and silently truncates anything longer from the front. I read the server log across both live runs: max prompt 2601 tokens, `truncated = 0`, so it did not bite here. But the build prompt concatenates retrieved context, a recon transcript, up to 12,000 characters of existing file content, the hashline instructions and a generated test. On a larger file that exceeds 4096 tokens, the instructions at the front are the part that gets dropped, silently. This is a latent failure mode for the exact target user, not a current one. |

---

## 10. Repo hygiene

Not a README claim, but it is what a stranger sees first.

- No repo description, no topics, 0 releases, 0 tags, no npm package, no CI workflows.
- **The test suite writes to the user's real `~/.config/monkeydcode/config.toml`.** The test sets `process.env.HOME`, but Bun's `os.homedir()` reads the OS value, not the env var. My real config was overwritten with a fixture containing `action = "not-a-real-action"`.
- Committed runtime state: `.monkeydcode/capability-cache.json` (`{"gpt-5-mini": 6}`) and `.monkeydcode/working-memory.json` (with a duplicate JSON key, and someone's "make a nike website" goal).
- Committed personal tooling: `.claude/`, `.claude-flow/`, `.cursor/`, `.cursorrules`, `.opencode.json`, `.vscode/mcp.json`, and `.mcp.json` hard-coded to `/home/rohan-prasen/Code/monkeyDcode`.
- `AGENTS.md` (symlinked as `CLAUDE.md`) describes only an unrelated "code-review-graph" MCP tool. It says nothing about this project.
- `landing/` is a whole Astro site with its own lockfiles, outside the workspace list. Its README is still the upstream template's.
- The README's first two sentences lead with a competitor comparison and a blog link rather than telling an Ollama user what they get.

---

## 11. Failing tests (7 of 200)

| Test | Cause |
| --- | --- |
| `tool-loop-run-sandboxed.test.ts` (×2) | Real bug 7.2 — the macOS sandbox profile breaks git. The tests are correct; the code is wrong. |
| `project-root.test.ts` (×3) | macOS `/var` → `/private/var` symlink; the test needs `realpath`, the code is fine. |
| `acp/agent.test.ts` (×2) | The test depends on the developer's real `~/.config/monkeydcode` existing. It should mock the model. |

---

## Summary

The engine is real. A 7B model on a real multi-file repo produced two correct,
test-passing changes end to end, and the install, first-run wizard, MCP server and
ACP agent all work as documented. That is a genuine foundation.

But the two things the README sells hardest are the two that don't hold up:

1. **Hashline never verifies what it applies.** The sampler has no knowledge of
   the patch format, so hashline candidates are verified as garbage, always fail,
   and are then applied anyway. The per-line fingerprint drift detection is dead
   code. Several silent-corruption paths contradict "never silently applied wrong".
2. **There is no number.** The benchmark has never been run, the committed report
   measures nothing, and three harness bugs (free-pass fixtures, the `applyChange`
   fan-out that cripples the raw arm, and the review stage never running) mean a
   number produced today would be measuring our own defects as uplift.

Fixing the fan-out bug and the two free-pass fixtures is a prerequisite to Phase 3.
Running the benchmark before that would produce a flattering number I would not
be able to defend.

**Count across 56 checked claims: 10 works · 24 partly · 18 broken · 1 absent · 3 unverified.**

### Coverage note

Six of eight planned audit passes ran to completion; two (the LLM/error-handling
layer and the docs/hygiene sweep) were cut short by an API spend limit, and the
adversarial re-review of every verdict did not run. I covered both areas myself
by hand afterwards, which is where §4.2–4.4, §9.13 and §10 come from, but those
two areas had one pass rather than two. The three rows marked **unverified** are
marked that way deliberately: Windows install, Linux bubblewrap, and echo mode.
I would rather show them as unverified than guess.
