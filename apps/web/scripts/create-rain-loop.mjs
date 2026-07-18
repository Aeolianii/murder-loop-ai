// Extract a seamless ~60s loop from the Sleepy Times rain FLAC
// Uses crossfade at the loop point for seamless playback
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

ffmpeg.setFfmpegPath(ffmpegPath);

const SAMPLE_RATE = 44100;
const LOOP_DURATION_SEC = 60;
const CROSSFADE_SEC = 5;
const EXTRACT_START_SEC = 60; // skip first minute (intro)

const FLAC_PATH = process.argv[2] || join(import.meta.dirname, '../../音频文件/Sleepy Times - Summer Rain Sleep Relaxation Sounds, Pt. 3.flac');
const OUT_DIR = join(import.meta.dirname, '../apps/web/public/audio');
const TMP_DIR = tmpdir();

function readWavSamples(filepath) {
  const buffer = readFileSync(filepath);
  const dataOffset = 44; // skip RIFF header
  const numSamples = (buffer.length - dataOffset) / 2;
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return samples;
}

function writeWav(filepath, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);       // PCM
  buffer.writeUInt16LE(1, 22);       // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
    buffer.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(filepath, buffer);
}

async function extractSegment(outPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    ffmpeg(FLAC_PATH)
      .seekInput(startSec)
      .duration(durationSec)
      .audioChannels(1)
      .audioFrequency(SAMPLE_RATE)
      .audioCodec('pcm_s16le')
      .output(outPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const extractDuration = LOOP_DURATION_SEC + CROSSFADE_SEC;
  const tmpWav = join(TMP_DIR, `rain_segment_${Date.now()}.wav`);

  console.log(`Extracting ${extractDuration}s segment from FLAC (start=${EXTRACT_START_SEC}s)...`);
  await extractSegment(tmpWav, EXTRACT_START_SEC, extractDuration);
  console.log('Segment extracted.');

  const allSamples = readWavSamples(tmpWav);
  console.log(`Read ${allSamples.length} samples (${(allSamples.length / SAMPLE_RATE).toFixed(1)}s)`);

  const crossfadeLen = CROSSFADE_SEC * SAMPLE_RATE;
  const loopBodyLen = allSamples.length - crossfadeLen;

  // Crossfade: last CROSSFADE_SEC (outro) fades out, first CROSSFADE_SEC (intro) fades in
  const result = new Float32Array(loopBodyLen);

  // Copy the main body (without the last crossfade section)
  result.set(allSamples.subarray(0, loopBodyLen - crossfadeLen));

  // Crossfade region: mix outro (fade out) + intro (fade in)
  const outroStart = loopBodyLen - crossfadeLen;
  const introStart = 0;
  for (let i = 0; i < crossfadeLen; i++) {
    const t = i / crossfadeLen;
    const outroGain = 1 - t;  // linear fade out
    const introGain = t;       // linear fade in
    result[outroStart + i] =
      allSamples[outroStart + i] * outroGain +
      allSamples[introStart + i] * introGain;
  }

  const outPath = join(OUT_DIR, 'rain_loop_real.wav');
  writeWav(outPath, result);
  console.log(`Written: ${outPath} (${(result.length / SAMPLE_RATE).toFixed(1)}s, ${(result.length * 2 / 1024 / 1024).toFixed(1)}MB)`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
