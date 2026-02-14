# aitherhub RAG機能 デプロイガイド v2

## 1. 概要

本ガイドでは、aitherhubにRAG（検索拡張生成）機能の**v2**をデプロイする手順を説明します。v2では新たに**売上データ**と**画面収録データ**を統合し、よりデータドリブンな分析を実現します。

| バージョン | 主な機能 |
|:---|:---|
| v1 | 基本的なRAG機能（過去の分析結果の蓄積と検索） |
| **v2** | **売上データ統合、ライバー別分析、トップパフォーマー比較、画面収録からの指標抽出** |

## 2. 前提条件

| 項目 | 要件 |
|:---|:---|
| Docker | v20.10以上 |
| Docker Compose | v2.0以上 |
| 既存aitherhub環境 | 正常に動作していること |
| Azure OpenAI | `text-embedding-3-small` および `gpt-4o` (Vision対応) がデプロイ済み |

## 3. デプロイ手順

### Step 1: ファイル構成の更新

以下のファイルをリポジトリの対応する位置に追加・更新します。

```
worker/batch/rag/                 # RAGコアロジック (v2に更新)
├── __init__.py
├── rag_client.py
├── embedding_service.py
├── knowledge_store.py
├── knowledge_retriever.py
├── rag_prompt_builder.py
├── sales_data_ingester.py   # [新規]
└── screen_metrics_extractor.py # [新規]

backend/app/api/v1/endpoints/
├── feedback.py              # (更新)
└── external_api.py          # [新規]

scripts/
└── backfill_knowledge_base.py # [新規]

tests/
└── test_sales_integration.py  # [新規]
```

### Step 2: 依存パッケージの追加

#### Worker
`worker/batch/requirements.txt` に以下を追加します。

```
# for RAG v2
qdrant-client>=1.7.0
azure-storage-blob>=12.19.0
requests>=2.31.0
```

#### Backend
`backend/requirements.txt` に以下を追加します。FastAPIでのファイルアップロードに必要です。

```
# for external_api file uploads
python-multipart>=0.0.9
```

### Step 3: Docker構成の更新

`docker-compose.yml` に `qdrant` サービスが追加されていることを確認します。（v1から変更なし）

```yaml
services:
  # ... 既存サービス ...

  qdrant:
    image: qdrant/qdrant:v1.8.2 # 最新版を推奨
    container_name: aitherhub-qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped
    networks:
      - app-network

volumes:
  # ... 既存ボリューム ...
  qdrant_data:
```

### Step 4: 環境変数の追加

`.env` ファイルに、Visionモデル用の環境変数を追加します。

```env
# --- RAG v1 Configuration ---
QDRANT_HOST=qdrant
QDRANT_PORT=6333
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_VERSION=2024-02-01

# --- RAG v2 Configuration ---
VISION_MODEL=gpt-4o
VISION_API_VERSION=2024-06-01
```

### Step 5: APIルーターの追加

`backend/app/api/v1/router.py` に、v2で新設された外部連携APIのエンドポイントを追加します。

```python
from app.api.v1.endpoints import feedback, external_api

# ...

api_router.include_router(feedback.router, prefix="/feedback", tags=["feedback"])
api_router.include_router(external_api.router, prefix="/external", tags=["external"])
```

### Step 6: デプロイ実行

```bash
# 依存関係を更新したコンテナを再ビルド
docker-compose build worker backend

# Qdrantを起動
docker-compose up -d qdrant

# 全サービスを起動
docker-compose up -d
```

### Step 7: 動作確認

```bash
# Qdrant ヘルスチェック
curl http://localhost:6333/healthz
# expected: "ok"

# v2 拡張統計APIの確認
curl http://localhost:8000/api/v1/external/stats
# expected: JSON response with total_gmv, total_livers etc.
```

## 4. 運用ガイド (v2)

### 4.1 過去データのバックフィル

ナレッジベースを構築するため、過去の分析結果（50本以上推奨）を登録します。`scripts/backfill_knowledge_base.py` を使用します。

```bash
# Dockerコンテナ内でスクリプトを実行
docker-compose exec worker python3 scripts/backfill_knowledge_base.py --source local --dir /path/to/your/past/analyses
```

`--source`には `local`（JSONファイル群）、`azure`（Blob Storage）、`api`（既存API）を指定できます。

### 4.2 データ入力パターン

v2では、2つのデータ入力パターンに対応します。

| パターン | 動画 | 売上データ | 処理フロー |
|:---|:---|:---|:---|
| **A** | クリーン動画 | TikTokダッシュボードの**スクリーンショット** | `sales_data_ingester`がOCRでデータを抽出。 |
| **B** | 画面収録動画 | なし（動画内から抽出） | `screen_metrics_extractor`が動画フレームをOCRし、視聴者数やコメントを抽出。 |

LCJシステムと連携する場合、通常は分析完了後に **Pattern A** のデータ（動画URL + 売上データ画像）を `/api/v1/external/analysis/store` エンドポイントに送信します。

### 4.3 ナレッジベースの成長

売上データが加わったことで、ナレッジベースはより高度な学習を行います。

| 蓄積数 | 期待される効果 |
|:---|:---|
| 0〜10本 | RAG効果はほぼなし |
| 10〜50本 | 類似フェーズの参照が始まる |
| 50〜200本 | **売上実績に基づいた改善提案**が可能になる |
| 200本以上 | **ライバーごとの成功・失敗パターンの特定**と、トレンド分析が可能になる |

### 4.4 バックアップ

(v1から変更なし) 定期的にQdrantのスナップショットを作成し、データをバックアップしてください。

```bash
# スナップショット作成
curl -X POST http://localhost:6333/collections/video_analysis_knowledge/snapshots

# スナップショット一覧
curl http://localhost:6333/collections/video_analysis_knowledge/snapshots
```

## 5. トラブルシューティング (v2)

| 症状 | 原因 | 対処 |
|:---|:---|:---|
| 売上データが反映されない | OCRの失敗、または入力データ形式の不一致 | `sales_data_ingester`のログを確認。入力画像の解像度や、APIのJSON構造を見直す。 |
| 画面収録から指標が取れない | 動画のUIが想定外のレイアウト | `screen_metrics_extractor`のプロンプトを調整するか、対応レイアウトを追加開発する。 |
| `external_api`が404 | APIルーターが未登録 | `backend/app/api/v1/router.py` に`external_api.router`が追加されているか確認する。 |
| テストが`AttributeError`で失敗 | lazy-loadingされたモジュールのmockパスが違う | mockのパスを `module.client` から `module._get_client` など、遅延初期化を考慮したパスに修正する。 |
