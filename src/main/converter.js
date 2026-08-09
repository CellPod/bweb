// Local File Converter
// Converts local media files using the bundled FFmpeg binary directly (no yt-dlp).
// Supports video-to-video and video/audio-to-audio conversions with real-time progress.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
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

function getOutputPath(inputPath, format, startTime, endTime, destDir) {
    const preset = FORMAT_PRESETS[format];
    if (!preset) return null;
    const dir = destDir || path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const suffix = format.includes('-') ? `-${format.split('-')[1]}` : '';
    const trimSuffix = (startTime || endTime) ? '_trim' : '';
    return path.join(dir, `${base}${suffix}${trimSuffix}_converted${preset.ext}`);
}

// Runs one ffmpeg pass with the given vcodec/acodec and resolves/rejects exactly like the
// previous inline implementation. Split out so convertFile() can transparently retry once
// with a different acodec when a "copy" remux turns out to be incompatible with the target
// container (see the retry logic below convertFile).
function runFfmpegPass(ffmpegBin, inputPath, outputPath, vcodec, acodec, startTime, endTime, onProgress, onLog, handle) {
    return new Promise((resolve, reject) => {
        const args = ['-y'];
        // Fast seek: put -ss BEFORE -i for keyframe-accurate fast seek
        if (startTime) args.push('-ss', startTime);
        if (endTime) args.push('-to', endTime);
        args.push('-i', inputPath, '-progress', 'pipe:1', '-nostats');

        if (vcodec === null) {
            args.push('-vn', '-acodec', acodec);
        } else {
            args.push('-vcodec', vcodec, '-acodec', acodec);
        }

        if (acodec === 'libmp3lame') {
            args.push('-q:a', '0'); // best VBR quality for MP3
        }

        args.push(outputPath);

        log('Converting:', inputPath, '->', outputPath, '(vcodec:', vcodec, 'acodec:', acodec + ')');
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
                const err = new Error(lastLines || `ffmpeg exited with code ${code}`);
                err.stderrTail = lastLines;
                return reject(err);
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

// Some source files (very commonly .mov screen recordings) carry an audio codec — e.g. PCM
// variants — that the target container's muxer refuses to hold via a stream copy, even
// though the video-only side of the remux is perfectly fine. ffmpeg reports this as
// "Error initializing output stream" for the audio stream specifically. Rather than
// surfacing a cryptic ffmpeg error to a non-technical user for something that has an easy,
// lossless-for-video fix, retry once with the audio re-encoded to AAC (universally
// supported) while keeping the video stream copy untouched.
function isOutputStreamInitError(err) {
    return /Error initializing output stream/i.test(err.stderrTail || err.message || '');
}

async function convertFile(ffmpegBin, inputPath, outputPath, format, onProgress, onLog, startTime, endTime, handle) {
    const preset = FORMAT_PRESETS[format];
    if (!preset) throw new Error(`Unknown format: ${format}`);

    try {
        return await runFfmpegPass(ffmpegBin, inputPath, outputPath, preset.vcodec, preset.acodec, startTime, endTime, onProgress, onLog, handle);
    } catch (err) {
        const canRetryWithAac = preset.acodec === 'copy' && preset.vcodec !== null && isOutputStreamInitError(err);
        if (!canRetryWithAac) throw err;

        log('Copy remux failed on the audio stream — retrying with audio re-encoded to AAC (video stays a lossless copy):', inputPath);
        if (onLog) onLog('Audio codec incompatible with this container — re-encoding audio to AAC, video stays lossless…');
        return runFfmpegPass(ffmpegBin, inputPath, outputPath, preset.vcodec, 'aac', startTime, endTime, onProgress, onLog, handle);
    }
}

module.exports = { convertFile, FORMAT_PRESETS, getOutputPath };
