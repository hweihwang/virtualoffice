/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Renders the launch film frame by frame into build/film/.
 * Needs ffmpeg and python3 with numpy (for the score).
 *
 *   node scripts/marketing/film/render.mjs            film.mp4, film-loop.mp4, posters
 *   node scripts/marketing/film/render.mjs --4k       also film-4k.mp4 (renders at 2x)
 *   node scripts/marketing/film/render.mjs --stills 6.8,30.5   single frames as PNG
 *   node scripts/marketing/film/render.mjs --sheet 1  contact sheet, one frame per second
 */
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { cpus } from 'node:os'
import { extname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const out = resolve(root, 'build/film')
const pageDir = join(out, 'page')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const run = (cmd, ...a) => execFileSync(cmd, a, { stdio: ['ignore', 'inherit', 'inherit'] })

run('npx', 'vite', 'build', '--config', resolve(import.meta.dirname, 'vite.config.mjs'))

// The page uses ES modules, so serve it over HTTP instead of file://.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
	const file = join(pageDir, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'))
	if (!file.startsWith(pageDir) || !existsSync(file)) {
		res.writeHead(404).end()
		return
	}
	res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
	createReadStream(file).pipe(res)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${server.address().port}/`

// The default headless shell exits after about 30 s on some machines; full Chromium does not.
const browser = await chromium.launch({ channel: 'chromium', args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text'] })
async function openPage(scale) {
	const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale })
	const page = await context.newPage()
	await page.goto(url)
	await page.evaluate(() => window.ready)
	const cdp = await context.newCDPSession(page)
	const film = await page.evaluate(() => window.film)
	return {
		film,
		async frame(t) {
			await page.evaluate((s) => window.seek(s), t)
			// The clip scale sets the output size; the context scale alone does not.
			const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale } })
			return Buffer.from(data, 'base64')
		},
		close: () => context.close(),
	}
}

if (flag('--stills') || flag('--sheet')) {
	const dir = join(out, 'stills')
	mkdirSync(dir, { recursive: true })
	const page = await openPage(Number(value('--scale') ?? 1))
	const times = flag('--stills')
		? value('--stills').split(',').map(Number)
		: Array.from({ length: Math.floor(page.film.duration / Number(value('--sheet'))) }, (_, i) => i * Number(value('--sheet')) + Number(value('--offset') ?? 0))
	const files = []
	for (const t of times) {
		const file = join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`)
		writeFileSync(file, await page.frame(t))
		files.push(file)
	}
	if (flag('--sheet')) {
		const sheet = join(out, `sheet-${value('--sheet')}${value('--offset') ? '-' + value('--offset') : ''}.jpg`)
		run('magick', 'montage', '-label', '%t', ...files, '-tile', '6x', '-geometry', '480x270+4+4', '-background', '#222', '-pointsize', '16', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-fill', '#ddd', sheet)
		console.log(sheet)
	} else {
		console.log(files.join('\n'))
	}
	await browser.close()
	server.close()
	process.exit(0)
}

// Film: split the frames across a few pages, each encoding a near-lossless segment.
const fourK = flag('--4k')
const scale = fourK ? 2 : 1
const probe = await openPage(scale)
const { fps, duration } = probe.film
await probe.close()
const total = Math.round(fps * duration)
const workers = Math.min(Number(value('--workers') ?? 4), Math.max(1, cpus().length - 4))
const segDir = join(out, `segments-${scale}x`)
rmSync(segDir, { recursive: true, force: true })
mkdirSync(segDir, { recursive: true })
const started = Date.now()
let done = 0
await Promise.all(Array.from({ length: workers }, async (_, w) => {
	const from = Math.floor((total * w) / workers)
	const to = Math.floor((total * (w + 1)) / workers)
	const page = await openPage(scale)
	const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
		// Chromium frames are sRGB; convert with the BT.709 matrix that players assume for HD.
		'-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p',
		'-c:v', 'libx264', '-preset', 'fast', '-crf', '8', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
		join(segDir, `seg${w}.mkv`)], { stdio: ['pipe', 'inherit', 'inherit'] })
	const closed = new Promise((ok, fail) => ffmpeg.on('close', (code) => code === 0 ? ok() : fail(new Error(`ffmpeg ${code}`))))
	for (let f = from; f < to; f++) {
		const png = await page.frame(f / fps)
		if (!ffmpeg.stdin.write(png)) {
			await new Promise((ok) => ffmpeg.stdin.once('drain', ok))
		}
		if (++done % 120 === 0) {
			const rate = done / ((Date.now() - started) / 1000)
			console.log(`${done}/${total} frames, ${rate.toFixed(1)} fps, ${((total - done) / rate / 60).toFixed(1)} min left`)
		}
	}
	ffmpeg.stdin.end()
	await closed
	await page.close()
}))
await browser.close()
server.close()
writeFileSync(join(segDir, 'list.txt'), Array.from({ length: workers }, (_, w) => `file 'seg${w}.mkv'`).join('\n'))
const master = join(segDir, 'master.mkv')
run('ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(segDir, 'list.txt'), '-c', 'copy', master)

// Score.
const score = join(out, 'score.wav')
run('python3', resolve(import.meta.dirname, 'score.py'), score, String(duration))

const bt709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']
const h264 = (crf, maxrate) => ['-c:v', 'libx264', '-preset', 'veryslow', '-profile:v', 'high', '-tune', 'animation', '-crf', String(crf), '-maxrate', maxrate, '-bufsize', maxrate.replace('M', '') * 2 + 'M', '-pix_fmt', 'yuv420p', ...bt709, '-movflags', '+faststart']
const size = (file) => (statSync(file).size / 1e6).toFixed(1) + ' MB'
if (fourK) {
	run('ffmpeg', '-v', 'error', '-y', '-i', master, '-i', score, '-map', '0:v', '-map', '1:a', ...h264(18, '28M'), '-c:a', 'aac', '-b:a', '192k', '-shortest', join(out, 'film-4k.mp4'))
	console.log('film-4k.mp4', size(join(out, 'film-4k.mp4')))
}
const down = (w, h) => ['-vf', `scale=${w}:${h}:flags=lanczos`]
run('ffmpeg', '-v', 'error', '-y', '-i', master, '-i', score, '-map', '0:v', '-map', '1:a', ...(fourK ? down(1920, 1080) : []), ...h264(21, '3M'), '-c:a', 'aac', '-b:a', '192k', '-shortest', join(out, 'film.mp4'))
run('ffmpeg', '-v', 'error', '-y', '-i', master, '-an', ...down(1280, 720), ...h264(24, '1.4M'), join(out, 'film-loop.mp4'))
const poster = Number(value('--poster') ?? 32.6)
run('ffmpeg', '-v', 'error', '-y', '-ss', poster.toFixed(3), '-i', master, '-frames:v', '1', ...(fourK ? down(1920, 1080) : []), '-q:v', '2', join(out, 'film-poster.jpg'))
run('ffmpeg', '-v', 'error', '-y', '-ss', poster.toFixed(3), '-i', master, '-frames:v', '1', ...down(1280, 720), '-q:v', '3', join(out, 'film-poster-720.jpg'))
for (const file of ['film.mp4', 'film-loop.mp4', 'film-poster.jpg', 'film-poster-720.jpg']) {
	console.log(file, size(join(out, file)))
}
console.log(`Rendered ${total} frames in ${((Date.now() - started) / 60000).toFixed(1)} min`)
