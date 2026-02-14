# aitherhub RAGアーキテクチャ設計書 v2

## 1. 概要

aitherhubに**RAG（Retrieval-Augmented Generation）**を導入し、過去の動画分析結果を蓄積・検索・活用することで、分析を重ねるほど精度が向上する「学習型」ビデオ分析システムを構築する。

**v2の拡張:**
本バージョンでは、新たに**売上データ**と**画面収録データ**を統合する。これにより、配信中のトークや行動が、GMV（流通取引総額）、CVR（転換率）、視聴者数といった具体的なビジネス指標にどう結びついたかを分析し、よりデータドリブンで実践的な洞察を提供することが可能になる。この機能は、特に**LCJ live streaming platform (lcjmall.com)** との連携を想定している。

## 2. アーキテクチャ全体像

```mermaid
graph TD
    subgraph Input [データ入力]
        A[動画ファイル<br>(クリーン or 画面収録)]
        B[売上データ<br>(TikTokダッシュボード画像 or LCJ API)]
    end

    subgraph Processing [分析パイプライン]
        C{データソース判定} --> D1[Pattern A: クリーン動画]
        C --> D2[Pattern B: 画面収録]

        D1 --> E1[既存パイプライン]
        B --> F[Sales Data Ingester<br>売上データ正規化]
        
        D2 --> E2[Screen Metrics Extractor<br>フレームから指標をOCR抽出]

        E1 & F --> G[RAG検索]
        E2 --> G

        G -- 類似分析を検索 --> H[(Vector DB: Qdrant)]
        G -- ライバー履歴, トップ実績を検索 --> H

        G --> I[拡張プロンプト生成<br>過去の分析 + 売上実績 + 現在のデータ]
        I --> J[LLM分析 (GPT-4o)]
        J --> K[分析レポート生成]
    end

    subgraph Output [出力と学習]
        K --> L[分析結果出力]
        K --> M[ナレッジベースに蓄積]
        M -- 分析結果 + 売上データ --> H
        L --> N[ユーザーフィードバック]
        N -- 品質評価 --> O[品質スコア更新]
        O --> H
    end

    style Input fill:#f9f,stroke:#333,stroke-width:2px
    style Output fill:#ccf,stroke:#333,stroke-width:2px
```

## 3. 技術選定

| コンポーネント | 技術 | 理由 |
|:---|:---|:---|
| Vector Database | **Qdrant** | 軽量、Docker対応、Python SDK充実、フィルタリング機能が強力。v2で追加された売上データ（GMV等）やライバーIDでの絞り込み検索に不可欠。 |
| Embedding Model | **OpenAI text-embedding-3-small** | 高精度、低コスト、1536次元。v2では売上コンテキストもベクトルに含める。 |
| LLM / Vision | **GPT-4o**（既存と統一） | マルチモーダル対応、高精度。分析だけでなく、v2で追加された売上データや画面収録からのOCRにも活用。 |
| フィードバックDB | **既存MySQL** | 新規DBを追加せず既存インフラを活用。 |

## 4. データモデル (v2)

### 4.1 Vector DB（Qdrant）に蓄積するドキュメント

各動画の**フェーズごと**に分析結果を以下の構造でベクトル化・蓄積する。v2ではライバー情報と売上関連データが大幅に拡充された。

```json
{
    "id": "{uuid}",
    "vector": [0.012, -0.034, ...],
    "payload": {
        "video_id": "uuid",
        "phase_index": 0,
        "phase_type": "product_demo",
        "speech_text": "この商品は...",
        "visual_context": "配信者が商品を手に持って...",
        "behavior_label": "product_demo",
        "ai_insight": "商品の特徴を...",
        "user_email": "user@example.com",
        "quality_score": 0.2,
        "feedback_count": 1,
        "duration_seconds": 120.5,
        "created_at": "2026-02-15T10:00:00Z",

        "liver_id": "lcj_liver_12345",
        "liver_name": "テストライバー",

        "sales_data": {
            "gmv": 150000,
            "total_orders": 45,
            "cvr": 1.9,
            "viewers": 3200
        },
        "set_products": [
            {
                "name": "美容セットA",
                "quantity_sold": 15,
                "set_revenue": 59700
            }
        ],
        "screen_metrics": {
            "viewer_count": 1500,
            "likes": 5000,
            "shopping_rank": 5
        },

        "metadata": {
            "filename": "NANA2026-2-15.mp4",
            "total_duration": 3600,
            "platform": "tiktok",
            "stream_date": "2026-02-15",
            "data_source": "clean" 
        }
    }
}
```

**Payload Index (v2で追加・更新):**
高速なフィルタリングのため、以下のフィールドにインデックスを作成する。
- `liver_id` (keyword)
- `sales_data.gmv` (float)
- `sales_data.cvr` (float)
- `metadata.data_source` (keyword)
- `metadata.stream_date` (keyword)

## 5. 実装ファイル構成 (v2)

```
worker/batch/
├── ai/
│   ├── llm_pipeline.py
│   └── prompts.py
├── rag/                         # RAGコアロジック
│   ├── __init__.py
│   ├── rag_client.py            # Qdrantクライアント (v2: Index追加)
│   ├── embedding_service.py     # Embeddingサービス (v2: 売上コンテキスト対応)
│   ├── knowledge_store.py       # ナレッジ蓄積 (v2: 売上データ対応)
│   ├── knowledge_retriever.py   # ナレッジ検索 (v2: 売上/ライバーフィルタ対応)
│   ├── rag_prompt_builder.py    # プロンプト生成 (v2: 売上/ライバー履歴対応)
│   ├── sales_data_ingester.py   # [新規] 売上データ取り込み (OCR, API)
│   └── screen_metrics_extractor.py # [新規] 画面収録データ抽出 (OCR)
└── process_video.py

backend/app/api/v1/endpoints/
├── feedback.py              # フィードバックAPI
└── external_api.py          # [新規] LCJ等外部連携用API

scripts/
└── backfill_knowledge_base.py # [新規] 過去データ登録用スクリプト

tests/
└── test_sales_integration.py  # [新規] v2機能のテストコード
```

## 6. 処理フロー詳細 (v2)

### 6.1 データ取り込みフロー

- **Pattern A (クリーン動画 + 売上データ):**
  1. `sales_data_ingester`が起動。
  2. 入力ソース（TikTokダッシュボード画像、LCJ APIのJSON等）に応じて処理を分岐。
  3. 画像の場合はGPT-4o VisionでOCRを実行し、構造化データ（`sales_data`, `set_products`）を抽出。
  4. APIデータの場合はフィールドを正規化。
  5. 正規化されたデータを`knowledge_store`に渡す。

- **Pattern B (画面収録動画):**
  1. `screen_metrics_extractor`が起動。
  2. 動画から一定間隔でキーフレームを抽出。
  3. 各フレームに対し、GPT-4o VisionでUI要素（視聴者数、いいね数、コメント等）をOCRで読み取り、`screen_metrics`を生成。
  4. 複数フレームの結果を集計（最大値、平均値、トレンド等）し、`knowledge_store`に渡す。

### 6.2 分析時のRAG検索フロー

1.  現在の分析対象フェーズのデータ（`speech_text`, `visual_context`）と、取り込まれた売上コンテキスト（`sales_context`）からクエリベクトルを生成。
2.  `knowledge_retriever`がQdrantに対して複数の検索を実行:
    *   **類似分析検索:** クエリベクトルとのコサイン類似度が高い過去の分析例を検索。
    *   **ライバー特化検索:** `liver_id`でフィルタリングし、同じ配信者の過去の分析に絞り込む。
    *   **トップパフォーマー検索:** `sales_data.gmv`や`sales_data.cvr`が高い分析例をベンチマークとして取得。
3.  `rag_prompt_builder`が、これらの検索結果と現在の分析対象データを統合し、以下のような多角的なプロンプトを生成する。
    > - **ベンチマーク:** 「過去のトップパフォーマー（GMV 50万円）は、このフェーズで次のように話していました...」
    > - **ライバーの過去実績:** 「あなたの前回の配信（GMV 10万円）と比較して、今回は...」
    > - **類似例:** 「類似の状況（商品デモ）では、以下のトークが効果的でした...」
    > - **現在のデータ:** 「上記を踏まえ、今回の配信（GMV 15万円）を分析し、具体的な改善点を提案してください。」
4.  生成された拡張プロンプトをGPT-4oに送信し、分析結果を取得。

### 6.3 分析結果の蓄積フロー

1.  LLM分析が完了。
2.  分析結果（`ai_insight`等）と、入力された売上データ（`sales_data`, `set_products`, `screen_metrics`）をペイロードに含める。
3.  `knowledge_store`がペイロード全体からEmbeddingを生成。
4.  Qdrantに`upsert`でデータを保存。`video_id`と`phase_index`の組み合わせで一意性を担保する。

### 6.4 フィードバック反映フロー

(v1から変更なし) ユーザーからの評価（良い/悪い）に基づき、`quality_score`を更新。スコアはRAG検索時の優先度に影響する。

## 7. Docker構成への追加

(v1から変更なし) `docker-compose.yml`に`qdrant`サービスを追加する。

```yaml
# docker-compose.ymlに追加
qdrant:
  image: qdrant/qdrant:latest
  ports:
    - "6333:6333"
    - "6334:6334"
  volumes:
    - qdrant_data:/qdrant/storage
  environment:
    - QDRANT__SERVICE__GRPC_PORT=6334

volumes:
  qdrant_data:
```
