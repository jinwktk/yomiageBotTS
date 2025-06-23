import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PullResult {
  success: boolean;
  output?: string;
  error?: string;
}

export class UpdateHandler {
  
  public async pullLatestChanges(): Promise<PullResult> {
    try {
      const branch = await this.getCurrentBranch();
      const { stdout, stderr } = await execAsync(`git pull origin ${branch}`);
      
      return {
        success: true,
        output: stdout
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || String(error)
      };
    }
  }

  public restartApplication(): void {
    console.log('アプリケーションを再起動します...');
    process.exit(0);
  }

  public async handleUpdate(newSha: string): Promise<void> {
    console.log(`GitHub更新を検出しました。SHA: ${newSha}`);
    console.log('Git pullを実行中...');
    
    const pullResult = await this.pullLatestChanges();
    
    if (pullResult.success) {
      console.log('更新完了:', pullResult.output);
      this.restartApplication();
    } else {
      console.error('Git pull失敗:', pullResult.error);
    }
  }

  public async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current');
      return stdout.trim();
    } catch (error) {
      console.warn('現在のブランチ取得に失敗しました。mainブランチを使用します。', error);
      return 'main';
    }
  }
}