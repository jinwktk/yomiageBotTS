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
} from '@discordjs/voice';
import type { Config } from './config.js';
import VoicevoxClient from './voicevox.js';
import RvcClient from './rvc.js';
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

class YomiageBot {
  private client: Client;
  private voicevox: VoicevoxClient;
  private rvc: RvcClient;
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
  private readonly maxRecordingBufferMinutes = 5;
  private audioQueues: Map<string, AudioQueueItem[]> = new Map();
  private isPlaying: Map<string, boolean> = new Map();

  constructor(config: Config) {
    this.config = config;
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
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.once('ready', () => {
      if (!this.client.user) {
        throw new Error("Client user is not available.");
      }
      console.log(`Ready! Logged in as ${this.client.user.tag}`);
      this.syncCommands();
      this.rejoinChannels();
    });
    this.client.on('voiceStateUpdate', this.handleVoiceStateUpdate.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('messageCreate', this.handleMessageCreate.bind(this));
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
        console.log(`[AutoJoin] User ${member?.user.tag} joined ${newState.channel!.name}. Bot disconnected, joining.`);
        await this.joinVoiceChannelByIds(guildId, newState.channelId, member?.displayName, member?.id);
      } catch (error) {
        console.error(`[AutoJoin] Failed to auto-join ${newState.channel!.name}:`, error);
      }
      return;
    }

    if (!connection || !botChannelId) return;

    const userJoinedBotChannel = newState.channelId === botChannelId && oldState.channelId !== botChannelId;
    if (userJoinedBotChannel) {
      console.log(`[Greeting] User ${member?.user.tag} joined bot's channel.`);
      this.playGreeting(guildId, member?.displayName, member?.id);
    }

    const userLeftBotChannel = oldState.channelId === botChannelId && newState.channelId !== botChannelId;
    if (userLeftBotChannel) {
      try {
        const channel = await this.client.channels.fetch(botChannelId);
        if (channel && channel.isVoiceBased() && channel.members.filter((m: GuildMember) => !m.user.bot).size === 0) {
          console.log(`[AutoLeave] Last user left. Channel is empty.`);
          await this.leaveVoiceChannel(guildId, false);
        } else if (channel && channel.isVoiceBased() && channel.members.filter((m: GuildMember) => !m.user.bot).size > 0) {
          // Only play farewell if there are still other users in the channel
          console.log(`[Farewell] User ${member?.user.tag} left bot's channel.`);
          await this.playFarewell(guildId, member?.displayName, member?.id);
        }
      } catch (error) {
        console.error('[LeaveLogic] Error handling user departure:', error);
      }
    }
  }

  private handleMessageCreate(message: Message) {
    if (message.author.bot || !message.guildId || !message.content) return;
    if (!getVoiceConnection(message.guildId)) return;

    this.enqueueAudio(message.guildId, {
      text: message.content.slice(0, this.config.maxTextLength),
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
    const durationMinutes = interaction.options.getNumber('duration') ?? 5;
    const durationSeconds = durationMinutes * 60;

    await interaction.deferReply({ ephemeral: true });

    let allChunks = this.recordedChunks.get(guildId);
    if (!allChunks || allChunks.length === 0) {
      await interaction.editReply('リプレイデータがありません。');
      return;
    }

    if (targetUser) {
      allChunks = allChunks.filter(chunkPath => path.basename(chunkPath).startsWith(targetUser.id));
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
        return timestamp >= cutoff;
      } catch {
        return false;
      }
    });

    if (relevantChunks.length === 0) {
      const userText = targetUser ? `${targetUser.tag}さんの` : '';
      await interaction.editReply(`${userText}${durationMinutes}分以内のリプレイデータがありません。`);
      return;
    }

    const tempDir = path.join('temp', 'replay', uuidv4());
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const wavFiles = await Promise.all(relevantChunks.map(async (chunkPath) => {
        const wavPath = path.join(tempDir, `${path.basename(chunkPath)}.wav`);
        await this.runFfmpeg(`-f s16le -ar 48k -ac 2 -i "${chunkPath}" "${wavPath}"`);
        return wavPath;
      }));

      const fileListPath = path.join(tempDir, 'filelist.txt');
      const fileListContent = wavFiles.map(f => `file '${path.basename(f)}'`).join('\n');
      fs.writeFileSync(fileListPath, fileListContent);

      // 3. Merge WAV files into a single WAV file
      const mergedPath = path.join(tempDir, 'merged.wav');
      await this.runFfmpeg(`-f concat -safe 0 -i "${fileListPath}" -c copy "${mergedPath}"`);
      
      // 4. Normalize the audio using loudnorm filter
      const normalizedPath = path.join(tempDir, 'replay.wav');
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
    ].map(cmd => cmd.toJSON());

    try {
      const rest = new REST({ version: '10' }).setToken(this.config.discordToken);
      await rest.put(Routes.applicationCommands(this.config.applicationId), { body: commands });
      console.log('✅ Synced slash commands.');
    } catch (error) {
      console.error('❌ Failed to sync slash commands:', error);
    }
  }

  private startRecording(connection: VoiceConnection) {
    const guildId = connection.joinConfig.guildId;
    console.log(`[Recording] Starting recording for guild ${guildId}`);
    this.recordedChunks.set(guildId, []);
    
    connection.receiver.speaking.on('start', (userId) => {
      if (this.recordingStates.has(userId)) return;

      const tempDir = path.join('temp', 'recordings', guildId);
      fs.mkdirSync(tempDir, { recursive: true });
      const chunkPath = path.join(tempDir, `${userId}-${Date.now()}.pcm`);

      const audioStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 100,
        },
      });

      const pcmStream = audioStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }));
      const writer = pcmStream.pipe(fs.createWriteStream(chunkPath));
      this.recordingStates.set(userId, writer);

      writer.on('finish', () => {
        const chunks = this.recordedChunks.get(guildId) || [];
        chunks.push(chunkPath);
        this.recordedChunks.set(guildId, chunks);
        this.recordingStates.delete(userId);
        this.cleanupOldChunks(guildId);
      });
    });
  }

  private stopRecording(guildId: string) {
    console.log(`[Recording] Stopping recording for guild ${guildId}`);
    // Stop any active writers associated with this guild
    for (const [userId, writer] of this.recordingStates.entries()) {
      // A bit of a hacky way to check guild membership without full member objects
      const chunkPath = writer.path.toString();
      if (chunkPath.includes(guildId)) {
        writer.end();
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

    const now = Date.now();
    const cutoff = now - this.maxRecordingBufferMinutes * 60 * 1000;

    const recentChunks = chunks.filter(chunkPath => {
      const timestamp = parseInt(path.basename(chunkPath).split('-')[1].replace('.pcm', ''));
      if (timestamp < cutoff) {
        fs.unlink(chunkPath, (err) => {
          if (err) console.error(`[Recording] Error deleting old chunk ${chunkPath}:`, err);
        });
        return false;
      }
      return true;
    });
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

  private async joinVoiceChannelByIds(guildId: string, channelId: string, userName?: string, userId?: string) {
    if (getVoiceConnection(guildId)) return;
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
      this.startRecording(connection);
    } catch (error) {
      console.error(`Failed to join channel ${channelId}:`, error);
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
          player = createAudioPlayer();
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
      player.once('error', (err) => {
          console.error(`Audio Player Error:`, err);
          player.off(AudioPlayerStatus.Idle, onIdle); // prevent double-calling onFinish
          onIdle();
      });

      player.play(resource);

    } catch (error) {
      console.error(`Error processing queue item:`, error);
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
}

export default YomiageBot;
