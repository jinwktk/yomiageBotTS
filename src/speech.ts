import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import FormData from 'form-data';
import axios from 'axios';
import type { AudioConfig } from './config.js';

const execAsync = promisify(exec);

interface TranscriptionResult {
  text: string;
}

// URL for the local Whisper API server
const WHISPER_API_URL = 'http://127.0.0.1:5000/transcribe';

export class SpeechToText {
  private readonly audioConfig: AudioConfig;

  constructor(audioConfig: AudioConfig) {
    this.audioConfig = audioConfig;
    console.log('[SpeechToText] Initialized with local Whisper API');
  }

  private async convertToWav(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace('.pcm', '.wav');
    console.log(`[SpeechToText] Converting PCM to WAV with audio enhancement: ${inputPath} -> ${outputPath}`);
    
    // Enhanced PCM to WAV conversion with configurable audio enhancement
    if (this.audioConfig.audioEnhancementEnabled) {
      // Enhanced conversion with noise reduction and normalization
      // 1. ノイズリダクション: highpass filter (100Hz以下をカット)
      // 2. 音量正規化: 一定の音量レベルに調整
      // 3. 音声強調: 人声帯域の強調
      const command = `ffmpeg -f s16le -ar 48000 -ac 2 -i "${inputPath}" -af "highpass=f=100,loudnorm=I=-16:TP=-1.5:LRA=11,equalizer=f=3000:width_type=h:width=2000:g=3" -ar 16000 -ac 1 "${outputPath}" -y`;
      try {
        await execAsync(command);
        console.log(`[SpeechToText] Successfully converted to enhanced WAV: ${outputPath}`);
        return outputPath;
      } catch (error) {
        console.error('[SpeechToText] FFmpeg enhanced conversion error:', error);
        // フォールバック: 基本的な変換を試行
      }
    }
    
    // 基本的な変換（デフォルトまたはフォールバック）
    const fallbackCommand = `ffmpeg -f s16le -ar 48000 -ac 2 -i "${inputPath}" -ar 16000 -ac 1 "${outputPath}" -y`;
    try {
      await execAsync(fallbackCommand);
      console.log(`[SpeechToText] Basic conversion successful: ${outputPath}`);
      return outputPath;
    } catch (fallbackError) {
      console.error('[SpeechToText] Basic conversion also failed:', fallbackError);
      throw fallbackError;
    }
  }

  async transcribeAudio(pcmPath: string): Promise<TranscriptionResult | null> {
    let convertedWavPath = '';
    try {
      console.log(`[SpeechToText] Starting transcription for: ${pcmPath}`);
      
      // 1. Convert PCM to WAV because Whisper works best with standard audio formats
      convertedWavPath = await this.convertToWav(pcmPath);
      
      // 2. Prepare the file to be sent to the API
      const form = new FormData();
      form.append('file', fs.createReadStream(convertedWavPath));
      console.log(`[SpeechToText] Prepared form data with WAV file: ${convertedWavPath}`);

      // 3. Make the request to the local Whisper API server using axios with configurable retry
      console.log(`[SpeechToText] Sending request to Whisper API: ${WHISPER_API_URL}`);
      let response;
      let retryCount = 0;
      const maxRetries = this.audioConfig.transcriptionRetries;
      
      while (retryCount <= maxRetries) {
        try {
          response = await axios.post(WHISPER_API_URL, form, {
            headers: form.getHeaders(),
            timeout: this.audioConfig.transcriptionTimeout,
          });
          break; // 成功したらループを抜ける
        } catch (retryError: any) {
          retryCount++;
          console.log(`[SpeechToText] Attempt ${retryCount} failed, retrying...`);
          if (retryCount > maxRetries) {
            throw retryError; // 最大リトライ回数に達したら例外を投げる
          }
          // 1秒待ってからリトライ
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const result = response?.data;
      console.log(`[SpeechToText] Received response from Whisper API:`, result);

      if (result && result.text) {
        console.log(`[SpeechToText] Transcription successful: "${result.text}"`);
        return {
          text: result.text,
        };
      }

      console.log(`[SpeechToText] No text in response from Whisper API`);
      return null; // No text in response
    } catch (error: any) {
      // Axiosエラーの詳細なロギング
      if (axios.isAxiosError(error)) {
        console.error('[SpeechToText] Transcription process error (Axios):', {
          message: error.message,
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          statusText: error.response?.statusText,
          response: error.response?.data,
        });
      } else {
        console.error('[SpeechToText] Transcription process error (Whisper):', error);
      }
      return null;
    } finally {
      // 4. Clean up the temporary WAV file
      if (convertedWavPath && fs.existsSync(convertedWavPath)) {
        try {
          fs.unlinkSync(convertedWavPath);
          console.log(`[SpeechToText] Cleaned up temporary WAV file: ${convertedWavPath}`);
        } catch (cleanupError) {
          console.error(`[SpeechToText] Error cleaning up WAV file ${convertedWavPath}:`, cleanupError);
        }
      }
    }
  }
}

export default SpeechToText; 