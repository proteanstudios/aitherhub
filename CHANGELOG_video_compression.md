# 動画圧縮システム実装サマリー (2026-02-20)

## 概要
動画プレビュー再生のパフォーマンスを改善するため、圧縮版プレビューシステムを実装しました。

## 変更ファイル一覧

### 新規作成
| ファイル | 説明 |
|---------|------|
| `worker/batch/compress_background.py` | バックグラウンド圧縮スクリプト（1080p圧縮→別ファイルとして保存） |
| `backend/migrations/versions/20260220_add_compressed_blob_url.py` | Alembicマイグレーション（compressed_blob_urlカラム追加） |

### 変更
| ファイル | 変更内容 |
|---------|---------|
| `backend/app/models/orm/video.py` | `compressed_blob_url`カラムをORMモデルに追加 |
| `backend/app/api/v1/endpoints/video.py` | video detail APIに`preview_url`と`compressed_blob_url`を追加 |
| `backend/app/main.py` | 起動時にcompressed_blob_urlカラムを自動追加（IF NOT EXISTS） |
| `frontend/src/components/MainContent.jsx` | `normalizeVideoData`に`preview_url`と`compressed_blob_url`を追加 |
| `frontend/src/components/VideoDetail.jsx` | プレビュー再生時に圧縮版URLを優先使用するロジック追加 |
| `frontend/src/components/modals/VideoPreviewModal.jsx` | `preload="metadata"`確認済み（既に設定済み） |

## アーキテクチャ

### 動画URL使い分け
- **プレビュー再生**: 圧縮版1080p (`{video_id}_preview.mp4`) → 軽量で高速
- **クリップ生成**: オリジナル高画質版 (`{video_id}.mp4`) → 品質維持

### Blob Storage命名規則
```
オリジナル:  email/video_id/video_id.mp4
プレビュー:  email/video_id/video_id_preview.mp4
```

### フロントエンドURL優先順位
1. フェーズ固有のクリップURL（`video_clip_url`）
2. 圧縮版プレビューURL（`preview_url`）
3. オリジナルダウンロードURL（フォールバック）

## デプロイ状況
- **フロントエンド**: GitHub Actions → Azure Static Web Apps（自動デプロイ）
- **バックエンド**: GitHub Actions → Azure App Service（自動デプロイ）
- **ワーカー**: Azure VM（手動デプロイが必要 - SSH, git pull, restart）
- **DBマイグレーション**: バックエンド起動時に自動実行（IF NOT EXISTS）

## 次のステップ
1. バックエンドのデプロイ完了を確認
2. ワーカーVMにSSHしてgit pull & restart（compress_background.pyを有効化）
3. 既存動画の圧縮版を生成（バッチ処理）
