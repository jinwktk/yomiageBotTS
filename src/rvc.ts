// eslint-disable-next-line @typescript-eslint/no-deprecated
import { client as gradioClient } from "@gradio/client";
import type { Config } from "./config.js";
import { realpathSync } from 'fs';

export class RvcClient {
  private app: any;
  private host: string;
  private port: number;

  constructor(config: Config) {
    this.host = config.rvcHost;
    this.port = config.rvcPort;
  }

  private async connect() {
    if (this.app) return;
    try {
        const url = `http://${this.host}:${this.port}`;
        this.app = await gradioClient(url);
        console.log("Successfully connected to RVC Gradio app.");
    } catch (error) {
        console.error("Failed to connect to RVC Gradio app:", error);
    }
  }

  public async convertVoice(
    inputPath: string,
    modelName: string,
    pitch: number = 0
  ): Promise<string | null> {
    await this.connect();
    if (!this.app) return null;

    try {
      // Step 1: Ensure the model is loaded on the server side.
      // This call also retrieves the correct index file path from the server.
      await this.app.predict("/infer_change_voice", [
        `${modelName}.pth`,
        0.33,
        0.33
      ]);

      // Step 2: Perform the voice conversion.
      const absoluteInputPath = realpathSync(inputPath).replace(/\\/g, '/');
      const normalizedIndexPath = `logs/${modelName}.index`;

      const result = await this.app.predict("/infer_convert", [
        0,                      // 0: sid (speaker_id)
        absoluteInputPath,      // 1: input_audio_path (absolute path)
        pitch,                  // 2: f0_up_key (pitch)
        null,                   // 3: f0_file (null for no file)
        "rmvpe",                // 4: f0_method
        "",                     // 5: file_index (manual path, empty to use dropdown)
        normalizedIndexPath,    // 6: file_index2 (auto-detected dropdown path)
        0.75,                   // 7: index_rate
        3,                      // 8: filter_radius
        0,                      // 9: resample_sr
        0.25,                   // 10: rms_mix_rate
        0.33,                   // 11: protect
      ]);

      const responseData = result.data;

      if (responseData && Array.isArray(responseData) && responseData.length > 1) {
          const outputInfo = responseData[1];
          if (outputInfo && typeof outputInfo === 'object' && 'name' in outputInfo && typeof outputInfo.name === 'string') {
              console.log(`RVC voice generated successfully: ${outputInfo.name}`);
              return outputInfo.name;
          }
      }
      
      console.error('RVC conversion failed: Invalid response structure', result);
      return null;

    } catch (error) {
        console.error('An unexpected error occurred during RVC conversion:', error);
        return null;
    }
  }

  public getRvcUrl(): string {
    return `http://${this.host}:${this.port}`;
  }
}

export default RvcClient; 