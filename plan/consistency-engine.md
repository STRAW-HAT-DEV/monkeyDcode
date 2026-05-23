# Consistency Engine

The core innovation of monkeyDcode. Makes any LLM produce reliable code by compensating for model weakness through sampling, verification, and grading.

## Multi-Temperature Sampling Algorithm

```
ALGORITHM: ConsistencySampling(task, model, context)

INPUT:
  task: AtomicOperation
  model: ModelRef
  context: AssembledContext

CONFIG (adapted by model capability):
  Level 1-2 (frontier):     temps=[0.3],           candidates=1
  Level 3-4 (medium):       temps=[0.3, 0.5],      candidates=2
  Level 5-6 (small):        temps=[0.3, 0.4, 0.5, 0.6], candidates=4

PROCEDURE:
  1. capability_level = ModelCapability.detect(model)
  2. Select temps and candidate count
  3. Generate N candidates in parallel (one per temperature)
  4. Verify each through pipeline
  5. Filter to verified-only
  6. If none pass: retry with error context (max 3)
  7. RRP grade verified candidates
  8. Select highest-scoring
```

## Consistency Score

Correct solutions converge; hallucinated solutions diverge.

For each verified candidate, compute normalized edit distance to every other.
Use AST-based comparison (tree-sitter) to ignore whitespace/formatting.

## RRP Grading

```
Score = 0.5 * verification_score
      + 0.3 * consistency_score
      + 0.2 * quality_score
```

## Model Capability Detection

Tier 1: Static registry (known models, zero cost)
Tier 2: Dynamic probing (standardized task, one-time, cached)
Tier 3: Adaptive refinement (track pass rates, promote/demote over time)
