require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildVoiceStates
    ] 
});

client.commands = new Collection();
const prefix = '!';

let queue = new Map();
const autoplayChannels = new Set(); // 제목만 쳐도 재생되는 채널 ID

// ------------------- HELP -------------------
client.commands.set('help', {
    execute: (message) => {
        message.channel.send(`
**뮤직봇 명령어**
!play [제목/URL] 또는 !p [제목/URL] - 노래 재생
!skip - 다음 곡으로
!stop - 재생 중지
!queue - 큐 확인
!loop - 반복 켜기/끄기
!playlist save [이름] - 플레이리스트 저장
!playlist load [이름] - 플레이리스트 불러오기
**특정 채널에서는 제목만 입력해도 자동 재생**
        `);
    }
});

// ------------------- 메시지 이벤트 -------------------
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const serverQueue = queue.get(message.guild.id);

    // 자동재생 채널
    if (autoplayChannels.has(message.channel.id)) {
        execute(message, serverQueue, message.content);
        return;
    }

    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'play' || command === 'p') {
        execute(message, serverQueue, args.join(' '));
    } else if (command === 'skip') {
        skip(message, serverQueue);
    } else if (command === 'stop') {
        stop(message, serverQueue);
    } else if (command === 'queue') {
        showQueue(message, serverQueue);
    } else if (command === 'loop') {
        toggleLoop(message, serverQueue);
    } else if (command === 'playlist') {
        managePlaylist(message, args);
    } else if (command === 'help') {
        client.commands.get('help').execute(message);
    }
});

// ------------------- 재생 함수 -------------------
async function execute(message, serverQueue, songName) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.channel.send('먼저 음성채널에 들어가야 합니다!');

    const songInfo = await ytSearch(songName).then(r => r.videos[0]);
    if (!songInfo) return message.channel.send('노래를 찾을 수 없습니다.');

    const song = {
        title: songInfo.title,
        url: songInfo.url
    };

    if (!serverQueue) {
        const queueContruct = {
            voiceChannel,
            textChannel: message.channel,
            connection: null,
            songs: [],
            player: createAudioPlayer(),
            loop: false
        };
        queue.set(message.guild.id, queueContruct);
        queueContruct.songs.push(song);

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });
            queueContruct.connection = connection;

            playSong(message.guild, queueContruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id);
            return message.channel.send('채널 접속 중 오류가 발생했습니다.');
        }
    } else {
        serverQueue.songs.push(song);
        return message.channel.send(`${song.title} 큐에 추가됨!`);
    }
}

function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        serverQueue.connection.destroy();
        queue.delete(guild.id);
        return;
    }

    const stream = ytdl(song.url, { filter: 'audioonly' });
    const resource = createAudioResource(stream);

    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        if (serverQueue.loop) {
            playSong(guild, serverQueue.songs[0]);
        } else {
            serverQueue.songs.shift();
            playSong(guild, serverQueue.songs[0]);
        }
    });

    serverQueue.textChannel.send(`🎶 지금 재생: **${song.title}**`);
}

// ------------------- 큐 & 제어 -------------------
function skip(message, serverQueue) {
    if (!serverQueue) return message.channel.send('재생 중인 노래가 없습니다.');
    serverQueue.player.stop();
    message.channel.send('⏭ 다음 곡으로 넘어갑니다.');
}

function stop(message, serverQueue) {
    if (!serverQueue) return message.channel.send('재생 중인 노래가 없습니다.');
    serverQueue.songs = [];
    serverQueue.player.stop();
    message.channel.send('⏹ 재생이 중지되었습니다.');
}

function showQueue(message, serverQueue) {
    if (!serverQueue || serverQueue.songs.length === 0) return message.channel.send('큐가 비어 있습니다.');
    message.channel.send(
        '큐 목록:\n' + serverQueue.songs.map((s, i) => `${i+1}. ${s.title}`).join('\n')
    );
}

function toggleLoop(message, serverQueue) {
    if (!serverQueue) return message.channel.send('재생 중인 노래가 없습니다.');
    serverQueue.loop = !serverQueue.loop;
    message.channel.send(`반복 ${serverQueue.loop ? '켬' : '끔'}`);
}

// ------------------- 플레이리스트 (간단 예시) -------------------
const playlists = {};
function managePlaylist(message, args) {
    const action = args.shift();
    const name = args.shift();
    if (action === 'save') {
        playlists[name] = queue.get(message.guild.id)?.songs.map(s => s.url) || [];
        message.channel.send(`플레이리스트 ${name} 저장 완료!`);
    } else if (action === 'load') {
        if (!playlists[name]) return message.channel.send('플레이리스트를 찾을 수 없습니다.');
        const serverQueue = queue.get(message.guild.id);
        playlists[name].forEach(url => execute(message, serverQueue, url));
        message.channel.send(`플레이리스트 ${name} 불러오기 완료!`);
    }
}

// ------------------- 봇 로그인 -------------------
client.login(process.env.TOKEN);