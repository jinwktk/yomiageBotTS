import * as fs from 'fs';
import * as path from 'path';

class LogManager {
  private logDir = 'logs';
  private logFile = 'logs/yomiage.log';
  private oldLogFile = 'logs/yomiage.old.log';
  private logStream: fs.WriteStream | null = null;
  private isInitialized = false;
  private currentDate: string = '';

  constructor() {
    this.currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD形式
    this.ensureLogDirectory();
    this.initializeLogStream();
    if (!this.isInitialized) {
      this.interceptConsole();
      this.interceptProcessEvents();
      this.isInitialized = true;
    }
    setInterval(() => {
      this.cleanupOldTempFiles();
    }, 3600000);
    this.cleanupOldTempFiles();
  }

  private ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
        console.log(`[LogManager] Created log directory: ${this.logDir}`);
      }
    } catch (error) {
      console.error(`[LogManager] Error creating log directory:`, error);
    }
  }

  private checkDateChange() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.currentDate) {
      this.log(`[LogManager] Date changed from ${this.currentDate} to ${today}, rotating logs`);
      this.currentDate = today;
      this.rotateLogs();
      this.initializeLogStream();
      this.cleanupOldTempFiles();
    }
  }

  private rotateLogs() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const newOldLogFile = `${this.logDir}/yomiage.${this.currentDate}.log`;
      if (fs.existsSync(newOldLogFile)) {
        try {
          fs.unlinkSync(newOldLogFile);
          console.log(`[LogManager] Removed existing log file: ${newOldLogFile}`);
        } catch (error) {
          console.log(`[LogManager] Could not remove ${newOldLogFile} (may be in use)`);
        }
      }
      if (fs.existsSync(this.logFile)) {
        try {
          fs.renameSync(this.logFile, newOldLogFile);
          console.log(`[LogManager] Moved yomiage.log to ${newOldLogFile}`);
        } catch (error) {
          try {
            fs.copyFileSync(this.logFile, newOldLogFile);
            console.log(`[LogManager] Copied yomiage.log to ${newOldLogFile} (original file in use)`);
          } catch (copyError) {
            console.log('[LogManager] Could not copy log file, continuing with existing file');
          }
        }
      }
      this.cleanupOldLogFiles();
    } catch (error) {
      console.log('[LogManager] Error rotating logs, continuing with existing file:', error);
    }
  }

  private cleanupOldLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir);
      const logFiles = files.filter(file => file.startsWith('yomiage.') && file.endsWith('.log'));
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
      logFiles.forEach(file => {
        try {
          const dateMatch = file.match(/yomiage\.(\d{4}-\d{2}-\d{2})\.log/);
          if (dateMatch) {
            const fileDate = new Date(dateMatch[1]);
            if (fileDate < cutoffDate) {
              const filePath = `${this.logDir}/${file}`;
              fs.unlinkSync(filePath);
              console.log(`[LogManager] Cleaned up old log file: ${filePath}`);
            }
          }
        } catch (error) {
          console.log(`[LogManager] Could not clean up log file ${file}:`, error);
        }
      });
    } catch (error) {
      console.log('[LogManager] Error during log cleanup:', error);
    }
  }

  private cleanupOldTempFiles() {
    try {
      const tempDir = 'temp';
      if (!fs.existsSync(tempDir)) {
        return;
      }
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 3);
      const tempSubdirs = ['tts', 'wav', 'audio', 'greetings', 'recordings', 'buffers'];
      tempSubdirs.forEach(subdir => {
        const subdirPath = path.join(tempDir, subdir);
        if (!fs.existsSync(subdirPath)) {
          return;
        }
        try {
          const files = fs.readdirSync(subdirPath);
          files.forEach(file => {
            try {
              const filePath = path.join(subdirPath, file);
              const stats = fs.statSync(filePath);
              if (stats.birthtime < cutoffDate) {
                if (stats.isDirectory()) {
                  fs.rmSync(filePath, { recursive: true, force: true });
                  console.log(`[LogManager] Cleaned up old temp directory: ${filePath}`);
                } else {
                  fs.unlinkSync(filePath);
                  console.log(`[LogManager] Cleaned up old temp file: ${filePath}`);
                }
              }
            } catch (error) {
              console.log(`[LogManager] Could not clean up temp file ${file}:`, error);
            }
          });
          try {
            const remainingFiles = fs.readdirSync(subdirPath);
            if (remainingFiles.length === 0) {
              fs.rmdirSync(subdirPath);
              console.log(`[LogManager] Removed empty temp directory: ${subdirPath}`);
            }
          } catch (error) {}
        } catch (error) {
          console.log(`[LogManager] Error processing temp subdirectory ${subdir}:`, error);
        }
      });
      const replayDir = path.join(tempDir, 'replay');
      if (fs.existsSync(replayDir)) {
        try {
          const replaySubdirs = fs.readdirSync(replayDir);
          replaySubdirs.forEach(subdir => {
            try {
              const subdirPath = path.join(replayDir, subdir);
              const stats = fs.statSync(subdirPath);
              const replayCutoffDate = new Date();
              replayCutoffDate.setDate(replayCutoffDate.getDate() - 1);
              if (stats.birthtime < replayCutoffDate) {
                fs.rmSync(subdirPath, { recursive: true, force: true });
                console.log(`[LogManager] Cleaned up old replay directory: ${subdirPath}`);
              }
            } catch (error) {
              console.log(`[LogManager] Could not clean up replay directory ${subdir}:`, error);
            }
          });
          try {
            const remainingReplayDirs = fs.readdirSync(replayDir);
            if (remainingReplayDirs.length === 0) {
              fs.rmdirSync(replayDir);
              console.log(`[LogManager] Removed empty replay directory: ${replayDir}`);
            }
          } catch (error) {}
        } catch (error) {
          console.log(`[LogManager] Error processing replay directory:`, error);
        }
      }
      const bufferedReplayDir = path.join(tempDir, 'buffered_replay');
      if (fs.existsSync(bufferedReplayDir)) {
        try {
          const bufferedReplaySubdirs = fs.readdirSync(bufferedReplayDir);
          bufferedReplaySubdirs.forEach(subdir => {
            try {
              const subdirPath = path.join(bufferedReplayDir, subdir);
              const stats = fs.statSync(subdirPath);
              const bufferedReplayCutoffDate = new Date();
              bufferedReplayCutoffDate.setDate(bufferedReplayCutoffDate.getDate() - 1);
              if (stats.birthtime < bufferedReplayCutoffDate) {
                fs.rmSync(subdirPath, { recursive: true, force: true });
                console.log(`[LogManager] Cleaned up old buffered_replay directory: ${subdirPath}`);
              }
            } catch (error) {
              console.log(`[LogManager] Could not clean up buffered_replay directory ${subdir}:`, error);
            }
          });
          try {
            const remainingBufferedReplayDirs = fs.readdirSync(bufferedReplayDir);
            if (remainingBufferedReplayDirs.length === 0) {
              fs.rmdirSync(bufferedReplayDir);
              console.log(`[LogManager] Removed empty buffered_replay directory: ${bufferedReplayDir}`);
            }
          } catch (error) {}
        } catch (error) {
          console.log(`[LogManager] Error processing buffered_replay directory:`, error);
        }
      }
    } catch (error) {
      console.log('[LogManager] Error during temp cleanup:', error);
    }
  }

  private initializeLogStream() {
    try {
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      console.log('[LogManager] Log stream initialized');
    } catch (error) {
      console.error('[LogManager] Error initializing log stream:', error);
    }
  }

  private interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const safeStringify = (arg: any): string => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'string') return arg;
      if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
      if (arg instanceof Error) {
        return `Error: ${arg.name}: ${arg.message}\nStack: ${arg.stack}`;
      }
      if (typeof arg === 'object') {
        try {
          const safeObj: any = {};
          const seen = new WeakSet();
          const safeCopy = (obj: any, depth = 0): any => {
            if (depth > 3) return '[Max Depth Reached]';
            if (seen.has(obj)) return '[Circular Reference]';
            if (obj === null || typeof obj !== 'object') return obj;
            seen.add(obj);
            if (Array.isArray(obj)) {
              return obj.map(item => safeCopy(item, depth + 1));
            }
            const result: any = {};
            for (const key in obj) {
              if (obj.hasOwnProperty(key)) {
                try {
                  result[key] = safeCopy(obj[key], depth + 1);
                } catch (e) {
                  result[key] = '[Error accessing property]';
                }
              }
            }
            return result;
          };
          const safeArg = safeCopy(arg);
          return JSON.stringify(safeArg, null, 2);
        } catch (e) {
          return `[Object that could not be serialized: ${arg.constructor?.name || 'Unknown'}]`;
        }
      }
      return String(arg);
    };
    console.log = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(message);
      originalLog.apply(console, args);
    };
    console.error = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(`ERROR: ${message}`);
      originalError.apply(console, args);
    };
    console.warn = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(`WARN: ${message}`);
      originalWarn.apply(console, args);
    };
  }

  private interceptProcessEvents() {
    process.on('exit', (code) => {
      this.writeToLog(`[Process] Process exiting with code: ${code}`);
      this.writeToLog(`[Process] Exit time: ${new Date().toISOString()}`);
      this.close();
    });
    process.on('SIGINT', () => {
      this.writeToLog('[Process] Received SIGINT (Ctrl+C)');
      this.writeToLog(`[Process] SIGINT time: ${new Date().toISOString()}`);
      this.close();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      this.writeToLog('[Process] Received SIGTERM');
      this.writeToLog(`[Process] SIGTERM time: ${new Date().toISOString()}`);
      this.close();
      process.exit(0);
    });
    process.on('uncaughtException', (error) => {
      this.writeToLog(`[Process] Uncaught Exception: ${error.message}`);
      this.writeToLog(`[Process] Stack: ${error.stack}`);
      this.writeToLog(`[Process] Exception time: ${new Date().toISOString()}`);
    });
    process.on('unhandledRejection', (reason, promise) => {
      this.writeToLog(`[Process] Unhandled Rejection: ${reason}`);
      this.writeToLog(`[Process] Rejection time: ${new Date().toISOString()}`);
    });
  }

  private writeToLog(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    if (this.logStream) {
      this.logStream.write(logMessage);
    }
  }

  public log(message: string) {
    this.writeToLog(message);
  }

  public error(message: string, error?: any) {
    if (error) {
      this.writeToLog(`ERROR: ${message} - ${error}`);
    } else {
      this.writeToLog(`ERROR: ${message}`);
    }
  }

  public warn(message: string, ...args: any[]) {
    const fullMessage = args.length > 0 ? `${message} ${args.join(' ')}` : message;
    this.writeToLog(`WARN: ${fullMessage}`);
  }

  public close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

export default LogManager; 