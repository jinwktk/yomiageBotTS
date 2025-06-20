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
}

export const createConfig = (): Config => {
  // .envの内容がprocess.envにロードされた後にこの関数を呼ぶ
  return {
    discordToken: process.env.DISCORD_TOKEN || '',
    applicationId: process.env.APPLICATION_ID || '',
    rvcHost: process.env.RVC_HOST || '127.0.0.1',
    rvcPort: parseInt(process.env.RVC_PORT || '7865'),
    rvcDefaultModel: process.env.RVC_DEFAULT_MODEL || 'omochiv2',
    rvcDisabled: process.env.RVC_DISABLED === 'true',
    rvcModelsPath: 'E:\\RVC1006Nvidia\\RVC1006Nvidia\\assets\\weights',
    voicevoxHost: process.env.VOICEVOX_HOST || '127.0.0.1',
    voicevoxPort: parseInt(process.env.VOICEVOX_PORT || '50021'),
    maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || '30'),
    recordingInterval: parseInt(process.env.RECORDING_INTERVAL || '300'),
    bufferExpiration: parseInt(process.env.BUFFER_EXPIRATION || '900'),
    serverHost: process.env.SERVER_HOST || 'localhost',
    serverPort: parseInt(process.env.SERVER_PORT || '8080'),
  };
};

export default createConfig; 