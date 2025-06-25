import { UpdateHandlerService } from '../services/update-handler.service';
import type { ILogger } from '../interfaces/github-monitor.interface';
import { jest } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');
const mockExec = jest.mocked(promisify(exec));

describe('UpdateHandlerService', () => {
  let handler: UpdateHandlerService;
  let mockLogger: jest.Mocked<ILogger>;
  let mockProcessExit: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    handler = new UpdateHandlerService(mockLogger);
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
      expect(mockLogger.info).toHaveBeenCalledWith('Git pullを実行中...');
    });

    it('git pullでエラーが発生した場合、エラーを返すこと', async () => {
      const error = {
        stderr: 'CONFLICT (content): Merge conflict in src/bot.ts\n'
      };
      mockExec.mockRejectedValueOnce(error);

      const result = await handler.pullLatestChanges();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('CONFLICT');
      expect(mockLogger.error).toHaveBeenCalledWith('Git pullに失敗しました:', error.stderr);
    });
  });

  describe('restartApplication', () => {
    it('正常にアプリケーションを再起動すること', () => {
      handler.restartApplication();
      
      expect(mockLogger.info).toHaveBeenCalledWith('アプリケーションを再起動します...');
    });
  });

  describe('handleUpdate', () => {
    it('更新処理が成功した場合、アプリケーションを再起動すること', async () => {
      mockExec.mockResolvedValueOnce({
        stdout: 'Updating abc123..def456\nFast-forward\n src/bot.ts | 2 ++\n 1 file changed, 2 insertions(+)\n',
        stderr: ''
      });

      await handler.handleUpdate('def456abc123');
      
      expect(mockLogger.info).toHaveBeenCalledWith('GitHub更新を検出しました。SHA: def456a');
      expect(mockLogger.info).toHaveBeenCalledWith('Git pullを実行中...');
      expect(mockLogger.info).toHaveBeenCalledWith('更新完了。アプリケーションを再起動します。');
    });

    it('git pullが失敗した場合、エラーをログ出力し、再起動しないこと', async () => {
      const error = {
        stderr: 'error: Your local changes would be overwritten by merge.\n'
      };
      mockExec.mockRejectedValueOnce(error);

      await handler.handleUpdate('def456abc123');
      
      expect(mockLogger.info).toHaveBeenCalledWith('GitHub更新を検出しました。SHA: def456a');
      expect(mockLogger.error).toHaveBeenCalledWith('更新に失敗しました。アプリケーションは再起動されません。');
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
      expect(mockLogger.debug).toHaveBeenCalledWith('現在のブランチ: main');
    });

    it('ブランチ取得に失敗した場合、mainを返すこと', async () => {
      const error = new Error('Not a git repository');
      mockExec.mockRejectedValueOnce(error);

      const branch = await handler.getCurrentBranch();
      
      expect(branch).toBe('main');
      expect(mockLogger.warn).toHaveBeenCalledWith('現在のブランチ取得に失敗しました。mainブランチを使用します。', error);
    });
  });
});