# Verification Pipeline

Deterministic, model-independent quality gate.

## Pipeline Stages (sequential, early exit)

| Stage | Tool | Timeout | Weight |
|-------|------|---------|--------|
| Syntax | tree-sitter parse | 5s | 0.10 |
| Type Check | tsc / mypy / rustc --check | 30s | 0.25 |
| Lint | biome / ruff / clippy | 15s | 0.10 |
| Existing Tests | bun test / pytest / cargo test | 120s | 0.30 |
| Generated Tests | LLM-generated test | 60s | 0.15 |
| Smoke Test | configurable command | 30s | 0.10 |

## Integration Points

- Per-step: Called by sampler for each candidate during build
- Full-changeset: Called after all steps complete, before review

## Language Detection

| Extension | Type Check | Lint | Test Runner |
|-----------|-----------|------|-------------|
| .ts/.tsx | tsc | biome | bun test |
| .py | mypy | ruff | pytest |
| .rs | rustc --check | clippy | cargo test |
| .go | go vet | golangci-lint | go test |
