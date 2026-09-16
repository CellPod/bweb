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

// Some source files carry a codec — e.g. PCM audio variants in .mov screen recordings, or
// a video codec the target container's muxer just doesn't support (HEVC variants, ProRes,
// etc.) — that a stream copy can't hold, even though the other stream's remux is perfectly
// fine. ffmpeg reports this as "Error initializing output stream", tagged with "vost" for
// the video output stream or "aost" for the audio one. This used to assume it was always
// the audio side (the common case), but a video-side failure hit the exact same generic
// message and retried with the same incompatible vcodec, just failing again the same way.
function isOutputStreamInitError(err) {
    return /Error initializing output stream/i.test(err.stderrTail || err.message || '');
}

function failingStreamKind(err) {
    const text = err.stderrTail || err.message || '';
    if (/\[vost#/i.test(text)) return 'video';
    if (/\[aost#/i.test(text)) return 'audio';
    return null; // older/other ffmpeg build that doesn't tag the stream — don't guess which
}

async function convertFile(ffmpegBin, inputPath, outputPath, format, onProgress, onLog, startTime, endTime, handle) {
    const preset = FORMAT_PRESETS[format];
    if (!preset) throw new Error(`Unknown format: ${format}`);

    let vcodec = preset.vcodec;
    let acodec = preset.acodec;

    // Up to 2 retries: one to fix the audio side, one to fix the video side, in whichever
    // order ffmpeg actually reports them failing (a file can need both).
    for (let attempt = 0; ; attempt++) {
        try {
            return await runFfmpegPass(ffmpegBin, inputPath, outputPath, vcodec, acodec, startTime, endTime, onProgress, onLog, handle);
        } catch (err) {
            if (attempt >= 2 || !isOutputStreamInitError(err)) throw err;

            const failing = failingStreamKind(err);
            if ((failing === 'audio' || !failing) && acodec === 'copy') {
                acodec = 'aac';
                log('Copy remux failed on the audio stream — retrying with audio re-encoded to AAC:', inputPath);
                if (onLog) onLog('Codec audio incompatible avec ce conteneur — réencodage en AAC…');
            } else if (vcodec === 'copy') {
                vcodec = 'libx264';
                log('Copy remux failed on the video stream — retrying with video re-encoded to H.264:', inputPath);
                if (onLog) onLog('Codec vidéo incompatible avec ce conteneur — réencodage en H.264…');
            } else {
                throw err;
            }
        }
    }
}

module.exports = { convertFile, FORMAT_PRESETS, getOutputPath };
