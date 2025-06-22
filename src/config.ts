import dotenv from 'dotenv';

const env = dotenv.config();

if (env.error) {
  console.warn('Could not find .env file, using default values.');
}

const loadedEnv = env.parsed || {};

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
  googleCloudKey: string;
  transcriptionChannelId: string;
  transcriptionEnabled: boolean;
}

export const createConfig = (): Config => {
  // .envの内容がprocess.envにロードされた後にこの関数を呼ぶ
  return {
    // 機密情報（.envから取得）
    discordToken: process.env.DISCORD_TOKEN || '',
    applicationId: process.env.APPLICATION_ID || '',
    googleCloudKey: process.env.GOOGLE_CLOUD_KEY || '',
    
    // RVC設定（デフォルト値）
    rvcHost: '127.0.0.1',
    rvcPort: 7865,
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
  };
};

export default createConfig; 