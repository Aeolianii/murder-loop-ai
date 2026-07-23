import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);

const sourceRoot = resolve(process.argv[2] || 'D:/HangZhou Hackathon/音频文件');
const publicAudioRoot = resolve(import.meta.dirname, '../public/audio');
const outputRoot = resolve(publicAudioRoot, 'repository');
const audioExtensions = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.webm']);
const musicIds = new Set([
  'rain-loop',
  'death-default',
  'ending-s',
  'ending-a',
  'ending-b',
  'ending-c',
  'ending-d',
]);

function listAudioFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) return listAudioFiles(absolutePath);
    return audioExtensions.has(extname(entry.name).toLowerCase()) ? [absolutePath] : [];
  });
}

function soundIdFor(sourcePath) {
  const parts = relative(sourceRoot, sourcePath).split(sep);
  const category = parts[0] ?? '';
  const namedFolder = parts.find(part => /__[a-z0-9-]+\.ogg$/i.test(part));
  if (namedFolder) {
    const id = namedFolder.match(/__([a-z0-9-]+)\.ogg$/i)?.[1].toLowerCase();
    if (category.startsWith('01_') && id === 'default') return 'death-default';
    return id;
  }

  if (category.startsWith('05_')) {
    const rank = parts[1]?.match(/^0[1-5]\s*([SABCD])/i)?.[1].toLowerCase();
    return rank ? `ending-${rank}` : undefined;
  }
  return undefined;
}

function transcode(sourcePath, outputPath, soundId) {
  const isMusic = musicIds.has(soundId);
  return new Promise((resolvePromise, rejectPromise) => {
    ffmpeg(sourcePath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(isMusic ? '96k' : '128k')
      .audioChannels(isMusic ? 2 : 1)
      .audioFrequency(44_100)
      .outputOptions('-map_metadata', '-1', '-y')
      .output(outputPath)
      .on('end', resolvePromise)
      .on('error', rejectPromise)
      .run();
  });
}

async function main() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Audio source directory does not exist: ${sourceRoot}`);
  }
  if (!outputRoot.startsWith(`${publicAudioRoot}${sep}`)) {
    throw new Error(`Refusing to replace unsafe output directory: ${outputRoot}`);
  }

  const sourcesById = new Map();
  for (const sourcePath of listAudioFiles(sourceRoot)) {
    const soundId = soundIdFor(sourcePath);
    if (!soundId) continue;
    if (sourcesById.has(soundId)) {
      throw new Error(`Duplicate audio id "${soundId}": ${sourcePath}`);
    }
    sourcesById.set(soundId, sourcePath);
  }

  if (!sourcesById.has('rain-loop')) {
    throw new Error('Required background sound "rain-loop" was not found.');
  }
  if (!sourcesById.has('default')) {
    throw new Error('Required fallback action sound "default" was not found.');
  }

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const outputById = new Map();
  for (const [soundId, sourcePath] of [...sourcesById].sort(([left], [right]) => left.localeCompare(right))) {
    const outputName = `${soundId}.mp3`;
    const outputPath = join(outputRoot, outputName);
    process.stdout.write(`audio ${soundId} <- ${basename(sourcePath)} ... `);
    await transcode(sourcePath, outputPath, soundId);
    outputById.set(soundId, outputName);
    process.stdout.write('done\n');
  }

  const sounds = {};
  const endings = {};
  for (const [soundId, outputName] of outputById) {
    if (soundId === 'rain-loop') continue;
    if (soundId === 'death-default') {
      endings.DEFAULT = outputName;
      continue;
    }
    if (soundId.startsWith('ending-')) {
      endings[soundId.slice('ending-'.length).toUpperCase()] = outputName;
      continue;
    }
    sounds[soundId] = [outputName];
  }

  const manifest = {
    version: 1,
    bgm: outputById.get('rain-loop'),
    sounds,
    endings,
  };
  writeFileSync(
    join(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const outputBytes = readdirSync(outputRoot)
    .map(name => statSync(join(outputRoot, name)).size)
    .reduce((sum, size) => sum + size, 0);
  const outputMiB = outputBytes / 1024 / 1024;
  if (outputMiB > 35) {
    throw new Error(`Prepared audio is ${outputMiB.toFixed(2)} MiB, exceeding the 35 MiB budget.`);
  }
  console.log(`Prepared ${outputById.size} fixed audio assets (${outputMiB.toFixed(2)} MiB).`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
