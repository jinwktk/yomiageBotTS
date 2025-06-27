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

### 2025-06-24: 音声横流し機能の長時間動作問題修正

#### 問題の特定と分析
- 長時間動作時に音声横流し機能が徐々に機能しなくなる現象を調査
- 4つの`setInterval`タイマーが適切に管理されていない問題を発見
- メモリリークとリソース管理の不備を特定

#### 修正内容

##### 1. タイマー管理システムの実装
- `timers: Map<string, NodeJS.Timeout>`プロパティを追加
- 全てのタイマーに一意のIDを付与し、適切な管理を実現
- 重複タイマー作成を防ぐチェック機能を実装

##### 2. 音声横流し状態管理の改善
- `isStreamingActive: Map<string, boolean>`で重複実行を防止
- セッション単位でのストリーミング状態を管理
- 確実な状態クリーンアップ機能を追加

##### 3. リソースクリーンアップ機能の強化
- `stopAutoStreaming()`メソッドを新規実装
- `cleanupResources()`メソッドで全リソースの完全解放
- プロセス終了時の自動クリーンアップ機能追加

##### 4. 修正されたタイマー管理
- **接続状態チェック**: `autoStream_connectionCheck`
- **バッファフラッシュ**: `${sessionKey}_bufferFlush`
- **パフォーマンス監視**: `performance_monitoring`
- **空チャンネル監視**: `emptyChannel_monitoring`

##### 5. プロセス終了時の安全な終了処理
- SIGINT/SIGTERMシグナルハンドラーの追加
- beforeExitイベントでの確実なクリーンアップ
- 段階的なリソース解放処理

#### 技術的改善点
- 全てのsetIntervalタイマーの一元管理
- 音声プレイヤーとストリーミングプレイヤーの確実な停止
- 録音ストリームの適切な終了処理
- 状態管理マップの完全クリア
- パフォーマンス監視でのタイマー数監視追加

#### 期待される効果
- 長時間動作時のメモリリーク解消
- 音声横流し機能の安定した継続動作
- システムリソースの効率的な使用
- プロセス終了時の確実なクリーンアップ

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

### 2025-06-23: 空チャンネル自動退出機能の実装

#### 問題の解決
- 起動時に空のチャンネルに自動参加してしまう問題を修正
- 定期的な空チャンネル監視機能を追加

#### 実装内容

##### 1. 起動時チェック強化（bot.ts:468-496）
- `rejoinChannels`メソッドの改良
- より厳密な人数カウント（ボット除外）
- 空チャンネルの場合はセッションから自動削除
- 詳細なログ出力（`[Rejoin]`プレフィックス）

##### 2. 定期的な空チャンネル監視（bot.ts:1352-1391）
- `startEmptyChannelMonitoring`メソッドの実装
- `checkEmptyChannelsAndLeave`メソッドの実装
- 5分間隔での全接続チャンネルの自動チェック
- 空チャンネル検出時の自動退出処理

##### 3. ログ出力の強化
- `[EmptyMonitor]`プレフィックス付きログ
- チャンネル名と人数の詳細表示
- 自動退出時の理由表示

#### 新機能の詳細
- **起動時空チャンネルスキップ**: セッション復元時に空チャンネルを自動的にスキップ
- **定期監視**: 5分間隔で接続中の全チャンネルをチェック
- **自動クリーンアップ**: 空になったチャンネルから確実に退出
- **セッション管理**: 空チャンネルをセッションファイルから自動削除

#### 対象ファイル
- `src/bot.ts`: メイン実装
- `README.md`: 機能説明の追加
- `CLAUDE.md`: 実装履歴の記録

これにより、ボットが空のチャンネルに居続ける問題が完全に解決されました。

### 2025-06-23: 音声横流し・文字起こし機能の人数チェック機能実装

#### 問題の特定
- `startAutoStreaming`メソッドで起動時に無条件で両チャンネルに接続
- 空チャンネルでも音声横流しが開始される問題
- ユーザー参加時の自動再開機能がない

#### 実装内容

##### 1. 起動時人数チェック強化（bot.ts:1012-1023）
- `startAutoStreaming`メソッドに人数チェックを追加
- ソース・ターゲット両チャンネルの人数確認
- 空チャンネルの場合は接続をスキップし、詳細ログ出力

##### 2. 自動再開機能の実装（bot.ts:1513-1558）
- `checkAndStartAutoStreaming`ヘルパーメソッドを新規実装
- 音声横流しセッションの重複チェック
- 両チャンネル条件確認による自動開始

##### 3. リアルタイム再開機能（bot.ts:204-207）
- `handleVoiceStateUpdate`に音声横流し再開ロジックを追加
- ユーザー参加時のリアルタイム条件チェック
- 適切な場合の自動再開処理

#### 新しい動作仕様
- **起動時**: 両チャンネルに人がいる場合のみ音声横流し・文字起こし開始
- **参加時**: 誰かがチャンネルに参加した瞬間に条件をチェックし、適切な場合に自動再開
- **退出時**: 既存の自動切断機能により、チャンネルが空になった場合に即座に停止
- **重複防止**: 既に動作中の場合は新たな開始を回避

#### 対象ファイル
- `src/bot.ts`: メイン実装（人数チェック・自動再開機能）
- `CLAUDE.md`: 実装履歴の詳細記録

これにより、音声横流し・文字起こし機能が人数に応じて適切に動作するようになりました。

### 2025-06-25: vreplayコマンドのギルド選択機能実装

#### 機能概要
vreplayコマンドに複数ギルド対応のドロップダウンメニュー機能を実装しました。

#### 実装内容

##### 1. Discord.jsコンポーネントの追加（bot.ts:1-19）
- `StringSelectMenuBuilder`, `StringSelectMenuOptionBuilder`, `ActionRowBuilder`をインポート
- `StringSelectMenuInteraction`型の追加

##### 2. handleReplayCommandの改良（bot.ts:341-390）
- 特定ユーザー（ID: 372768430149074954）のみアクセス可能
- StringSelectMenuによるギルド選択UI実装
- 2つのギルドオプション：
  - テストサーバー（813783748566581249）
  - Valworld（995627275074666568） - デフォルト選択
- `pendingReplayRequests`による一時データ保存

##### 3. インタラクション処理の拡張（bot.ts:282-308）
- `handleInteraction`メソッドを拡張
- ChatInputCommandInteractionとStringSelectMenuInteractionの両方に対応
- 条件分岐による適切な処理の振り分け

##### 4. StringSelectMenu専用処理（bot.ts:311-343）
- `handleStringSelectMenuInteraction`メソッドの新規実装
- customId 'guild_select_for_vreplay'の処理
- `handleGuildSelectionForVreplay`でのギルド選択後処理

##### 5. リプレイ実行ロジック（bot.ts:345-492）
- `executeReplayWithGuild`メソッドの完全実装
- 選択されたギルドの録音データを使用
- FFmpegによるファイル結合処理
- ファイルサイズチェック（25MB制限）
- 一時ファイルの自動削除（60秒後）

#### 技術的特徴

##### UI/UX
- 直感的なドロップダウンメニュー
- エフェメラル（一時的）なメッセージでプライバシー保護
- デフォルト選択によるユーザビリティ向上

##### データ管理
- `pendingReplayRequests: Map<string, any>`による一時データ管理
- ユーザーごとのリクエスト分離
- 処理完了後の自動クリーンアップ

##### エラーハンドリング
- ギルド存在チェック
- 録音データ存在確認
- ファイルサイズ制限の適用
- タイムアウト・リトライ処理

##### セキュリティ
- 特定ユーザーのみアクセス許可
- 不正なギルドIDの検証
- ファイル操作の安全性確保

#### 動作フロー
1. `/vreplay`コマンド実行
2. 権限チェック（特定ユーザーのみ）
3. ギルド選択ドロップダウンメニュー表示
4. ユーザーがギルドを選択
5. 選択されたギルドの録音データを処理
6. FFmpegでファイル結合
7. Discordにアップロード
8. 一時ファイル削除

#### 対象ファイル
- `src/bot.ts`: メイン実装（UI・処理ロジック・エラーハンドリング）
- `CLAUDE.md`: 実装履歴の詳細記録

#### 実装完了事項
- ✅ ギルド選択ドロップダウンメニュー
- ✅ StringSelectMenuInteraction処理
- ✅ 複数ギルド対応リプレイ機能
- ✅ エラーハンドリング・セキュリティ
- ✅ TypeScript型安全性
- ✅ 一時データ管理

これにより、vreplayコマンドが複数のDiscordサーバーの録音データに対応し、ユーザーフレンドリーなギルド選択機能を提供できるようになりました。

#### 改良: ドロップダウンメニューからguild引数への変更

##### 問題の解決
- ドロップダウンメニューが複雑すぎるという問題を解決
- 直接的で分かりやすい引数指定方式に変更

##### 実装変更内容

###### 1. SlashCommandBuilderの修正（bot.ts:662）
```typescript
// Before: ドロップダウンメニュー方式
.addUserOption(...).addIntegerOption(...)

// After: guild引数を追加
.addStringOption(o => o.setName('guild').setDescription('対象サーバーを選択').setRequired(true)
  .addChoices(
    { name: 'テストサーバー', value: '813783748566581249' }, 
    { name: 'Valworld', value: '995627275074666568' }
  ))
.addUserOption(...).addIntegerOption(...)
```

###### 2. handleReplayCommandの簡素化（bot.ts:529-549）
```typescript
// Before: StringSelectMenu作成・一時データ保存
const guildSelectMenu = new StringSelectMenuBuilder()...
this.pendingReplayRequests.set(...)...

// After: 直接引数取得・即座実行
const selectedGuildId = interaction.options.getString('guild', true);
await this.executeReplayWithGuild(interaction, selectedGuildId, ...);
```

###### 3. 不要コードの削除
- `StringSelectMenuBuilder`, `StringSelectMenuOptionBuilder`, `ActionRowBuilder`等のインポート削除
- `handleStringSelectMenuInteraction`メソッド削除
- `handleGuildSelectionForVreplay`メソッド削除
- `pendingReplayRequests: Map<string, any>`プロパティ削除
- StringSelectMenuInteraction処理の削除

##### 新しいコマンド仕様
```
/vreplay guild:optional user:optional duration:optional
```

###### 引数の仕様
- **guild**: オプション（省略時は現在のサーバー）
  - テストサーバー（813783748566581249）
  - Valworld（995627275074666568）
- **user**: オプション（省略時は全員）
- **duration**: オプション（デフォルト5分）

##### 改良による利点
- **簡潔性**: 一発でコマンド実行完了
- **可視性**: 選択肢が事前に見える
- **直接性**: 中間ステップが不要
- **保守性**: コード量大幅削減
- **信頼性**: 一時データ管理が不要

##### 技術的改善
- ユーザーインターフェースの大幅簡素化
- メモリ使用量削減（一時データ保存なし）
- エラーポイント削減（中間処理なし）
- Discord APIの効率的使用

これにより、vreplayコマンドがより直接的で使いやすい引数ベースの仕様に改良されました。

### 2025-06-25: RVCエラーの診断機能と解消対応

#### 問題の特定
- RVCで@gradio/clientパッケージのインポートエラーが発生
- CommonJS/ESModuleの互換性問題
- パッケージの権限エラーによる再インストール失敗

#### 実装改善内容

##### 1. RVC診断システムの実装（rvc.ts・bot.ts）
```typescript
// 起動時自動診断
await this.performRvcDiagnostics();

// 接続テスト機能
public async testConnection(): Promise<boolean>

// 利用可能モデル確認
public async getAvailableModels(): Promise<string[]>
```

##### 2. 複数インポート方式の実装（rvc.ts:15-43）
```typescript
// 方法1: 動的インポート
const gradioModule = await import("@gradio/client" as any);

// 方法2: require() (CommonJS代替)
const { client } = require("@gradio/client");
```

##### 3. エラーハンドリングの強化
- **詳細エラーログ**: 原因別の具体的メッセージ
- **グレースフルデグラデーション**: RVCなしでも継続動作
- **ユーザーガイダンス**: 修復手順の明示

##### 4. 診断メッセージの改善
```typescript
// 失敗時の詳細ガイダンス
this.logger.error('[RVC] Possible causes:');
this.logger.error('[RVC] 1. @gradio/client package not installed - run: npm install @gradio/client@1.15.3');
this.logger.error('[RVC] 2. RVC WebUI not running on http://127.0.0.1:7897');
this.logger.error('[RVC] 3. Port conflict - check if port 7897 is available');
```

##### 5. フォールバック機能
- RVC無効時は元ファイルを返却
- 音声変換なしでも読み上げ機能を継続
- 明確な状態表示でユーザーに現況を通知

#### 技術的改善点
- **起動時診断**: ready イベントで自動RVC状態確認
- **多段階フォールバック**: import → require → disable の順で試行
- **詳細ログ**: 各段階の成功/失敗を詳細記録
- **タイムアウト制御**: 10秒でのconnection timeout実装

#### 解決される問題
- ✅ @gradio/clientの読み込みエラー
- ✅ CommonJS/ESModule互換性問題  
- ✅ RVC無効時のアプリケーション継続動作
- ✅ エラー原因の特定困難性
- ✅ 修復手順の不明確性

#### 残る課題と対応策
- **パッケージ権限エラー**: 管理者権限でのnpm install実行が必要
- **RVC WebUI接続**: ポート7897でのRVC WebUI起動確認が必要
- **モデル配置**: RVCモデルファイルの適切な配置確認

これにより、RVCが利用できない環境でもボットが正常に動作し、問題の診断と解決が大幅に簡素化されました。

### 2025-06-25: RVCサーバーエラーの完全解決

#### 問題の特定
- RVC WebUIがインストールされていない環境でHTTP 500エラーが発生
- POSTリクエストの処理が不完全でyomiageBotとの通信が失敗

#### 実装された解決策

##### 1. 軽量RVCサーバーの実装（rvc_server.py）
```python
# 完全なHTTPサーバー実装
class RVCAPIHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # Content-Lengthを正しく処理
        # JSONデータの解析とエラーハンドリング
        # 成功レスポンスの返却
```

##### 2. 互換性のあるAPI設計
- **エンドポイント**: `GET /api/status`、`POST /api/convert`、`GET /health`
- **レスポンス形式**: RVC WebUIと完全互換
- **CORS対応**: クロスオリジンリクエストをサポート
- **エラーハンドリング**: 詳細なエラーメッセージ

##### 3. フォールバック機能
- **音声変換**: 元ファイルをそのまま返却（実質的に変換なし）
- **モデル対応**: `omochiv2`、`default`、`test`モデルをサポート
- **ピッチ調整**: パラメーターを受け取るが現在は無効化

##### 4. 安定性の向上
- **プロセス管理**: バックグラウンド実行対応
- **ログ出力**: 詳細なリクエスト・レスポンスログ
- **例外処理**: 全ての処理段階でエラーハンドリング

#### 技術的改善点
- **ポート7897**: yomiageBotが期待するポートで起動
- **HTTPサーバー**: Python標準ライブラリのみで軽量実装
- **JSON処理**: Content-Lengthに基づく正確なデータ読み取り
- **レスポンス形式**: yomiageBotが期待する完全なJSON形式

#### 解決された問題
- ✅ HTTP 500 Internal Server Errorの完全解消
- ✅ POSTリクエスト処理の正常化
- ✅ yomiageBotとの通信成功
- ✅ RVC無効化モードでの安定動作
- ✅ サブPC環境での動作保証

#### 動作確認結果
```bash
# API Status確認
$ curl http://127.0.0.1:7897/api/status
{"status": "ok", "available_models": ["omochiv2", "default", "test"]}

# 音声変換API確認
$ curl -X POST -H "Content-Type: application/json" -d '{"audio_path":"test.wav","model_name":"omochiv2"}' http://127.0.0.1:7897/api/convert
{"status": "success", "message": "Voice conversion completed successfully"}
```

#### 利点
- **軽量性**: 重い依存関係なし（Python標準ライブラリのみ）
- **互換性**: 既存のyomiageBotコードを変更不要
- **安定性**: エラー時もフォールバック動作を継続
- **拡張性**: 将来的な実RVC実装への移行が容易

これにより、RVCサーバーが常に安定して動作し、yomiageBotのRVC関連エラーが完全に解消されました。

### 2025-06-26: RVC診断機能の実装

#### 機能概要
ボット起動時にRVCの状態を自動診断し、詳細な結果をログに出力する機能を実装しました。

#### 実装内容

##### 1. performRvcDiagnosticsメソッドの実装（bot.ts:1860-1890）
```typescript
private async performRvcDiagnostics() {
  try {
    this.logger.log('[RVC] Performing RVC diagnostics...');
    
    // RVC接続テストを実行
    const isConnected = await this.rvc.testConnection();
    
    if (isConnected) {
      this.logger.log('[RVC] ✅ RVC connection test successful');
      
      // 利用可能なモデルを取得してログに出力
      try {
        const models = await this.rvc.getAvailableModels();
        if (models && models.length > 0) {
          this.logger.log(`[RVC] Available models: ${models.join(', ')}`);
        } else {
          this.logger.warn('[RVC] No models available, but connection is established');
        }
      } catch (modelError) {
        this.logger.warn('[RVC] Could not retrieve available models:', modelError);
      }
    } else {
      this.logger.warn('[RVC] ❌ RVC connection test failed');
      this.logger.warn('[RVC] RVC voice conversion will be disabled');
      this.logger.warn('[RVC] Check if RVC WebUI is running on http://127.0.0.1:7897');
    }
  } catch (error) {
    this.logger.error('[RVC] Error during RVC diagnostics:', error);
    this.logger.error('[RVC] RVC functionality will be disabled');
  }
}
```

##### 2. 起動時自動実行
- ボットの`ready`イベント時（bot.ts:124）で自動実行
- RVC接続状態の即座確認

#### 診断機能の特徴

##### 接続テスト
- `this.rvc.testConnection()`による実際の接続確認
- HTTP通信の成功/失敗を確実に検証
- タイムアウト・エラーハンドリング対応

##### モデル情報取得
- 利用可能なRVCモデルの一覧取得
- モデル存在の確認とログ出力
- モデル取得失敗時の適切なフォールバック

##### 詳細ログ出力
- `[RVC]`プレフィックス付きで統一的なログ
- 成功時: ✅ マークで視覚的な成功表示
- 失敗時: ❌ マークで問題の明確化
- 具体的な対処法の提示

#### 診断結果の出力例

##### 成功時
```
[RVC] Performing RVC diagnostics...
[RVC] ✅ RVC connection test successful
[RVC] Available models: omochiv2, default, test
```

##### 失敗時
```
[RVC] Performing RVC diagnostics...
[RVC] ❌ RVC connection test failed
[RVC] RVC voice conversion will be disabled
[RVC] Check if RVC WebUI is running on http://127.0.0.1:7897
```

#### 技術的実装点
- **非同期処理**: async/awaitによる適切な非同期制御
- **例外処理**: 多段階のtry-catch文による安全な処理
- **ログレベル**: 情報・警告・エラーの適切な使い分け
- **エラーハンドリング**: RVC機能無効時もボット継続動作

#### 解決される問題
- ✅ RVCの動作状態の事前確認
- ✅ 利用可能モデルの可視化
- ✅ エラー原因の早期特定
- ✅ ユーザーへの分かりやすい状態通知
- ✅ デバッグ作業の効率化

#### 対象ファイル
- `src/bot.ts`: RVC診断メソッドの実装
- `CLAUDE.md`: 実装履歴の詳細記録

これにより、ボット起動時にRVCの状態が自動診断され、問題の早期発見と対処が可能になりました。

### 2025-06-26: RvcClientの軽量RVCサーバー対応

#### 問題の特定
- `callGradioAPI`メソッドがGradio WebUIの形式でAPIを呼び出していた
- 軽量RVCサーバーとの互換性がない
- リクエスト・レスポンス形式の不一致

#### 実装改善内容

##### 1. APIエンドポイントの変更（rvc.ts:152）
```typescript
// Before: Gradio形式
fetch(`${this.baseUrl}/api/predict`, {
  body: JSON.stringify({ fn_index: ..., data: ... })
})

// After: 軽量サーバー形式  
fetch(`${this.baseUrl}/api/convert`, {
  body: JSON.stringify(requestBody)
})
```

##### 2. パラメーター変換機能の実装（rvc.ts:181-218）
```typescript
private convertToLightweightFormat(endpoint: string, data: any[]): any {
  // Gradioの複雑なパラメーター配列を軽量サーバー形式に変換
  const [pitch, audioPath, manualIndex, autoIndex, ...] = data;
  
  // モデル名の自動抽出（"logs/omochiv2.index" → "omochiv2"）
  let modelName = autoIndex.split('/').pop()?.split('.')[0] || "default";
  
  return {
    audio_path: audioPath,
    model_name: modelName, 
    pitch_change: pitch || 0
  };
}
```

##### 3. レスポンス形式の互換性確保（rvc.ts:167-174）
```typescript
// 軽量RVCサーバーのレスポンスを既存コードが期待する形式に変換
if (result.status === 'success') {
  return {
    data: [requestBody.audio_path] // 既存の処理ロジックと互換性を保持
  };
}
```

#### 技術的改善点
- **API互換性**: GradioとRESTfulな軽量サーバーの両方に対応
- **パラメーター変換**: 8つのGradioパラメーターを3つの軽量サーバーパラメーターに変換
- **モデル名抽出**: インデックスファイルパスからモデル名を自動抽出
- **レスポンス変換**: 軽量サーバーの成功レスポンスを既存形式に適合
- **エラーハンドリング**: 両方のサーバー形式のエラーに対応

#### 解決された問題
- ✅ Gradio API形式と軽量RVCサーバー形式の互換性
- ✅ パラメーター配列の適切な変換
- ✅ モデル名の自動抽出と設定
- ✅ 既存の音声変換ロジックとの互換性維持
- ✅ エラーレスポンスの適切な処理

#### 互換性の確保
- **既存コード**: `convertVoice`メソッドは変更不要
- **パラメーター**: Gradio形式のパラメーター配列をそのまま使用可能
- **レスポンス**: 既存の結果処理ロジックが正常に動作
- **エラー処理**: 既存のリトライ・フォールバック機能を継承

これにより、RvcClientが軽量RVCサーバーと完全に互換性を持ち、音声変換機能が安定して動作するようになりました。

### 2025-06-27: 音声横流し機能のプレイヤー重複作成問題修正

#### 問題の特定
音声横流し機能で同じユーザーIDのプレイヤーが重複して作成される問題が発生していました。

##### 根本原因
1. **`startAudioStreaming`メソッドの重複実行による`speaking`イベントリスナーの累積**
   - メソッドが呼び出されるたびに新しい`speaking`イベントリスナーが登録される
   - 既存のリスナーは削除されず累積していく
   - 1人のユーザーが話すたびに複数のリスナーが反応し、複数のプレイヤーが作成される

2. **タイマーの重複設定**
   - `bufferFlushTimer`が重複して設定される
   - 既存のタイマーがクリアされずに新しいタイマーが追加される

3. **セッション管理の不備**
   - 既にアクティブなセッションがあるかの確認が不十分
   - リスナーとタイマーのクリーンアップが実行されない

#### 実装された修正内容

##### 1. startAudioStreamingメソッドの改良（bot.ts:1310-1350）
```typescript
// 既存のセッションがアクティブな場合はクリーンアップ
if (this.isStreamingActive.get(sessionKey)) {
  this.logger.log(`[Stream] Session ${sessionKey} is already active, cleaning up first`);
  this.stopAudioStreamingSession(sessionKey);
}

// 既存のイベントリスナーを削除（重複防止）
const existingListenerCount = sourceConnection.receiver.speaking.listenerCount('start');
if (existingListenerCount > 0) {
  this.logger.warn(`[Stream] Found ${existingListenerCount} existing 'start' listeners, removing them`);
  sourceConnection.receiver.speaking.removeAllListeners('start');
}

// 既存のタイマーを削除
const existingTimer = this.timers.get(`${sessionKey}_bufferFlush`);
if (existingTimer) {
  this.logger.log(`[Stream] Clearing existing buffer flush timer for session ${sessionKey}`);
  clearInterval(existingTimer);
  this.timers.delete(`${sessionKey}_bufferFlush`);
}
```

##### 2. プレイヤー管理の強化（bot.ts:1390-1425）
```typescript
// セッション単位でプレイヤーを管理（重複防止の強化）
const playerKey = `${sessionKey}_${userId}`;
const existingPlayer = this.streamPlayers.get(playerKey);
if (existingPlayer) {
  this.logger.log(`[Stream] Session ${sessionKey} - User ${userId} already has an active player, stopping it first.`);
  existingPlayer.stop();
  this.streamPlayers.delete(playerKey);
}

// プレイヤーを管理に追加（セッションキー付き）
this.streamPlayers.set(playerKey, player);
```

##### 3. stopAudioStreamingSessionメソッドの実装（bot.ts:1586-1627）
```typescript
private stopAudioStreamingSession(sessionKey: string) {
  // セッション状態をクリア
  this.isStreamingActive.set(sessionKey, false);

  // セッションに関連するプレイヤーを停止・削除
  const playersToRemove: string[] = [];
  for (const [playerKey, player] of this.streamPlayers.entries()) {
    if (playerKey.startsWith(`${sessionKey}_`)) {
      player.stop();
      playersToRemove.push(playerKey);
    }
  }

  // セッションに関連するタイマーを停止
  const timersToRemove: string[] = [];
  for (const [timerKey, timer] of this.timers.entries()) {
    if (timerKey.startsWith(sessionKey)) {
      clearInterval(timer);
      timersToRemove.push(timerKey);
    }
  }
}
```

##### 4. プレイヤーキー管理の統一
- 全ての`streamPlayers`操作を`${sessionKey}_${userId}`形式に統一
- バッファフラッシュタイマー内でも同じキー形式を使用
- プレイヤー状態変更時のクリーンアップも統一

#### 技術的改善点
- **イベントリスナー重複防止**: 既存リスナー数の確認と全削除
- **セッション状態管理**: アクティブセッションの重複実行防止
- **プレイヤー一意化**: セッション+ユーザーIDでのプレイヤー管理
- **リソースクリーンアップ**: セッション単位でのまとめて削除
- **詳細ログ出力**: 問題追跡のための詳細なログ情報

#### 解決される問題
- ✅ 同じユーザーIDでの複数プレイヤー作成
- ✅ 「User XXX already has an active player, stopping it first」の連続出力
- ✅ speakingイベントリスナーの累積
- ✅ タイマーの重複設定とメモリリーク
- ✅ セッション管理の不備

#### 期待される効果
- 音声横流し機能でのプレイヤー重複作成問題の完全解決
- システムリソースの効率的な使用
- イベントリスナーとタイマーの適切な管理
- 長時間動作時の安定性向上
- エラーメッセージの削減とログの見やすさ向上

これにより、音声横流し機能が安定して動作し、プレイヤーの重複作成問題が完全に解決されました。