# aitherhub RAGアーキテクチャ設計書

## 1. 概要

aitherhubに**RAG（Retrieval-Augmented Generation）**を導入し、過去の動画分析結果を蓄積・検索・活用することで、分析を重ねるほど精度が向上する「学習型」ビデオ分析システムを構築する。

## 2. アーキテクチャ全体像

```
[動画アップロード]
       ↓
[既存パイプライン: フレーム抽出 → フェーズ検出 → 音声書き起こし → キャプション生成]
       ↓
[RAG検索] ← [Vector DB (Qdrant)]
  過去の類似分析結果を検索
       ↓
[拡張プロンプト生成]
  過去の優秀な分析例 + 現在の動画データ
       ↓
[LLM分析 (GPT-4o)]
       ↓
[分析結果出力]
       ↓
[ナレッジベースに蓄積] → [Vector DB (Qdrant)]
       ↓
[ユーザーフィードバック] → [品質スコア更新]
```

## 3. 技術選定

| コンポーネント | 技術 | 理由 |
|:---|:---|:---|
| Vector Database | **Qdrant** | 軽量、Docker対応、Python SDK充実、フィルタリング機能が強力 |
| Embedding Model | **OpenAI text-embedding-3-small** | 高精度、低コスト、1536次元 |
| LLM | **GPT-4o**（既存と統一） | マルチモーダル対応、高精度 |
| フィードバックDB | **既存MySQL** | 新規DBを追加せず既存インフラを活用 |

## 4. データモデル

### 4.1 Vector DB（Qdrant）に蓄積するドキュメント

各動画の分析結果を以下の構造でベクトル化・蓄積する：

```python
{
    "id": "video_analysis_{video_id}_{phase_index}",
    "vector": [0.012, -0.034, ...],  # embedding (1536次元)
    "payload": {
        "video_id": "uuid",
        "user_email": "user@example.com",
        "phase_type": "product_demo",        # フェーズ種別
        "speech_text": "この商品は...",       # 音声書き起こし
        "visual_context": "配信者が商品を手に持って...", # 画像キャプション
        "behavior_label": "product_demo",     # AIが付けたラベル
        "ai_insight": "商品の特徴を...",      # AIの洞察
        "quality_score": 0.0,                 # ユーザーフィードバック (-1〜1)
        "feedback_count": 0,                  # フィードバック数
        "created_at": "2026-02-14T00:00:00Z",
        "duration_seconds": 300,              # フェーズの長さ
        "metadata": {
            "filename": "NANA2026-1-11.mp4",
            "total_duration": 3600
        }
    }
}
```

### 4.2 MySQL（既存）に追加するテーブル

```sql
-- フィードバックテーブル
CREATE TABLE analysis_feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    video_id VARCHAR(255) NOT NULL,
    phase_index INT,
    user_email VARCHAR(255) NOT NULL,
    rating TINYINT NOT NULL,           -- -1(悪い), 0(普通), 1(良い)
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_video_id (video_id),
    INDEX idx_user_email (user_email)
);

-- RAG設定テーブル
CREATE TABLE rag_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    top_k INT DEFAULT 5,               -- 検索結果の上位件数
    min_quality_score FLOAT DEFAULT 0.0, -- 最低品質スコア
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_email (user_email)
);
```

## 5. 実装ファイル構成

```
worker/batch/
├── ai/
│   ├── llm_pipeline.py          # 既存（修正: RAG拡張プロンプト対応）
│   ├── prompts.py               # 既存（修正: RAG用プロンプトテンプレート追加）
│   └── ...
├── rag/                         # 新規ディレクトリ
│   ├── __init__.py
│   ├── rag_client.py            # Qdrantクライアント
│   ├── embedding_service.py     # Embeddingサービス
│   ├── knowledge_store.py       # ナレッジベース蓄積
│   ├── knowledge_retriever.py   # ナレッジベース検索
│   └── rag_prompt_builder.py    # RAG拡張プロンプト生成
├── process_video.py             # 既存（修正: RAGステップ追加）
└── ...

backend/app/
├── api/v1/endpoints/
│   └── feedback.py              # 新規: フィードバックAPI
├── models/
│   └── feedback.py              # 新規: フィードバックモデル
└── services/
    └── feedback_service.py      # 新規: フィードバックサービス

frontend/src/
├── components/
│   └── FeedbackPanel.jsx        # 新規: フィードバックUI
└── ...
```

## 6. 処理フロー詳細

### 6.1 分析時のRAG検索フロー

```
1. 動画のフェーズデータ（speech_text + visual_context）を取得
2. Embeddingモデルでベクトル化
3. Qdrantで類似ベクトルを検索（top_k=5, quality_score >= 0）
4. 検索結果から「優秀な分析例」を抽出
5. RAG拡張プロンプトを生成:
   - 「以下は過去の類似配信の優れた分析例です:」
   - [例1] speech: "..." → analysis: "..."
   - [例2] speech: "..." → analysis: "..."
   - 「上記を参考に、以下の配信を分析してください:」
   - [現在の動画データ]
6. LLMに送信して分析結果を取得
```

### 6.2 分析結果の蓄積フロー

```
1. LLM分析が完了
2. 分析結果（speech_text + visual_context + ai_insight）をEmbedding化
3. Qdrantにupsert（video_id + phase_indexをキーとして）
4. 初期quality_scoreは0.0（ニュートラル）
```

### 6.3 フィードバック反映フロー

```
1. ユーザーが分析結果に対して評価（良い/悪い）を送信
2. MySQLのanalysis_feedbackテーブルに保存
3. Qdrant上の該当ドキュメントのquality_scoreを更新
   - 良い評価 → +0.2（最大1.0）
   - 悪い評価 → -0.3（最小-1.0）
4. quality_scoreが高いほど、RAG検索で優先的に参照される
```

## 7. Docker構成への追加

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
