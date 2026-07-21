# Capability Gaps — monkeyDcode

Honest audit in two parts:

- **Part 1 — vs. a frontier agent (Claude Code):** what it can do that
  monkeyDcode couldn't, what was closed, what is deliberately left open.
  Written after the "the logo isn't rendering" task — a case a frontier agent
  fixes in seconds but monkeyDcode spun on for minutes and never solved.
- **Part 2 — vs. Open Interpreter (the direct competitor):** as of July 2026,
  a 65.6k-star Rust rewrite whose stated purpose is *the same as ours*. Read
  this before planning any roadmap work.

---

## Part 1 — vs. a frontier agent

### Why that task exposed a real gap

monkeyDcode's core loop is **edit code → verify with `bun test`**. That's a
powerful loop for *logic* bugs whose failure is reproducible as a unit test.
But "the `<img>` shows a broken placeholder" is not a logic bug — it's a
**dead reference to an external resource**. There is no `bun test` that
asserts "this image loads." So the reproduction-test bug-fixer had nothing to
anchor on (empty `Suspect files`), and the verifier had no way to confirm a
fix. The task needed two capabilities the agent simply did not have:
**probing a URL** and **checking an asset resolves**.

---

## Gap table

| # | Capability | Frontier agent | monkeyDcode (before) | Status |
|---|------------|:---:|:---:|---|
| 1 | **Validate asset references** (image/link/CSS/script resolve?) | ✅ | ❌ | **CLOSED** |
| 2 | **Probe a URL over HTTP** (is this link alive?) | ✅ | ❌ | **CLOSED** (scoped) |
| 3 | Route non-testable "bugs" away from the repro-test loop | ✅ | ❌ | **CLOSED** |
| 4 | Verify a fix by something other than `bun test` | ✅ | partial | **CLOSED** (assets + browser stages) |
| 5 | See rendered visual output (does the page *look* right?) | ✅ | ❌ | **CLOSED** (see Part 2, C2) |
| 6 | Web search (look up an API, a fix, current docs) | ✅ | ❌ | **CLOSED** (scoped — see below) |
| 7 | Arbitrary shell execution | ✅ | ❌ (closed RUN menu) | Open **by design** |

---

## What was closed this session

### 1–2. Asset & URL validation — `verification/assets.ts`
A new, dependency-free module that extracts every `<img src>`, `<link href>`,
`srcset`, CSS `url()`, and Markdown-image reference from HTML/CSS/MD/SVG, then:
- **local paths** → checked against the filesystem (missing file = DEAD);
- **remote URLs** → HTTP HEAD/GET (4xx/5xx = DEAD; a network blip = WARNING,
  never a false build failure).

Deduped, bounded, timeout-guarded. This is the piece that turns "the logo
shows a placeholder" from invisible into a precise, located finding:
`index.html:74 src attribute → <url> (400)`.

### 3. Routing — `orchestrator.ts` `isAssetBug()`
A deterministic check reclassifies an asset/render "bug" off the
reproduction-test path and onto the general build path, whose tool-loop recon
can actually investigate it. Pure and model-independent, so routing is
identical from Qwen-7B to Opus.

### 4. Verification stage — `assets` in the pipeline
Wired into the verification pipeline and marked static-safe, so a hand-written
HTML page is now verified by "do all its references resolve?" A fix that still
points at a dead URL **fails verification** — the agent knows it isn't done.
This is the missing non-`bun test` verifier.

### 2 (agent-facing). Tool-loop `check-assets` command
The bounded tool loop gained a `RUN check-assets` diagnostic. It stays inside
the loop's injection-safe contract: it takes **no model-supplied argument** —
it extracts the URLs from the user's own project files and validates them. The
model can now *discover* a dead reference during recon, before it edits.

---

## What's left open, and why (not "can't" — "deliberately not yet")

### 5. Visual / rendered-output understanding — CLOSED, see Part 2 C2

Originally deferred here for needing a headless browser AND a vision model.
The headless-browser half is now closed (`verification/browser-check.ts` — a
real Playwright render, catching JS-injected broken images/redirects/CORS
failures that assets.ts's regex scan can't see, lazy/optional exactly like
`screenshot.ts` was designed for). The vision-model half (does the page
*look* good, not just "did every resource load") remains open — that's a
model-capability gap, not a tooling one, and the local-7B target genuinely
doesn't have it.

### 6. Web search — CLOSED, scoped

New `agent/src/web-search.ts` + a `SEARCH <query>` tool-loop action, gated on
a configured `[web_search]` provider (Brave Search API — a real documented
REST API, not HTML scraping) and, like MCP servers, on the same permission
rules (`checkPermission`). Off by default, same "bring your own key, visible
opt-in" stance as escalation: looking things up on the live internet is a
real behavior change (network egress, query text leaving the box), not
something to default on silently. The model controls only the query text —
the destination (Brave's endpoint) is fixed by config, the same trust
boundary GREP already has for its regex pattern.

### 7. Arbitrary shell execution — open **on purpose**
A frontier agent runs any shell command. monkeyDcode's tool loop offers only a
**closed menu** of named, parameterless diagnostics (`typecheck`, `test`,
`git-diff`, `git-status`, `check-assets`). This is a security decision, not a
missing feature: no code path ever hands model-authored text to a shell, so the
loop cannot be turned into a command executor by prompt injection. New
capability is added by extending the menu (as `check-assets` was), never by
opening a general `exec`.

---

### The theme of Part 1

The gaps that mattered were not "monkeyDcode reasons worse than a frontier
model." They were **missing tools**: the agent couldn't probe a URL, check an
asset, render a page, or search the web, so whole bug classes were
structurally invisible to it. All of that is now closed. The only item left
open in this table is #7 (arbitrary shell execution), and that's open **by
design** — a genuine security boundary, not a gap to close.

---

## Part 2 — vs. Open Interpreter (direct competitor)

**Read this before planning roadmap work.** As of July 2026,
[openinterpreter/openinterpreter](https://github.com/openinterpreter/openinterpreter)
is a **Rust rewrite forked from OpenAI's Codex**, 65.6k stars, 56 releases
(v0.0.25, 2026-07-15). Its stated purpose:

> "A coding agent for low-cost models" — "emulating the agent harness that gets
> the best performance out of low-cost models."

That is **our thesis, verbatim**, shipped by a project with a large head start.

### First: this validates the bet

The category is real and now mainstream — *"the frontier models inside these
tools have largely converged, and the harness around the model now does most of
the work."* See [The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/)
("I improved 15 LLMs at coding in one afternoon. Only the harness changed.") and
[harness-bench](https://www.neuralnoise.com/2026/harness-bench-wip/), which pairs
local LLMs with harnesses across 16 SWE tasks. We are not chasing a fantasy. But
we are no longer alone, and we cannot win on surface area.

### They bet differently than we do

| Dimension | Open Interpreter | monkeyDcode |
| --- | --- | --- |
| **Strategy** | **Harness multiplexer** — switch between existing harnesses (`native`, `claude-code`, `qwen-code`, `kimi-cli`, `deepseek-tui`, `swe-agent`, `minimal`) via `/harness` | **One harness with consistency machinery** |
| **Core mechanism** | Pick the best-fitting harness per model | Multi-temperature sampling + deterministic verification + repair |
| **Published proof** | **None** — no benchmarks or comparative evidence in their README | Three-arm benchmark (built; **not yet run**) |

Their thesis: *the right harness per model wins.* Ours: *cancel the model's
variance with sampling + verification.* These are **not the same mechanism** —
and they have none of ours.

### Competitive gap table (what they have, we don't)

| # | Capability | Open Interpreter | monkeyDcode | Priority |
|---|------------|:---:|:---:|---|
| C1 | **MCP support** (plug into the tool ecosystem) | ✅ | ✅ | **CLOSED** — client + server |
| C2 | **Browser + visual QA** (`agent-browser`, `trycua`, QA skill) | ✅ | ✅ | **CLOSED** (scoped) — same gap as Part 1 #5 |
| C3 | **OS-level sandboxing** (macOS/Linux/Windows) | ✅ | ✅ (best-effort) | **CLOSED** (scoped) |
| C4 | Skills / hooks / permissions / `AGENTS.md` | ✅ | ✅ (partial, honestly) | **CLOSED** for 3 of 4 — see below |
| C5 | **ACP** (Agent Client Protocol — editor integration) | ✅ | ✅ | **CLOSED** |
| C6 | Harness switching per model family | ✅ | ❌ | Low — arguably subsumed by capability-tiering |

Note C2 was the **same gap** as Part 1 #5 (visual output) — two independent
analyses landed on it, which is why it was prioritized and closed together.

### C1–C5: what was actually built

**C1 — MCP, both directions.** New `packages/mcp` (protocol plumbing: a
plain-Promise client over `@modelcontextprotocol/sdk` — stdio + remote
transports, no OAuth — and a generic `startStdioServer` builder) plus
`packages/mcp-server` (monkeyDcode's own capabilities — `mdc_build`,
`mdc_verify`, `mdc_check_assets` — exposed as MCP tools other clients, e.g.
Claude Desktop, can call). Deliberately NOT built on `packages/engine`'s
already-vendored opencode MCP client — that's wired into opencode's own
Effect Config/Bus/runtime service graph, and pulling the lightweight
orchestrator through it would be a real architectural migration, not a
same-session feature (same precedent tool-loop.ts already documents for why
it doesn't use the engine's tool registry either). On the client side,
configured servers are a closed menu exactly like the tool loop's RUN
commands — model text can select an already-listed tool name, never
introduce a new server — with a shallow JSON-Schema check on arguments
before any call reaches a real process. Run `mdc mcp-server` to start it.
Configure external servers under `[mcp.servers.<name>]` in `config.toml`.

**C2 — browser/visual QA (scoped).** New `verification/browser-check.ts`:
a real headless-Chromium render (Playwright, lazy/optional — same stance as
the pre-existing `screenshot.ts`) that reports failed resource loads and
console errors, wired as a `browser` verification stage and a `RUN
check-render` tool-loop diagnostic. Catches what assets.ts's regex scan
structurally cannot: a JS-injected `<img>`, a redirect, a CORS failure.
Scoped honestly: this is *does every resource load*, not *does the page
look good* — the latter needs a vision model, which stays an open gap (see
Part 1 #5). One real bug found and fixed in the process: `checkPage()` had
no timeout around the browser *launch* itself (only around navigation),
so a stuck Chromium install could hang the entire verification pipeline
forever — caught by hitting exactly that hang in this codebase's own
development sandbox (headless Chromium never completed launch there; a
real, reproducible environment limitation, not a bug in the check logic).

**C3 — sandboxing (best-effort, scoped).** New `core/util/sandbox.ts`:
environment allowlisting (a spawned process gets a small, functional env,
never the parent's full one — so this project's own LLM provider API keys
can't leak into a spawned `bun test` or a third-party MCP server) on every
platform, plus bubblewrap wrapping on Linux and `sandbox-exec` wrapping on
macOS when present (both restrict filesystem writes and disable network by
default). Wired into the tool loop's RUN diagnostics and, at higher value,
into locally-configured MCP servers — genuinely untrusted, user-installed
third-party code. Windows has no simple userland equivalent to
bwrap/sandbox-exec (true isolation there needs WSL or a Windows Sandbox VM)
— stated plainly rather than silently downgraded: on Windows, only the
environment-allowlisting protection applies. The Linux/macOS wrapping logic
itself is fully unit-tested (pure command-construction function, all three
branches forced via a test-only override) but — honestly — was developed
and typechecked on Windows, so it could not be verified with a live
sandboxed execution; that's an inherent limitation of the development
environment, not untested code.

**C4 — AGENTS.md/CLAUDE.md + permissions (honest partial).** Two of the four
things in this row, closed for real:

- **Repo instructions**: new `agent/src/repo-instructions.ts` reads
  `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` from the project root and folds it
  into every non-chat task, the same way conversation history already is.
  `packages/engine` had this already, but only inside opencode's heavy
  Config/Bus/RuntimeFlags service graph — same reason as C1, this is the
  lightweight equivalent for the actual orchestrator.
- **Permissions**: new `agent/src/permissions.ts` reuses
  `core/permission.ts`'s `Rule`/`Ruleset` types (not its `evaluate()` — see
  that file's own comment on why: `evaluate()`'s "no match" fallback is
  shape-identical to a real "ask everything" rule, which would make one
  surgical `{permission:"run", pattern:"test", action:"deny"}` rule silently
  deny every *other* RUN command and MCP tool too the moment it existed —
  caught by a test that assumed true default-allow and failed against the
  first draft). Gates both RUN diagnostics and MCP tool calls; configured
  under `[permissions.rules.<name>]` in config.toml.
- **Skills**: not built as a separate framework. monkeyDcode's existing
  capability-tiered scaffold system (`task-type.ts` + `scaffold.ts`) already
  fills this role — detect the task shape, apply a constrained template — so
  a second, parallel "skills" mechanism would be redundant, not additive.
- **Hooks**: genuinely not built. A pre/post-action lifecycle hook system
  (arbitrary user code running around tool calls) is real, unscoped surface
  area with its own injection/trust questions — not started, not claimed.

**C5 — ACP (Agent Client Protocol).** New `packages/acp`, implementing the
`initialize`/`session/new`/`session/prompt`/`session/cancel` methods an ACP
agent must support, via `@agentclientprotocol/sdk`, delegating straight to
`Orchestrator.handle` — the same code path `mdc "<task>"` and MCP's
`mdc_build` already run. `mdc acp` starts it on stdio for any ACP-speaking
editor (Zed, or anything else adopting the protocol). Scoped honestly:
replies stream as ONE `agent_message_chunk`, not incremental token deltas —
true streaming needs Orchestrator.handle to emit partial output as it
generates, a real restructuring orthogonal to "support ACP at all." Cancel
is best-effort (checked once the in-flight Effect resolves; there are no
cancellation checkpoints inside Orchestrator.handle to abort mid-generation
today). Both documented in `packages/acp/src/agent.ts`, not silently assumed
away. Caught one real bug building this: the natural instinct — call
`process.exit()` right after `startAcpAgent()`/`connect()` resolves — was
exactly the bug that broke `mdc mcp-server` completely (see C1 above); ACP's
SDK happens to expose an explicit `connection.closed` promise, so the same
pattern is correct here, but only because that was checked against the SDK
source rather than assumed from the MCP experience.

### What we have that they don't (the moat)

Multi-temperature sampling · deterministic verification grading · **hashline**
(line-anchored patches with staleness detection) · capability-tiered adaptation ·
self-repair · self-tuning telemetry · per-step hybrid escalation · asset
validation · **a benchmark that can prove uplift**.

### Strategic conclusion

**Do not try to out-feature a 65k-star Rust project.** Press the thing they
conspicuously lack: **evidence**. They claim "optimized for low-cost models" and
publish nothing to back it. Our three-arm benchmark answers exactly that
question, and no competitor is answering it.

Status:

1. **Run the three-arm benchmark** (`benchmarks/README.md`) — **still the
   single biggest open item.** It is built and idle. "We publish our uplift
   vs. our own raw model; they don't" is the wedge, and it needs a real
   number behind it before it goes anywhere public. harness-bench is a
   public arena to compare in once it does.
2. ~~C1 — MCP support~~ — **closed.** Client + server, see above.
3. ~~C2 — browser/visual QA~~ — **closed** (scoped: render/resource checking,
   not vision judgment). See above.
4. ~~C3 — sandboxing~~ — **closed** (scoped: env allowlisting everywhere,
   OS-level wrapping where Linux/macOS tooling is present). See above.
5. ~~C4 — AGENTS.md/CLAUDE.md + permissions~~ — **closed** for those two;
   skills judged redundant with the existing scaffold system; hooks
   genuinely not built. See above.
6. ~~C5 — ACP~~ — **closed.** `mdc acp`, see above.
7. **C6 — harness switching per model family.** Still not started, still
   judged low priority — capability-tiering already adapts within one
   harness continuously, which is arguably the better version of this.

Everything in this document that was buildable in a single session is now
either closed or explicitly, individually justified as deferred. The
benchmark run is the one item that cannot be closed by more code — it needs
real compute time on real infrastructure.
