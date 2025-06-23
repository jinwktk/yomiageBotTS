import type { IGitHubApi, GitHubCommit, ILogger } from '../interfaces/github-monitor.interface.js';

export class GitHubApiService implements IGitHubApi {
  private readonly timeout: number;
  private readonly logger: ILogger;
  private lastRateLimitReset: number = 0;
  private rateLimitRemaining: number = 60; // デフォルト値

  constructor(timeout: number = 10000, logger: ILogger) {
    this.timeout = timeout;
    this.logger = logger;
  }

  async getLatestCommit(owner: string, repo: string, branch: string): Promise<GitHubCommit> {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;

    return this.apiCallWithRetry(async () => {
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

      // レート制限情報を更新
      this.updateRateLimitInfo(response);

      if (!response.ok) {
        if (response.status === 403) {
          const resetTime = response.headers.get('x-ratelimit-reset');
          if (resetTime) {
            const resetTimestamp = parseInt(resetTime) * 1000;
            const waitTime = resetTimestamp - Date.now();
            if (waitTime > 0) {
              this.logger.warn(`[GitHub] Rate limit exceeded. Waiting ${Math.ceil(waitTime / 60000)} minutes until reset.`);
              throw new Error(`RATE_LIMIT_EXCEEDED:${waitTime}`);
            }
          }
        }
        throw new Error(`GitHub API呼び出しに失敗しました: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    });
  }

  private async apiCallWithRetry<T>(apiCall: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await apiCall();
      } catch (error) {
        lastError = error as Error;
        
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw new Error(`GitHub APIタイムアウト: ${this.timeout}ms`);
          }
          
          // レート制限の場合の特別処理
          if (error.message.startsWith('RATE_LIMIT_EXCEEDED:')) {
            const waitTime = parseInt(error.message.split(':')[1]);
            if (waitTime > 0 && waitTime < 5 * 60 * 1000) { // 5分以内なら待機
              this.logger.info(`[GitHub] Rate limit hit, waiting ${Math.ceil(waitTime / 1000)}s before retry...`);
              await this.sleep(waitTime);
              continue;
            } else {
              throw new Error('GitHub API rate limit exceeded for extended period');
            }
          }
          
          // 5xx エラーの場合は指数バックオフでリトライ
          if (error.message.includes('5')) {
            if (attempt < maxRetries) {
              const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
              this.logger.warn(`[GitHub] Server error, retrying in ${backoffTime}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
              await this.sleep(backoffTime);
              continue;
            }
          }
        }
        
        // 最後の試行またはリトライ不可能なエラー
        if (attempt === maxRetries) {
          throw lastError;
        }
      }
    }
    
    throw lastError!;
  }

  private updateRateLimitInfo(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining);
    }
    if (reset) {
      this.lastRateLimitReset = parseInt(reset) * 1000;
    }
    
    if (this.rateLimitRemaining < 10) {
      this.logger.warn(`[GitHub] Rate limit low: ${this.rateLimitRemaining} requests remaining`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public getRateLimitStatus(): { remaining: number; resetTime: number } {
    return {
      remaining: this.rateLimitRemaining,
      resetTime: this.lastRateLimitReset
    };
  }
}