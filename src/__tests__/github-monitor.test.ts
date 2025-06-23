import { GitHubMonitor } from '../github-monitor.js';
import { jest } from '@jest/globals';

describe('GitHubMonitor', () => {
  let monitor: GitHubMonitor;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = mockFetch;
    monitor = new GitHubMonitor('test-owner', 'test-repo', 'main');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestCommitSha', () => {
    it('GitHubAPIから最新のコミットSHAを取得できること', async () => {
      const mockResponse = {
        sha: 'abc123def456',
        commit: {
          message: 'Test commit',
          author: {
            date: '2023-01-01T00:00:00Z'
          }
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      const sha = await monitor.getLatestCommitSha();
      expect(sha).toBe('abc123def456');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/commits/main'
      );
    });

    it('API呼び出しが失敗した場合、エラーをスローすること', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      await expect(monitor.getLatestCommitSha()).rejects.toThrow('GitHub API呼び出しに失敗しました: 404');
    });
  });

  describe('hasUpdates', () => {
    it('新しいコミットがある場合、trueを返すこと', async () => {
      monitor.setCurrentSha('old-sha');
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'new-sha' })
      } as Response);

      const hasUpdates = await monitor.hasUpdates();
      expect(hasUpdates).toBe(true);
    });

    it('コミットSHAが同じ場合、falseを返すこと', async () => {
      const currentSha = 'same-sha';
      monitor.setCurrentSha(currentSha);
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: currentSha })
      } as Response);

      const hasUpdates = await monitor.hasUpdates();
      expect(hasUpdates).toBe(false);
    });
  });

  describe('start', () => {
    it('監視を開始し、更新があった場合コールバックが呼ばれること', async () => {
      const mockCallback = jest.fn();
      monitor.setCurrentSha('old-sha');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sha: 'new-sha' })
      } as Response);

      monitor.start(mockCallback, 100); // 100ms間隔でテスト
      
      // 少し待ってからコールバックが呼ばれることを確認
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(mockCallback).toHaveBeenCalledWith('new-sha');
      monitor.stop();
    });

    it('エラーが発生した場合、継続して監視すること', async () => {
      const mockCallback = jest.fn();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ sha: 'new-sha' })
        } as Response);

      monitor.setCurrentSha('old-sha');
      monitor.start(mockCallback, 100);
      
      await new Promise(resolve => setTimeout(resolve, 250));
      
      expect(consoleErrorSpy).toHaveBeenCalledWith('GitHub監視エラー:', expect.any(Error));
      expect(mockCallback).toHaveBeenCalledWith('new-sha');
      
      monitor.stop();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('監視を停止できること', () => {
      const mockCallback = jest.fn();
      monitor.start(mockCallback, 100);
      monitor.stop();
      
      // 停止後はコールバックが呼ばれないことを確認
      setTimeout(() => {
        expect(mockCallback).not.toHaveBeenCalled();
      }, 150);
    });
  });
});