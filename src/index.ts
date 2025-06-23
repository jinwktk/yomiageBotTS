import dotenv from 'dotenv';
dotenv.config();

import YomiageBot from './bot.js';
import { createConfig } from './config.js';
import { GitHubMonitor } from './github-monitor.js';
import { UpdateHandler } from './update-handler.js';

const config = createConfig();
const bot = new YomiageBot(config);

// GitHub監視とアップデート処理を初期化
const initializeGitHubMonitoring = async () => {
  try {
    const monitor = new GitHubMonitor('jinwktk', 'yomiageBotTS', 'main');
    const updateHandler = new UpdateHandler();
    
    // 現在のコミットSHAで初期化
    await monitor.initialize();
    
    // 更新検出時のコールバック
    const onUpdate = (newSha: string) => {
      updateHandler.handleUpdate(newSha);
    };
    
    // 30秒間隔で監視開始
    monitor.start(onUpdate, 30000);
    
    console.log('GitHub監視を開始しました。');
    
    // プロセス終了時のクリーンアップ
    process.on('SIGINT', () => {
      console.log('\nアプリケーションを終了します...');
      monitor.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('\nアプリケーションを終了します...');
      monitor.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('GitHub監視の初期化に失敗しました:', error);
    console.log('GitHub監視なしでボットを起動します。');
  }
};

// ボット起動
bot.start().catch(console.error);

// GitHub監視を開始
initializeGitHubMonitoring(); 