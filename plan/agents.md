# Agent System

## Agent Loop: ReAct with Chain-of-Thought

All agents use ReAct (Reasoning + Acting):
```
Thought → Action → Observation → Thought → ... → Answer
```

## Agent Registry

| Agent | Role | Permissions |
|-------|------|------------|
| Plan | Adaptive task decomposition (levels 1-6) | read-only |
| Build | Code generation with consistency loop | full |
| Review | Actor-Critique multi-round review | read-only |
| Bug-fix | Reproduce -> localize -> fix -> verify | full |
| Feature | Spec -> plan -> scaffold -> implement -> test | full |
| Refactor | Parse AST -> plan -> apply -> verify | full |
| Debug | Read traceback -> hypothesize -> test -> fix (HyDE) | full |

## Plan Agent: Adaptive Decomposition

| Level | Depth | Max LOC/Step | Example Models |
|-------|-------|-------------|----------------|
| 1 | 1-2 | unlimited | Claude Opus, GPT-4o |
| 2 | 2-3 | ~100 | Claude Sonnet, DeepSeek V3 |
| 3 | 3-4 | ~50 | Qwen 72B, Llama 70B |
| 4 | 4-5 | ~30 | Qwen 32B |
| 5 | 5-6 | ~20 | Qwen 14B |
| 6 | 6 | <20 | Qwen 7B, CodeLlama 7B |

## Review Agent: Actor-Critique

1. Round 1 (Actor): Review diff, identify issues
2. Round 2 (Critic): Challenge Actor, add missed issues
3. Round 3: Consensus on actionable fixes
4. Route fixes back to Build Agent
