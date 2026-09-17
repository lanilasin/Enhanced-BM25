from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import requests
import sys
import os
import json

# Adjust path to import core modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.preprocessor import TextPreprocessor
from core.reranker import NeuralReranker
from scripts.evaluate_baseline import FastBaselineBM25
from scripts.build_index import download_beir_dataset

app = Flask(__name__)
CORS(app)

print("Bootstrapping Two-Stage Retrieval Engine...")
preprocessor = TextPreprocessor()

print("Loading Corpus...")
corpus, _, _ = download_beir_dataset("scifact")

print("Initializing Fast BM25 Index...")
bm25_stage1 = FastBaselineBM25(corpus, preprocessor)

print("Loading Neural Cross-Encoder (MiniLM)...")
reranker = NeuralReranker()

OLLAMA_MODEL = "llama3:8b"
OLLAMA_URL   = "http://localhost:11434/api/chat"

# System prompt that stays at the top of every conversation.
# RAG context is injected into the FIRST user turn so the model
# always has the retrieved evidence without it cluttering follow-ups.
BASE_SYSTEM_PROMPT = (
    "You are a knowledgeable research assistant. "
    "When scientific context documents are provided, use them as your primary evidence source. "
    "Be concise, accurate, and cite which document supports your answer when relevant. "
    "If the context does not contain enough information, say so clearly and answer from your general knowledge."
)


def retrieve_context(query: str):
    """Run two-stage retrieval and return top docs + a formatted context string."""
    query_tokens = preprocessor.clean(query)
    top_k_stage1 = bm25_stage1.get_top_k(query_tokens, k=25)

    candidate_docs = [
        (score, doc_id, corpus[doc_id].get("title", "") + " " + corpus[doc_id].get("text", ""))
        for doc_id, score in top_k_stage1
    ]

    top_docs = reranker.rerank(query, candidate_docs, top_k=5)

    retrieved = [{"score": doc[0], "text": doc[2]} for doc in top_docs]
    context_str = "\n\n".join(
        [f"[Document {i+1}]: {doc[2]}" for i, doc in enumerate(top_docs)]
    )
    return retrieved, context_str


def build_ollama_messages(history: list, latest_query: str, context_str: str) -> list:
    """
    Construct the messages array for Ollama /api/chat.

    Layout:
      [system]  BASE_SYSTEM_PROMPT
      [user]    <previous user turn 1>          (from history, no RAG injection)
      [assistant] <previous assistant turn 1>
      ...
      [user]    Retrieved context + latest query  ← always the final turn
    """
    messages = [{"role": "system", "content": BASE_SYSTEM_PROMPT}]

    # Replay prior turns from history (skip the very last user turn —
    # we'll rebuild it below with the freshly retrieved context).
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Final user turn: prepend retrieved context so the model can cite it.
    user_turn_content = (
        f"Relevant context documents retrieved for this question:\n\n"
        f"{context_str}\n\n"
        f"---\n\n"
        f"Question: {latest_query}"
    )
    messages.append({"role": "user", "content": user_turn_content})

    return messages


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    latest_query = data.get('query', '').strip()
    history      = data.get('history', [])

    if not latest_query:
        return jsonify({"error": "Query is required"}), 400

    def generate_stream():
        retrieved, context_str = retrieve_context(latest_query)

        yield f"data: {json.dumps({'type': 'context', 'retrieved': retrieved})}\n\n"

        messages = build_ollama_messages(history, latest_query, context_str)

        try:
            response = requests.post(
                OLLAMA_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "temperature": 0.7,
                        "num_predict": 1024,
                    }
                },
                stream=True,
                timeout=180
            )
            response.raise_for_status()

            for line in response.iter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        is_done = chunk.get("done", False)

                        if token:
                            yield f"data: {json.dumps({'type': 'token', 'text': token})}\n\n"

                        if is_done:
                            break
                    except json.JSONDecodeError:
                        continue

        except requests.exceptions.ConnectionError:
            yield f"data: {json.dumps({'type': 'error', 'text': 'Cannot reach Ollama. Is it running? Run: ollama serve'})}\n\n"
        except requests.exceptions.HTTPError as e:
            msg = f"Ollama returned an error: {e.response.status_code}. Is the model pulled? Run: ollama pull {OLLAMA_MODEL}"
            yield f"data: {json.dumps({'type': 'error', 'text': msg})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': f'Unexpected error: {str(e)}'})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(generate_stream(), mimetype='text/event-stream')

@app.route('/api/retrieve_and_generate', methods=['POST'])
def retrieve_and_generate_legacy():
    return chat()


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
