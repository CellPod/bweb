// Local File Converter
// Converts local media files using the bundled FFmpeg binary directly (no yt-dlp).
// Supports video-to-video and video/audio-to-audio conversions with real-time progress.

const { spawn } = require('child_process');
const path = require('path');
const { log, logError } = require('./utils');

// Output format presets: vcodec null = audio-only, 'copy' = remux (lossless, no re-encode)
const FORMAT_PRESETS = {
    // ── Remux (lossless, recommended) ─────────────────────────────────────
    'mp4':       { vcodec: 'copy',       acodec: 'copy',       ext: '.mp4'  },
    'mkv':       { vcodec: 'copy',       acodec: 'copy',       ext: '.mkv'  },
    'mov':       { vcodec: 'copy',       acodec: 'copy',       ext: '.mov'  },
    // ── Re-encode (use only if remux fails or smaller file needed) ─────────
    'mp4-h264':  { vcodec: 'libx264',    acodec: 'aac',        ext: '.mp4'  },
    'mp4-h265':  { vcodec: 'libx265',    acodec: 'aac',        ext: '.mp4'  },
    'webm':      { vcodec: 'libvpx-vp9', acodec: 'libopus',    ext: '.webm' },
    // ── Audio extraction ───────────────────────────────────────────────────
    'mp3':       { vcodec: null,         acodec: 'libmp3lame', ext: '.mp3'  },
    'm4a':       { vcodec: null,         acodec: 'aac',        ext: '.m4a'  },
    'opus':      { vcodec: null,         acodec: 'libopus',    ext: '.opus' },
    // ── Lossless audio (source must be lossless for real benefit) ──────────
    'flac':      { vcodec: null,         acodec: 'flac',       ext: '.flac' },
    'wav':       { vcodec: null,         acodec: 'pcm_s16le',  ext: '.wav'  },
    // ── Rare / pro formats ─────────────────────────────────────────────────
    'avi':       { vcodec: 'copy',       acodec: 'copy',       ext: '.avi'  },
    'ts':        { vcodec: 'copy',       acodec: 'copy',       ext: '.ts'   },
    'mts':       { vcodec: 'copy',       acodec: 'copy',       ext: '.mts'  },
    'vob':       { vcodec: 'copy',       acodec: 'copy',       ext: '.vob'  },
    'flv':       { vcodec: 'copy',       acodec: 'copy',       ext: '.flv'  },
    '3gp':       { vcodec: 'libx264',    acodec: 'aac',        ext: '.3gp'  },
    'dav':       { vcodec: 'copy',       acodec: 'copy',       ext: '.dav'  },
};

function getOutputPath(inputPath, format, startTime, endTime) {
    const preset = FORMAT_PRESETS[format];
    if (!preset) return null;
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const suffix = format.includes('-') ? `-${format.split('-')[1]}` : '';
    const trimSuffix = (startTime || endTime) ? '_trim' : '';
    return path.join(dir, `${base}${suffix}${trimSuffix}_converted${preset.ext}`);
}

function convertFile(ffmpegBin, inputPath, outputPath, format, onProgress, onLog, startTime, endTime, handle) {
    return new Promise((resolve, reject) => {
        const preset = FORMAT_PRESETS[format];
        if (!preset) return reject(new Error(`Unknown format: ${format}`));

        const args = ['-y'];
        // Fast seek: put -ss BEFORE -i for keyframe-accurate fast seek
        if (startTime) args.push('-ss', startTime);
        if (endTime) args.push('-to', endTime);
        args.push('-i', inputPath, '-progress', 'pipe:1', '-nostats');

        if (preset.vcodec === null) {
            args.push('-vn', '-acodec', preset.acodec);
        } else {
            args.push('-vcodec', preset.vcodec, '-acodec', preset.acodec);
        }

        if (preset.acodec === 'libmp3lame') {
            args.push('-q:a', '0'); // best VBR quality for MP3
        }

        args.push(outputPath);

        log('Converting:', inputPath, '->', outputPath, '(format:', format + ')');
        log('FFmpeg args:', args.join(' '));

        let duration = 0;
        const proc = spawn(ffmpegBin, args);
        let stderrBuf = '';
        let stdoutBuf = '';
        let cancelled = false;

        if (handle) {
            handle.cancel = () => {
                cancelled = true;
                try {
                    proc.kill('SIGTERM');
                } catch { /**/ }
            };
        }

        proc.stderr.on('data', (d) => {
            const text = d.toString();
            stderrBuf += text;

            // Parse total duration from ffmpeg header (emitted once)
            if (!duration) {
                const m = text.match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
                if (m) {
                    duration = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
                }
            }

            if (onLog) {
                const lines = text.split('\n');
                for (const line of lines) {
                    const t = line.trim();
                    if (t && t.length < 300) onLog(t);
                }
            }
        });

        proc.stdout.on('data', (d) => {
            stdoutBuf += d.toString();
            const lines = stdoutBuf.split('\n');
            stdoutBuf = lines.pop() || '';

            let timeUs = null;
            for (const line of lines) {
                const m = line.match(/^out_time_us=(\d+)/);
                if (m) timeUs = parseInt(m[1]);
            }

            if (timeUs !== null && onProgress) {
                const elapsed = timeUs / 1e6;
                const pct = duration > 0 ? Math.min(99, Math.round((elapsed / duration) * 100)) : 0;
                onProgress({ percent: pct + '%', elapsed: elapsed.toFixed(1), total: duration.toFixed(1) });
            }
        });

        proc.on('close', (code) => {
            if (cancelled) {
                log('Convert cancelled:', inputPath);
                return reject(new Error('Cancelled'));
            }
            if (code !== 0) {
                const lastLines = stderrBuf.trim().split('\n').slice(-5).join(' ');
                logError('Convert failed (code', code + '):', lastLines);
                return reject(new Error(lastLines || `ffmpeg exited with code ${code}`));
            }
            log('Convert complete:', outputPath);
            if (onProgress) onProgress({ percent: '100%', elapsed: duration.toFixed(1), total: duration.toFixed(1) });
            resolve({ ok: true, outputPath });
        });

        proc.on('error', (err) => {
            cancelled = true;
            logError('Convert spawn error:', err.message);
            reject(new Error(`Cannot run ffmpeg: ${err.message}`));
        });
    });
}

module.exports = { convertFile, FORMAT_PRESETS, getOutputPath };
