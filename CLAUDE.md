# YomiageBot TypeScript - CLAUDE.md

## プロジェクト概要

Discord用の読み上げボットで、TypeScriptで実装されています。RVCとVOICEVOXを使用した音声合成機能と、GitHub更新の自動監視・プル・再起動機能を持ちます。

## フォルダ構成

```
yomiageBotTS/
├── src/
│   ├── interfaces/           # 型定義とインターフェース
│   │   └── github-monitor.interface.ts
│   ├── services/            # ビジネスロジック層
│   │   ├── github-api.service.ts
│   │   ├── github-monitor.service.ts
│   │   ├── update-handler.service.ts
│   │   ├── logger.service.ts
│   │   └── github-monitor-controller.service.ts
│   ├── __tests__/           # ユニットテスト
│   │   ├── github-monitor.service.test.ts
│   │   └── update-handler.service.test.ts
│   ├── bot.ts               # Discord Bot メインロジック
│   ├── config.ts            # 設定管理
│   ├── index.ts             # エントリーポイント
│   ├── logger.ts            # 旧ログ機能
│   ├── rvc.ts               # RVC音声合成
│   ├── speech.ts            # 音声処理
│   └── voicevox.ts          # VOICEVOX音声合成
├── dist/                    # TypeScriptコンパイル済みファイル
├── coverage/                # テストカバレッジレポート
├── .env.example             # 環境変数サンプル
├── jest.config.js           # Jest設定
├── nodemon.json             # Nodemon設定
├── package.json             # NPM設定
└── tsconfig.json            # TypeScript設定
```

## 開発履歴

### 2025-06-23: GitHub監視システムの実装とリファクタリング

#### TDD（テスト駆動開発）による実装
1. **テスト作成フェーズ**
   - GitHub監視とUpdate Handlerのテストを先に作成
   - Jest設定とテスト環境の構築
   - 期待する動作を明確に定義

2. **実装フェーズ**
   - GitHubMonitorクラス: リポジトリ更新の監視
   - UpdateHandlerクラス: git pullと自動再起動
   - メインアプリケーションへの統合

3. **リファクタリングフェーズ**
   - 依存性注入(DI)パターンの導入
   - インターフェースによる抽象化
   - サービス層の分離とモジュール化

#### アーキテクチャ改善
- **Before**: モノリシックな構造
- **After**: レイヤード・アーキテクチャ
  - Interface層: 型定義とコントラクト
  - Service層: ビジネスロジック
  - Controller層: 制御フロー

#### 新機能
- GitHub APIによるリアルタイム更新監視（30秒間隔）
- 自動git pullとNodemonによる再起動
- 構造化ログ出力（プレフィックス付き）
- 環境変数による設定の外部化
- タイムアウト機能付きAPI呼び出し

## 技術スタック

### 開発環境
- **言語**: TypeScript 5.8.3
- **ランタイム**: Node.js (ESModules)
- **テスト**: Jest 29.7.0 + ts-jest
- **開発サーバー**: Nodemon 3.1.10

### 主要依存関係
- **Discord**: discord.js 14.20.0, @discordjs/voice 0.18.0
- **音声**: @discordjs/opus 0.10.0, ffmpeg-static 5.2.0
- **HTTP**: axios 1.10.0
- **音声合成**: @gradio/client 1.15.3 (RVC用)
- **その他**: dotenv 16.5.0, uuid 11.1.0

## 設定管理

### 環境変数 (.env)
```bash
# 必須設定
DISCORD_TOKEN=your_discord_bot_token
APPLICATION_ID=your_application_id

# GitHub監視設定（オプション）
GITHUB_MONITOR_ENABLED=true                    # 監視有効/無効
GITHUB_REPO_OWNER=jinwktk                     # リポジトリオーナー
GITHUB_REPO_NAME=yomiageBotTS                 # リポジトリ名
GITHUB_BRANCH=main                            # 監視ブランチ
GITHUB_CHECK_INTERVAL_MS=120000               # チェック間隔（デフォルト2分）
GITHUB_API_TIMEOUT_MS=10000                   # APIタイムアウト（ミリ秒）

# 音質・精度関連設定（オプション）
AUDIO_MAX_RECORDING_BUFFER_MINUTES=5         # 録音バッファ時間（分）
AUDIO_MIN_FILE_SIZE=512                       # 最小ファイルサイズ（バイト）
AUDIO_SILENCE_DURATION=800                    # 無音判定時間（ミリ秒）
AUDIO_TRANSCRIPTION_TIMEOUT=15000             # 文字起こしタイムアウト（ミリ秒）
AUDIO_TRANSCRIPTION_RETRIES=2                 # 文字起こしリトライ回数
AUDIO_ENHANCEMENT_ENABLED=true                # 音声前処理強化の有効/無効
AUDIO_STREAMING_SPEAKING_COOLDOWN=200         # 音声横流しのレート制限（ミリ秒）
AUDIO_STREAMING_BUFFER_FLUSH_INTERVAL=100     # バッファフラッシュ間隔（ミリ秒）
```

### NPMスクリプト
```bash
npm run dev         # 開発サーバー起動（Nodemon）
npm run build       # TypeScriptコンパイル
npm start           # 本番環境起動
npm test            # テスト実行
npm run test:watch  # テスト監視モード
npm run typecheck   # TypeScript型チェック
```

## GitHub監視システム

### 動作フロー
1. **初期化**: 現在のコミットSHAを取得
2. **監視開始**: デフォルト2分間隔でGitHub APIをポーリング
3. **更新検出**: 新しいコミットを発見
4. **自動更新**: `git pull origin main`を実行
5. **再起動**: 4段階の再起動方法で確実な再起動

### エラーハンドリング・レート制限対応
- **レート制限対応**: 403エラー時に自動的に監視間隔を延長（最大30分）
- **指数バックオフリトライ**: 一時的なエラーに対する自動リトライ
- **動的間隔調整**: 成功時は間隔を短縮、エラー時は延長
- **継続監視**: ネットワークエラー時も監視を継続
- **Git pullエラー時の再起動回避**: プル失敗時は再起動しない
- **初期化失敗時の監視なし継続**: 初期化に失敗してもアプリは継続動作

### ログ出力例
```
[App] Discord Bot を起動しました
[GitHub] GitHub監視を初期化しました。現在のSHA: abc123d
[GitHub] GitHub監視を開始しました
[GitHub] 新しいコミットを検出: abc123d → def456a
[GitHub] Git pullを実行中...
[GitHub] 更新完了。アプリケーションを再起動します。
```

## テスト戦略

### ユニットテスト
- **GitHubMonitorService**: API呼び出し、更新検出ロジック
- **UpdateHandlerService**: Git操作、再起動処理
- **モック使用**: 外部依存関係の分離

### テストカバレッジ
- インターフェース実装の網羅
- エラーケースの検証
- 非同期処理のテスト

## 開発ガイドライン

### コーディング規約
- TypeScript strictモード
- ESModules使用
- インターフェースによる型安全性
- 依存性注入パターン

### ファイル命名規則
- サービス: `*.service.ts`
- インターフェース: `*.interface.ts`
- テスト: `*.test.ts`

### Git運用
- メインブランチ: `main`
- コミットメッセージ: 日本語、機能別
- 自動監視対象: `main`ブランチ

## トラブルシューティング

### よくある問題
1. **GitHub監視が動作しない**
   - `.env`の`GITHUB_MONITOR_ENABLED`を確認
   - リポジトリ名、オーナー名の設定確認

2. **TypeScriptエラー**
   - `npm run typecheck`で型チェック
   - `moduleResolution: "NodeNext"`設定確認

3. **テスト失敗**
   - Jest設定の`moduleNameMapping`確認
   - モックの正常動作確認

### デバッグ方法
```bash
# 詳細ログ出力
NODE_ENV=development npm run dev

# 型チェックのみ
npm run typecheck

# テスト詳細出力
npm test -- --verbose
```

## 今後の拡張予定

- [ ] Webhook対応による即時更新
- [ ] 複数ブランチ監視機能
- [ ] Discord通知機能
- [ ] 監視統計の記録
- [ ] 設定UIの追加

## テスト履歴

### 2025-06-24: GitHub監視システムのテスト・改善
- サブPCでの依存関係エラーを解決
- GitHub監視システムの動作確認テスト実行中
- 自動プル・再起動機能の検証
- GitHub APIレート制限対応とエラーハンドリング強化

### 2025-06-24: 音声機能の精度・クオリティ向上
#### vreplay機能の改善
- バッファリング機能削除でファイルベース統一（軽量化）
- ところてん方式最適化（30分→5分）でメモリ効率向上
- リプレイ生成処理のパフォーマンス監視追加

#### 文字起こし機能の改善
- 無音判定緩和（1500ms→800ms）で検出感度大幅向上
- 最小ファイルサイズ調整（1KB→512B）で小さな音声もキャッチ
- 音声前処理強化：ノイズリダクション・音量正規化・人声強調
- リトライ機能とタイムアウト最適化で安定性向上

#### 音声横流し機能の改善
- レート制限緩和（500ms→200ms）で取りこぼし削減
- 複数話者同時対応で全員の音声を確実に転送
- エラーハンドリング改善で継続動作を優先

#### 設定の環境変数化
- 音質・精度関連パラメーターを.envで調整可能
- AudioConfig追加で統一的な設定管理

#### パフォーマンス監視追加
- 5分間隔での詳細統計ログ出力
- メモリ使用量・接続数・処理時間の監視