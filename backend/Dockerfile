# Serving image: answers questions from a library that was ingested elsewhere.
# Docling and PyTorch are deliberately absent, which keeps this under a gigabyte.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

COPY requirements-serve.txt .
RUN pip install --no-cache-dir -r requirements-serve.txt

# Bake the embedding and reranker models into the image so the first question is not slow.
RUN python -c "from fastembed import TextEmbedding, SparseTextEmbedding; \
from fastembed.rerank.cross_encoder import TextCrossEncoder; \
TextEmbedding('BAAI/bge-small-en-v1.5'); SparseTextEmbedding('Qdrant/bm25'); \
TextCrossEncoder('Xenova/ms-marco-MiniLM-L-6-v2')"

COPY app ./app

# The file store (PDFs, page images, photos) is a volume: page images come from the restore.
ENV FOREMAN_DATA_DIR=/data FOREMAN_SEED=0
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
