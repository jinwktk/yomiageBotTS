import express from 'express';
import type { Request, Response } from 'express';
import { createHmac } from 'crypto';
import type { 
  IGitHubWebHookHandler, 
  GitHubWebHookPayload, 
  ILogger,
  IUpdateHandler 
} from '../interfaces/github-monitor.interface.js';
import type { GitHubMonitorConfig } from '../config.js';

export class GitHubWebHookHandlerService implements IGitHubWebHookHandler {
  private app: express.Application;
  private server: any;
  private readonly config: GitHubMonitorConfig;
  private readonly logger: ILogger;
  private readonly updateHandler: IUpdateHandler;
  private running: boolean = false;

  constructor(config: GitHubMonitorConfig, logger: ILogger, updateHandler: IUpdateHandler) {
    this.config = config;
    this.logger = logger;
    this.updateHandler = updateHandler;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // JSONボディのrawデータを保持（署名検証に必要）
    this.app.use(express.raw({ type: 'application/json' }));
  }

  private setupRoutes(): void {
    this.app.post(this.config.webhook.path, async (req: Request, res: Response) => {
      try {
        const signature = req.headers['x-hub-signature-256'] as string;
        const body = req.body.toString();

        // 署名検証
        if (!this.verifySignature(body, signature)) {
          this.logger.warn('[WebHook] Invalid signature received');
          return res.status(401).json({ error: 'Invalid signature' });
        }

        const payload: GitHubWebHookPayload = JSON.parse(body);

        // 対象ブランチのチェック
        const expectedRef = `refs/heads/${this.config.branch}`;
        if (payload.ref !== expectedRef) {
          this.logger.debug(`[WebHook] Ignoring push to ${payload.ref}, monitoring ${expectedRef}`);
          return res.status(200).json({ message: 'Branch not monitored' });
        }

        // リポジトリ名のチェック
        const expectedRepo = `${this.config.repositoryOwner}/${this.config.repositoryName}`;
        if (payload.repository.full_name !== expectedRepo) {
          this.logger.warn(`[WebHook] Repository mismatch: ${payload.repository.full_name} !== ${expectedRepo}`);
          return res.status(400).json({ error: 'Repository not monitored' });
        }

        // 更新処理
        const newSha = payload.after;
        this.logger.info(`[WebHook] 新しいコミット受信: ${payload.before.substring(0, 7)} → ${newSha.substring(0, 7)}`);
        this.logger.info(`[WebHook] コミットメッセージ: ${payload.head_commit.message}`);

        // 非同期で更新処理を実行（レスポンスを先に返す）
        setImmediate(async () => {
          try {
            await this.updateHandler.handleUpdate(newSha);
          } catch (error) {
            this.logger.error('[WebHook] 更新処理中にエラーが発生:', error);
          }
        });

        res.status(200).json({ message: 'Webhook received successfully' });

      } catch (error) {
        this.logger.error('[WebHook] WebHook処理中にエラーが発生:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ヘルスチェックエンドポイント
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ 
        status: 'ok', 
        webhook: this.running,
        timestamp: new Date().toISOString()
      });
    });
  }

  public verifySignature(body: string, signature: string): boolean {
    if (!this.config.webhook.secret) {
      this.logger.warn('[WebHook] WebHookシークレットが設定されていません');
      return false;
    }

    if (!signature) {
      this.logger.warn('[WebHook] 署名ヘッダーがありません');
      return false;
    }

    const expectedSignature = 'sha256=' + createHmac('sha256', this.config.webhook.secret)
      .update(body)
      .digest('hex');

    return signature === expectedSignature;
  }

  public async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('[WebHook] WebHookサーバーは既に起動しています');
      return;
    }

    if (!this.config.webhook.secret) {
      throw new Error('GITHUB_WEBHOOK_SECRET環境変数が設定されていません');
    }

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.webhook.port, () => {
        this.running = true;
        this.logger.info(`[WebHook] GitHub WebHookサーバーを開始: ポート${this.config.webhook.port}, パス${this.config.webhook.path}`);
        resolve();
      });

      this.server.on('error', (error: any) => {
        this.logger.error('[WebHook] WebHookサーバー起動エラー:', error);
        reject(error);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        this.running = false;
        this.logger.info('[WebHook] GitHub WebHookサーバーを停止しました');
        resolve();
      });
    });
  }

  public isRunning(): boolean {
    return this.running;
  }
}