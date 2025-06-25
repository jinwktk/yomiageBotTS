import dotenv from 'dotenv';

const env = dotenv.config();

if (env.error) {
  console.warn('Could not find .env file, using default values.');
}

const loadedEnv = env.parsed || {};

export interface GitHubMonitorConfig {
  enabled: boolean;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  checkIntervalMs: number;
  apiTimeout: number;
}

export interface Config {
  discordToken: string;
  applicationId: string;
  rvcHost: string;
  rvcPort: number;
  rvcDefaultModel: string;
  rvcDisabled: boolean;
  rvcModelsPath: string;
  voicevoxHost: string;
  voicevoxPort: number;
  maxTextLength: number;
  recordingInterval: number;
  bufferExpiration: number;
  serverHost: string;
  serverPort: number;
  transcriptionChannelId: string;
  transcriptionEnabled: boolean;
  githubMonitor: GitHubMonitorConfig;
  // 音質・精度関連の新設定
  audio: AudioConfig;
}

export interface AudioConfig {
  // 録音・リプレイ関連
  maxRecordingBufferMinutes: number;
  minFileSize: number;
  silenceDuration: number;
  
  // 文字起こし関連
  transcriptionTimeout: number;
  transcriptionRetries: number;
  audioEnhancementEnabled: boolean;
  
  // 音声横流し関連
  streamingSpeakingCooldown: number;
  streamingBufferFlushInterval: number;
}

export const createConfig = (): Config => {
  // .envの内容がprocess.envにロードされた後にこの関数を呼ぶ
  return {
    // 機密情報（.envから取得）
    discordToken: process.env.DISCORD_TOKEN || '',
    applicationId: process.env.APPLICATION_ID || '',
    
    // RVC設定（デフォルト値）
    rvcHost: '127.0.0.1',
    rvcPort: 7897,
    rvcDefaultModel: 'omochiv2',
    rvcDisabled: false,
    rvcModelsPath: 'E:\\RVC1006Nvidia\\RVC1006Nvidia\\assets\\weights',
    
    // VOICEVOX設定（デフォルト値）
    voicevoxHost: '127.0.0.1',
    voicevoxPort: 50021,
    
    // テキスト・録音・バッファ設定（デフォルト値）
    maxTextLength: 30,
    recordingInterval: 300,
    bufferExpiration: 900,
    
    // サーバー設定（デフォルト値）
    serverHost: 'localhost',
    serverPort: 8080,
    
    // 文字起こし設定（デフォルト値）
    transcriptionChannelId: '1385376893997678602',
    transcriptionEnabled: true,
    
    // GitHub監視設定
    githubMonitor: {
      enabled: process.env.GITHUB_MONITOR_ENABLED !== 'false',
      repositoryOwner: process.env.GITHUB_REPO_OWNER || 'jinwktk',
      repositoryName: process.env.GITHUB_REPO_NAME || 'yomiageBotTS',
      branch: process.env.GITHUB_BRANCH || 'main',
      checkIntervalMs: parseInt(process.env.GITHUB_CHECK_INTERVAL_MS || '30000'),
      apiTimeout: parseInt(process.env.GITHUB_API_TIMEOUT_MS || '10000'),
    },
    
    // 音質・精度関連設定
    audio: {
      // 録音・リプレイ関連
      maxRecordingBufferMinutes: parseInt(process.env.AUDIO_MAX_RECORDING_BUFFER_MINUTES || '5'),
      minFileSize: parseInt(process.env.AUDIO_MIN_FILE_SIZE || '512'),
      silenceDuration: parseInt(process.env.AUDIO_SILENCE_DURATION || '800'),
      
      // 文字起こし関連
      transcriptionTimeout: parseInt(process.env.AUDIO_TRANSCRIPTION_TIMEOUT || '15000'),
      transcriptionRetries: parseInt(process.env.AUDIO_TRANSCRIPTION_RETRIES || '2'),
      audioEnhancementEnabled: process.env.AUDIO_ENHANCEMENT_ENABLED !== 'false',
      
      // 音声横流し関連
      streamingSpeakingCooldown: parseInt(process.env.AUDIO_STREAMING_SPEAKING_COOLDOWN || '200'),
      streamingBufferFlushInterval: parseInt(process.env.AUDIO_STREAMING_BUFFER_FLUSH_INTERVAL || '100'),
    },
  };
};

export default createConfig; 