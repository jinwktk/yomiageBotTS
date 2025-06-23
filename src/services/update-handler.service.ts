import { exec } from 'child_process';
import { promisify } from 'util';
import type { IUpdateHandler, PullResult, ILogger } from '../interfaces/github-monitor.interface.js';

const execAsync = promisify(exec);

export class UpdateHandlerService implements IUpdateHandler {
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  public async pullLatestChanges(): Promise<PullResult> {
    try {
      this.logger.info('Git pullを実行中...');
      const branch = await this.getCurrentBranch();
      const { stdout, stderr } = await execAsync(`git pull origin ${branch}`);
      
      this.logger.info('Git pull完了:', stdout.trim());
      
      return {
        success: true,
        output: stdout
      };
    } catch (error: any) {
      const errorMessage = error.stderr || error.message || String(error);
      this.logger.error('Git pullに失敗しました:', errorMessage);
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  public restartApplication(): void {
    this.logger.info('アプリケーションを再起動します...');
    
    // 少し待ってから終了（ログが表示されるのを確認するため）
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }

  public async handleUpdate(newSha: string): Promise<void> {
    this.logger.info(`GitHub更新を検出しました。SHA: ${newSha.substring(0, 7)}`);
    
    const pullResult = await this.pullLatestChanges();
    
    if (pullResult.success) {
      this.logger.info('更新完了。アプリケーションを再起動します。');
      this.restartApplication();
    } else {
      this.logger.error('更新に失敗しました。アプリケーションは再起動されません。');
    }
  }

  public async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      const branch = stdout.trim();
      this.logger.debug(`現在のブランチ: ${branch}`);
      return branch;
    } catch (error) {
      this.logger.warn('現在のブランチ取得に失敗しました。mainブランチを使用します。', error);
      return 'main';
    }
  }
}