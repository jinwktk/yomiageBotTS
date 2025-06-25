import type { IGitHubMonitor, IGitHubApi, ILogger, IGitHubWebHookHandler, IUpdateHandler } from '../interfaces/github-monitor.interface.js';
import type { GitHubMonitorConfig } from '../config.js';

export class GitHubMonitorService implements IGitHubMonitor {
  private currentSha: string = '';
  private intervalId: NodeJS.Timeout | null = null;
  private readonly config: GitHubMonitorConfig;
  private readonly githubApi: IGitHubApi;
  private readonly logger: ILogger;
  private readonly webhookHandler?: IGitHubWebHookHandler;
  private readonly updateHandler?: IUpdateHandler;
  private currentInterval: number;
  private consecutiveErrors: number = 0;

  constructor(
    config: GitHubMonitorConfig, 
    githubApi: IGitHubApi, 
    logger: ILogger,
    webhookHandler?: IGitHubWebHookHandler,
    updateHandler?: IUpdateHandler
  ) {
    this.config = config;
    this.githubApi = githubApi;
    this.logger = logger;
    this.webhookHandler = webhookHandler;
    this.updateHandler = updateHandler;
    this.currentInterval = config.checkIntervalMs;
  }

  public setCurrentSha(sha: string): void {
    this.currentSha = sha;
  }

  public async getLatestCommitSha(): Promise<string> {
    try {
      const commit = await this.githubApi.getLatestCommit(
        this.config.repositoryOwner,
        this.config.repositoryName,
        this.config.branch
      );
      return commit.sha;
    } catch (error) {
      this.logger.error('最新コミットSHA取得エラー:', error);
      throw error;
    }
  }

  public async hasUpdates(): Promise<boolean> {
    try {
      const latestSha = await this.getLatestCommitSha();
      const hasUpdate = latestSha !== this.currentSha;
      
      if (hasUpdate) {
        this.logger.info(`新しいコミットを検出: ${this.currentSha.substring(0, 7)} → ${latestSha.substring(0, 7)}`);
      }
      
      // 成功時はエラーカウンターをリセットし、間隔を正常値に戻す
      this.consecutiveErrors = 0;
      this.adjustInterval(false);
      
      return hasUpdate;
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.error('更新チェック中にエラーが発生しました:', error);
      
      // レート制限エラーの場合は間隔を延長
      if (error instanceof Error && error.message.includes('rate limit')) {
        this.adjustInterval(true);
      }
      
      return false;
    }
  }

  public async start(onUpdate: (sha: string) => void, intervalMs?: number): Promise<void> {
    await this.stop(); // 既存の監視を停止

    // WebHookが有効かつ利用可能な場合はWebHookを使用
    if (this.config.webhook.enabled && this.webhookHandler) {
      try {
        await this.webhookHandler.start();
        this.logger.info('[GitHub] WebHook監視モードで開始しました');
        return;
      } catch (error) {
        this.logger.error('[GitHub] WebHook開始に失敗、APIポーリングにフォールバック:', error);
      }
    }

    // APIポーリングモードで開始
    this.currentInterval = intervalMs || this.config.checkIntervalMs;
    this.logger.info(`[GitHub] APIポーリング監視を開始: ${this.currentInterval / 1000}秒間隔`);

    const checkForUpdates = async () => {
      try {
        if (await this.hasUpdates()) {
          const newSha = await this.getLatestCommitSha();
          this.currentSha = newSha;
          onUpdate(newSha);
        }
      } catch (error) {
        this.logger.error('GitHub監視エラー:', error);
      }
      
      // 動的間隔調整のため、次のチェックをスケジュール
      this.scheduleNextCheck(checkForUpdates);
    };

    // 最初のチェックをスケジュール
    this.scheduleNextCheck(checkForUpdates);
  }

  private scheduleNextCheck(checkFunction: () => Promise<void>): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }
    
    this.intervalId = setTimeout(checkFunction, this.currentInterval);
  }

  private adjustInterval(isRateLimit: boolean): void {
    const originalInterval = this.config.checkIntervalMs;
    
    if (isRateLimit) {
      // レート制限時は間隔を大幅に延長（最大30分）
      const newInterval = Math.min(this.currentInterval * 2, 30 * 60 * 1000);
      if (newInterval !== this.currentInterval) {
        this.currentInterval = newInterval;
        this.logger.warn(`[GitHub] Rate limit detected, increasing check interval to ${this.currentInterval / 60000} minutes`);
      }
    } else if (this.consecutiveErrors === 0 && this.currentInterval > originalInterval) {
      // 成功時は徐々に間隔を短縮
      const newInterval = Math.max(Math.floor(this.currentInterval * 0.8), originalInterval);
      if (newInterval !== this.currentInterval) {
        this.currentInterval = newInterval;
        this.logger.info(`[GitHub] Reducing check interval to ${this.currentInterval / 1000} seconds`);
      }
    }
  }

  public async stop(): Promise<void> {
    // APIポーリングの停止
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // WebHookサーバーの停止
    if (this.webhookHandler && this.webhookHandler.isRunning()) {
      await this.webhookHandler.stop();
    }
  }

  public async initialize(): Promise<void> {
    try {
      this.currentSha = await this.getLatestCommitSha();
      this.logger.info(`GitHub監視を初期化しました。現在のSHA: ${this.currentSha.substring(0, 7)}`);
    } catch (error) {
      this.logger.error('GitHub監視の初期化に失敗しました:', error);
      throw error;
    }
  }
}