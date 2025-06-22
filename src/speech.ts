import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import FormData from 'form-data';
import axios from 'axios';

const execAsync = promisify(exec);

interface TranscriptionResult {
  text: string;
}

// URL for the local Whisper API server
const WHISPER_API_URL = 'http://127.0.0.1:5000/transcribe';

export class SpeechToText {
  constructor() {
    // No API key needed for local Whisper
    console.log('[SpeechToText] Initialized with local Whisper API');
  }

  private async convertToWav(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace('.pcm', '.wav');
    console.log(`[SpeechToText] Converting PCM to WAV: ${inputPath} -> ${outputPath}`);
    
    // Convert PCM s16le, 48kHz, stereo to a standard WAV file for Whisper
    const command = `ffmpeg -f s16le -ar 48000 -ac 2 -i "${inputPath}" "${outputPath}" -y`;
    try {
      await execAsync(command);
      console.log(`[SpeechToText] Successfully converted to WAV: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('[SpeechToText] FFmpeg conversion error:', error);
      throw error;
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

      // 3. Make the request to the local Whisper API server using axios
      console.log(`[SpeechToText] Sending request to Whisper API: ${WHISPER_API_URL}`);
      const response = await axios.post(WHISPER_API_URL, form, {
        headers: form.getHeaders(),
        timeout: 30000, // 30秒のタイムアウト
      });

      const result = response.data;
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