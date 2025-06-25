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
import type { Config } from './config.ts';
import VoicevoxClient from './voicevox.ts';
import RvcClient from './rvc.ts';
import SpeechToText from './speech.ts';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import prism from 'prism-media';
import { exec } from 'child_process';
import LogManager from './logger.ts';

interface Session {
  [guildId: string]: string; // channelId
}

interface AudioQueueItem {
  text: string;
  userId?: string;
  onFinish?: () => void;
}


interface StreamSession {
  sourceGuildId: string;
  sourceChannelId: string;
  targetGuildId: string;
  targetChannelId: string;
  isActive: boolean;
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
  private readonly maxRecordingBufferMinutes: number;
  private audioQueues: Map<string, AudioQueueItem[]> = new Map();
  private isPlaying: Map<string, boolean> = new Map();
  // 音声横流し用
  private streamSessions: Map<string, StreamSession> = new Map();
  private streamConnections: Map<string, any> = new Map();
  // 音声横流し用のプレイヤー管理
  private streamPlayers: Map<string, AudioPlayer> = new Map();
  // タイマー管理
  private timers: Map<string, NodeJS.Timeout> = new Map();
  // 音声横流し状態管理
  private isStreamingActive: Map<string, boolean> = new Map();
  // ログ管理
  private logger: LogManager;

  constructor(config: Config) {
    this.config = config;
    this.logger = new LogManager();
    this.maxRecordingBufferMinutes = config.audio.maxRecordingBufferMinutes;
    
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
      this.speechToText = new SpeechToText(config.audio);
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
      
      
      // 自動的に音声横流しを開始
      this.startAutoStreaming();
      
      // パフォーマンス監視を開始
      this.startPerformanceMonitoring();
      
      // 定期的な空チャンネルチェックを開始
      this.startEmptyChannelMonitoring();
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

    // プロセス終了時のクリーンアップ
    process.on('SIGINT', () => {
      this.logger.log('[Process] Received SIGINT, shutting down gracefully...');
      this.cleanupResources();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.logger.log('[Process] Received SIGTERM, shutting down gracefully...');
      this.cleanupResources();
      process.exit(0);
    });

    process.on('beforeExit', () => {
      this.logger.log('[Process] Before exit, performing cleanup...');
      this.cleanupResources();
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

    // 音声横流しセッションの自動切断チェック
    await this.checkStreamingChannelsForAutoDisconnect(oldState, newState);

    // ユーザーがチャンネルに参加した場合、音声横流しの再開をチェック
    if (newState.channelId && !oldState.channelId) {
      await this.checkAndStartAutoStreaming();
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
      const processingStartTime = Date.now();
      this.logger.log(`[Replay] Converting ${relevantChunks.length} chunks to WAV...`);
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
      const totalProcessingTime = Date.now() - processingStartTime;
      this.logger.log(`[Replay] Sending replay with ${relevantChunks.length} chunks (processing took ${totalProcessingTime}ms)`);
      await interaction.editReply({
        content: `過去${durationMinutes}分間の${userText}リプレイ（音量調整済み）です。`,
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
        
        if (channel && channel.isVoiceBased()) {
          const nonBotMembers = channel.members.filter((m: GuildMember) => !m.user.bot);
          this.logger.log(`[Rejoin] Checking ${channel.name}: ${nonBotMembers.size} non-bot members`);
          
          if (nonBotMembers.size > 0) {
            this.logger.log(`[Rejoin] Rejoining ${channel.name} (${nonBotMembers.size} users present)`);
            await this.joinVoiceChannelByIds(guildId, channel.id);
          } else {
            this.logger.log(`[Rejoin] Skipping rejoin for ${channel.name} (empty channel)`);
            // 空のチャンネルはセッションから削除
            await this.saveSession(guildId, null);
          }
        } else {
          this.logger.warn(`[Rejoin] Channel not found or not voice-based: ${session[guildId]}`);
          await this.saveSession(guildId, null);
        }
      } catch (error) {
        this.logger.error(`[Rejoin] Failed to rejoin for guild ${guildId}:`, error);
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
      new SlashCommandBuilder().setName('vspeaker').setDescription('読み上げの話者を変更します').addIntegerOption(o => o.setName('speaker').setDescription('話者を選択').setRequired(true).addChoices(...speakers)),
      new SlashCommandBuilder().setName('vreplay').setDescription('指定ユーザーの会話を再生').addUserOption(o => o.setName('user').setDescription('再生するユーザー（省略時は全員）').setRequired(false)).addIntegerOption(o => o.setName('duration').setDescription('再生時間(分、デフォルト5)').setRequired(false).setMinValue(1)),
      new SlashCommandBuilder().setName('vkyouiku').setDescription('辞書に単語を登録します。').addStringOption(o => o.setName('surface').setDescription('単語').setRequired(true)).addStringOption(o => o.setName('pronunciation').setDescription('読み(カタカナ)').setRequired(true)).addIntegerOption(o => o.setName('accent_type').setDescription('アクセント核位置').setRequired(true)),
      new SlashCommandBuilder().setName('vsetvoice').setDescription('あなたの声のモデルを変更します。').addStringOption(o => o.setName('model').setDescription('モデルを選択').setRequired(true).addChoices(...rvcModels)),
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

        let audioStream;
        try {
          audioStream = connection.receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.AfterSilence,
              duration: this.config.audio.silenceDuration,
            },
          });

          // 音声ストリームのバッファリングを改善
          audioStream.setMaxListeners(0); // リスナー制限を解除
        } catch (subscribeError: any) {
          this.logger.error(`[Recording] Failed to subscribe to user ${userId}:`, subscribeError);
          return;
        }

        let pcmStream;
        try {
          pcmStream = audioStream.pipe(new prism.opus.Decoder({ 
            rate: 48000, 
            channels: 2, 
            frameSize: 960
          }));
        } catch (decoderError: any) {
          this.logger.error(`[Recording] Failed to create decoder for user ${userId}:`, decoderError);
          if (audioStream) {
            audioStream.destroy();
          }
          return;
        }
        
        let writer;
        try {
          writer = pcmStream.pipe(fs.createWriteStream(chunkPath));
          this.recordingStates.set(userId, writer);
          this.logger.log(`[Recording] Recording stream setup completed for user ${userId}`);
        } catch (writerError: any) {
          this.logger.error(`[Recording] Failed to create writer for user ${userId}:`, writerError);
          if (audioStream) {
            audioStream.destroy();
          }
          if (pcmStream) {
            pcmStream.destroy();
          }
          return;
        }


        // ストリームエラーハンドリングを強化
        audioStream.on('error', (error) => {
          // 正常な動作やメモリ関連で発生するエラーは無視
          if ((error.message && (
              error.message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
              error.message.includes('Premature close') ||
              error.message.includes('memory access out of bounds') ||
              error.message.includes('RuntimeError')
            )) ||
              ((error as any).code && (
                (error as any).code === 'ERR_STREAM_PREMATURE_CLOSE' ||
                (error as any).code === 'ERR_STREAM_DESTROYED'
              ))) {
            this.logger.log(`[Recording] Normal stream termination for user ${userId} (${error.message})`);
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
          // PCMデコーダーのメモリエラーも寛容に処理
          if ((error.message && (
              error.message.includes('memory access out of bounds') ||
              error.message.includes('RuntimeError') ||
              error.message.includes('ERR_STREAM_PREMATURE_CLOSE')
            ))) {
            this.logger.log(`[Recording] Normal PCM processing termination for user ${userId} (${error.message})`);
            if (writer && !writer.destroyed) {
              writer.end();
            }
            return;
          }
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
          
          // ファイルサイズをチェック
          try {
            const stats = fs.statSync(chunkPath);
            if (stats.size < this.config.audio.minFileSize) {
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
  }

  private cleanupOldChunks(guildId: string) {
    const chunks = this.recordedChunks.get(guildId);
    if (!chunks) return;

    const startTime = Date.now();
    const now = Date.now();
    const cutoff = now - this.maxRecordingBufferMinutes * 60 * 1000;
    this.logger.log(`[Cleanup] Checking ${chunks.length} chunks for guild ${guildId}, cutoff time: ${cutoff}`);

    const recentChunks = chunks.filter(chunkPath => {
      try {
        const timestamp = parseInt(path.basename(chunkPath).split('-')[1].replace('.pcm', ''));
        if (timestamp < cutoff) {
          this.logger.log(`[Cleanup] Removing old chunk: ${path.basename(chunkPath)} (timestamp: ${timestamp})`);
          fs.unlink(chunkPath, (err) => {
            if (err) this.logger.error(`[Recording] Error deleting old chunk ${chunkPath}:`, err);
            else this.logger.log(`[Cleanup] Successfully deleted old chunk: ${path.basename(chunkPath)}`);
          });
          return false;
        }
        return true;
      } catch (error) {
        this.logger.error(`[Cleanup] Error parsing timestamp for ${chunkPath}:`, error);
        return false;
      }
    });
    
    if (recentChunks.length !== chunks.length) {
      const cleanupTime = Date.now() - startTime;
      this.logger.log(`[Cleanup] Removed ${chunks.length - recentChunks.length} old chunks, ${recentChunks.length} remaining (${cleanupTime}ms)`);
    }
    
    this.recordedChunks.set(guildId, recentChunks);
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
    const sessionKey = 'auto';

    this.logger.log('[AutoStream] Starting automatic audio streaming...');

    // 重複実行防止チェック
    if (this.isStreamingActive.get(sessionKey)) {
      this.logger.log('[AutoStream] Streaming is already active, aborting');
      return;
    }

    // ストリーミング状態を設定
    this.isStreamingActive.set(sessionKey, true);

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

      // 人数チェック：両方のチャンネルに人がいることを確認
      const sourceMembers = sourceChannel.members.filter((m: GuildMember) => !m.user.bot);
      const targetMembers = targetChannel.members.filter((m: GuildMember) => !m.user.bot);
      
      this.logger.log(`[AutoStream] Source channel (${sourceChannel.name}): ${sourceMembers.size} members`);
      this.logger.log(`[AutoStream] Target channel (${targetChannel.name}): ${targetMembers.size} members`);
      
      if (sourceMembers.size === 0 || targetMembers.size === 0) {
        this.logger.log('[AutoStream] Skipping auto-streaming: one or both channels are empty');
        this.logger.log('[AutoStream] Will retry when users join the channels');
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

      // 定期的に接続状態をチェック（タイマーID管理）
      const connectionCheckTimer = setInterval(() => {
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
      
      // タイマーIDを保存
      this.timers.set('autoStream_connectionCheck', connectionCheckTimer);

    } catch (error) {
      this.logger.error('[AutoStream] Error starting automatic streaming:', error);
      // エラー時はストリーミング状態をクリア
      this.isStreamingActive.set(sessionKey, false);
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
    const SPEAKING_COOLDOWN = this.config.audio.streamingSpeakingCooldown;

    // 音声バッファリング用
    const audioBuffers: Map<string, Buffer[]> = new Map();
    const BUFFER_FLUSH_INTERVAL = this.config.audio.streamingBufferFlushInterval;

    // 定期的にバッファをフラッシュ（タイマーID管理）
    const bufferFlushTimer = setInterval(() => {
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
    
    // タイマーIDを保存
    this.timers.set(`${sessionKey}_bufferFlush`, bufferFlushTimer);

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
        // 複数話者対応：新しい話者が開始した時、他のプレイヤーを停止せず共存させる
        // ただし、同一ユーザーの重複プレイヤーは停止
        const existingPlayer = this.streamPlayers.get(userId);
        if (existingPlayer) {
          this.logger.log(`[Stream] User ${userId} already has an active player, stopping it first.`);
          existingPlayer.stop();
          this.streamPlayers.delete(userId);
        }

        let audioStream;
        try {
          audioStream = sourceConnection.receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.AfterSilence,
              duration: this.config.audio.silenceDuration,
            },
          });

          // 音声ストリームのバッファリングを改善
          audioStream.setMaxListeners(0); // リスナー制限を解除
        } catch (subscribeError: any) {
          this.logger.error(`[Stream] Failed to subscribe to user ${userId}:`, subscribeError);
          return;
        }

        this.logger.log(`[Stream] Audio stream created for user ${userId}`);

        // 音声をターゲットチャンネルに送信
        const player = createAudioPlayer({
          behaviors: {
            noSubscriber: NoSubscriberBehavior.Play, // サブスクライバーがいなくても再生
          },
        });
        
        // プレイヤーを管理に追加
        this.streamPlayers.set(userId, player);
        
        let resource;
        try {
          resource = createAudioResource(audioStream, {
            inputType: StreamType.Opus,
            inlineVolume: true,
            silencePaddingFrames: 5, // 無音パディングを有効化して途切れを減らす
          });
        } catch (resourceError: any) {
          this.logger.error(`[Stream] Failed to create audio resource for user ${userId}:`, resourceError);
          // クリーンアップ
          if (audioStream) {
            audioStream.destroy();
          }
          this.streamPlayers.delete(userId);
          return;
        }
        
        try {
          targetConnection.subscribe(player);
        } catch (subscribeError: any) {
          this.logger.error(`[Stream] Failed to subscribe player for user ${userId}:`, subscribeError);
          // クリーンアップ
          if (audioStream) {
            audioStream.destroy();
          }
          if (resource) {
            resource.audioStream?.destroy();
          }
          this.streamPlayers.delete(userId);
          return;
        }
        
        try {
          player.play(resource);
          this.logger.log(`[Stream] Audio player started for user ${userId}`);
        } catch (playError: any) {
          this.logger.error(`[Stream] Failed to start player for user ${userId}:`, playError);
          // クリーンアップ
          if (audioStream) {
            audioStream.destroy();
          }
          if (resource) {
            resource.audioStream?.destroy();
          }
          this.streamPlayers.delete(userId);
          return;
        }

        player.on('stateChange', (oldState: any, newState: any) => {
          this.logger.log(`[Stream] Player state for user ${userId}: ${oldState.status} -> ${newState.status}`);
          
          // プレイヤーが終了したら管理から削除
          if (newState.status === AudioPlayerStatus.Idle) {
            this.streamPlayers.delete(userId);
            this.logger.log(`[Stream] Removed player from management for user ${userId}`);
          }
        });

        // エラーハンドリング改善：より寛容なエラー処理
        player.on('error', (error: any) => {
          // ストリーム関連のエラーは無視し、継続動作を優先
          if ((error.message && (
              error.message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
              error.message.includes('Premature close') ||
              error.message.includes('ERR_STREAM_PUSH_AFTER_EOF') ||
              error.message.includes('stream.push() after EOF') ||
              error.message.includes('ERR_STREAM_DESTROYED')
            )) || 
            (error.code && (
              error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
              error.code === 'ERR_STREAM_PUSH_AFTER_EOF' ||
              error.code === 'ERR_STREAM_DESTROYED'
            ))) {
            // 正常な終了処理として扱う
            this.logger.log(`[Stream] Normal stream termination for user ${userId}`);
            return;
          }
          // 重要なエラーのみログ出力
          this.logger.warn(`[Stream] Recoverable audio player error for user ${userId}: ${error.message}`);
          // エラーが発生してもプレイヤーは削除せず、自然な終了を待つ
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

        // 音声ストリームのエラーハンドリング改善
        audioStream.on('error', (error: any) => {
          // ストリーム関連のエラーは正常な終了として扱う
          if ((error.message && (
              error.message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
              error.message.includes('Premature close') ||
              error.message.includes('ERR_STREAM_PUSH_AFTER_EOF') ||
              error.message.includes('stream.push() after EOF') ||
              error.message.includes('ERR_STREAM_DESTROYED')
            )) || 
            (error.code && (
              error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
              error.code === 'ERR_STREAM_PUSH_AFTER_EOF' ||
              error.code === 'ERR_STREAM_DESTROYED'
            ))) {
            this.logger.log(`[Stream] Normal audio stream termination for user ${userId}`);
            return;
          }
          // 重要なエラーのみ警告として記録
          this.logger.warn(`[Stream] Audio stream issue for user ${userId}: ${error.message}`);
        });

      } catch (error: any) {
        // ストリーム作成エラーの寛容な処理
        if ((error.message && (
            error.message.includes('ERR_STREAM_PREMATURE_CLOSE') ||
            error.message.includes('Premature close') ||
            error.message.includes('ERR_STREAM_PUSH_AFTER_EOF') ||
            error.message.includes('stream.push() after EOF') ||
            error.message.includes('ERR_STREAM_DESTROYED')
          )) || 
          (error.code && (
            error.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
            error.code === 'ERR_STREAM_PUSH_AFTER_EOF' ||
            error.code === 'ERR_STREAM_DESTROYED'
          ))) {
          this.logger.log(`[Stream] Normal stream creation termination for user ${userId}`);
          return;
        }
        // 重要なエラーのみログ出力し、処理は継続
        this.logger.warn(`[Stream] Stream creation issue for user ${userId}: ${error.message}`);
      }
    });

    // speaking終了イベントも監視
    sourceConnection.receiver.speaking.on('end', (userId: string) => {
      this.logger.log(`[Stream] User ${userId} stopped speaking in source channel`);
    });

    this.logger.log(`[Stream] Audio streaming setup completed for session: ${sessionKey}`);
  }

  private startPerformanceMonitoring() {
    this.logger.log('[Performance] Starting performance monitoring...');
    
    // 既存のパフォーマンス監視タイマーをクリア
    const existingTimer = this.timers.get('performance_monitoring');
    if (existingTimer) {
      clearInterval(existingTimer);
      this.timers.delete('performance_monitoring');
    }
    
    // 5分ごとにパフォーマンス統計をログ出力
    const performanceTimer = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      
      // メモリ使用量を MB 単位で表示
      const stats = {
        uptime: Math.floor(uptime / 60), // 分単位
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        },
        connections: this.connections.size,
        recordingStates: this.recordingStates.size,
        streamPlayers: this.streamPlayers.size,
        timers: this.timers.size,
        recordedChunks: Array.from(this.recordedChunks.values()).reduce((sum, chunks) => sum + chunks.length, 0),
      };
      
      this.logger.log(`[Performance] Stats - Uptime: ${stats.uptime}min, Memory: ${stats.memory.heapUsed}/${stats.memory.heapTotal}MB, Connections: ${stats.connections}, Recording: ${stats.recordingStates}, Streaming: ${stats.streamPlayers}, Timers: ${stats.timers}, Chunks: ${stats.recordedChunks}`);
      
      // メモリ使用量が高い場合は警告
      if (stats.memory.heapUsed > 1024) { // 1GB以上
        this.logger.warn(`[Performance] High memory usage detected: ${stats.memory.heapUsed}MB`);
      }
      
      // タイマー数が多すぎる場合は警告
      if (stats.timers > 10) {
        this.logger.warn(`[Performance] High timer count detected: ${stats.timers}`);
      }
      
    }, 5 * 60 * 1000); // 5分間隔
    
    // タイマーIDを保存
    this.timers.set('performance_monitoring', performanceTimer);
  }

  private startEmptyChannelMonitoring() {
    this.logger.log('[EmptyMonitor] Starting empty channel monitoring...');
    
    // 既存の空チャンネル監視タイマーをクリア
    const existingTimer = this.timers.get('emptyChannel_monitoring');
    if (existingTimer) {
      clearInterval(existingTimer);
      this.timers.delete('emptyChannel_monitoring');
    }
    
    // 5分ごとに空チャンネルをチェック
    const emptyChannelTimer = setInterval(async () => {
      await this.checkEmptyChannelsAndLeave();
    }, 5 * 60 * 1000); // 5分間隔
    
    // タイマーIDを保存
    this.timers.set('emptyChannel_monitoring', emptyChannelTimer);
  }

  private async checkEmptyChannelsAndLeave() {
    try {
      this.logger.log('[EmptyMonitor] Checking for empty channels...');
      
      // 現在接続している全チャンネルをチェック
      for (const [guildId, connection] of this.connections.entries()) {
        try {
          const channelId = connection.joinConfig?.channelId;
          if (!channelId) continue;

          const channel = await this.client.channels.fetch(channelId);
          if (channel && channel.isVoiceBased()) {
            const nonBotMembers = channel.members.filter((m: GuildMember) => !m.user.bot);
            
            this.logger.log(`[EmptyMonitor] Channel ${channel.name} in guild ${guildId}: ${nonBotMembers.size} non-bot members`);
            
            if (nonBotMembers.size === 0) {
              this.logger.log(`[EmptyMonitor] Channel ${channel.name} is empty, leaving automatically`);
              await this.leaveVoiceChannel(guildId, true);
            }
          }
        } catch (error) {
          this.logger.error(`[EmptyMonitor] Error checking channel in guild ${guildId}:`, error);
        }
      }
      
      this.logger.log(`[EmptyMonitor] Check completed. Active connections: ${this.connections.size}`);
    } catch (error) {
      this.logger.error('[EmptyMonitor] Error in empty channel monitoring:', error);
    }
  }

  private async checkStreamingChannelsForAutoDisconnect(oldState: VoiceState, newState: VoiceState) {
    try {
      // 音声横流しが有効な場合のみチェック
      if (this.streamSessions.size === 0) return;

      // ユーザーがチャンネルを退出した場合のみ処理
      if (!oldState.channelId || newState.channelId) return;

      const leftChannelId = oldState.channelId;
      const leftGuildId = oldState.guild.id;

      // 退出したチャンネルが音声横流しのソースまたはターゲットチャンネルかチェック
      for (const [sessionId, session] of this.streamSessions.entries()) {
        let shouldDisconnect = false;
        let channelToCheck: string | null = null;
        let guildToCheck: string | null = null;
        let sessionType = '';

        // ソースチャンネルからの退出をチェック
        if (session.sourceChannelId === leftChannelId && session.sourceGuildId === leftGuildId) {
          channelToCheck = leftChannelId;
          guildToCheck = leftGuildId;
          sessionType = 'source';
        }
        // ターゲットチャンネルからの退出をチェック
        else if (session.targetChannelId === leftChannelId && session.targetGuildId === leftGuildId) {
          channelToCheck = leftChannelId;
          guildToCheck = leftGuildId;
          sessionType = 'target';
        }

        if (channelToCheck && guildToCheck) {
          try {
            const channel = await this.client.channels.fetch(channelToCheck);
            if (channel && channel.isVoiceBased()) {
              const nonBotMembers = channel.members.filter((m: GuildMember) => !m.user.bot);
              
              if (nonBotMembers.size === 0) {
                this.logger.log(`[StreamAutoDisconnect] ${sessionType} channel ${channel.name} is empty, stopping streaming session ${sessionId}`);
                shouldDisconnect = true;
              } else {
                this.logger.log(`[StreamAutoDisconnect] ${sessionType} channel ${channel.name} still has ${nonBotMembers.size} users, continuing session`);
              }
            }
          } catch (error) {
            this.logger.error(`[StreamAutoDisconnect] Error checking ${sessionType} channel ${channelToCheck}:`, error);
          }
        }

        // どちらかのチャンネルが空になった場合、音声横流しセッションを停止
        if (shouldDisconnect) {
          await this.stopStreamingSession(sessionId, `${sessionType} channel became empty`);
        }
      }
    } catch (error) {
      this.logger.error('[StreamAutoDisconnect] Error in auto-disconnect check:', error);
    }
  }

  private async stopStreamingSession(sessionId: string, reason: string) {
    try {
      const session = this.streamSessions.get(sessionId);
      if (!session) {
        this.logger.warn(`[StreamStop] Session ${sessionId} not found`);
        return;
      }

      this.logger.log(`[StreamStop] Stopping streaming session ${sessionId}: ${reason}`);

      // ソースとターゲットの接続を切断
      const sourceConnection = getVoiceConnection(session.sourceGuildId);
      const targetConnection = getVoiceConnection(session.targetGuildId);

      if (sourceConnection) {
        this.logger.log(`[StreamStop] Disconnecting from source channel (Guild: ${session.sourceGuildId})`);
        sourceConnection.destroy();
      }

      if (targetConnection) {
        this.logger.log(`[StreamStop] Disconnecting from target channel (Guild: ${session.targetGuildId})`);
        targetConnection.destroy();
      }

      // ストリーミングプレイヤーをクリーンアップ
      for (const [userId, player] of this.streamPlayers.entries()) {
        try {
          player.stop();
          this.streamPlayers.delete(userId);
          this.logger.log(`[StreamStop] Stopped streaming player for user ${userId}`);
        } catch (error) {
          this.logger.error(`[StreamStop] Error stopping player for user ${userId}:`, error);
        }
      }

      // 録音を停止
      this.stopRecording(session.sourceGuildId);
      this.stopRecording(session.targetGuildId);

      // セッションを削除
      this.streamSessions.delete(sessionId);
      
      this.logger.log(`[StreamStop] Successfully stopped streaming session ${sessionId}`);
    } catch (error) {
      this.logger.error(`[StreamStop] Error stopping streaming session ${sessionId}:`, error);
    }
  }

  private async stopAutoStreaming(reason: string = 'Manual stop') {
    try {
      this.logger.log(`[AutoStream] Stopping automatic streaming: ${reason}`);

      // 全てのタイマーを停止
      for (const [key, timer] of this.timers.entries()) {
        if (key.startsWith('autoStream') || key.startsWith('performance') || key.startsWith('emptyChannel')) {
          clearInterval(timer);
          this.timers.delete(key);
          this.logger.log(`[AutoStream] Cleared timer: ${key}`);
        }
      }

      // 音声横流し状態をクリア
      this.isStreamingActive.clear();

      // 全てのストリーミングセッションを停止
      const sessionIds = Array.from(this.streamSessions.keys());
      for (const sessionId of sessionIds) {
        await this.stopStreamingSession(sessionId, reason);
      }

      // 全てのストリーミングプレイヤーを停止
      for (const [userId, player] of this.streamPlayers.entries()) {
        try {
          player.stop();
          this.streamPlayers.delete(userId);
          this.logger.log(`[AutoStream] Stopped streaming player for user ${userId}`);
        } catch (error) {
          this.logger.error(`[AutoStream] Error stopping player for user ${userId}:`, error);
        }
      }

      // ストリーミング関連の接続をクリア
      this.streamConnections.clear();

      this.logger.log('[AutoStream] Successfully stopped all streaming activities');
    } catch (error) {
      this.logger.error('[AutoStream] Error stopping automatic streaming:', error);
    }
  }

  private cleanupResources() {
    try {
      this.logger.log('[Cleanup] Starting resource cleanup...');

      // 全てのタイマーをクリア
      for (const [key, timer] of this.timers.entries()) {
        clearInterval(timer);
        this.logger.log(`[Cleanup] Cleared timer: ${key}`);
      }
      this.timers.clear();

      // 全ての音声プレイヤーを停止
      for (const [guildId, player] of this.audioPlayers.entries()) {
        try {
          player.stop();
          this.logger.log(`[Cleanup] Stopped audio player for guild ${guildId}`);
        } catch (error) {
          this.logger.error(`[Cleanup] Error stopping audio player for guild ${guildId}:`, error);
        }
      }
      this.audioPlayers.clear();

      // 全てのストリーミングプレイヤーを停止
      for (const [userId, player] of this.streamPlayers.entries()) {
        try {
          player.stop();
          this.logger.log(`[Cleanup] Stopped streaming player for user ${userId}`);
        } catch (error) {
          this.logger.error(`[Cleanup] Error stopping streaming player for user ${userId}:`, error);
        }
      }
      this.streamPlayers.clear();

      // 録音状態をクリア
      for (const [guildId, writeStream] of this.recordingStates.entries()) {
        try {
          writeStream.end();
          this.logger.log(`[Cleanup] Ended recording stream for guild ${guildId}`);
        } catch (error) {
          this.logger.error(`[Cleanup] Error ending recording stream for guild ${guildId}:`, error);
        }
      }
      this.recordingStates.clear();

      // 状態管理マップをクリア
      this.isStreamingActive.clear();
      this.isPlaying.clear();
      this.recordedChunks.clear();
      this.audioQueues.clear();

      this.logger.log('[Cleanup] Resource cleanup completed');
    } catch (error) {
      this.logger.error('[Cleanup] Error during resource cleanup:', error);
    }
  }

  private async checkAndStartAutoStreaming() {
    try {
      const sourceGuildId = '995627275074666568';
      const sourceChannelId = '1319432294762545162';
      const targetGuildId = '813783748566581249';
      const targetChannelId = '813783749153259606';

      // 既に音声横流しが動作中の場合はスキップ
      if (this.streamSessions.size > 0) {
        this.logger.log('[AutoStreamCheck] Audio streaming already active, skipping');
        return;
      }

      // チャンネルの存在確認
      try {
        const sourceGuild = await this.client.guilds.fetch(sourceGuildId);
        const sourceChannel = await sourceGuild.channels.fetch(sourceChannelId);
        const targetGuild = await this.client.guilds.fetch(targetGuildId);
        const targetChannel = await targetGuild.channels.fetch(targetChannelId);

        if (!sourceChannel || !sourceChannel.isVoiceBased() || !targetChannel || !targetChannel.isVoiceBased()) {
          this.logger.warn('[AutoStreamCheck] Source or target channel not found or not voice-based');
          return;
        }

        // 人数チェック
        const sourceMembers = sourceChannel.members.filter((m: GuildMember) => !m.user.bot);
        const targetMembers = targetChannel.members.filter((m: GuildMember) => !m.user.bot);

        this.logger.log(`[AutoStreamCheck] Source channel (${sourceChannel.name}): ${sourceMembers.size} members`);
        this.logger.log(`[AutoStreamCheck] Target channel (${targetChannel.name}): ${targetMembers.size} members`);

        // 両方のチャンネルに人がいる場合のみ音声横流しを開始
        if (sourceMembers.size > 0 && targetMembers.size > 0) {
          this.logger.log('[AutoStreamCheck] Both channels have users, starting auto-streaming');
          await this.startAutoStreaming();
        } else {
          this.logger.log('[AutoStreamCheck] One or both channels are empty, not starting auto-streaming');
        }
      } catch (error) {
        this.logger.error('[AutoStreamCheck] Error checking channels:', error);
      }
    } catch (error) {
      this.logger.error('[AutoStreamCheck] Error in auto-streaming check:', error);
    }
  }
}

export default YomiageBot;