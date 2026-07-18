// Apply Gaussian-like fade-out to all audio files >= 2 seconds
// Usage: node apply-fadeout.mjs [audio-repo-directory]
import { readdirSync, renameSync, unlinkSync, existsSync } from 'fs';
import { join, extname, resolve } from 'path';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'os';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const REPO_DIR = resolve(process.argv[2] || join(import.meta.dirname, '../audio-files'));

if (!existsSync(REPO_DIR)) {
  console.error(`ERROR: Directory not found: ${REPO_DIR}`);
  console.error('Usage: node apply-fadeout.mjs <audio-repo-directory>');
  process.exit(1);
}
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.webm']);
const MIN_DURATION = 2.0; // only process files >= 2 seconds

function fadeDuration(totalSec) {
  if (totalSec <= 3) return 0.4;
  if (totalSec <= 5) return 0.6;
  if (totalSec <= 10) return 1.0;
  if (totalSec <= 30) return 1.5;
  return 2.0;
}

async function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { reject(err); return; }
      resolve(metadata.format.duration || 0);
    });
  });
}

async function applyFadeOut(inputPath, outputPath, totalSec, fadeSec) {
  const startSec = totalSec - fadeSec;
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFilters(`afade=t=out:st=${startSec.toFixed(2)}:d=${fadeSec.toFixed(2)}:curve=exp`)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function processFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (!AUDIO_EXTS.has(ext)) return null;

  let duration;
  try {
    duration = await getDuration(filePath);
  } catch {
    return `SKIP (probe failed)`;
  }

  if (duration < MIN_DURATION) return `SKIP (${duration.toFixed(1)}s < 2.0s)`;

  const fadeSec = fadeDuration(duration);
  const tmpPath = join(tmpdir(), `fadeout_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  try {
    await applyFadeOut(filePath, tmpPath, duration, fadeSec);
    // Replace original with processed file
    unlinkSync(filePath);
    renameSync(tmpPath, filePath);
    return `OK (${duration.toFixed(1)}s, fade ${fadeSec.toFixed(1)}s)`;
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    return `FAIL ${err.message.slice(0, 60)}`;
  }
}

async function main() {
  const folders = readdirSync(REPO_DIR, { withFileTypes: true }).filter(e => e.isDirectory());

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const folder of folders) {
    const folderPath = join(REPO_DIR, folder.name);
    const files = readdirSync(folderPath).filter(f => {
      const ext = extname(f).toLowerCase();
      return AUDIO_EXTS.has(ext);
    });

    for (const file of files) {
      const filePath = join(folderPath, file);
      const result = await processFile(filePath);

      if (result.startsWith('OK')) processed++;
      else if (result.startsWith('SKIP')) skipped++;
      else failed++;

      if (!result.startsWith('SKIP')) {
        console.log(`  ${folder.name}/${file}: ${result}`);
      }
    }
  }

  console.log(`\nDone. Processed: ${processed}, Skipped (<2s): ${skipped}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
