// eslint-disable-next-line @typescript-eslint/no-deprecated
// @ts-ignore
import { client as gradioClient } from "@gradio/client";
import type { Config } from "./config.ts";
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
      // Step 1: モデルを選択・読み込み（最新のAPI仕様に合わせて修正）
      const changeVoiceResult = await this.app.predict("/infer_change_voice", [
        `${modelName}.pth`,  // モデル名
        0,                   // 保護値1（0に変更）
        0                    // 保護値2（0に変更）
      ]);

      console.log('Model selection result:', changeVoiceResult);

      // Step 2: 音声変換実行
      const absoluteInputPath = realpathSync(inputPath).replace(/\\/g, '/');
      const normalizedIndexPath = `logs/${modelName}.index`;

      const result = await this.app.predict("/infer_convert", [
        0,                      // 0: sid (話者ID)
        absoluteInputPath,      // 1: input_audio_path 
        pitch,                  // 2: f0_up_key (ピッチ変更)
        null,                   // 3: f0_file (F0カーブファイル)
        "pm",                   // 4: f0_method (ピッチ抽出：pmに変更)
        "",                     // 5: file_index (手動パス)
        normalizedIndexPath,    // 6: file_index2 (自動検出パス)
        0.75,                   // 7: index_rate (検索特徴率)
        3,                      // 8: filter_radius (メディアンフィルタ)
        0,                      // 9: resample_sr (リサンプリング)
        0.25,                   // 10: rms_mix_rate (音量エンベロープ融合率)
        0.33,                   // 11: protect (保護値)
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