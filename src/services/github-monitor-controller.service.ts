import type { IGitHubMonitor, IUpdateHandler, ILogger } from '../interfaces/github-monitor.interface.ts';
import type { GitHubMonitorConfig } from '../config.ts';

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
    } catch (error) {
      this.logger.error('GitHub監視の初期化に失敗しました:', error);
      throw error;
    }
  }

  public async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (!this.isInitialized) {
      throw new Error('GitHub監視コントローラーが初期化されていません');
    }

    const onUpdate = (newSha: string) => {
      this.updateHandler.handleUpdate(newSha);
    };

    await this.monitor.start(onUpdate, this.config.checkIntervalMs);
    this.logger.info('GitHub監視を開始しました');
  }

  public async stop(): Promise<void> {
    if (this.isInitialized) {
      await this.monitor.stop();
    }
  }

  private setupProcessHandlers(): void {
    const gracefulShutdown = async (signal: string) => {
      await this.stop();
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
      await controller.start();
      return controller;
    } catch (error) {
      logger.error('GitHub監視の初期化に失敗しました:', error);
      logger.info('GitHub監視なしでアプリケーションを継続します');
      throw error;
    }
  }
}