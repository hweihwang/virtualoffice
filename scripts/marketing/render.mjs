/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Turns the captures in build/marketing/ into the published assets: App Store
 * and README screenshots, landing page images, the social preview, the demo
 * video with captions and the office card preview.
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const src = resolve(root, 'build/marketing')
const docs = resolve(root, 'docs')
const marks = JSON.parse(readFileSync(resolve(src, 'marks.json'), 'utf8'))
const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`

// Screenshots: PNG for the App Store and README, WebP for the landing page.
function png(from, to, crop) {
	run('magick', resolve(src, from), ...(crop ? ['-crop', crop, '+repage'] : []), '-strip', '-define', 'png:compression-level=9', to)
}
function webp(from, to, width) {
	run('cwebp', '-quiet', '-q', '86', '-resize', String(width), '0', from, '-o', to)
}
png('office.png', resolve(docs, 'screenshots/office.png'))
png('dashboard.png', resolve(docs, 'screenshots/dashboard.png'))
// The conversation without Talk's app navigation.
png('talk.png', resolve(docs, 'screenshots/talk.png'), '2246x2056+618+88')
webp(resolve(docs, 'screenshots/office.png'), resolve(docs, 'media/office.webp'), 1600)
webp(resolve(docs, 'screenshots/talk.png'), resolve(docs, 'media/talk.webp'), 1200)
webp(resolve(docs, 'screenshots/dashboard.png'), resolve(docs, 'media/dashboard.webp'), 1600)
// Phones get the map and the office card, large enough to read.
run('magick', resolve(src, 'stage.png'), '-crop', '1400x1320+0+0', '+repage', resolve(src, 'stage-mobile.png'))
webp(resolve(src, 'stage-mobile.png'), resolve(docs, 'media/office-mobile.webp'), 900)
run('magick', resolve(src, 'talk.png'), '-crop', '1530x1210+1045+675', '+repage', resolve(src, 'talk-mobile.png'))
webp(resolve(src, 'talk-mobile.png'), resolve(docs, 'media/talk-mobile.webp'), 900)
run('magick', resolve(src, 'dashboard.png'), '-crop', '700x540+384+300', '+repage', resolve(src, 'dashboard-mobile.png'))
webp(resolve(src, 'dashboard-mobile.png'), resolve(docs, 'media/dashboard-mobile.webp'), 700)
// Link previews in Talk and Text show the real office.
run('magick', resolve(src, 'stage.png'), '-resize', '960x600!', resolve(src, 'preview.png'))
run('cwebp', '-quiet', '-q', '84', resolve(src, 'preview.png'), '-o', resolve(root, 'img/office-preview.webp'))

// Cards for the video and the social preview.
const icon = dataUrl(resolve(docs, 'media/app.svg'), 'image/svg+xml')
const office = dataUrl(resolve(src, 'stage.png'), 'image/png')
const browser = await chromium.launch()
const base = `
	* { box-sizing: border-box; margin: 0; }
	body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #10324a; background: #eef6fa; }
	.brand { display: flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: -.01em; color: #10324a; }
	.brand img { display: block; }
	h1 { font-weight: 780; letter-spacing: -.03em; line-height: 1.05; }
	p { color: #4b6576; line-height: 1.4; }
`
async function render(file, width, height, body, css) {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
	await page.setContent(`<!doctype html><html><head><style>${base}${css}</style></head><body>${body}</body></html>`)
	await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
	await page.screenshot({ path: file })
	await page.close()
}
const card = `
	.card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 26px; }
	.card .brand { font-size: 24px; }
	.card h1 { font-size: 76px; }
	.card p { font-size: 26px; }
`
await render(resolve(src, 'intro.png'), 1280, 800, `<div class="card"><div class="brand"><img src="${icon}" width="48" height="48">Virtual Office</div><h1>See who's around.<br>Drop by.</h1><p>A small shared office in Nextcloud.</p></div>`, card)
await render(resolve(src, 'bridge.png'), 1280, 800, '<div class="card"><h1>Or step into<br>the full office.</h1></div>', card)
await render(resolve(src, 'outro.png'), 1280, 800, `<div class="card"><div class="brand"><img src="${icon}" width="48" height="48">Virtual Office</div><h1>Free and open source<br>for Nextcloud 35.</h1><p>github.com/hweihwang/virtualoffice</p></div>`, card)
await render(resolve(docs, 'media/social-preview.png'), 1280, 640, `
	<div class="text">
		<div class="brand"><img src="${icon}" width="40" height="40">Virtual Office</div>
		<h1>See who's around.<br>Drop by.</h1>
		<p>A small shared office for Nextcloud Teams and Talk conversations.</p>
		<p class="tag">Free and open source · Nextcloud 35</p>
	</div>
	<div class="shot"><img src="${office}"></div>
`, `
	.text { position: absolute; left: 64px; top: 64px; bottom: 64px; width: 480px; display: flex; flex-direction: column; }
	.text .brand { font-size: 22px; }
	.text h1 { margin-top: 64px; font-size: 54px; }
	.text p { margin-top: 24px; font-size: 22px; }
	.text .tag { margin-top: auto; font-size: 16px; font-weight: 650; color: #2c5d77; }
	.shot { position: absolute; left: 580px; top: 70px; width: 820px; height: 512px; border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px #12406026, 0 4px 14px #1240601a; }
	.shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: left top; }
`)
await browser.close()

// Demo video: title, Talk, bridge, the full office, closing card.
const clip = (args, to) => run('ffmpeg', '-v', 'error', '-y', ...args, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-an', resolve(src, to))
const still = (image, seconds, to) => clip(['-loop', '1', '-t', String(seconds), '-i', resolve(src, image), '-vf', 'scale=1280:800'], to)
const talkFrom = marks.talk.card + 1.2
const talkLength = marks.talk.end - talkFrom
const officeFrom = marks.office.entered - 0.4
const officeLength = marks.office.end - officeFrom
still('intro.png', 2.6, 'part1.mp4')
clip(['-ss', talkFrom.toFixed(2), '-t', talkLength.toFixed(2), '-i', resolve(src, 'talk.webm'), '-vf', 'scale=-2:800,pad=1280:800:(ow-iw)/2:0:color=0xeef6fa'], 'part2.mp4')
still('bridge.png', 1.6, 'part3.mp4')
clip(['-ss', officeFrom.toFixed(2), '-t', officeLength.toFixed(2), '-i', resolve(src, 'office.webm'), '-vf', 'scale=1280:800'], 'part4.mp4')
still('outro.png', 2.8, 'part5.mp4')
writeFileSync(resolve(src, 'parts.txt'), [1, 2, 3, 4, 5].map((i) => `file 'part${i}.mp4'`).join('\n'))
run('ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', resolve(src, 'parts.txt'), '-c', 'copy', '-movflags', '+faststart', resolve(docs, 'media/demo.mp4'))

const office0 = 2.6 + talkLength + 1.6
const at = (mark) => office0 + marks.office[mark] - officeFrom
const time = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 23)
const cues = [
	[2.6, 2.6 + talkLength, 'Open the office right in a Talk conversation.'],
	[office0, at('coffee'), 'Walk over and say hi.'],
	[at('coffee'), at('knock'), 'Make a coffee together.'],
	[at('knock'), at('focus'), 'Knock to ask “got 2 minutes?”'],
	[at('focus'), at('end'), 'Focus together when you need quiet.'],
]
writeFileSync(resolve(docs, 'media/demo.vtt'), `WEBVTT

NOTE SPDX-FileCopyrightText: 2026 Hoang Pham
NOTE SPDX-License-Identifier: AGPL-3.0-or-later

${cues.map(([from, to, text]) => `${time(from)} --> ${time(to)}\n${text}`).join('\n\n')}
`)
run('ffmpeg', '-v', 'error', '-y', '-ss', (2.6 + 3).toFixed(2), '-i', resolve(docs, 'media/demo.mp4'), '-frames:v', '1', '-q:v', '3', resolve(docs, 'media/demo-poster.jpg'))
const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', resolve(docs, 'media/demo.mp4')], { encoding: 'utf8' }))
console.log(`demo.mp4: ${length.toFixed(1)} s`)
