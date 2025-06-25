import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { IUpdateHandler, PullResult, ILogger } from '../interfaces/github-monitor.interface.ts';

const execAsync = promisify(exec);

export class UpdateHandlerService implements IUpdateHandler {
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  public async pullLatestChanges(): Promise<PullResult> {
    try {
      const branch = await this.getCurrentBranch();
      const { stdout, stderr } = await execAsync(`git pull origin ${branch}`);
      
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
    
    setTimeout(() => {
      if (process.env.NODE_ENV === 'development') {
        // 開発環境での複数の再起動方法を試行
        this.attemptDevelopmentRestart();
      } else {
        // 本番環境では通常の終了
        process.exit(0);
      }
    }, 1000);
  }

  private async attemptDevelopmentRestart(): Promise<void> {
    try {
      // 方法1: ファイル変更をトリガーしてnodemonを確実に再起動させる
      await this.triggerFileChange();
      
      // 方法2: プラットフォーム別の再起動シグナル送信
      if (process.platform !== 'win32') {
        // Unix系でのみSIGUSR2を使用
        this.logger.info('nodemonに再起動シグナルを送信中...');
        process.kill(process.pid, 'SIGUSR2');
      } else {
        // Windows環境では直接終了してnodemonに任せる
        this.logger.info('Windows環境での再起動処理...');
      }
      
      // 方法3: 少し待ってから強制終了（nodemonがキャッチする）
      setTimeout(() => {
        this.logger.info('バックアップ再起動方法を実行...');
        process.exit(0);
      }, 2000);
      
    } catch (error) {
      this.logger.error('再起動処理中にエラー:', error);
      // 方法4: フォールバックとして即座に終了
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  }

  private async triggerFileChange(): Promise<void> {
    try {
      // 一時的な変更をトリガーファイルに書き込んでnodemonに検知させる
      const triggerFile = join(process.cwd(), 'src', '.restart-trigger');
      const timestamp = new Date().toISOString();
      await writeFile(triggerFile, `Restart triggered at: ${timestamp}\n`);
      this.logger.info('ファイル変更をトリガーしました');
    } catch (error) {
      this.logger.warn('ファイル変更トリガーに失敗:', error);
    }
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
      return stdout.trim();
    } catch (error) {
      this.logger.warn('現在のブランチ取得に失敗しました。mainブランチを使用します。');
      return 'main';
    }
  }
}