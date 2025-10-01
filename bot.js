// bot.js
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const yts = require('yt-search');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

let queue = [];
let player = createAudioPlayer();
let connection = null;
let loop = false;
let playlists = {}; // 서버별 플레이리스트 저장

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args.shift().toLowerCase();

    // ─── 음악 재생 ───
    if (command === '!play' || command === '!p') {
        const query = args.join(' ');
        if (!query) return message.channel.send('노래 이름이나 링크를 입력하세요.');

        let url = '';
        if (ytdl.validateURL(query)) {
            url = query;
        } else {
            const result = await yts(query);
            if (!result.videos.length) return message.channel.send('검색 결과가 없습니다.');
            url = result.videos[0].url;
        }

        queue.push(url);
        message.channel.send(`🎵 큐에 추가됨: ${url}`);

        if (!connection) {
            if (!message.member.voice.channel) return message.channel.send('먼저 음성 채널에 들어가세요.');
            connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
            playSong();
        }
    }

    // ─── 스킵 ───
    else if (command === '!skip') {
        player.stop();
        message.channel.send('⏭ 다음 곡으로 넘어갑니다.');
    }

    // ─── 정지 ───
    else if (command === '!stop') {
        queue = [];
        player.stop();
        if (connection) {
            connection.destroy();
            connection = null;
        }
        message.channel.send('⏹ 재생을 종료했습니다.');
    }

    // ─── 큐 확인 ───
    else if (command === '!queue') {
        message.channel.send('🎶 현재 큐:\n' + (queue.length ? queue.join('\n') : '큐가 비어있습니다.'));
    }

    // ─── 반복 ───
    else if (command === '!loop') {
        loop = !loop;
        message.channel.send(`🔁 반복 모드 ${loop ? '활성화' : '비활성화'}`);
    }

    // ─── 플레이리스트 저장 ───
    else if (command === '!save') {
        const name = args[0];
        if (!name) return message.channel.send('플레이리스트 이름을 입력하세요.');
        playlists[name] = [...queue];
        message.channel.send(`💾 플레이리스트 '${name}' 저장 완료`);
    }

    // ─── 플레이리스트 불러오기 ───
    else if (command === '!load') {
        const name = args[0];
        if (!name || !playlists[name]) return message.channel.send('존재하지 않는 플레이리스트입니다.');
        queue.push(...playlists[name]);
        message.channel.send(`📂 플레이리스트 '${name}' 큐에 추가됨`);
        if (!connection && message.member.voice.channel) {
            connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });
            playSong();
        }
    }
});

function playSong() {
    if (!queue.length) {
        if (connection) {
            connection.destroy();
            connection = null;
        }
        return;
    }

    const url = queue[0];
    const stream = ytdl(url, { filter: 'audioonly' });
    const resource = createAudioResource(stream);

    player.play(resource);
    connection.subscribe(player);

    player.once(AudioPlayerStatus.Idle, () => {
        if (!loop) queue.shift();
        playSong();
    });
}

client.login(process.env.DISCORD_TOKEN);