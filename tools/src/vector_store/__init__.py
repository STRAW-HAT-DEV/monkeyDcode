import hashlib
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

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
