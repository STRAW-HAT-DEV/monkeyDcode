# Step 9: Context Engineering

**Goal:** Knowledge graph + signature index + vector store + working memory -> assembled into a smart context retriever.

**Why:** Prevents hallucinated APIs. Feeds the model real signatures, types, and usage examples.

**Prerequisites:** [Step 8](08-python-bridge.md) complete.

**Reference spec:** [architecture.md](architecture.md) — Layer 4

---

## 9.1 Signature index

`packages/context/src/signature-index.ts`:
```typescript
import { Effect } from "effect"
import { treeSitter } from "@monkeydcode/python-bridge/client"

export interface Signature {
    name: string
    parameters: string
    line: number
    file: string
    type: "function" | "method" | "class"
}

export function indexProject(rootDir: string) {
    return Effect.gen(function* () {
        const files = yield* findSourceFiles(rootDir)
        const index = new Map<string, Signature[]>()
        for (const file of files) {
            const sigs = yield* treeSitter.extractSignatures(file)
            index.set(file, sigs.map(s => ({ ...s, file })))
        }
        return index
    })
}
```

## 9.2 Vector store (Python)

Add to `tools/pyproject.toml`:
```toml
dependencies = [
    "chromadb>=1.0.0",
    "sentence-transformers>=4.0.0",
]
```

`tools/src/vector_store/__init__.py`:
```python
import chromadb
from sentence_transformers import SentenceTransformer
from pathlib import Path
import hashlib

_client = None
_collection = None
_encoder = None

def _init():
    global _client, _collection, _encoder
    if _client is None:
        db_path = Path.home() / ".local/share/monkeydcode/chroma"
        db_path.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(db_path))
        _collection = _client.get_or_create_collection("code")
        _encoder = SentenceTransformer("all-MiniLM-L6-v2")


def index_files(files: list[str]) -> None:
    _init()
    docs, ids, embeddings = [], [], []
    for f in files:
        content = Path(f).read_text()
        # Better: chunk by tree-sitter semantic boundaries
        doc_id = hashlib.sha256(f.encode()).hexdigest()[:16]
        docs.append(content)
        ids.append(doc_id)
        embeddings.append(_encoder.encode(content).tolist())
    _collection.upsert(documents=docs, ids=ids, embeddings=embeddings)


def search(query: str, k: int = 5) -> list[dict]:
    _init()
    q = _encoder.encode(query).tolist()
    results = _collection.query(query_embeddings=[q], n_results=k)
    return [{"text": d, "score": 1 - dist}
            for d, dist in zip(results["documents"][0], results["distances"][0])]
```

Register in `bridge_server.py`:
```python
from .vector_store import index_files, search
server.register("vectorStore.index", index_files)
server.register("vectorStore.search", search)
```

## 9.3 TypeScript vector store wrapper

`packages/context/src/vector-store.ts`:
```typescript
export function indexFiles(files: string[]) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        yield* bridge.call("vectorStore.index", { files })
    })
}

export function search(query: string, k = 5) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<{ text: string; score: number }[]>(
            "vectorStore.search", { query, k }
        )
    })
}
```

## 9.4 Knowledge graph

`tools/src/knowledge_graph/__init__.py`:
```python
import ast
from pathlib import Path
import networkx as nx

_graph = None

def build(project_root: str) -> None:
    global _graph
    _graph = nx.DiGraph()
    for py_file in Path(project_root).rglob("*.py"):
        tree = ast.parse(py_file.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                src = f"{py_file}:{node.name}"
                _graph.add_node(src, file=str(py_file))
                for child in ast.walk(node):
                    if isinstance(child, ast.Call) and hasattr(child.func, "id"):
                        _graph.add_edge(src, child.func.id)


def neighbors(node: str, depth: int = 2) -> list[str]:
    if _graph is None:
        return []
    visited = {node}
    frontier = {node}
    for _ in range(depth):
        nxt = set()
        for n in frontier:
            if n in _graph:
                nxt.update(_graph.successors(n))
                nxt.update(_graph.predecessors(n))
        nxt -= visited
        visited.update(nxt)
        frontier = nxt
    return list(visited - {node})
```

Add `networkx>=3.5` to `tools/pyproject.toml`.

## 9.5 Context retriever (compose everything)

`packages/context/src/retriever.ts`:
```typescript
export interface AssembledContext {
    signatures: Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
    workingMemory: WorkingMemory.State
}

export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        const signatures = yield* Effect.all(
            query.files.map(f => SignatureIndex.extractSignatures(f))
        ).pipe(Effect.map(arrs => arrs.flat()))

        const examples = yield* VectorStore.search(query.description, 5)

        const graphNeighbors = yield* Effect.all(
            query.files.map(f => KnowledgeGraph.neighbors(f, 2))
        ).pipe(Effect.map(arrs => arrs.flat()))

        const workingMemory = yield* WorkingMemory.load()

        return {
            signatures,
            relatedExamples: examples.map(e => e.text),
            graphNeighbors,
            workingMemory
        }
    })
}

export function formatForPrompt(ctx: AssembledContext): string {
    return `
## Available Functions/Methods
${ctx.signatures.map(s => `- ${s.name}${s.parameters} (${s.file}:${s.line})`).join("\n")}

## Related Code Examples
${ctx.relatedExamples.slice(0, 3).join("\n---\n")}

## Working Memory
Goal: ${ctx.workingMemory.currentGoal}
Completed: ${ctx.workingMemory.completedSteps.length} steps
Constraints: ${ctx.workingMemory.knownConstraints.join("; ")}
`.trim()
}
```

## 9.6 Update Build Agent

In `packages/agent/src/build-agent.ts`:
```typescript
const context = yield* Retriever.retrieve({
    files: step.targetFiles,
    description: step.description
})

const prompt = `
${Retriever.formatForPrompt(context)}

## Task
${step.description}

Generate the code change.
`
```

## 9.7 Index on session start

```typescript
Session.create(projectRoot)
  -> SignatureIndex.indexProject(projectRoot)    // background
  -> VectorStore.indexFiles(allFiles)             // background
  -> KnowledgeGraph.build(projectRoot)            // background
```

## 9.8 Auto-compaction

`packages/context/src/compaction.ts`:
```typescript
export function shouldCompact(messageCount: number): boolean {
    return messageCount > 0 && messageCount % 5 === 0
}

export function compact(messages: Message[]) {
    return Effect.gen(function* () {
        const summary = yield* LLM.generate({
            model: defaultModel,
            prompt: `Summarize this conversation, preserving decisions:\n${format(messages)}`,
            generation: { temperature: 0.3 }
        })
        return [{ role: "system", content: `[Summary] ${summary.text}` }]
    })
}
```

## 9.9 Commit

```bash
git add -A
git commit -m "feat: context engineering

- Signature index (tree-sitter)
- Vector store (ChromaDB)
- Knowledge graph (networkx)
- Working memory
- Auto-compaction every 5 messages"
```

## Validation Checklist

- [ ] Signature index builds for TS and Python
- [ ] Vector store indexes code chunks
- [ ] Semantic search returns relevant code
- [ ] Knowledge graph traverses dependencies
- [ ] Retriever combines all sources
- [ ] Build agent uses retrieved context
- [ ] Auto-compaction triggers every 5 messages

## Next Step

[Step 10: Review + sub-agents](10-review-subagents.md)
