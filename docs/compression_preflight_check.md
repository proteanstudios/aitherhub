# 1080p圧縮機能 - 本番デプロイ事前確認

## 1. Dockerfile.batch の確認

**結果: OK**

- `apt-get install ffmpeg` が含まれている → `ffmpeg` と `ffprobe` の両方がインストールされる
- `azure-storage-blob==12.19.1` が requirements.txt に含まれている → Blob SDK利用可能
- `video_compressor.py` は `worker/batch/` に配置 → `COPY worker/batch/ /app/batch/` でコンテナに含まれる

## 2. ワーカーのデプロイ方式

**確認事項:**
- CI/CDワークフローはバックエンド（Azure Web App）とフロントエンド（Azure Static Web Apps）のみ
- **ワーカーのDockerイメージビルド/デプロイのCI/CDは見当たらない**
- ワーカーは手動でDockerイメージをビルド・プッシュしている可能性が高い

→ **要確認**: ワーカーのDockerイメージのビルド・デプロイ手順

## 3. ディスク容量

**懸念:**
- 13GBの元ファイル + 圧縮後ファイル（1-2GB）= 一時的に約15GB必要
- ワーカーVMのディスクサイズが十分か確認が必要

→ **要確認**: ワーカーVMのディスクサイズ

## 4. 既存ジョブへの影響

**STEP_ORDERのインデックス変更:**
- COMPRESS が index 0 に追加 → 全ステップが +1
- resume条件: `raw_start_step >= 8` (旧: >= 7)
- 既にSTEP_7以降で中断している動画がある場合、resumeインデックスがずれる

**対策:**
- デプロイ前に処理中の動画がないことを確認
- または、DBの status カラムの値は文字列なので `status_to_step_index()` で正しく解決される
  → 実際には **影響なし**（statusは文字列 "STEP_7_GROUPING" 等で保存されており、STEP_ORDERの `.index()` で動的に解決される）

## 5. フォールバック安全性

- 圧縮失敗時 → 元ファイルをそのまま使用（フォールバック）
- FFmpegが見つからない場合 → 圧縮スキップ
- ffprobeが見つからない場合 → ファイルサイズのみで判定
- Blobアップロード失敗 → ログに警告を出すが処理は継続

## まとめ

| 項目 | 状態 | 備考 |
|------|------|------|
| FFmpeg/FFprobe | OK | Dockerfile.batchに含まれている |
| Azure SDK | OK | requirements.txtに含まれている |
| CI/CD | 要確認 | ワーカーのデプロイ手順を確認 |
| ディスク容量 | 要確認 | 15GB以上必要 |
| 既存ジョブ | OK | statusは文字列で保存、動的解決 |
| フォールバック | OK | 全ての失敗パスで安全にフォールバック |
