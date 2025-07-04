# Yomiage Bot (TypeScript版)

Discordボイスチャンネルでテキストメッセージを音声読み上げし、リアルタイム録音・再生機能を提供するボットです。

## 🎯 主な機能

### 音声読み上げ機能
- **VOICEVOX連携**: 高品質な日本語音声合成
- **RVC連携**: リアルタイム声変換でユーザー別の声を再現
- **音声キュー**: 複数の音声を順番に再生（競合防止）
- **自動参加・退出**: ユーザーの入退室に応じて自動でVCに参加・退出（0人の場合は参加しない・退出する）
- **定期的な空チャンネルチェック**: 5分間隔で空チャンネルを監視し自動退出

### 録音・再生機能
- **リアルタイム録音**: ボイスチャットの会話を自動録音
- **バッファリング録音**: 30分間の音声バッファを保持（永続化対応）
- **リプレイ機能**: 過去の会話を指定時間分再生（バッファリング優先）
- **音量ノーマライズ**: FFmpegを使用した高品質な音声処理
- **ユーザー別録音**: 特定ユーザーまたは全ユーザーの録音を取得

### 挨拶機能
- **参加時**: 「〇〇さん、こんちゃ！」（ユーザー名が取得できる場合のみ）
- **退出時**: 「〇〇さん、またね！」（他のユーザーが残っている場合のみ）

## 🛠️ 必要な環境

### 必須ソフトウェア
- **Node.js** (v18以上)
- **FFmpeg** (音声処理用)
- **VOICEVOX** (音声合成エンジン)
- **RVC** (声変換エンジン)

### 環境変数
`.env`ファイルを作成し、以下の設定を行ってください：

```env
# Discord設定（必須）
DISCORD_TOKEN=your_discord_bot_token
APPLICATION_ID=your_application_id
```

## 📦 インストール

1. **リポジトリのクローン**
```bash
git clone https://github.com/jinwktk/yomiageBotTS.git
cd yomiage-bot-ts
```

2. **依存関係のインストール**
```bash
npm install
```

3. **環境設定**
- `.env`ファイルを作成し、必要な環境変数を設定
- VOICEVOXサーバーを起動（デフォルト: http://localhost:50021）
- RVCサーバーを起動（デフォルト: http://localhost:7865）
- FFmpegがPATHに含まれていることを確認

4. **ボットの起動**
```bash
# 開発モード（自動再起動）
npm run dev

# 本番モード
npm start
```

## 🎮 コマンド一覧

### 基本コマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/vjoin` | ボイスチャンネルに参加 | `/vjoin` |
| `/vleave` | ボイスチャンネルから退出 | `/vleave` |

### 音声設定コマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/vspeaker` | VOICEVOX話者を変更 | `/vspeaker speaker:29` |
| `/vsetvoice` | RVC声モデルを設定 | `/vsetvoice model:your_model` |

### 録音・再生コマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/vreplay` | 会話リプレイを再生 | `/vreplay user:@user duration:5` |
| `/vreplay` | 全員の会話リプレイ | `/vreplay duration:5` |

### 辞書コマンド

| コマンド | 説明 | 使用例 |
|---------|------|--------|
| `/vkyouiku` | 辞書に単語を登録 | `/vkyouiku surface:単語 pronunciation:タンゴ accent_type:1` |

## 🔧 詳細設定

### VOICEVOX設定
- デフォルト話者ID: 29
- カスタム辞書対応
- 話者変更機能

### RVC設定
- ユーザー別モデル設定
- デフォルトモデル: `omochiv2`
- 外部パス: `E:\RVC1006Nvidia\RVC1006Nvidia\assets\weights`

### 録音設定
- バッファ保持期間: 30分
- 自動クリーンアップ（3日経過で削除）
- PCM形式で保存
- 永続化機能（再起動後もバッファ復元）

### ログ設定
- 追記モード（ローテーション無効）
- ログファイル: `logs/yomiage.log`
- 自動クリーンアップ（7日経過で削除）

## 🚀 自動機能

### 自動参加
- ユーザーがVCに参加した際に自動でボットも参加
- セッション保存により再起動後も再接続
- **0人の場合は参加しない**

### 自動退出
- チャンネルが空になった際に即座に自動退出
- 5分間隔での定期的な空チャンネル監視
- 起動時の空チャンネルスキップ機能
- 挨拶なしで静かに退出

### 挨拶機能
- 参加時: ユーザー名が取得できる場合のみ挨拶
- 退出時: 他のユーザーが残っている場合のみ挨拶

## 📁 ファイル構成

```
yomiage-bot-ts/
├── src/
│   ├── bot.ts          # メインボットクラス
│   ├── config.ts       # 設定管理
│   ├── voicevox.ts     # VOICEVOX連携
│   ├── rvc.ts          # RVC連携
│   ├── logger.ts       # ログ管理
│   └── index.ts        # エントリーポイント
├── temp/               # 一時ファイル
│   ├── tts/           # 音声合成用
│   ├── buffers/       # 音声バッファ用
│   ├── buffered_replay/ # バッファリングリプレイ用
│   └── replay/        # 通常リプレイ用
├── logs/              # ログファイル
├── session.json       # セッション情報
├── .env.example       # 環境変数サンプル
├── package.json       # 依存関係
├── tsconfig.json      # TypeScript設定
└── README.md          # このファイル
```

## 🐛 トラブルシューティング

### よくある問題

1. **ボットが音声を再生しない**
   - VOICEVOXサーバーが起動しているか確認
   - FFmpegがインストールされているか確認

2. **RVC変換が失敗する**
   - RVCサーバーが起動しているか確認
   - モデルファイルが正しいパスにあるか確認

3. **録音が動作しない**
   - ボットに適切な権限があるか確認
   - ディスク容量が十分にあるか確認

## 📝 ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 🤝 貢献

プルリクエストやイシューの報告を歓迎します！

## 📞 サポート

問題が発生した場合は、GitHubのイシューで報告してください。 