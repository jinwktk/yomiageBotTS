import type { IGitHubMonitor, IGitHubApi, ILogger } from '../interfaces/github-monitor.interface.js';
import type { GitHubMonitorConfig } from '../config.js';

export class GitHubMonitorService implements IGitHubMonitor {
  private currentSha: string = '';
  private intervalId: NodeJS.Timeout | null = null;
  private readonly config: GitHubMonitorConfig;
  private readonly githubApi: IGitHubApi;
  private readonly logger: ILogger;

  constructor(config: GitHubMonitorConfig, githubApi: IGitHubApi, logger: ILogger) {
    this.config = config;
    this.githubApi = githubApi;
    this.logger = logger;
  }

  public setCurrentSha(sha: string): void {
    this.currentSha = sha;
    this.logger.debug(`現在のSHAを設定: ${sha.substring(0, 7)}`);
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
      } else {
        this.logger.debug('更新はありません');
      }
      
      return hasUpdate;
    } catch (error) {
      this.logger.error('更新チェック中にエラーが発生しました:', error);
      return false;
    }
  }

  public start(onUpdate: (sha: string) => void, intervalMs?: number): void {
    this.stop(); // 既存の監視を停止

    const interval = intervalMs || this.config.checkIntervalMs;
    this.logger.info(`GitHub監視を開始: ${interval / 1000}秒間隔`);

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
    };

    this.intervalId = setInterval(checkForUpdates, interval);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('GitHub監視を停止しました');
    }
  }

  public async initialize(): Promise<void> {
    try {
      this.logger.info('GitHub監視を初期化中...');
      this.currentSha = await this.getLatestCommitSha();
      this.logger.info(`GitHub監視を初期化しました。現在のSHA: ${this.currentSha.substring(0, 7)}`);
    } catch (error) {
      this.logger.error('GitHub監視の初期化に失敗しました:', error);
      throw error;
    }
  }
}