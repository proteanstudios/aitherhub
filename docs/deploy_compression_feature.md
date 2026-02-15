# 1080p圧縮機能 - 本番デプロイ手順書

## PR情報

- **PR #107**: `feature/direct-upload-compression` → `master`
- **変更ファイル**: 7ファイル（+468行 / -18行）
- **テスト**: 55テスト全パス（22 単体 + 33 統合）

## デプロイ前チェックリスト

### 1. 処理中ジョブの確認

```bash
# Azure Queueに残っているメッセージがないか確認
# Azure Portal → Storage Account → Queues → video-jobs
# メッセージ数が 0 であることを確認
```

### 2. 処理中の動画がないか確認

```sql
-- DBで処理中の動画を確認
SELECT id, status, created_at
FROM videos
WHERE status NOT IN ('DONE', 'ERROR', 'NEW', 'uploaded')
ORDER BY created_at DESC;
```

処理中の動画がある場合は、完了を待ってからデプロイする。

### 3. ディスク容量の確認

ワーカーVMに最低 **20GB** の空きディスクが必要（13GB元ファイル + 圧縮中の一時ファイル + 余裕）。

```bash
# ワーカーVM上で
df -h /tmp
```

## デプロイ手順

### Step 1: PRをマージ

```bash
# GitHub上でPR #107をマージ
# または CLI で:
gh pr merge 107 --squash
```

### Step 2: バックエンドのデプロイ

masterへのマージにより、GitHub Actionsが自動的にバックエンドをデプロイする。

- `master_aitherhubapi.yml` → Azure Web App (aitherhubAPI)
- `master_fast-api-kyogoku.yml` → Azure Web App (fast-api-kyogoku)

デプロイ完了を確認:
```bash
# GitHub Actions のステータスを確認
gh run list --limit 3
```

### Step 3: フロントエンドのデプロイ

masterへのマージにより、GitHub Actionsが自動的にフロントエンドをデプロイする。

- `githubworkflowsdeploy-swa-frontend.yml` → Azure Static Web Apps

### Step 4: ワーカーのDockerイメージ更新

**注意**: ワーカーのCI/CDは自動化されていないため、手動でビルド・デプロイが必要。

```bash
# 1. リポジトリを最新に更新
git pull origin master

# 2. Dockerイメージをビルド
docker build -f worker/Dockerfile.batch -t aitherhub-worker:latest .

# 3. Azure Container Registry にプッシュ（ACR名は環境に合わせて変更）
docker tag aitherhub-worker:latest <ACR_NAME>.azurecr.io/aitherhub-worker:latest
docker push <ACR_NAME>.azurecr.io/aitherhub-worker:latest

# 4. ワーカーを再起動
# Azure Container Instances / Azure Batch の場合:
# Azure Portal から手動で再起動
```

## デプロイ後の動作確認

### 1. 小さい動画でテスト（推奨: 100MB以下）

1. テスト用の動画をアップロード
2. フロントエンドで「動画を1080pに圧縮中...」が表示されることを確認
3. ワーカーログで以下を確認:

```
=== STEP COMPRESS – 1080P COMPRESSION ===
[COMPRESS] Resolution: 1920x1080, size: 0.10 GB
[COMPRESS] Skipping – already ≤1080p and <2GB
[COMPRESS] Using video: /tmp/xxx.mp4 (0.10 GB)
```

### 2. 大容量動画でテスト（1GB以上）

1. 1080p超の動画をアップロード
2. ワーカーログで圧縮が実行されることを確認:

```
=== STEP COMPRESS – 1080P COMPRESSION ===
[COMPRESS] Resolution: 3840x2160, size: 5.20 GB
[COMPRESS] Compressing to 1080p...
[COMPRESS] Compression complete: 5.20 GB → 0.85 GB (83.7% reduction)
[COMPRESS] Uploading compressed file to blob...
[COMPRESS] Using video: /tmp/xxx_1080p.mp4 (0.85 GB)
```

### 3. 後続ステップの正常動作確認

- STEP 0 (フレーム抽出) が正常に完了
- STEP 3 (音声書き起こし) が正常に完了
- 最終的に DONE ステータスになること

## ロールバック手順

問題が発生した場合:

```bash
# 1. PRのrevertコミットを作成
git revert <merge_commit_hash>
git push origin master

# 2. ワーカーのDockerイメージを前のバージョンに戻す
docker tag aitherhub-worker:previous <ACR_NAME>.azurecr.io/aitherhub-worker:latest
docker push <ACR_NAME>.azurecr.io/aitherhub-worker:latest

# 3. ワーカーを再起動
```

圧縮機能は**フォールバック設計**のため、圧縮が失敗しても元のファイルで処理が続行される。
ロールバックが必要になるのは、圧縮ステップ自体がクラッシュする場合のみ。

## 環境変数

新しい環境変数の追加は**不要**。既存の以下の変数を使用:

| 変数 | 用途 |
|------|------|
| `AZURE_STORAGE_CONNECTION_STRING` | Blob Storageへの圧縮ファイルアップロード |
| `AZURE_BLOB_CONTAINER_NAME` | コンテナ名（デフォルト: `videos`） |

## 技術的な注意事項

1. **圧縮時間**: 2時間の4K動画で約30分〜2時間（VMスペックに依存）
2. **一時ディスク使用量**: 元ファイル + 圧縮ファイルで最大2倍
3. **Blob Storage**: 圧縮後のファイルで元のBlobを上書きする（ストレージ節約）
4. **既存動画への影響なし**: 新規アップロードのみに適用
