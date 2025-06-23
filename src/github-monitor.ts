export class GitHubMonitor {
  private owner: string;
  private repo: string;
  private branch: string;
  private currentSha: string = '';
  private intervalId: NodeJS.Timeout | null = null;

  constructor(owner: string, repo: string, branch: string = 'main') {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  public setCurrentSha(sha: string): void {
    this.currentSha = sha;
  }

  public async getLatestCommitSha(): Promise<string> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits/${this.branch}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`GitHub API呼び出しに失敗しました: ${response.status}`);
      }
      
      const data = await response.json();
      return data.sha;
    } catch (error) {
      if (error instanceof Error && error.message.includes('GitHub API呼び出しに失敗しました')) {
        throw error;
      }
      throw new Error(`GitHub APIエラー: ${error}`);
    }
  }

  public async hasUpdates(): Promise<boolean> {
    try {
      const latestSha = await this.getLatestCommitSha();
      return latestSha !== this.currentSha;
    } catch (error) {
      console.error('更新チェック中にエラーが発生しました:', error);
      return false;
    }
  }

  public start(onUpdate: (sha: string) => void, intervalMs: number = 30000): void {
    this.stop(); // 既存の監視を停止

    const checkForUpdates = async () => {
      try {
        if (await this.hasUpdates()) {
          const newSha = await this.getLatestCommitSha();
          this.currentSha = newSha;
          onUpdate(newSha);
        }
      } catch (error) {
        console.error('GitHub監視エラー:', error);
      }
    };

    this.intervalId = setInterval(checkForUpdates, intervalMs);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async initialize(): Promise<void> {
    try {
      this.currentSha = await this.getLatestCommitSha();
      console.log(`GitHub監視を初期化しました。現在のSHA: ${this.currentSha}`);
    } catch (error) {
      console.error('GitHub監視の初期化に失敗しました:', error);
      throw error;
    }
  }
}