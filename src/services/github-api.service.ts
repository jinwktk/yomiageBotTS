import type { IGitHubApi, GitHubCommit, ILogger } from '../interfaces/github-monitor.interface.js';

export class GitHubApiService implements IGitHubApi {
  private readonly timeout: number;
  private readonly logger: ILogger;

  constructor(timeout: number = 10000, logger: ILogger) {
    this.timeout = timeout;
    this.logger = logger;
  }

  async getLatestCommit(owner: string, repo: string, branch: string): Promise<GitHubCommit> {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
    
    this.logger.debug(`GitHub APIリクエスト: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'YomiageBot/1.0.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`GitHub API呼び出しに失敗しました: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      this.logger.debug(`GitHub APIレスポンス取得: SHA=${data.sha.substring(0, 7)}`);
      
      return data;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`GitHub APIタイムアウト: ${this.timeout}ms`);
        }
        if (error.message.includes('GitHub API呼び出しに失敗しました')) {
          throw error;
        }
      }
      throw new Error(`GitHub APIエラー: ${error}`);
    }
  }
}