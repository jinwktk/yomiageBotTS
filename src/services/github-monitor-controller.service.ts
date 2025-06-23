import type { IGitHubMonitor, IUpdateHandler, ILogger } from '../interfaces/github-monitor.interface.js';
import type { GitHubMonitorConfig } from '../config.js';

export class GitHubMonitorController {
  private readonly config: GitHubMonitorConfig;
  private readonly monitor: IGitHubMonitor;
  private readonly updateHandler: IUpdateHandler;
  private readonly logger: ILogger;
  private isInitialized: boolean = false;

  constructor(
    config: GitHubMonitorConfig,
    monitor: IGitHubMonitor,
    updateHandler: IUpdateHandler,
    logger: ILogger
  ) {
    this.config = config;
    this.monitor = monitor;
    this.updateHandler = updateHandler;
    this.logger = logger;
  }

  public async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('GitHub監視は無効になっています');
      return;
    }

    try {
      await this.monitor.initialize();
      this.setupProcessHandlers();
      this.isInitialized = true;
      this.logger.info('GitHub監視コントローラーを初期化しました');
    } catch (error) {
      this.logger.error('GitHub監視の初期化に失敗しました:', error);
      throw error;
    }
  }

  public start(): void {
    if (!this.config.enabled) {
      this.logger.info('GitHub監視が無効のため、監視を開始しません');
      return;
    }

    if (!this.isInitialized) {
      throw new Error('GitHub監視コントローラーが初期化されていません');
    }

    const onUpdate = (newSha: string) => {
      this.updateHandler.handleUpdate(newSha);
    };

    this.monitor.start(onUpdate, this.config.checkIntervalMs);
    this.logger.info('GitHub監視を開始しました');
  }

  public stop(): void {
    if (this.isInitialized) {
      this.monitor.stop();
      this.logger.info('GitHub監視を停止しました');
    }
  }

  private setupProcessHandlers(): void {
    const gracefulShutdown = (signal: string) => {
      this.logger.info(`\n${signal}シグナルを受信しました。アプリケーションを終了します...`);
      this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }

  public static async createAndStart(
    config: GitHubMonitorConfig,
    monitor: IGitHubMonitor,
    updateHandler: IUpdateHandler,
    logger: ILogger
  ): Promise<GitHubMonitorController> {
    const controller = new GitHubMonitorController(config, monitor, updateHandler, logger);
    
    try {
      await controller.initialize();
      controller.start();
      return controller;
    } catch (error) {
      logger.error('GitHub監視の初期化に失敗しました:', error);
      logger.info('GitHub監視なしでアプリケーションを継続します');
      throw error;
    }
  }
}