// bot.js
const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();
const queue = new Map();
const playlistFile = 'playlists.json';
if (!fs.existsSync(playlistFile)) fs.writeFileSync(playlistFile, '{}');

// 슬래시 명령어 정의
const commands = [
    new SlashCommandBuilder().setName('help').setDescription('도움말 보기'),
    new SlashCommandBuilder().setName('play').setDescription('노래 재생').addStringOption(option => option.setName('query').setDescription('곡 제목 또는 링크').setRequired(true)),
    new SlashCommandBuilder().setName('p').setDescription('play 단축').addStringOption(option => option.setName('query').setDescription('곡 제목 또는 링크').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('일시정지'),
    new SlashCommandBuilder().setName('resume').setDescription('재생'),
    new SlashCommandBuilder().setName('skip').setDescription('다음 곡'),
    new SlashCommandBuilder().setName('stop').setDescription('재생 종료'),
    new SlashCommandBuilder().setName('queue').setDescription('큐 확인'),
    new SlashCommandBuilder().setName('shuffle').setDescription('큐 섞기'),
    new SlashCommandBuilder().setName('clear').setDescription('큐 삭제'),
    new SlashCommandBuilder().setName('loop').setDescription('반복 설정').addStringOption(option => option.setName('mode').setDescription('off / single / all').setRequired(true)),
    new SlashCommandBuilder().setName('playlist').setDescription('플레이리스트 관리')
        .addStringOption(option => option.setName('action').setDescription('save/load/list/delete/add/remove').setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('플레이리스트 이름').setRequired(false))
        .addStringOption(option => option.setName('song').setDescription('곡 이름 또는 링크').setRequired(false))
].map(cmd => cmd.toJSON());

// 슬래시 명령어 등록
const rest = new REST({ version: '10' }).setToken('MTMyMDc5OTg4OTg5NDAxNTAzOQ.GWyYZk.rvdpl_u2D26-HHLKCp_6ZGQoOX-akp4wBg3R4c');
(async () => {
    try {
        console.log('슬래시 명령어 등록 중...');
        await rest.put(Routes.applicationCommands('1320799889894015039'), { body: commands });
        console.log('슬래시 명령어 등록 완료!');
    } catch (error) {
        console.error(error);
    }
})();

client.on('error', console.error);

client.on('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;
    let serverQueue = queue.get(interaction.guild.id);
    if (!serverQueue) {
        serverQueue = { songs: [], player: createAudioPlayer(), connection: null, loop: 'off' };
        queue.set(interaction.guild.id, serverQueue);
    }

    const playSong = async (query) => {
        try {
            let songInfo;
            if (ytdl.validateURL(query)) {
                songInfo = { title: 'YouTube Link', url: query };
            } else {
                const r = await ytSearch(query);
                if (!r.videos.length) return interaction.reply('검색 결과가 없습니다.');
                songInfo = { title: r.videos[0].title, url: r.videos[0].url };
            }
            serverQueue.songs.push(songInfo);

            if (!serverQueue.connection) {
                const channel = interaction.member.voice.channel;
                if (!channel) return interaction.reply('먼저 음성채널에 들어가야 합니다.');
                const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator });
                serverQueue.connection = connection;
                playNext(interaction.guild.id, interaction);
            } else {
                interaction.reply(`큐에 추가됨: **${songInfo.title}**`);
            }
        } catch (err) {
            console.error(err);
            interaction.reply('곡 재생 중 오류가 발생했습니다.');
        }
    };

    const playNext = (guildId, interaction) => {
        const queueData = queue.get(guildId);
        if (!queueData || !queueData.songs.length) {
            if (queueData.connection) queueData.connection.destroy();
            queue.delete(guildId);
            return;
        }

        const currentSong = queueData.songs[0];
        let stream;
        try {
            stream = ytdl(currentSong.url, { filter: 'audioonly' });
        } catch {
            interaction.reply(`URL 오류: ${currentSong.url}`);
            queueData.songs.shift();
            return playNext(guildId, interaction);
        }

        const resource = createAudioResource(stream);
        queueData.player.play(resource);
        queueData.connection.subscribe(queueData.player);

        queueData.player.once(AudioPlayerStatus.Idle, () => {
            if (queueData.loop === 'single') return playNext(guildId, interaction);
            if (queueData.loop === 'all') queueData.songs.push(queueData.songs.shift());
            else queueData.songs.shift();
            playNext(guildId, interaction);
        });

        interaction.reply(`재생 시작: **${currentSong.title}**`);
    };

    try {
        switch (commandName) {
            case 'play':
            case 'p':
                await playSong(options.getString('query'));
                break;
            case 'pause':
                serverQueue.player.pause();
                interaction.reply('일시정지 완료');
                break;
            case 'resume':
                serverQueue.player.unpause();
                interaction.reply('재생 재개');
                break;
            case 'skip':
                serverQueue.player.stop();
                interaction.reply('다음 곡으로 넘어갑니다');
                break;
            case 'stop':
                serverQueue.songs = [];
                serverQueue.player.stop();
                if (serverQueue.connection) serverQueue.connection.destroy();
                queue.delete(interaction.guild.id);
                interaction.reply('재생 종료');
                break;
            case 'queue':
                interaction.reply(serverQueue.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n') || '큐가 비어 있습니다');
                break;
            case 'shuffle':
                for (let i = serverQueue.songs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [serverQueue.songs[i], serverQueue.songs[j]] = [serverQueue.songs[j], serverQueue.songs[i]];
                }
                interaction.reply('큐 섞기 완료');
                break;
            case 'clear':
                serverQueue.songs = [];
                interaction.reply('큐 초기화 완료');
                break;
            case 'loop':
                const mode = options.getString('mode');
                if (['off', 'single', 'all'].includes(mode)) {
                    serverQueue.loop = mode;
                    interaction.reply(`반복 모드: **${mode}**`);
                } else interaction.reply('잘못된 모드입니다: off / single / all');
                break;
            case 'help':
                interaction.reply('뮤직봇 명령어:\n/play <곡>\n/p <곡>\n/pause\n/resume\n/skip\n/stop\n/queue\n/shuffle\n/clear\n/loop <off/single/all>\n/playlist <save/load/list/delete/add/remove>');
                break;
            case 'playlist':
                const action = options.getString('action');
                const name = options.getString('name');
                const song = options.getString('song');
                const playlists = JSON.parse(fs.readFileSync(playlistFile));
                switch (action) {
                    case 'save':
                        if (!name) return interaction.reply('플레이리스트 이름 필요');
                        playlists[name] = serverQueue.songs;
                        fs.writeFileSync(playlistFile, JSON.stringify(playlists));
                        interaction.reply(`플레이리스트 저장됨: **${name}**`);
                        break;
                    case 'load':
                        if (!name || !playlists[name]) return interaction.reply('해당 플레이리스트 없음');
                        serverQueue.songs = [...playlists[name]];
                        interaction.reply(`플레이리스트 불러오기 완료: **${name}**`);
                        break;
                    case 'list':
                        interaction.reply(Object.keys(playlists).join('\n') || '저장된 플레이리스트 없음');
                        break;
                    case 'delete':
                        if (!name || !playlists[name]) return interaction.reply('해당 플레이리스트 없음');
                        delete playlists[name];
                        fs.writeFileSync(playlistFile, JSON.stringify(playlists));
                        interaction.reply(`플레이리스트 삭제됨: **${name}**`);
                        break;
                    case 'add':
                        if (!name || !song) return interaction.reply('플레이리스트 이름과 곡 필요');
                        if (!playlists[name]) playlists[name] = [];
                        playlists[name].push({ title: song, url: song });
                        fs.writeFileSync(playlistFile, JSON.stringify(playlists));
                        interaction.reply(`곡 추가 완료: **${song}** → **${name}**`);
                        break;
                    case 'remove':
                        if (!name || !song || !playlists[name]) return interaction.reply('해당 플레이리스트 또는 곡 없음');
                        playlists[name] = playlists[name].filter(s => s.title !== song);
                        fs.writeFileSync(playlistFile, JSON.stringify(playlists));
                        interaction.reply(`곡 삭제 완료: **${song}** → **${name}**`);
                        break;
                    default:
                        interaction.reply('잘못된 playlist 명령어');
                }
                break;
        }
    } catch (err) {
        console.error(err);
        interaction.reply('명령어 실행 중 오류가 발생했습니다.');
    }
});

client.login('MTMyMDc5OTg4OTg5NDAxNTAzOQ.GWyYZk.rvdpl_u2D26-HHLKCp_6ZGQoOX-akp4wBg3R4c');