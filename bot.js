require('dotenv').config();
const { Client, GatewayIntentBits, Collection, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts = require('yt-search');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
});

const queue = new Map(); // 서버별 큐
const autoChannels = new Map(); // 서버별 자동 재생 채널

// 슬래시 명령어 등록
const commands = [
    new SlashCommandBuilder().setName('play').setDescription('노래 재생').addStringOption(opt => opt.setName('song').setDescription('노래 이름 또는 링크').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('노래 건너뛰기'),
    new SlashCommandBuilder().setName('stop').setDescription('재생 중지'),
    new SlashCommandBuilder().setName('queue').setDescription('큐 확인'),
    new SlashCommandBuilder().setName('setmusicchannel').setDescription('자동 재생 전용 채널 설정').addChannelOption(opt => opt.setName('채널').setDescription('자동 재생 채널').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('명령어 안내 보기'),
].map(cmd => cmd.toJSON());

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('슬래시 명령어 등록 중...');
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('슬래시 명령어 등록 완료!');
    } catch (err) {
        console.error(err);
    }
})();

// 메시지 자동 재생
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const autoChannelID = autoChannels.get(message.guild.id);
    if (message.channel.id === autoChannelID) {
        const songName = message.content;
        if (!songName) return;

        const result = await yts(songName);
        if (!result || !result.videos.length) return message.channel.send('노래를 찾을 수 없어요 😢');

        const song = { title: result.videos[0].title, url: result.videos[0].url };
        const serverQueue = queue.get(message.guild.id) || { songs: [] };
        serverQueue.songs.push(song);
        queue.set(message.guild.id, serverQueue);

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.channel.send('먼저 음성 채널에 들어와 주세요!');
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        const resource = createAudioResource(ytdl(song.url, { filter: 'audioonly' }));
        player.play(resource);
        connection.subscribe(player);

        message.channel.send(`🎵 재생 시작: **${song.title}**`);
    }
});

// 슬래시 명령어 처리
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const serverQueue = queue.get(interaction.guild.id) || { songs: [] };

    switch (interaction.commandName) {
        case 'play':
            {
                const songName = interaction.options.getString('song');
                const result = await yts(songName);
                if (!result || !result.videos.length) return interaction.reply('노래를 찾을 수 없어요 😢');
                const song = { title: result.videos[0].title, url: result.videos[0].url };
                serverQueue.songs.push(song);
                queue.set(interaction.guild.id, serverQueue);
                interaction.reply(`🎵 큐에 추가: **${song.title}**`);
            }
            break;
        case 'skip':
            interaction.reply('⏭ 다음 곡으로 넘어갑니다');
            break;
        case 'stop':
            serverQueue.songs = [];
            interaction.reply('⏹ 재생 중지');
            break;
        case 'queue':
            interaction.reply(serverQueue.songs.length ? serverQueue.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n') : '큐가 비었어요.');
            break;
        case 'setmusicchannel':
            {
                const channel = interaction.options.getChannel('채널');
                autoChannels.set(interaction.guild.id, channel.id);
                interaction.reply(`🎵 자동 재생 전용 채널: ${channel.name}`);
            }
            break;
        case 'help':
            interaction.reply(`
🎵 **뮤직봇 명령어 안내**
- /play [노래] : 노래 재생
- /skip : 다음 곡
- /stop : 재생 중지
- /queue : 현재 큐 확인
- /setmusicchannel [채널] : 자동 재생 전용 채널 설정
- /help : 명령어 안내
💡 자동 채널에서는 명령어 없이 노래 제목만 입력해도 재생됩니다!
`);
            break;
    }
});

client.login(process.env.TOKEN);