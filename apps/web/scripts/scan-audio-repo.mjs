// Scan the audio repository folder and generate manifest.json
// Usage: node scan-audio-repo.mjs [audio-repo-directory]
//   If no argument given, defaults to ../audio-files (relative to this script)
import { readdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const REPO_DIR = resolve(process.argv[2] || join(import.meta.dirname, '../audio-files'));

if (!existsSync(REPO_DIR)) {
  console.error(`ERROR: Directory not found: ${REPO_DIR}`);
  console.error('Usage: node scan-audio-repo.mjs <audio-repo-directory>');
  process.exit(1);
}

const MANIFEST_PATH = join(REPO_DIR, 'manifest.json');
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.webm']);

function scan() {
  const manifest = {};
  const entries = readdirSync(REPO_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = join(REPO_DIR, entry.name);
    const files = readdirSync(folderPath)
      .filter(f => {
        const ext = '.' + (f.split('.').pop() || '').toLowerCase();
        return AUDIO_EXTS.has(ext);
      })
      .sort();
    manifest[entry.name] = files;
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

  const totalFolders = Object.keys(manifest).length;
  const populatedFolders = Object.values(manifest).filter(a => a.length > 0).length;
  const totalFiles = Object.values(manifest).reduce((s, a) => s + a.length, 0);

  console.log(`Manifest written: ${MANIFEST_PATH}`);
  console.log(`  ${totalFolders} folders, ${populatedFolders} with audio, ${totalFiles} total files`);

  const emptyFolders = Object.entries(manifest).filter(([, files]) => files.length === 0).map(([name]) => name);
  if (emptyFolders.length > 0) {
    console.log(`  Empty folders (no audio yet): ${emptyFolders.join(', ')}`);
  }
}

scan();
