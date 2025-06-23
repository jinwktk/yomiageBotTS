import dotenv from 'dotenv';
dotenv.config();

import YomiageBot from './bot.js';
import { createConfig, type Config } from './config.js';
import { GitHubMonitorController } from './services/github-monitor-controller.service.js';
import { GitHubMonitorService } from './services/github-monitor.service.js';
import { UpdateHandlerService } from './services/update-handler.service.js';
import { GitHubApiService } from './services/github-api.service.js';
import { GitHubWebHookHandlerService } from './services/github-webhook-handler.service.js';
import { LoggerService } from './services/logger.service.js';

async function main() {
  const config = createConfig();
  const logger = LoggerService.create('App');
  
  try {
    // ボット起動
    const bot = new YomiageBot(config);
    await bot.start();
    logger.info('Discord Bot を起動しました');

    // GitHub監視を初期化（オプション）
    await initializeGitHubMonitoring(config, logger);
    
  } catch (error) {
    logger.error('アプリケーションの起動に失敗しました:', error);
    process.exit(1);
  }
}

async function initializeGitHubMonitoring(config: Config, logger: LoggerService) {
  if (!config.githubMonitor.enabled) {
    return;
  }

  try {
    // 依存性注入でサービスを構築
    const githubLogger = LoggerService.create('GitHub');
    const githubApi = new GitHubApiService(config.githubMonitor.apiTimeout, githubLogger);
    const updateHandler = new UpdateHandlerService(githubLogger);
    
    // WebHookハンドラーの作成（WebHook有効時のみ）
    const webhookHandler = config.githubMonitor.webhook.enabled 
      ? new GitHubWebHookHandlerService(config.githubMonitor, githubLogger, updateHandler)
      : undefined;
    
    const monitor = new GitHubMonitorService(
      config.githubMonitor, 
      githubApi, 
      githubLogger,
      webhookHandler,
      updateHandler
    );

    // コントローラー作成と開始
    await GitHubMonitorController.createAndStart(
      config.githubMonitor,
      monitor,
      updateHandler,
      githubLogger
    );
    
  } catch (error) {
    logger.warn('GitHub監視の初期化に失敗しました。監視なしで続行します');
  }
}

// アプリケーション開始
main(); 