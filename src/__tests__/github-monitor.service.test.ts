import { GitHubMonitorService } from '../services/github-monitor.service.js';
import type { IGitHubApi, ILogger, GitHubCommit } from '../interfaces/github-monitor.interface.js';
import type { GitHubMonitorConfig } from '../config.js';
import { jest } from '@jest/globals';

describe('GitHubMonitorService', () => {
  let monitor: GitHubMonitorService;
  let mockGitHubApi: jest.Mocked<IGitHubApi>;
  let mockLogger: jest.Mocked<ILogger>;
  let config: GitHubMonitorConfig;

  beforeEach(() => {
    mockGitHubApi = {
      getLatestCommit: jest.fn(),
      getRateLimitStatus: jest.fn()
    };
    
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    config = {
      enabled: true,
      repositoryOwner: 'test-owner',
      repositoryName: 'test-repo',
      branch: 'main',
      checkIntervalMs: 1000,
      apiTimeout: 5000,
      webhook: {
        enabled: false,
        port: 3001,
        path: '/webhook/github',
        secret: ''
      }
    };

    monitor = new GitHubMonitorService(config, mockGitHubApi, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestCommitSha', () => {
    it('GitHubAPIから最新のコミットSHAを取得できること', async () => {
      const mockCommit: GitHubCommit = {
        sha: 'abc123def456',
        commit: {
          message: 'Test commit',
          author: {
            name: 'Test Author',
            date: '2023-01-01T00:00:00Z'
          }
        }
      };

      mockGitHubApi.getLatestCommit.mockResolvedValueOnce(mockCommit);

      const sha = await monitor.getLatestCommitSha();
      
      expect(sha).toBe('abc123def456');
      expect(mockGitHubApi.getLatestCommit).toHaveBeenCalledWith('test-owner', 'test-repo', 'main');
    });

    it('API呼び出しが失敗した場合、エラーをスローすること', async () => {
      const error = new Error('GitHub API呼び出しに失敗しました: 404');
      mockGitHubApi.getLatestCommit.mockRejectedValueOnce(error);

      await expect(monitor.getLatestCommitSha()).rejects.toThrow(error);
      expect(mockLogger.error).toHaveBeenCalledWith('最新コミットSHA取得エラー:', error);
    });
  });

  describe('hasUpdates', () => {
    it('新しいコミットがある場合、trueを返すこと', async () => {
      monitor.setCurrentSha('old-sha');
      
      const mockCommit: GitHubCommit = {
        sha: 'new-sha',
        commit: {
          message: 'New commit',
          author: {
            name: 'Test Author',
            date: '2023-01-01T00:00:00Z'
          }
        }
      };

      mockGitHubApi.getLatestCommit.mockResolvedValueOnce(mockCommit);

      const hasUpdates = await monitor.hasUpdates();
      expect(hasUpdates).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('新しいコミットを検出: old-sha → new-sha');
    });

    it('コミットSHAが同じ場合、falseを返すこと', async () => {
      const currentSha = 'same-sha';
      monitor.setCurrentSha(currentSha);
      
      const mockCommit: GitHubCommit = {
        sha: currentSha,
        commit: {
          message: 'Same commit',
          author: {
            name: 'Test Author',
            date: '2023-01-01T00:00:00Z'
          }
        }
      };

      mockGitHubApi.getLatestCommit.mockResolvedValueOnce(mockCommit);

      const hasUpdates = await monitor.hasUpdates();
      expect(hasUpdates).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith('更新はありません');
    });
  });

  describe('start', () => {
    it('監視を開始し、更新があった場合コールバックが呼ばれること', async () => {
      const mockCallback = jest.fn();
      monitor.setCurrentSha('old-sha');
      
      const mockCommit: GitHubCommit = {
        sha: 'new-sha',
        commit: {
          message: 'New commit',
          author: {
            name: 'Test Author',
            date: '2023-01-01T00:00:00Z'
          }
        }
      };

      mockGitHubApi.getLatestCommit.mockResolvedValue(mockCommit);

      monitor.start(mockCallback, 100);
      
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(mockCallback).toHaveBeenCalledWith('new-sha');
      monitor.stop();
    });
  });

  describe('stop', () => {
    it('監視を停止できること', () => {
      const mockCallback = jest.fn();
      monitor.start(mockCallback, 100);
      monitor.stop();
      
      expect(mockLogger.info).toHaveBeenCalledWith('GitHub監視を停止しました');
    });
  });
});