import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  VoiceState,
  GuildMember,
  ChatInputCommandInteraction,
  Guild,
  MessageFlags,
  Message,
  AttachmentBuilder,
} from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  AudioPlayer,
  EndBehaviorType,
  VoiceConnection,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import type { Config } from './config.js';
import VoicevoxClient from './voicevox.js';
import RvcClient from './rvc.js';
import SpeechToText from './speech.js';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import prism from 'prism-media';
import { exec } from 'child_process';

interface Session {
  [guildId: string]: string; // channelId
}

interface AudioQueueItem {
  text: string;
  userId?: string;
  onFinish?: () => void;
}

interface BufferedAudio {
  data: Buffer;
  timestamp: number;
  userId: string;
}

interface StreamSession {
  sourceGuildId: string;
  sourceChannelId: string;
  targetGuildId: string;
  targetChannelId: string;
  isActive: boolean;
}

// ログ管理クラス
class LogManager {
  private logDir = 'logs';
  private logFile = 'logs/yomiage.log';
  private oldLogFile = 'logs/yomiage.old.log';
  private logStream: fs.WriteStream | null = null;
  private isInitialized = false;
  private currentDate: string = '';

  constructor() {
    this.currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD形式
    
    // logsディレクトリを作成
    this.ensureLogDirectory();
    
    this.rotateLogs();
    this.initializeLogStream();
    if (!this.isInitialized) {
      this.interceptConsole();
      this.interceptProcessEvents();
      this.isInitialized = true;
    }
    
    // 日付変更を監視するタイマーを設定（毎分チェック）
    setInterval(() => {
      this.checkDateChange();
    }, 60000); // 1分ごと

    // tempファイルのクリーンアップを定期的に実行（1時間ごと）
    setInterval(() => {
      this.cleanupOldTempFiles();
    }, 3600000); // 1時間ごと

    // 起動時に一度tempファイルのクリーンアップを実行
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
      
      // 日付変更時にもtempファイルのクリーンアップを実行
      this.cleanupOldTempFiles();
    }
  }

  private rotateLogs() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const newOldLogFile = `${this.logDir}/yomiage.${this.currentDate}.log`;
      
      // 今日の日付のログファイルが既に存在する場合は削除
      if (fs.existsSync(newOldLogFile)) {
        try {
          fs.unlinkSync(newOldLogFile);
          console.log(`[LogManager] Removed existing log file: ${newOldLogFile}`);
        } catch (error) {
          console.log(`[LogManager] Could not remove ${newOldLogFile} (may be in use)`);
        }
      }

      // yomiage.logが存在する場合は日付付きファイルにリネーム
      if (fs.existsSync(this.logFile)) {
        try {
          fs.renameSync(this.logFile, newOldLogFile);
          console.log(`[LogManager] Moved yomiage.log to ${newOldLogFile}`);
        } catch (error) {
          // ファイルが使用中の場合は、新しいファイル名でコピー
          try {
            fs.copyFileSync(this.logFile, newOldLogFile);
            console.log(`[LogManager] Copied yomiage.log to ${newOldLogFile} (original file in use)`);
          } catch (copyError) {
            console.log('[LogManager] Could not copy log file, continuing with existing file');
          }
        }
      }

      // 古いログファイルのクリーンアップ（7日以上古いファイルを削除）
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
      cutoffDate.setDate(cutoffDate.getDate() - 7); // 7日前

      logFiles.forEach(file => {
        try {
          // ファイル名から日付を抽出 (yomiage.YYYY-MM-DD.log)
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
      cutoffDate.setDate(cutoffDate.getDate() - 3); // 3日前（tempファイルはより短い期間で削除）

      // temp配下の各ディレクトリを処理
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
              
              // ファイルの作成日時をチェック
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

          // 空のディレクトリを削除
          try {
            const remainingFiles = fs.readdirSync(subdirPath);
            if (remainingFiles.length === 0) {
              fs.rmdirSync(subdirPath);
              console.log(`[LogManager] Removed empty temp directory: ${subdirPath}`);
            }
          } catch (error) {
            // ディレクトリが空でない場合は無視
          }

        } catch (error) {
          console.log(`[LogManager] Error processing temp subdirectory ${subdir}:`, error);
        }
      });

      // replayディレクトリの特別処理（UUIDベースのディレクトリ）
      const replayDir = path.join(tempDir, 'replay');
      if (fs.existsSync(replayDir)) {
        try {
          const replaySubdirs = fs.readdirSync(replayDir);
          
          replaySubdirs.forEach(subdir => {
            try {
              const subdirPath = path.join(replayDir, subdir);
              const stats = fs.statSync(subdirPath);
              
              // replayディレクトリは1日前で削除
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

          // 空のreplayディレクトリを削除
          try {
            const remainingReplayDirs = fs.readdirSync(replayDir);
            if (remainingReplayDirs.length === 0) {
              fs.rmdirSync(replayDir);
              console.log(`[LogManager] Removed empty replay directory: ${replayDir}`);
            }
          } catch (error) {
            // ディレクトリが空でない場合は無視
          }

        } catch (error) {
          console.log(`[LogManager] Error processing replay directory:`, error);
        }
      }

      // buffered_replayディレクトリの特別処理
      const bufferedReplayDir = path.join(tempDir, 'buffered_replay');
      if (fs.existsSync(bufferedReplayDir)) {
        try {
          const bufferedReplaySubdirs = fs.readdirSync(bufferedReplayDir);
          
          bufferedReplaySubdirs.forEach(subdir => {
            try {
              const subdirPath = path.join(bufferedReplayDir, subdir);
              const stats = fs.statSync(subdirPath);
              
              // buffered_replayディレクトリは1日前で削除
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

          // 空のbuffered_replayディレクトリを削除
          try {
            const remainingBufferedReplayDirs = fs.readdirSync(bufferedReplayDir);
            if (remainingBufferedReplayDirs.length === 0) {
              fs.rmdirSync(bufferedReplayDir);
              console.log(`[LogManager] Removed empty buffered_replay directory: ${bufferedReplayDir}`);
            }
          } catch (error) {
            // ディレクトリが空でない場合は無視
          }

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
    // 元のconsoleメソッドを保存
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    // 安全なオブジェクト文字列化関数
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
          // 循環参照を回避するための安全なオブジェクト作成
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

    // console.logをインターセプト
    console.log = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(message);
      originalLog.apply(console, args);
    };

    // console.errorをインターセプト
    console.error = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(`ERROR: ${message}`);
      originalError.apply(console, args);
    };

    // console.warnをインターセプト
    console.warn = (...args) => {
      const message = args.map(safeStringify).join(' ');
      this.writeToLog(`WARN: ${message}`);
      originalWarn.apply(console, args);
    };
  }

  private interceptProcessEvents() {
    // プロセス終了時のログ記録
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

    // 未処理のエラーをキャッチ
    process.on('uncaughtException', (error) => {
      this.writeToLog(`[Process] Uncaught Exception: ${error.message}`);
      this.writeToLog(`[Process] Stack: ${error.stack}`);
      this.writeToLog(`[Process] Exception time: ${new Date().toISOString()}`);
      
      // メモリ使用量も記録
      const memUsage = process.memoryUsage();
      this.writeToLog(`[Process] Memory at crash - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, HeapUsed: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, HeapTotal: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
      
      this.close();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      this.writeToLog(`[Process] Unhandled Rejection: ${reason}`);
      this.writeToLog(`[Process] Rejection time: ${new Date().toISOString()}`);
      
      // メモリ使用量も記録
      const memUsage = process.memoryUsage();
      this.writeToLog(`[Process] Memory at rejection - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, HeapUsed: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, HeapTotal: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
      
      this.close();
      process.exit(1);
    });

    // メモリ使用量の監視
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.writeToLog(`[Process] Memory Usage - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, HeapUsed: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, HeapTotal: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    }, 30000); // 5分ごと

    // 起動時のログ
    this.writeToLog(`[Process] Bot started at: ${new Date().toISOString()}`);
    this.writeToLog(`[Process] Node.js version: ${process.version}`);
    this.writeToLog(`[Process] Platform: ${process.platform}`);
    this.writeToLog(`[Process] Architecture: ${process.arch}`);
  }

  private writeToLog(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // ファイルに出力
    if (this.logStream) {
      this.logStream.write(logMessage);
    }
  }

  public log(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // コンソールに出力
    console.log(message);
    
    // ファイルに出力
    if (this.logStream) {
      this.logStream.write(logMessage);
    }
  }

  public error(message: string, error?: any) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] ERROR: ${message}\n`;
    
    if (error) {
      // 循環参照を回避するための安全なエラー文字列化
      let errorDetails = '';
      try {
        // エラーオブジェクトの主要なプロパティを抽出
        if (error instanceof Error) {
          errorDetails = `Error: ${error.name}: ${error.message}\nStack: ${error.stack}`;
        } else if (typeof error === 'object') {
          // オブジェクトの場合は主要なプロパティのみを抽出
          const safeError = {
            message: error.message,
            name: error.name,
            code: error.code,
            stack: error.stack,
            type: error.constructor?.name
          };
          errorDetails = JSON.stringify(safeError, null, 2);
        } else {
          errorDetails = String(error);
        }
      } catch (stringifyError) {
        // JSON.stringifyが失敗した場合は、エラーの基本情報のみを出力
        errorDetails = `Error details could not be serialized: ${error?.message || error?.name || String(error)}`;
      }
      
      logMessage += `[${timestamp}] Error details: ${errorDetails}\n`;
    }
    
    // コンソールに出力
    console.error(message, error);
    
    // ファイルに出力
    if (this.logStream) {
      this.logStream.write(logMessage);
    }
  }

  public warn(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] WARN: ${message}\n`;
    
    // コンソールに出力
    console.warn(message);
    
    // ファイルに出力
    if (this.logStream) {
      this.logStream.write(logMessage);
    }
  }

  public close() {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

class YomiageBot {
  private client: Client;
  private voicevox: VoicevoxClient;
  private rvc: RvcClient;
  private speechToText: SpeechToText | null = null;
  private readonly config: Config;
  private readonly sessionFilePath = 'session.json';
  private currentSpeaker: number = 29;
  private rvcPitch: number = 0;
  private userRvcModels: Map<string, string> = new Map();
  private userSpeakers: Map<string, number> = new Map();
  private connections: Map<string, any> = new Map();
  private audioPlayers: Map<string, AudioPlayer> = new Map();
  private recordingStates: Map<string, fs.WriteStream> = new Map();
  private recordedChunks: Map<string, string[]> = new Map();
  private readonly maxRecordingBufferMinutes = 30;
  private audioQueues: Map<string, AudioQueueItem[]> = new Map();
  private isPlaying: Map<string, boolean> = new Map();
  // 連続バッファリング用
  private audioBuffers: Map<string, BufferedAudio[]> = new Map();
  private readonly bufferDurationMs = 30 * 60 * 1000; // 30分間のバッファ
  // バッファ永続化用
  private readonly bufferPersistenceDir = 'temp/buffers';
  private readonly bufferPersistenceInterval = 30000; // 30秒ごとに保存
  // 音声横流し用
  private streamSessions: Map<string, StreamSession> = new Map();
  private streamConnections: Map<string, any> = new Map();
  // 音声横流し用のプレイヤー管理
  private streamPlayers: Map<string, AudioPlayer> = new Map();
  // ログ管理
  private logger: LogManager;

  constructor(config: Config) {
    this.config = config;
    this.logger = new LogManager();
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });
    this.voicevox = new VoicevoxClient(this.config);
    this.rvc = new RvcClient(this.config);

    // .envの設定に関わらず、SpeechToTextを初期化
    // 実際に使用するかどうかは、この後の起動ログやtranscribeAudioChunkで判断
    try {
      this.speechToText = new SpeechToText();
      this.logger.log(`[Transcription] Service initialized (Whisper).`);
    } catch (error: any) {
      this.logger.error(`[Transcription] Failed to initialize: ${error.message}`);
      this.speechToText = null;
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.once('ready', async () => {
      if (!this.client.user) {
        throw new Error("Client user is not available.");
      }
      this.logger.log(`Ready! Logged in as ${this.client.user.tag}`);
      
      this.syncCommands();
      this.rejoinChannels();
      
      // バッファを復元
      this.loadAllBuffers();
      
      // 定期的にバッファを保存
      setInterval(() => {
        this.saveAllBuffers();
      }, this.bufferPersistenceInterval);
      
      // 自動的に音声横流しを開始
      this.startAutoStreaming();
    });
    this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('messageCreate', this.handleMessageCreate.bind(this));

    // グローバルエラーハンドリング
    process.on('uncaughtException', (error) => {
      this.logger.error('[Global] Uncaught Exception:', error);
      this.logger.error('[Global] Stack trace:', error.stack);
      this.logger.error('[Global] Exception time:', new Date().toISOString());
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('[Global] Unhandled Rejection:', reason);
      this.logger.error('[Global] Rejection time:', new Date().toISOString());
    });
  }

  private async handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState
  ) {
    const guildId = newState.guild.id || oldState.guild.id;
    const member = newState.member || oldState.member;
    const botId = this.client.user?.id;

    if (member?.id === botId || member?.user.bot) return;

    const connection = getVoiceConnection(guildId);
    const botChannelId = connection?.joinConfig.channelId;

    if (newState.channelId && !connection) {
      try {
        this.logger.log(`[AutoJoin] User ${member?.user.tag} joined ${newState.channel!.name}. Bot disconnected, joining.`);
        await this.joinVoiceChannelByIds(guildId, newState.channelId, member?.displayName, member?.id);
      } catch (error) {
        this.logger.error(`[AutoJoin] Failed to auto-join ${newState.channel!.name}:`, error);
      }
      return;
    }

    if (!connection || !botChannelId) return;

    const userJoinedBotChannel = newState.channelId === botChannelId && oldState.channelId !== botChannelId;
    if (userJoinedBotChannel) {
      this.logger.log(`[Greeting] User ${member?.user.tag} joined bot's channel.`);
      this.playGreeting(guildId, member?.displayName, member?.id);
    }

    const userLeftBotChannel = oldState.channelId === botChannelId && newState.channelId !== botChannelId;
    if (userLeftBotChannel) {
      try {
        const channel = await this.client.channels.fetch(botChannelId);
        if (channel && channel.isVoiceBased() && channel.members.filter((m: GuildMember) => !m.user.bot).size === 0) {
          this.logger.log(`[AutoLeave] Last user left. Channel is empty.`);
          await this.leaveVoiceChannel(guildId, false);
        } else if (channel && channel.isVoiceBased() && channel.members.filter((m: GuildMember) => !m.user.bot).size > 0) {
          // Only play farewell if there are still other users in the channel
          this.logger.log(`[Farewell] User ${member?.user.tag} left bot's channel.`);
          await this.playFarewell(guildId, member?.displayName, member?.id);
        }
      } catch (error) {
        this.logger.error('[LeaveLogic] Error handling user departure:', error);
      }
    }
  }

  private preprocessMessage(content: string): string {
    // 先頭が「;」なら読み上げない
    if (content.startsWith(";")) {
      return "";
    }

    // コードブロック（```で囲まれてるもの）は読み上げない
    if (content.startsWith("```") && content.endsWith("```")) {
      return "";
    }

    // メンション（<@1234567890> や <@!1234567890>）を取り除く
    content = content.replace(/<@!?[0-9]+>/g, "");

    // URLチェック（簡易版）
    const urlPattern = /https?:\/\/[^\s]+/;
    if (urlPattern.test(content.trim())) {
      return "URL";
    }

    // 長すぎるメッセージを切り詰める
    if (content.length > this.config.maxTextLength) {
      content = content.substring(0, this.config.maxTextLength) + "以下省略";
    }

    return content.trim();
  }

  private handleMessageCreate(message: Message) {
    if (message.author.bot || !message.guildId || !message.content) return;
    if (!getVoiceConnection(message.guildId)) return;

    // メッセージの前処理
    const processedText = this.preprocessMessage(message.content);
    
    // 空文字列の場合は読み上げない
    if (!processedText) return;

    this.enqueueAudio(message.guildId, {
      text: processedText,
      userId: message.author.id,
    });
  }

  private async handleInteraction(interaction: any) {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;
    switch (commandName) {
      case 'vjoin':
        await this.handleJoinCommand(interaction);
        break;
      case 'vleave':
        await this.handleLeaveCommand(interaction);
        break;
      case 'vpitch':
        await this.handlePitchCommand(interaction);
        break;
      case 'vspeaker':
        await this.handleSpeakerCommand(interaction);
        break;
      case 'vreplay':
        await this.handleReplayCommand(interaction);
        break;
      case 'vkyouiku':
        await this.handleKyouikuCommand(interaction);
        break;
      case 'vsetvoice':
        await this.handleSetVoiceCommand(interaction);
        break;
      case 'vstatus':
        await this.handleStatusCommand(interaction);
        break;
    }
  }

  private async handleJoinCommand(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: 'ボイスチャンネルに参加してください。', flags: [MessageFlags.Ephemeral] });
    }
    await this.joinVoiceChannelByIds(voiceChannel.guild.id, voiceChannel.id, member.displayName, member.id);
    await interaction.reply({ content: `✅ ${voiceChannel.name} に参加しました！`, flags: [MessageFlags.Ephemeral] });
  }

  private async handleLeaveCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;
    const left = await this.leaveVoiceChannel(interaction.guild.id, true, (interaction.member as GuildMember).displayName, interaction.user.id);
    if (left) {
      await interaction.reply({ content: '✅ ボイスチャンネルから切断しました。', flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content: 'ボイスチャンネルに接続していません。', flags: [MessageFlags.Ephemeral] });
    }
  }

  private async handlePitchCommand(interaction: ChatInputCommandInteraction) {
    this.rvcPitch = interaction.options.getInteger('value', true);
    await interaction.reply({ content: `RVCのピッチを ${this.rvcPitch}に設定しました。`, flags: [MessageFlags.Ephemeral] });
  }

  private async handleSpeakerCommand(interaction: ChatInputCommandInteraction) {
    const speakers = await this.voicevox.getSpeakers();
    if (speakers.length === 0) {
      return interaction.reply({ content: '話者リストの取得に失敗しました。', flags: [MessageFlags.Ephemeral] });
    }
    const speakerId = interaction.options.getInteger('speaker', true);
    const selectedSpeaker = speakers.find(s => s.id === speakerId);
    if (!selectedSpeaker) {
      return interaction.reply({ content: '無効な話者が選択されました。', flags: [MessageFlags.Ephemeral] });
    }
    this.userSpeakers.set(interaction.user.id, speakerId);
    await interaction.reply({ content: `話者を「${selectedSpeaker.name}」に設定しました。`, flags: [MessageFlags.Ephemeral] });
  }

  private async handleReplayCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) return;
    const guildId = interaction.guildId;
    const targetUser = interaction.options.getUser('user', false);
    const durationMinutes = interaction.options.getInteger('duration') ?? 5;
    const durationSeconds = durationMinutes * 60;

    await interaction.deferReply({ ephemeral: true });

    // まずバッファリング機能を試す
    const bufferedPath = await this.createBufferedReplay(guildId, durationMinutes);
    
    if (bufferedPath) {
      const attachment = new AttachmentBuilder(bufferedPath);
      const userText = targetUser ? `${targetUser.tag}さんの` : '全員の';
      console.log(`[Replay] Sending buffered replay for ${durationMinutes} minutes`);
      await interaction.editReply({
        content: `過去${durationMinutes}分間の${userText}リプレイ（バッファリング録音、音量調整済み）です。`,
        files: [attachment],
      });
      return;
    }

    // バッファリングが失敗した場合、従来のファイルベース録音を使用
    console.log(`[Replay] Buffered replay failed, falling back to file-based replay`);
    
    let allChunks = this.recordedChunks.get(guildId);
    console.log(`[Replay] Guild ${guildId} has ${allChunks?.length || 0} total recorded chunks`);
    
    if (!allChunks || allChunks.length === 0) {
      await interaction.editReply('リプレイデータがありません。');
      return;
    }

    // デバッグ: 全ファイルの詳細を出力
    console.log(`[Replay] All chunks for guild ${guildId}:`);
    allChunks.forEach((chunk, index) => {
      const filename = path.basename(chunk);
      const parts = filename.split('-');
      const userId = parts[0];
      const timestamp = parts[1]?.replace('.pcm', '');
      console.log(`  ${index + 1}. ${filename} (User: ${userId}, Time: ${timestamp})`);
    });

    if (targetUser) {
      const beforeFilter = allChunks.length;
      allChunks = allChunks.filter(chunkPath => path.basename(chunkPath).startsWith(targetUser.id));
      console.log(`[Replay] Filtered for user ${targetUser.tag}: ${beforeFilter} -> ${allChunks.length} chunks`);
      
      if (allChunks.length === 0) {
        await interaction.editReply(`${targetUser.tag}さんのリプレイデータがありません。`);
        return;
      }
    }

    const now = Date.now();
    const cutoff = now - durationSeconds * 1000;

    const relevantChunks = allChunks.filter(chunkPath => {
      try {
        const timestamp = parseInt(path.basename(chunkPath).split('-')[1].replace('.pcm', ''));
        const isRelevant = timestamp >= cutoff;
        if (!isRelevant) {
          console.log(`[Replay] Skipping old chunk: ${path.basename(chunkPath)} (timestamp: ${timestamp}, cutoff: ${cutoff})`);
        }
        return isRelevant;
      } catch (error) {
        console.error(`[Replay] Error parsing timestamp for ${chunkPath}:`, error);
        return false;
      }
    });

    console.log(`[Replay] Found ${relevantChunks.length} relevant chunks within ${durationMinutes} minutes`);

    if (relevantChunks.length === 0) {
      const userText = targetUser ? `${targetUser.tag}さんの` : '';
      await interaction.editReply(`${userText}${durationMinutes}分以内のリプレイデータがありません。`);
      return;
    }

    const tempDir = path.join('temp', 'replay', uuidv4());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      console.log(`[Replay] Converting ${relevantChunks.length} chunks to WAV...`);
      const wavFiles = await Promise.all(relevantChunks.map(async (chunkPath, index) => {
        const wavPath = path.join(tempDir, `${path.basename(chunkPath)}.wav`);
        console.log(`[Replay] Converting chunk ${index + 1}/${relevantChunks.length}: ${path.basename(chunkPath)}`);
        await this.runFfmpeg(`-f s16le -ar 48k -ac 2 -i "${chunkPath}" "${wavPath}"`);
        return wavPath;
      }));

      const fileListPath = path.join(tempDir, 'filelist.txt');
      const fileListContent = wavFiles.map(f => `file '${path.basename(f)}'`).join('\n');
      fs.writeFileSync(fileListPath, fileListContent);

      // 3. Merge WAV files into a single WAV file
      const mergedPath = path.join(tempDir, 'merged.wav');
      console.log(`[Replay] Merging ${wavFiles.length} WAV files...`);
      await this.runFfmpeg(`-f concat -safe 0 -i "${fileListPath}" -c copy "${mergedPath}"`);
      
      // 4. Normalize the audio using loudnorm filter
      const normalizedPath = path.join(tempDir, 'replay.wav');
      console.log(`[Replay] Normalizing audio...`);
      // Note: This is a two-pass loudnorm process for better results.
      // Pass 1: Analyze the audio and get normalization stats
      const loudnormStats = await this.runFfmpegWithOutput(`-i "${mergedPath}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`);
      
      // Extract the stats from FFmpeg's stderr
      const statsJson = loudnormStats.substring(loudnormStats.indexOf('{'), loudnormStats.lastIndexOf('}') + 1);
      const stats = JSON.parse(statsJson);

      // Pass 2: Apply the normalization using the stats from pass 1
      const loudnormCommand = `-i "${mergedPath}" -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_LRA=${stats.input_lra}:measured_TP=${stats.input_tp}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset} -ar 48k "${normalizedPath}"`
      await this.runFfmpeg(loudnormCommand);

      // 5. Send the final audio as an attachment
      const attachment = new AttachmentBuilder(normalizedPath);
      const userText = targetUser ? `${targetUser.tag}さんの` : '全員の';
      console.log(`[Replay] Sending replay with ${relevantChunks.length} chunks`);
      await interaction.editReply({
        content: `過去${durationMinutes}分間の${userText}リプレイ（ファイルベース、音量調整済み）です。`,
        files: [attachment],
      });

    } catch (error) {
      console.error('[Replay] Error processing replay:', error);
      await interaction.editReply('リプレイの生成に失敗しました。');
    } finally {
      // 5. Clean up temp directory
      setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }, () => {}), 60000);
    }
  }

  private async handleKyouikuCommand(interaction: ChatInputCommandInteraction) {
    const surface = interaction.options.getString('surface', true);
    const pronunciation = interaction.options.getString('pronunciation', true);
    const accentType = interaction.options.getInteger('accent_type', true);
    const success = await this.voicevox.addUserDictWord(surface, pronunciation, accentType);
    if (success) {
      await interaction.reply({ content: `「${surface}」を辞書に登録しました。`, flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content: `❌ 単語の登録に失敗しました。`, flags: [MessageFlags.Ephemeral] });
    }
  }

  private async handleSetVoiceCommand(interaction: ChatInputCommandInteraction) {
    const modelName = interaction.options.getString('model', true);
    this.userRvcModels.set(interaction.user.id, modelName);
    await interaction.reply({ content: `✅ あなたの声を ${modelName} に設定しました。`, flags: [MessageFlags.Ephemeral] });
  }

  private async handleStatusCommand(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) return;
    const guildId = interaction.guildId;
    
    await interaction.deferReply({ ephemeral: true });
    
    const connection = getVoiceConnection(guildId);
    const chunks = this.recordedChunks.get(guildId) || [];
    const recordingStates = Array.from(this.recordingStates.entries())
      .filter(([userId, writer]) => {
        const chunkPath = writer.path.toString();
        return chunkPath.includes(guildId);
      });
    
    let statusMessage = `**録音状況**\n`;
    statusMessage += `接続状態: ${connection ? '✅ 接続中' : '❌ 未接続'}\n`;
    statusMessage += `録音ファイル数: ${chunks.length}個\n`;
    statusMessage += `現在録音中: ${recordingStates.length}人\n`;
    
    if (chunks.length > 0) {
      statusMessage += `\n**最近の録音ファイル**\n`;
      const recentChunks = chunks.slice(-5); // 最新5個
      recentChunks.forEach((chunk, index) => {
        const filename = path.basename(chunk);
        const parts = filename.split('-');
        const userId = parts[0];
        const timestamp = parts[1]?.replace('.pcm', '');
        const time = timestamp ? new Date(parseInt(timestamp)).toLocaleTimeString() : 'Unknown';
        statusMessage += `${index + 1}. ${userId} (${time})\n`;
      });
    }
    
    if (recordingStates.length > 0) {
      statusMessage += `\n**現在録音中のユーザー**\n`;
      recordingStates.forEach(([userId], index) => {
        statusMessage += `${index + 1}. ${userId}\n`;
      });
    }
    
    await interaction.editReply(statusMessage);
  }

  private getRvcModels(): string[] {
    try {
      const files = fs.readdirSync(this.config.rvcModelsPath);
      return files.filter(file => file.endsWith('.pth')).map(file => file.replace('.pth', ''));
    } catch (error) {
      console.error("Could not read RVC models directory:", error);
      return [];
    }
  }

  private async loadSession(): Promise<Session> {
    try {
      const data = fs.readFileSync(this.sessionFilePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  private async saveSession(guildId: string, channelId: string | null) {
    const session = await this.loadSession();
    if (channelId) session[guildId] = channelId;
    else delete session[guildId];
    fs.writeFileSync(this.sessionFilePath, JSON.stringify(session, null, 2));
  }

  private async rejoinChannels() {
    const session = await this.loadSession();
    for (const guildId in session) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(session[guildId]);
        if (channel && channel.isVoiceBased() && channel.members.filter(m => !m.user.bot).size > 0) {
          console.log(`Rejoining ${channel.name} (users present).`);
          await this.joinVoiceChannelByIds(guildId, channel.id);
        } else {
          console.log(`Skipping rejoin for ${channel ? channel.name : `ID: ${session[guildId]}`} (empty or not found).`);
        }
      } catch (error) {
        console.error(`Failed to rejoin for guild ${guildId}:`, error);
        await this.saveSession(guildId, null);
      }
    }
  }

  private async syncCommands() {
    if (!this.client.user) return;
    const speakers = (await this.voicevox.getSpeakers()).map(s => ({ name: s.name, value: s.id })).slice(0, 25);
    const rvcModels = this.getRvcModels().map(m => ({ name: m, value: m })).slice(0, 25);
    const commands = [
      new SlashCommandBuilder().setName('vjoin').setDescription('ボイスチャットにボットを追加。'),
      new SlashCommandBuilder().setName('vleave').setDescription('ボイスチャットから切断します。'),
      new SlashCommandBuilder().setName('vpitch').setDescription('RVC使用時の声の高さを変更します。').addIntegerOption(o => o.setName('value').setDescription('ピッチ(-12~12)').setRequired(true).setMinValue(-12).setMaxValue(12)),
      new SlashCommandBuilder().setName('vspeaker').setDescription('読み上げの話者を変更します').addIntegerOption(o => o.setName('speaker').setDescription('話者を選択').setRequired(true).addChoices(...speakers)),
      new SlashCommandBuilder().setName('vreplay').setDescription('指定ユーザーの会話を再生').addUserOption(o => o.setName('user').setDescription('再生するユーザー（省略時は全員）').setRequired(false)).addIntegerOption(o => o.setName('duration').setDescription('再生時間(分、デフォルト5)').setRequired(false).setMinValue(1)),
      new SlashCommandBuilder().setName('vkyouiku').setDescription('辞書に単語を登録します。').addStringOption(o => o.setName('surface').setDescription('単語').setRequired(true)).addStringOption(o => o.setName('pronunciation').setDescription('読み(カタカナ)').setRequired(true)).addIntegerOption(o => o.setName('accent_type').setDescription('アクセント核位置').setRequired(true)),
      new SlashCommandBuilder().setName('vsetvoice').setDescription('あなたの声のモデルを変更します。').addStringOption(o => o.setName('model').setDescription('モデルを選択').setRequired(true).addChoices(...rvcModels)),
      new SlashCommandBuilder().setName('vstatus').setDescription('録音状況を確認します。'),
    ].map(cmd => cmd.toJSON());

    try {
      const rest = new REST({ version: '10' }).setToken(this.config.discordToken);
      await rest.put(Routes.applicationCommands(this.config.applicationId), { body: commands });
      this.logger.log('✅ Synced slash commands.');
    } catch (error) {
      this.logger.error('❌ Failed to sync slash commands:', error);
    }
  }

  private startRecording(connection: VoiceConnection) {
    const guildId = connection.joinConfig.guildId;
    const channelId = connection.joinConfig.channelId;
    
    this.logger.log(`[Recording] Attempting to start recording for guild ${guildId}, channel ${channelId}`);
    
    // バッファを初期化（ただし、既にバッファが存在する場合は維持する）
    if (!this.audioBuffers.has(guildId)) {
      this.audioBuffers.set(guildId, []);
      this.logger.log(`[Recording] Initialized new audio buffer for guild ${guildId}`);
    } else {
      this.logger.log(`[Recording] Using existing audio buffer for guild ${guildId} with ${this.audioBuffers.get(guildId)!.length} chunks.`);
    }
    
    connection.receiver.speaking.on('start', (userId) => {
      // 既に録音中の場合は、新しい録音を開始しない
      if (this.recordingStates.has(userId)) {
        this.logger.log(`[Recording] User ${userId} is already being recorded, skipping new recording.`);
        return;
      }

      this.logger.log(`[Recording] Starting recording for user ${userId} in guild ${guildId}`);
      const tempDir = path.join('temp', 'recordings', guildId);
      
      try {
        fs.mkdirSync(tempDir, { recursive: true });
        const chunkPath = path.join(tempDir, `${userId}-${Date.now()}.pcm`);
        this.logger.log(`[Recording] Recording file path: ${chunkPath}`);

        const audioStream = connection.receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 1500, // 3秒から1.5秒に短縮してより多くの音声をキャッチ
          },
        });

        // 音声ストリームのバッファリングを改善
        audioStream.setMaxListeners(0); // リスナー制限を解除

        const pcmStream = audioStream.pipe(new prism.opus.Decoder({ 
          rate: 48000, 
          channels: 2, 
          frameSize: 960
        }));
        
        const writer = pcmStream.pipe(fs.createWriteStream(chunkPath));
        this.recordingStates.set(userId, writer);
        this.logger.log(`[Recording] Recording stream setup completed for user ${userId}`);

        // バッファリング用のデータ収集
        const audioChunks: Buffer[] = [];
        pcmStream.on('data', (chunk: Buffer) => {
          audioChunks.push(chunk);
        });

        // ストリームエラーハンドリングを強化
        audioStream.on('error', (error) => {
          // 正常な動作で発生するエラーは無視
          if ((error.message && error.message.includes('ERR_STREAM_PREMATURE_CLOSE')) ||
              ((error as any).code && (error as any).code === 'ERR_STREAM_PREMATURE_CLOSE') ||
              (error.message && error.message.includes('Premature close'))) {
            this.logger.log(`[Recording] Normal stream close for user ${userId} (ignoring error)`);
            // エラーでも録音ファイルを保存するため、writerを終了
            if (writer && !writer.destroyed) {
              writer.end();
            }
            return;
          }
          this.logger.error(`[Recording] Audio stream error for user ${userId}:`, error);
          this.recordingStates.delete(userId);
        });

        pcmStream.on('error', (error) => {
          this.logger.error(`[Recording] PCM stream error for user ${userId}:`, error);
          this.recordingStates.delete(userId);
        });

        // ストリーム終了イベントを追加
        audioStream.on('end', () => {
          this.logger.log(`[Recording] Audio stream ended for user ${userId}`);
          // ストリーム終了時にwriterを確実に終了
          if (writer && !writer.destroyed) {
            writer.end();
          }
        });

        audioStream.on('close', () => {
          this.logger.log(`[Recording] Audio stream closed for user ${userId}`);
        });

        pcmStream.on('end', () => {
          this.logger.log(`[Recording] PCM stream ended for user ${userId}`);
        });

        pcmStream.on('close', () => {
          this.logger.log(`[Recording] PCM stream closed for user ${userId}`);
        });

        writer.on('finish', async () => {
          this.logger.log(`[Recording] Finished recording for user ${userId}, file: ${chunkPath}`);
          
          // ファイルサイズをチェック（最小1KB）
          try {
            const stats = fs.statSync(chunkPath);
            if (stats.size < 1024) {
              this.logger.log(`[Recording] File too small (${stats.size} bytes), skipping: ${chunkPath}`);
              fs.unlinkSync(chunkPath);
              this.recordingStates.delete(userId);
              return;
            }
            
            this.logger.log(`[Recording] File saved successfully: ${chunkPath} (${stats.size} bytes)`);
          } catch (error) {
            this.logger.error(`[Recording] Error checking file size for ${chunkPath}:`, error);
            this.recordingStates.delete(userId);
            return;
          }
          
          const recordedChunks = this.recordedChunks.get(guildId) || [];
          recordedChunks.push(chunkPath);
          this.recordedChunks.set(guildId, recordedChunks);
          this.recordingStates.delete(userId);
          
          // バッファリング用データを追加
          if (audioChunks.length > 0) {
            const bufferData = Buffer.concat(audioChunks);
            const buffers = this.audioBuffers.get(guildId) || [];
            buffers.push({
              data: bufferData,
              timestamp: Date.now(),
              userId: userId
            });
            this.audioBuffers.set(guildId, buffers);
            
            // 古いバッファをクリーンアップ
            this.cleanupOldBuffers(guildId);
            
            // パフォーマンス改善のため、録音ごとの保存は停止
            // this.saveBuffersToFile(guildId);
          }
          
          // 録音ファイルの統計を出力
          this.logger.log(`[Recording] Guild ${guildId} now has ${recordedChunks.length} recorded chunks`);
          
          this.cleanupOldChunks(guildId);
          
          // 文字起こしを実行
          if (this.speechToText) {
            this.logger.log(`[Transcription] Starting transcription for user ${userId}, file: ${chunkPath}`);
            this.transcribeAudioChunk(chunkPath, userId, guildId);
          } else {
            this.logger.log(`[Transcription] SpeechToText service not available, skipping transcription`);
          }
        });

        writer.on('close', () => {
          this.logger.log(`[Recording] Writer closed for user ${userId}`);
        });

        writer.on('error', (error) => {
          this.logger.error(`[Recording] Error recording for user ${userId}:`, error);
          this.recordingStates.delete(userId);
          // エラーが発生した場合、ファイルを削除
          try {
            if (fs.existsSync(chunkPath)) {
              fs.unlinkSync(chunkPath);
            }
          } catch (unlinkError) {
            this.logger.error(`[Recording] Error deleting failed recording file ${chunkPath}:`, unlinkError);
          }
        });

        // タイムアウト処理を追加（5秒後に強制終了）
        setTimeout(() => {
          if (this.recordingStates.has(userId)) {
            this.logger.log(`[Recording] Timeout reached for user ${userId}, forcing stream end`);
            try {
              if (!writer.destroyed) {
                writer.end();
              }
            } catch (error) {
              this.logger.error(`[Recording] Error forcing stream end for user ${userId}:`, error);
            }
            this.recordingStates.delete(userId);
          }
        }, 10000); // 5秒から10秒に延長

      } catch (error) {
        this.logger.error(`[Recording] Error setting up recording for user ${userId}:`, error);
        this.recordingStates.delete(userId);
      }
    });

    // speaking終了イベントも監視
    connection.receiver.speaking.on('end', (userId) => {
      this.logger.log(`[Recording] User ${userId} stopped speaking in guild ${guildId}`);
      
      // 録音中の場合は、少し待ってからストリームを終了
      if (this.recordingStates.has(userId)) {
        setTimeout(() => {
          const writer = this.recordingStates.get(userId);
          if (writer && !writer.destroyed) {
            this.logger.log(`[Recording] Forcing stream end for user ${userId} after speaking ended`);
            try {
              writer.end();
            } catch (error) {
              this.logger.error(`[Recording] Error ending stream for user ${userId}:`, error);
            }
          }
        }, 3000); // 2秒から3秒に延長
      }
    });
  }

  private async transcribeAudioChunk(chunkPath: string, userId: string, guildId: string) {
    if (!this.speechToText) {
      this.logger.log(`[Transcription] SpeechToText service not available for user ${userId}`);
      return;
    }
    
    try {
      this.logger.log(`[Transcription] Processing audio chunk for user ${userId}, file: ${chunkPath}`);
      const result = await this.speechToText.transcribeAudio(chunkPath);
      
      if (result && result.text.trim().length > 0) {
        this.logger.log(`[Transcription] Successfully transcribed for user ${userId}: "${result.text}"`);
        
        const guild = await this.client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId).catch(() => null);
        const userName = member?.displayName || member?.user.username || 'Unknown User';
        
        // WhisperではチャンネルIDは不要だが、念のためログは残す
        const channel = await this.client.channels.fetch(this.config.transcriptionChannelId).catch(() => null);
        if (channel && channel.isTextBased() && 'send' in channel) {
          await channel.send({
            content: `**${userName}**: ${result.text}`
          });
          this.logger.log(`[Transcription] Sent transcription to channel ${this.config.transcriptionChannelId}`);
        } else {
          this.logger.warn(`[Transcription] Channel ${this.config.transcriptionChannelId} not found or not a text channel. Transcription: "${result.text}"`);
        }
      } else {
        this.logger.log(`[Transcription] No text detected for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(`[Transcription] Error during audio chunk transcription for user ${userId}:`, error);
    }
  }

  private stopRecording(guildId: string) {
    console.log(`[Recording] Stopping recording for guild ${guildId}`);
    // Stop any active writers associated with this guild
    for (const [userId, writer] of this.recordingStates.entries()) {
      // A bit of a hacky way to check guild membership without full member objects
      const chunkPath = writer.path.toString();
      if (chunkPath.includes(guildId)) {
        try {
          // ストリームを安全に終了
          if (!writer.destroyed) {
            writer.end();
          }
        } catch (error) {
          console.error(`[Recording] Error ending writer for user ${userId}:`, error);
        }
        this.recordingStates.delete(userId);
      }
    }

    // Clean up temp folder for the guild
    const tempDir = path.join('temp', 'recordings', guildId);
    if (fs.existsSync(tempDir)) {
      fs.rm(tempDir, { recursive: true, force: true }, (err) => {
        if (err) console.error(`[Recording] Error cleaning up temp dir for ${guildId}:`, err);
        else console.log(`[Recording] Cleaned up temp dir for ${guildId}`);
      });
    }
    this.recordedChunks.delete(guildId);
    
    // バッファもクリーンアップ
    this.audioBuffers.delete(guildId);
    console.log(`[Recording] Cleared audio buffers for guild ${guildId}`);
  }

  private cleanupOldChunks(guildId: string) {
    const chunks = this.recordedChunks.get(guildId);
    if (!chunks) return;

    const now = Date.now();
    const cutoff = now - this.maxRecordingBufferMinutes * 60 * 1000;
    console.log(`[Cleanup] Checking ${chunks.length} chunks for guild ${guildId}, cutoff time: ${cutoff}`);

    const recentChunks = chunks.filter(chunkPath => {
      try {
        const timestamp = parseInt(path.basename(chunkPath).split('-')[1].replace('.pcm', ''));
        if (timestamp < cutoff) {
          console.log(`[Cleanup] Removing old chunk: ${path.basename(chunkPath)} (timestamp: ${timestamp})`);
          fs.unlink(chunkPath, (err) => {
            if (err) console.error(`[Recording] Error deleting old chunk ${chunkPath}:`, err);
            else console.log(`[Cleanup] Successfully deleted old chunk: ${path.basename(chunkPath)}`);
          });
          return false;
        }
        return true;
      } catch (error) {
        console.error(`[Cleanup] Error parsing timestamp for ${chunkPath}:`, error);
        return false;
      }
    });
    
    if (recentChunks.length !== chunks.length) {
      console.log(`[Cleanup] Removed ${chunks.length - recentChunks.length} old chunks, ${recentChunks.length} remaining`);
    }
    
    this.recordedChunks.set(guildId, recentChunks);
  }

  private cleanupOldBuffers(guildId: string) {
    const buffers = this.audioBuffers.get(guildId);
    if (!buffers) return;

    const now = Date.now();
    const cutoff = now - this.bufferDurationMs;
    
    const recentBuffers = buffers.filter(buffer => buffer.timestamp >= cutoff);
    
    if (recentBuffers.length !== buffers.length) {
      console.log(`[BufferCleanup] Removed ${buffers.length - recentBuffers.length} old buffers, ${recentBuffers.length} remaining`);
    }
    
    this.audioBuffers.set(guildId, recentBuffers);
  }

  // バッファをファイルに保存
  private saveBuffersToFile(guildId: string) {
    try {
      const buffers = this.audioBuffers.get(guildId);
      if (!buffers || buffers.length === 0) return;

      // バッファ保存ディレクトリを作成
      if (!fs.existsSync(this.bufferPersistenceDir)) {
        fs.mkdirSync(this.bufferPersistenceDir, { recursive: true });
      }

      const bufferFile = path.join(this.bufferPersistenceDir, `${guildId}.json`);
      const bufferData = {
        timestamp: Date.now(),
        guildId: guildId,
        buffers: buffers.map(buffer => ({
          data: buffer.data.toString('base64'), // BufferをBase64に変換
          timestamp: buffer.timestamp,
          userId: buffer.userId
        }))
      };

      fs.writeFileSync(bufferFile, JSON.stringify(bufferData, null, 2));
      this.logger.log(`[BufferPersistence] Saved ${buffers.length} buffers for guild ${guildId}`);
    } catch (error) {
      this.logger.error(`[BufferPersistence] Error saving buffers for guild ${guildId}:`, error);
    }
  }

  // バッファをファイルから復元
  private loadBuffersFromFile(guildId: string) {
    try {
      const bufferFile = path.join(this.bufferPersistenceDir, `${guildId}.json`);
      if (!fs.existsSync(bufferFile)) return;

      const data = JSON.parse(fs.readFileSync(bufferFile, 'utf-8'));
      const buffers: BufferedAudio[] = data.buffers.map((buffer: any) => ({
        data: Buffer.from(buffer.data, 'base64'), // Base64からBufferに変換
        timestamp: buffer.timestamp,
        userId: buffer.userId
      }));

      this.audioBuffers.set(guildId, buffers);
      this.logger.log(`[BufferPersistence] Loaded ${buffers.length} buffers for guild ${guildId}`);
    } catch (error) {
      this.logger.error(`[BufferPersistence] Error loading buffers for guild ${guildId}:`, error);
    }
  }

  // 全ギルドのバッファを保存
  private saveAllBuffers() {
    for (const [guildId] of this.audioBuffers) {
      this.saveBuffersToFile(guildId);
    }
  }

  // 全ギルドのバッファを復元
  private loadAllBuffers() {
    try {
      if (!fs.existsSync(this.bufferPersistenceDir)) return;

      const files = fs.readdirSync(this.bufferPersistenceDir);
      const bufferFiles = files.filter(file => file.endsWith('.json'));

      for (const file of bufferFiles) {
        const guildId = file.replace('.json', '');
        this.loadBuffersFromFile(guildId);
      }

      this.logger.log(`[BufferPersistence] Loaded buffers from ${bufferFiles.length} files`);
    } catch (error) {
      this.logger.error(`[BufferPersistence] Error loading all buffers:`, error);
    }
  }

  private async createBufferedReplay(guildId: string, durationMinutes: number): Promise<string | null> {
    // ユーザーは「会話の合計が5分」のリプレイを求めている。
    const targetDurationMs = (durationMinutes ?? 5) * 60 * 1000;

    const allBuffers = this.audioBuffers.get(guildId);
    if (!allBuffers || allBuffers.length === 0) {
      this.logger.log(`[BufferedReplay] No buffered audio for guild ${guildId}`);
      return null;
    }

    // バッファを新しい順（降順）にソート
    allBuffers.sort((a, b) => b.timestamp - a.timestamp);

    const relevantBuffers: BufferedAudio[] = [];
    let accumulatedDurationMs = 0;
    // 1msあたりのバイト数: 48kHz (サンプル/秒) * 2 (チャンネル) * 2 (16bit = 2bytes) / 1000 (ms/s)
    const bytesPerMs = (48000 * 2 * 2) / 1000;

    for (const buffer of allBuffers) {
      const bufferDurationMs = buffer.data.length / bytesPerMs;
      relevantBuffers.push(buffer);
      accumulatedDurationMs += bufferDurationMs;
      
      // 5分以上の音声が集まったらループを抜ける
      if (accumulatedDurationMs >= targetDurationMs) {
        break;
      }
    }

    if (relevantBuffers.length === 0) {
      this.logger.log(`[BufferedReplay] No relevant buffers found after filtering.`);
      return null;
    }

    this.logger.log(`[BufferedReplay] Found ${relevantBuffers.length} buffers with a total duration of ${Math.round(accumulatedDurationMs / 1000)}s to create replay.`);

    // 再生のために時系列順（昇順）に戻す
    relevantBuffers.sort((a, b) => a.timestamp - b.timestamp);
    
    const tempDir = path.join('temp', 'buffered_replay', uuidv4());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // 各バッファをWAVファイルに変換
      const wavFiles = await Promise.all(relevantBuffers.map(async (buffer, index) => {
        const wavPath = path.join(tempDir, `buffer_${index}.wav`);
        
        // PCMデータをWAVファイルに変換
        const pcmPath = path.join(tempDir, `buffer_${index}.pcm`);
        fs.writeFileSync(pcmPath, buffer.data);
        
        await this.runFfmpeg(`-f s16le -ar 48k -ac 2 -i "${pcmPath}" "${wavPath}"`);
        fs.unlinkSync(pcmPath); // PCMファイルを削除
        
        return wavPath;
      }));

      if (wavFiles.length === 0) {
        return null;
      }

      // 単一のWAVファイルに結合
      const fileListPath = path.join(tempDir, 'filelist.txt');
      const fileListContent = wavFiles.map(f => `file '${path.basename(f)}'`).join('\n');
      fs.writeFileSync(fileListPath, fileListContent);

      const mergedPath = path.join(tempDir, 'merged.wav');
      this.logger.log(`[BufferedReplay] Merging ${wavFiles.length} WAV files...`);
      await this.runFfmpeg(`-f concat -safe 0 -i "${fileListPath}" -c copy "${mergedPath}"`);

      // 音量正規化
      const normalizedPath = path.join(tempDir, 'buffered_replay.wav');
      this.logger.log(`[BufferedReplay] Normalizing audio...`);
      
      const loudnormStats = await this.runFfmpegWithOutput(`-i "${mergedPath}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -`);
      const statsJson = loudnormStats.substring(loudnormStats.indexOf('{'), loudnormStats.lastIndexOf('}') + 1);
      const stats = JSON.parse(statsJson);

      const loudnormCommand = `-i "${mergedPath}" -af loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_LRA=${stats.input_lra}:measured_TP=${stats.input_tp}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset} -ar 48k "${normalizedPath}"`;
      await this.runFfmpeg(loudnormCommand);

      return normalizedPath;
    } catch (error) {
      this.logger.error('[BufferedReplay] Error creating buffered replay:', error);
      // エラー時も一時ファイルはクリーンアップ
      fs.rm(tempDir, { recursive: true, force: true }, (err) => {
        if (err) this.logger.error(`[BufferedReplay] Error cleaning up temp dir on failure:`, err);
      });
      return null;
    } finally {
      // 正常終了時もクリーンアップスケジュール
      setTimeout(() => fs.rm(tempDir, { recursive: true, force: true }, (err) => {
        if (err) this.logger.error(`[BufferedReplay] Error cleaning up temp dir on success:`, err);
      }), 60000);
    }
  }

  private runFfmpeg(command: string): Promise<void> {
    return new Promise((resolve, reject) => exec(`ffmpeg ${command}`, e => e ? reject(e) : resolve()));
  }

  private runFfmpegWithOutput(command: string): Promise<string> {
    return new Promise((resolve, reject) => exec(`ffmpeg ${command}`, (e, so, se) => e && !se ? reject(e) : resolve(se || so)));
  }

  public async start() {
    await this.client.login(this.config.discordToken);
  }

  public async stop() {
    this.logger.log('[Bot] Shutting down...');
    
    // 終了時にバッファを保存
    this.saveAllBuffers();
    
    this.logger.close();
    await this.client.destroy();
  }

  private async joinVoiceChannelByIds(guildId: string, channelId: string, userName?: string, userId?: string) {
    if (getVoiceConnection(guildId)) {
      console.log(`[Join] Already connected to guild ${guildId}, skipping join`);
      return;
    }
    
    console.log(`[Join] Attempting to join guild ${guildId}, channel ${channelId}`);
    
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isVoiceBased()) throw new Error('Channel not found or not voice-based.');

      const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.connections.set(guildId, connection);
      await this.saveSession(guildId, channelId);
      this.playGreeting(guildId, userName, userId);
      this.recordedChunks.set(guildId, []);
      
      console.log(`[Join] Successfully joined guild ${guildId}, channel ${channelId}, starting recording...`);
      this.startRecording(connection);
    } catch (error) {
      console.error(`[Join] Failed to join channel ${channelId}:`, error);
      await this.saveSession(guildId, null);
    }
  }

  private async leaveVoiceChannel(guildId: string, forget: boolean = false, userName?: string, userId?: string): Promise<boolean> {
    const connection = getVoiceConnection(guildId);
    if (!connection) return false;

    await this.playFarewell(guildId, userName, userId);
    this.stopRecording(guildId);
    
    const player = this.audioPlayers.get(guildId);
    if (player) {
      player.stop();
      this.audioPlayers.delete(guildId);
    }
    
    connection.destroy();
    this.connections.delete(guildId);
    if (forget) await this.saveSession(guildId, null);
    console.log(`Left voice channel in guild ${guildId}.`);
    return true;
  }

  private enqueueAudio(guildId: string, item: AudioQueueItem) {
    if (!this.audioQueues.has(guildId)) {
      this.audioQueues.set(guildId, []);
    }
    this.audioQueues.get(guildId)!.push(item);
    this.processQueue(guildId);
  }

  private async processQueue(guildId: string) {
    if (this.isPlaying.get(guildId)) return;
    const queue = this.audioQueues.get(guildId);
    if (!queue || queue.length === 0) return;

    this.isPlaying.set(guildId, true);
    const item = queue.shift()!;
    
    const connection = getVoiceConnection(guildId);
    if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
      this.isPlaying.set(guildId, false);
      this.audioQueues.set(guildId, []);
      return;
    }

    try {
      const speakerId = this.userSpeakers.get(item.userId ?? '') ?? this.currentSpeaker;
      const audioBuffer = await this.voicevox.generateAudio(item.text, speakerId);
      if (!audioBuffer) throw new Error('VOICEVOX failed to generate audio.');

      const tempDir = path.join('temp', 'tts');
      fs.mkdirSync(tempDir, { recursive: true });
      const tempFilePath = path.join(tempDir, `${uuidv4()}.wav`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      let finalAudioPath = tempFilePath;
      if (!this.config.rvcDisabled) {
        const userModel = (item.userId ? this.userRvcModels.get(item.userId) : undefined) || this.config.rvcDefaultModel;
        const rvcPath = await this.rvc.convertVoice(tempFilePath, userModel, this.rvcPitch);
        if (rvcPath) finalAudioPath = rvcPath;
      }
      
      const resource = createAudioResource(finalAudioPath);
      let player = this.audioPlayers.get(guildId);
      if (!player || player.state.status === AudioPlayerStatus.Idle) {
          player = createAudioPlayer({
            behaviors: {
              noSubscriber: NoSubscriberBehavior.Play, // サブスクライバーがいなくても再生
            },
          });
          this.audioPlayers.set(guildId, player);
          connection.subscribe(player);
      }

      const onIdle = () => {
        if (fs.existsSync(finalAudioPath)) fs.unlinkSync(finalAudioPath);
        if (finalAudioPath !== tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        item.onFinish?.();
        this.isPlaying.set(guildId, false);
        this.processQueue(guildId);
      };
      
      player.once(AudioPlayerStatus.Idle, onIdle);
      player.on('stateChange', (oldState: any, newState: any) => {
        this.logger.log(`[Stream] Player state for user ${item.userId}: ${oldState.status} -> ${newState.status}`);
      });

      // エラーハンドリングを復活（クラッシュ防止のため）
      player.on('error', (error: any) => {
        // 正常な動作で発生するエラーは完全に無視
        if ((error.message && error.message.includes('ERR_STREAM_PREMATURE_CLOSE')) ||
            (error.code && error.code === 'ERR_STREAM_PREMATURE_CLOSE') ||
            (error.message && error.message.includes('Premature close')) ||
            (error.message && error.message.includes('ERR_STREAM_PUSH_AFTER_EOF')) ||
            (error.code && error.code === 'ERR_STREAM_PUSH_AFTER_EOF') ||
            (error.message && error.message.includes('stream.push() after EOF'))) {
          // 完全に無視（ログにも記録しない）
          return;
        }
        this.logger.error(`[Stream] Audio player error for user ${item.userId}:`, error);
      });

      player.play(resource);

    } catch (error) {
      this.logger.error(`Error processing queue item:`, error);
      item.onFinish?.();
      this.isPlaying.set(guildId, false);
      this.processQueue(guildId);
    }
  }

  private playGreeting(guildId: string, userName?: string, userId?: string) {
    if (!userName) return; // Skip greeting if no username
    const text = `${userName}、こんちゃ！`;
    this.enqueueAudio(guildId, { text, userId });
  }

  private async playFarewell(guildId: string, userName?: string, userId?: string) {
    if (!userName) return Promise.resolve(); // Skip farewell if no username
    return new Promise<void>((resolve) => {
      const text = `${userName}、またね！`;
      this.enqueueAudio(guildId, { text, userId, onFinish: resolve });
    });
  }

  private async startAutoStreaming() {
    const sourceGuildId = '995627275074666568';
    const sourceChannelId = '1319432294762545162';
    const targetGuildId = '813783748566581249';
    const targetChannelId = '813783749153259606';

    this.logger.log('[AutoStream] Starting automatic audio streaming...');

    try {
      // ソースサーバーとチャンネルの存在確認
      const sourceGuild = await this.client.guilds.fetch(sourceGuildId);
      const sourceChannel = await sourceGuild.channels.fetch(sourceChannelId);
      if (!sourceChannel || !sourceChannel.isVoiceBased()) {
        this.logger.error('[AutoStream] Source voice channel not found');
        return;
      }

      // ターゲットサーバーとチャンネルの存在確認
      const targetGuild = await this.client.guilds.fetch(targetGuildId);
      const targetChannel = await targetGuild.channels.fetch(targetChannelId);
      if (!targetChannel || !targetChannel.isVoiceBased()) {
        this.logger.error('[AutoStream] Target voice channel not found');
        return;
      }

      // 既存の接続をチェック（通常の録音機能との競合を避ける）
      const existingSourceConnection = getVoiceConnection(sourceGuildId);
      const existingTargetConnection = getVoiceConnection(targetGuildId);

      if (existingSourceConnection) {
        this.logger.log('[AutoStream] Source channel already has a connection, using existing');
      } else {
        // ソースチャンネルに接続
        const sourceConnection = joinVoiceChannel({
          channelId: sourceChannelId,
          guildId: sourceGuildId,
          adapterCreator: sourceGuild.voiceAdapterCreator,
        });
        await entersState(sourceConnection, VoiceConnectionStatus.Ready, 30_000);
        this.logger.log('[AutoStream] Created new source connection');
      }

      if (existingTargetConnection) {
        this.logger.log('[AutoStream] Target channel already has a connection, using existing');
      } else {
        // ターゲットチャンネルに接続
        const targetConnection = joinVoiceChannel({
          channelId: targetChannelId,
          guildId: targetGuildId,
          adapterCreator: targetGuild.voiceAdapterCreator,
        });
        await entersState(targetConnection, VoiceConnectionStatus.Ready, 30_000);
        this.logger.log('[AutoStream] Created new target connection');
      }

      // 現在の接続を取得
      const sourceConnection = getVoiceConnection(sourceGuildId);
      const targetConnection = getVoiceConnection(targetGuildId);

      if (!sourceConnection || !targetConnection) {
        this.logger.error('[AutoStream] Failed to get connections');
        return;
      }

      this.logger.log('[AutoStream] Successfully connected to both channels');
      this.logger.log(`[AutoStream] Source connection state: ${sourceConnection.state.status}`);
      this.logger.log(`[AutoStream] Target connection state: ${targetConnection.state.status}`);

      // ソースチャンネルで録音を開始（文字起こしのため）
      this.logger.log('[AutoStream] Starting recording on source channel for transcription');
      this.startRecording(sourceConnection);
      this.logger.log('[AutoStream] Recording started successfully on source channel');

      // 音声ストリーミングを開始
      this.startAudioStreaming('auto', sourceConnection, targetConnection);

      this.logger.log('[AutoStream] Audio streaming started successfully');

      // 定期的に接続状態をチェック
      setInterval(() => {
        this.logger.log(`[AutoStream] Connection status check:`);
        this.logger.log(`  Source: ${sourceConnection.state.status}`);
        this.logger.log(`  Target: ${targetConnection.state.status}`);
        
        if (sourceConnection.state.status !== VoiceConnectionStatus.Ready) {
          this.logger.warn(`[AutoStream] Source connection not ready: ${sourceConnection.state.status}`);
          // 自動再接続を試行
          this.reconnectSourceChannel(sourceGuildId, sourceChannelId, sourceGuild);
        }
        if (targetConnection.state.status !== VoiceConnectionStatus.Ready) {
          this.logger.warn(`[AutoStream] Target connection not ready: ${targetConnection.state.status}`);
          // 自動再接続を試行
          this.reconnectTargetChannel(targetGuildId, targetChannelId, targetGuild);
        }
      }, 30000); // 30秒ごとにチェック

    } catch (error) {
      this.logger.error('[AutoStream] Error starting automatic streaming:', error);
    }
  }

  private async reconnectSourceChannel(guildId: string, channelId: string, guild: any) {
    try {
      this.logger.log(`[AutoStream] Attempting to reconnect to source channel ${channelId}`);
      const connection = joinVoiceChannel({
        channelId: channelId,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.logger.log(`[AutoStream] Successfully reconnected to source channel`);
      
      // 録音とストリーミングを再開
      this.startRecording(connection);
      this.startAudioStreaming('auto', connection, getVoiceConnection('813783748566581249'));
    } catch (error) {
      this.logger.error(`[AutoStream] Failed to reconnect to source channel:`, error);
    }
  }

  private async reconnectTargetChannel(guildId: string, channelId: string, guild: any) {
    try {
      this.logger.log(`[AutoStream] Attempting to reconnect to target channel ${channelId}`);
      const connection = joinVoiceChannel({
        channelId: channelId,
        guildId: guildId,
        adapterCreator: guild.voiceAdapterCreator,
      });
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      this.logger.log(`[AutoStream] Successfully reconnected to target channel`);
    } catch (error) {
      this.logger.error(`[AutoStream] Failed to reconnect to target channel:`, error);
    }
  }

  private startAudioStreaming(sessionKey: string, sourceConnection: any, targetConnection: any) {
    this.logger.log(`[Stream] Starting audio streaming for session: ${sessionKey}`);

    // 接続状態の監視
    sourceConnection.on('stateChange', (oldState: any, newState: any) => {
      this.logger.log(`[Stream] Source connection state changed: ${oldState.status} -> ${newState.status}`);
    });

    targetConnection.on('stateChange', (oldState: any, newState: any) => {
      this.logger.log(`[Stream] Target connection state changed: ${oldState.status} -> ${newState.status}`);
    });

    // エラーハンドリング
    sourceConnection.on('error', (error: any) => {
      this.logger.error(`[Stream] Source connection error:`, error);
    });

    targetConnection.on('error', (error: any) => {
      this.logger.error(`[Stream] Target connection error:`, error);
    });

    // ユーザーごとの最後の発話時間を追跡（音声横流し専用）
    const lastSpeakingTime: Map<string, number> = new Map();
    const SPEAKING_COOLDOWN = 500; // 1秒から0.5秒に短縮してレスポンスを向上

    // 音声バッファリング用
    const audioBuffers: Map<string, Buffer[]> = new Map();
    const BUFFER_FLUSH_INTERVAL = 100; // 100msごとにバッファをフラッシュ

    // 定期的にバッファをフラッシュ
    setInterval(() => {
      for (const [userId, buffers] of audioBuffers.entries()) {
        if (buffers.length > 0) {
          const player = this.streamPlayers.get(userId);
          if (player && player.state.status === AudioPlayerStatus.Playing) {
            // バッファが蓄積されている場合は、新しいストリームを作成
            this.logger.log(`[Stream] Flushing buffer for user ${userId} (${buffers.length} chunks)`);
          }
        }
      }
    }, BUFFER_FLUSH_INTERVAL);

    // ソースチャンネルの音声を受信
    sourceConnection.receiver.speaking.on('start', (userId: string) => {
      this.logger.log(`[Stream] User ${userId} started speaking in source channel`);

      // レート制限チェック
      const now = Date.now();
      const lastTime = lastSpeakingTime.get(userId) || 0;
      if (now - lastTime < SPEAKING_COOLDOWN) {
        this.logger.log(`[Stream] Rate limiting for user ${userId}, skipping`);
        return;
      }
      lastSpeakingTime.set(userId, now);

      try {
        // 他のプレイヤーが再生中であれば停止し、新しい話者に切り替える
        this.streamPlayers.forEach((player, pUserId) => {
          this.logger.log(`[Stream] New speaker detected. Stopping player for user ${pUserId}.`);
          player.stop();
          this.streamPlayers.delete(pUserId);
        });

        const audioStream = sourceConnection.receiver.subscribe(userId, {
          end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 3000, // 1.5秒から3秒に延長してより安定した録音
          },
        });

        // 音声ストリームのバッファリングを改善
        audioStream.setMaxListeners(0); // リスナー制限を解除

        this.logger.log(`[Stream] Audio stream created for user ${userId}`);

        // 音声をターゲットチャンネルに送信
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play, // サブスクライバーがいなくても再生
          },
        });
        
        // プレイヤーを管理に追加
        this.streamPlayers.set(userId, player);
        
        const resource = createAudioResource(audioStream, {
          inputType: StreamType.Opus,
          inlineVolume: true,
          silencePaddingFrames: 5, // 無音パディングを有効化して途切れを減らす
        });
        
        targetConnection.subscribe(player);
        player.play(resource);

        this.logger.log(`[Stream] Audio player started for user ${userId}`);

        player.on('stateChange', (oldState: any, newState: any) => {
          this.logger.log(`[Stream] Player state for user ${userId}: ${oldState.status} -> ${newState.status}`);
          
          // プレイヤーが終了したら管理から削除
          if (newState.status === AudioPlayerStatus.Idle) {
            this.streamPlayers.delete(userId);
            this.logger.log(`[Stream] Removed player from management for user ${userId}`);
          }
        });

        // エラーハンドリングを復活（クラッシュ防止のため）
        player.on('error', (error: any) => {
          // 正常な動作で発生するエラーは完全に無視
          if ((error.message && error.message.includes('ERR_STREAM_PREMATURE_CLOSE')) ||
              (error.code && error.code === 'ERR_STREAM_PREMATURE_CLOSE') ||
              (error.message && error.message.includes('Premature close')) ||
              (error.message && error.message.includes('ERR_STREAM_PUSH_AFTER_EOF')) ||
              (error.code && error.code === 'ERR_STREAM_PUSH_AFTER_EOF') ||
              (error.message && error.message.includes('stream.push() after EOF'))) {
            // 完全に無視（ログにも記録しない）
            return;
          }
          this.logger.error(`[Stream] Audio player error for user ${userId}:`, error);
          // エラーが発生したらプレイヤーを管理から削除
          this.streamPlayers.delete(userId);
        });

        audioStream.on('end', () => {
          this.logger.log(`[Stream] Audio stream ended for user ${userId}`);
        });

        // 音声ストリームのcloseイベントも監視
        audioStream.on('close', () => {
          this.logger.log(`[Stream] Audio stream closed for user ${userId}`);
        });

        // 音声ストリームのdestroyイベントも監視
        audioStream.on('destroy', () => {
          this.logger.log(`[Stream] Audio stream destroyed for user ${userId}`);
        });

        // 音声ストリームのエラーハンドリング（クラッシュ防止のため）
        audioStream.on('error', (error: any) => {
          // 正常な動作で発生するエラーは完全に無視
          if ((error.message && error.message.includes('ERR_STREAM_PREMATURE_CLOSE')) ||
              (error.code && error.code === 'ERR_STREAM_PREMATURE_CLOSE') ||
              (error.message && error.message.includes('Premature close')) ||
              (error.message && error.message.includes('ERR_STREAM_PUSH_AFTER_EOF')) ||
              (error.code && error.code === 'ERR_STREAM_PUSH_AFTER_EOF') ||
              (error.message && error.message.includes('stream.push() after EOF'))) {
            // 完全に無視（ログにも記録しない）
            return;
          }
          this.logger.error(`[Stream] Audio stream error for user ${userId}:`, error);
        });

      } catch (error: any) {
        // 正常な動作で発生するエラーは完全に無視
        if ((error.message && error.message.includes('ERR_STREAM_PREMATURE_CLOSE')) ||
            (error.code && error.code === 'ERR_STREAM_PREMATURE_CLOSE') ||
            (error.message && error.message.includes('Premature close')) ||
            (error.message && error.message.includes('ERR_STREAM_PUSH_AFTER_EOF')) ||
            (error.code && error.code === 'ERR_STREAM_PUSH_AFTER_EOF') ||
            (error.message && error.message.includes('stream.push() after EOF'))) {
          // 完全に無視（ログにも記録しない）
          return;
        }
        this.logger.error(`[Stream] Error creating audio stream for user ${userId}:`, error);
      }
    });

    // speaking終了イベントも監視
    sourceConnection.receiver.speaking.on('end', (userId: string) => {
      this.logger.log(`[Stream] User ${userId} stopped speaking in source channel`);
    });

    this.logger.log(`[Stream] Audio streaming setup completed for session: ${sessionKey}`);
  }
}

export default YomiageBot;