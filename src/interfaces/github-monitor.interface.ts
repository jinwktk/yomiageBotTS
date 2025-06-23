export interface IGitHubMonitor {
  initialize(): Promise<void>;
  start(onUpdate: (sha: string) => void, intervalMs?: number): void;
  stop(): void;
  hasUpdates(): Promise<boolean>;
  getLatestCommitSha(): Promise<string>;
  setCurrentSha(sha: string): void;
}

export interface IUpdateHandler {
  handleUpdate(newSha: string): Promise<void>;
  pullLatestChanges(): Promise<PullResult>;
  restartApplication(): void;
  getCurrentBranch(): Promise<string>;
}

export interface PullResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface ILogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export interface IGitHubApi {
  getLatestCommit(owner: string, repo: string, branch: string): Promise<GitHubCommit>;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}