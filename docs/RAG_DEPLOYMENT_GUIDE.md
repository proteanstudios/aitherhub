# aitherhub RAG機能 デプロイガイド

## 概要

本ガイドでは、aitherhubにRAG（検索拡張生成）機能を統合するための手順を説明します。RAG機能により、システムは過去の動画分析結果を蓄積・検索し、新しい動画の分析精度を継続的に向上させることができます。

## 前提条件

| 項目 | 要件 |
|:---|:---|
| Docker | v20.10以上 |
| Docker Compose | v2.0以上 |
| 既存aitherhub環境 | 正常に動作していること |
| Azure OpenAI | text-embedding-3-smallモデルがデプロイ済み |

## デプロイ手順

### Step 1: 新規ファイルの追加

以下のファイルをリポジトリに追加します。

```
worker/batch/rag/
├── __init__.py
├── rag_client.py
├── embedding_service.py
├── knowledge_store.py
├── knowledge_retriever.py
└── rag_prompt_builder.py

backend/app/api/v1/endpoints/
└── feedback.py

frontend/src/components/
└── FeedbackPanel.jsx
```

### Step 2: 依存パッケージの追加

`worker/batch/requirements.txt` に以下を追加します。

```
qdrant-client>=1.7.0
```

OpenAIパッケージは既にインストール済みのため追加不要です。

### Step 3: Docker構成の更新

`docker-compose.yml` に Qdrant サービスを追加します。

```yaml
services:
  # ... 既存サービス ...

  qdrant:
    image: qdrant/qdrant:v1.7.4
    container_name: aitherhub-qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      - QDRANT__SERVICE__GRPC_PORT=6334
    restart: unless-stopped
    networks:
      - app-network

volumes:
  # ... 既存ボリューム ...
  qdrant_data:
```

worker サービスの `depends_on` に `qdrant` を追加します。

### Step 4: 環境変数の追加

`.env` ファイルに以下を追加します。

```env
# RAG Configuration
QDRANT_HOST=qdrant
QDRANT_PORT=6333
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_VERSION=2024-02-01
RAG_ENABLED=true
RAG_TOP_K=5
RAG_MIN_QUALITY_SCORE=0.0
```

### Step 5: 既存コードの修正

#### 5.1 process_video.py

`process_video.py` に以下の変更を適用します。

**インポートの追加（ファイル先頭）：**

```python
from rag.rag_client import get_qdrant_client, init_collection
from rag.knowledge_retriever import retrieve_similar_analyses
from rag.knowledge_store import store_video_analysis
from rag.rag_prompt_builder import build_rag_insight_prompt, build_rag_report_prompt
```

**RAG取得ステップの追加（レポート生成前）：**

```python
# RAG: Retrieve similar past analyses
rag_context = step_rag_retrieve(video_id, phase_units, user_email)
```

**RAG蓄積ステップの追加（レポート生成後）：**

```python
# RAG: Store current analysis results
step_rag_store(video_id, phase_units, user_email, filename, total_duration)
```

#### 5.2 video_status.py

VideoStatus enum に以下を追加します。

```python
STEP_RAG_RETRIEVE = "rag_retrieve"
STEP_RAG_STORE = "rag_store"
```

#### 5.3 backend/app/api/v1/router.py

フィードバックAPIルーターを追加します。

```python
from app.api.v1.endpoints import feedback
api_router.include_router(feedback.router, prefix="/feedback", tags=["feedback"])
```

### Step 6: デプロイ実行

```bash
# コンテナの再ビルドと起動
docker-compose build worker
docker-compose up -d qdrant
docker-compose up -d worker
docker-compose up -d backend
```

### Step 7: 動作確認

```bash
# Qdrant ヘルスチェック
curl http://localhost:6333/healthz

# ナレッジベース統計確認
curl http://localhost:8000/api/v1/feedback/stats
```

## 運用ガイド

### ナレッジベースの成長

RAG機能は、動画分析を重ねるほど効果が高まります。以下が目安です。

| 蓄積数 | 期待される効果 |
|:---|:---|
| 0〜10本 | RAG効果はほぼなし（ベースライン） |
| 10〜50本 | 類似フェーズの参照が始まる |
| 50〜200本 | 明確な分析品質の向上 |
| 200本以上 | 配信者ごとのパターン認識が可能に |

### フィードバックの重要性

ユーザーからのフィードバック（良い/悪い評価）は、RAGの品質を大きく左右します。良い評価を受けた分析結果は優先的に参照され、悪い評価を受けた結果は除外されます。チームメンバーに積極的なフィードバックを推奨してください。

### バックアップ

Qdrantのデータは `qdrant_data` ボリュームに保存されます。定期的なバックアップを推奨します。

```bash
# Qdrant スナップショット作成
curl -X POST http://localhost:6333/collections/video_analysis_knowledge/snapshots
```

## トラブルシューティング

| 症状 | 原因 | 対処 |
|:---|:---|:---|
| RAG検索結果が0件 | ナレッジベースが空 | 動画分析を実行してデータを蓄積 |
| Embedding生成エラー | Azure OpenAI接続不良 | 環境変数を確認 |
| Qdrant接続エラー | コンテナ未起動 | `docker-compose up -d qdrant` |
| 分析品質が変わらない | フィードバック不足 | ユーザーにフィードバックを促す |
