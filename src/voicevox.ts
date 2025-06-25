import type { AxiosInstance } from 'axios';
import axios from 'axios';
import type { Config } from './config';

export interface Speaker {
    name: string;
    id: number;
}

export class VoicevoxClient {
  private host: string;
  private port: number;
  private client: AxiosInstance;

  constructor(config: Config) {
    this.host = config.voicevoxHost;
    this.port = config.voicevoxPort;
    this.client = axios.create({
      baseURL: `http://${this.host}:${this.port}`,
    });
  }

  public async getSpeakers(): Promise<Speaker[]> {
    try {
      const response = await this.client.get('/speakers');
      const speakers: Speaker[] = response.data.map((speaker: any) => {
        return speaker.styles.map((style: any) => ({
          name: `${speaker.name}(${style.name})`,
          id: style.id
        }));
      }).flat();
      return speakers;
    } catch (error) {
      console.error('Failed to get speakers from VOICEVOX:', error);
      return [];
    }
  }

  public async generateAudio(text: string, speakerId: number = 1): Promise<Buffer | null> {
    try {
      const audioQuery = await this.client.post('/audio_query', null, {
        params: {
          speaker: speakerId,
          text: text,
        }
      });

      const synthesisResponse = await this.client.post('/synthesis', audioQuery.data, {
        params: {
          speaker: speakerId,
        },
        headers: { 'Content-Type': 'application/json' },
        responseType: 'arraybuffer'
      });

      return Buffer.from(synthesisResponse.data);
    } catch (error) {
      console.error('Failed to generate audio from VOICEVOX:', error);
      return null;
    }
  }

  public async addUserDictWord(
    surface: string,
    pronunciation: string,
    accentType: number
  ): Promise<boolean> {
    try {
      await this.client.post('/user_dict_word', null, {
        params: {
          surface,
          pronunciation,
          accent_type: accentType,
        }
      });
      console.log(`Successfully added word to VOICEVOX dictionary: ${surface}`);
      return true;
    } catch (error) {
      console.error(`Failed to add word to VOICEVOX dictionary: ${surface}`, error);
      return false;
    }
  }
}

export default VoicevoxClient; 