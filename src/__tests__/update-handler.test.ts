import { UpdateHandler } from '../update-handler.js';
import { jest } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');
const mockExec = jest.mocked(promisify(exec));

describe('UpdateHandler', () => {
  let handler: UpdateHandler;
  let mockProcessExit: jest.SpyInstance;

  beforeEach(() => {
    handler = new UpdateHandler();
    mockProcessExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockProcessExit.mockRestore();
  });

  describe('pullLatestChanges', () => {
    it('git pullコマンドを実行できること', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'Already up to date.\n',
        stderr: ''
      });

      const result = await handler.pullLatestChanges();
      
      expect(mockExec).toHaveBeenCalledWith('git pull origin main');
      expect(result.success).toBe(true);
      expect(result.output).toBe('Already up to date.\n');
    });

    it('git pullでマージコンフリクトが発生した場合、エラーを返すこと', async () => {
      mockExec.mockRejectedValueOnce({
        stdout: '',
        stderr: 'CONFLICT (content): Merge conflict in src/bot.ts\n'
      });

      const result = await handler.pullLatestChanges();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('CONFLICT');
    });

    it('ネットワークエラーの場合、適切なエラーメッセージを返すこと', async () => {
      mockExec.mockRejectedValueOnce({
        code: 128,
        stderr: 'fatal: unable to access \'https://github.com/...\': Could not resolve host\n'
      });

      const result = await handler.pullLatestChanges();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not resolve host');
    });
  });

  describe('restartApplication', () => {
    it('正常にアプリケーションを再起動すること', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      handler.restartApplication();
      
      expect(consoleLogSpy).toHaveBeenCalledWith('アプリケーションを再起動します...');
      expect(mockProcessExit).toHaveBeenCalledWith(0);
      
      consoleLogSpy.mockRestore();
    });
  });

  describe('handleUpdate', () => {
    it('更新処理が成功した場合、アプリケーションを再起動すること', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      mockExec.mockResolvedValueOnce({
        stdout: 'Updating abc123..def456\nFast-forward\n src/bot.ts | 2 ++\n 1 file changed, 2 insertions(+)\n',
        stderr: ''
      });

      await handler.handleUpdate('def456');
      
      expect(consoleLogSpy).toHaveBeenCalledWith('GitHub更新を検出しました。SHA: def456');
      expect(consoleLogSpy).toHaveBeenCalledWith('Git pullを実行中...');
      expect(mockExec).toHaveBeenCalledWith('git pull origin main');
      expect(consoleLogSpy).toHaveBeenCalledWith('更新完了:', expect.stringContaining('Fast-forward'));
      expect(mockProcessExit).toHaveBeenCalledWith(0);
      
      consoleLogSpy.mockRestore();
    });

    it('git pullが失敗した場合、エラーをログ出力し、再起動しないこと', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockExec.mockRejectedValueOnce({
        stderr: 'error: Your local changes would be overwritten by merge.\n'
      });

      await handler.handleUpdate('def456');
      
      expect(consoleLogSpy).toHaveBeenCalledWith('GitHub更新を検出しました。SHA: def456');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Git pull失敗:', expect.stringContaining('overwritten'));
      expect(mockProcessExit).not.toHaveBeenCalled();
      
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('空のコミットSHAでも処理を継続すること', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      mockExec.mockResolvedValueOnce({
        stdout: 'Already up to date.\n',
        stderr: ''
      });

      await handler.handleUpdate('');
      
      expect(consoleLogSpy).toHaveBeenCalledWith('GitHub更新を検出しました。SHA: ');
      expect(mockExec).toHaveBeenCalled();
      
      consoleLogSpy.mockRestore();
    });
  });

  describe('getCurrentBranch', () => {
    it('現在のブランチ名を取得できること', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'main\n',
        stderr: ''
      });

      const branch = await handler.getCurrentBranch();
      
      expect(mockExec).toHaveBeenCalledWith('git branch --show-current');
      expect(branch).toBe('main');
    });

    it('ブランチ取得に失敗した場合、mainを返すこと', async () => {
      mockExec.mockRejectedValueOnce(new Error('Not a git repository'));

      const branch = await handler.getCurrentBranch();
      
      expect(branch).toBe('main');
    });
  });
});