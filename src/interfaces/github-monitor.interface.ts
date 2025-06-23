export interface IGitHubMonitor {
  initialize(): Promise<void>;
  start(onUpdate: (sha: string) => void, intervalMs?: number): Promise<void>;
  stop(): Promise<void>;
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
  getRateLimitStatus(): { remaining: number; resetTime: number };
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

export interface IGitHubWebHookHandler {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  verifySignature(body: string, signature: string): boolean;
}

export interface GitHubWebHookPayload {
  ref: string;
  after: string;
  before: string;
  repository: {
    name: string;
    full_name: string;
  };
  head_commit: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  };
}