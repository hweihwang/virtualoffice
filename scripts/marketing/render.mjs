/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Turns the captures in build/marketing/ into the published assets: App Store
 * and README screenshots, the social preview, the office card preview, and
 * the product page assets in build/marketing/site/ (copied to
 * hweihwang.com/virtualoffice/ by hand, together with build/film/).
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const src = resolve(root, 'build/marketing')
const site = resolve(src, 'site')
const docs = resolve(root, 'docs')
const fonts = resolve(import.meta.dirname, 'film/fonts')
const run = (cmd, ...args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
const size = (file) => execFileSync('magick', ['identify', '-format', '%w %h', file], { encoding: 'utf8' }).split(' ').map(Number)
const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`
const at = (name) => resolve(src, name)
rmSync(site, { recursive: true, force: true })
mkdirSync(site, { recursive: true })

function magick(from, to, ...ops) {
	run('magick', from, ...ops, '-strip', to)
}
function webp(from, to, width, quality = 88) {
	run('cwebp', '-quiet', '-q', String(quality), '-alpha_q', '100', '-resize', String(width), '0', from, '-o', to)
}
/** A crop of the map, given in cells of the 32 × 20 office or of another layout's width. */
function cells(from, to, [x, y, w, h], columns = 32) {
	const [width] = size(at(from))
	const cell = width / columns
	magick(at(from), at(to), '-crop', `${Math.round(w * cell)}x${Math.round(h * cell)}+${Math.round(x * cell)}+${Math.round(y * cell)}`, '+repage')
}

// Screenshots for the App Store and the README: 2880 × 1800 PNG, as on a 2× screen.
// Nextcloud's header is 50 px; the Talk crop also leaves out Talk's navigation.
magick(at('office.png'), resolve(docs, 'screenshots/office.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('office-dark.png'), resolve(docs, 'screenshots/office-dark.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('picker.png'), resolve(docs, 'screenshots/character.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('dashboard.png'), resolve(docs, 'screenshots/dashboard.png'), '-define', 'png:compression-level=9')
magick(at('talk.png'), resolve(docs, 'screenshots/talk.png'), '-crop', '2264x2072+616+88', '+repage', '-define', 'png:compression-level=9')
magick(at('small-office.png'), resolve(docs, 'screenshots/small-office.png'), '-resize', '2880x', '-define', 'png:compression-level=9')

// Link previews in Talk and Text show the real office.
magick(at('stage.png'), at('preview.png'), '-resize', '960x600!')
run('cwebp', '-quiet', '-q', '84', at('preview.png'), '-o', resolve(root, 'img/office-preview.webp'))
magick(at('stage-compact.png'), at('preview-compact.png'), '-resize', '960x600^', '-gravity', 'center', '-extent', '960x600')
run('cwebp', '-quiet', '-q', '84', at('preview-compact.png'), '-o', resolve(root, 'img/office-preview-compact-office-v1.webp'))

// Product page: the office inside Nextcloud's rounded content area.
magick(at('office.png'), at('office-page.png'), '-crop', '4272x2470+24+170', '+repage')
webp(at('office-page.png'), resolve(site, 'office.webp'), 2880, 86)
webp(at('office-page.png'), resolve(site, 'office-1440.webp'), 1440, 86)
// Phones get the busy half of the map instead of the whole window.
cells('stage.png', 'office-phone.png', [2.5, 0.4, 17.4, 13.05])
webp(at('office-phone.png'), resolve(site, 'office-phone.webp'), 1200)
// Talking to whoever is close, in the small office.
cells('stage-voice.png', 'm-voice.png', [0, 1, 8, 8], 22)
webp(at('m-voice.png'), resolve(site, 'm-voice.webp'), 800)
// The knock card, captured on a transparent background with its own shadow, evenly padded.
magick(at('knock.png'), at('knock-card.png'), '-trim', '+repage', '-bordercolor', 'none', '-border', '24')
webp(at('knock-card.png'), resolve(site, 'knock.webp'), size(at('knock-card.png'))[0])
// The conversation from Bảo's question to the office card, large enough to read.
magick(at('talk.png'), at('talk-page.png'), '-crop', '1840x1580+810+390', '+repage')
webp(at('talk-page.png'), resolve(site, 'talk.webp'), 1600)
copyFileSync(resolve(docs, 'media/logo.svg'), resolve(site, 'logo.svg'))

// The social preview and the touch icon. New file names, because the website caches PNGs for a year.
const face = (family, file, style = 'normal') => `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: 100 900; src: url(${dataUrl(resolve(fonts, file), 'font/woff2')}) format('woff2'); }`
const base = `
	${face('Source Sans 3', 'source-sans-3-latin.woff2')}
	* { box-sizing: border-box; margin: 0; }
	body { font-family: 'Source Sans 3', sans-serif; color: #111318; -webkit-font-smoothing: antialiased; }
`
const browser = await chromium.launch({ channel: 'chromium' })
async function render(file, width, height, body, css, scale = 1) {
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale })
	await page.setContent(`<!doctype html><html><head><style>${base}${css}</style></head><body>${body}</body></html>`)
	await page.evaluate(async () => {
		await document.fonts.ready
		await Promise.all([...document.images].map((i) => i.decode()))
	})
	await page.screenshot({ path: file, omitBackground: true })
	await page.close()
}
const logo = dataUrl(resolve(docs, 'media/logo.svg'), 'image/svg+xml')
await render(resolve(site, 'touch-icon.png'), 180, 180, `<img src="${logo}" width="180" height="180">`, 'body { background: #0c0e18; } img { display: block; }')
await render(resolve(docs, 'media/social-preview.png'), 1280, 640, `
	<div class="text">
		<div class="brand"><img src="${logo}" width="52" height="52"><span>Virtual Office</span></div>
		<h1>See who's around.<br>Drop by.</h1>
		<p>A small shared office for Nextcloud Teams, groups and Talk conversations.</p>
		<p class="tag">Free and open source · Nextcloud 35</p>
	</div>
	<div class="shot"><img src="${dataUrl(at('stage.png'), 'image/png')}"></div>
	<img class="knock" src="${dataUrl(at('knock-card.png'), 'image/png')}">
`, `
	body {
		width: 1280px; height: 640px; overflow: hidden; position: relative;
		background: #fff;
	}
	.text { position: absolute; left: 72px; top: 64px; bottom: 60px; width: 600px; display: flex; flex-direction: column; }
	.brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 700; letter-spacing: -.01em; }
	h1 { margin-top: 60px; font-size: 68px; line-height: 1; font-weight: 700; letter-spacing: -.035em; }
	p { margin-top: 26px; max-width: 470px; font-size: 25px; line-height: 1.35; color: #5b5f6a; }
	.tag { margin-top: auto; font-size: 18px; font-weight: 600; color: #5b5f6a; }
	.shot { position: absolute; left: 660px; top: 110px; width: 820px; border-radius: 26px; overflow: hidden; background: #eef4f8; box-shadow: 0 0 0 1px #e4e4e9, 0 40px 80px -30px rgb(12 44 68 / .45); }
	.shot img { display: block; width: 100%; }
	.knock { position: absolute; left: 596px; top: 404px; width: 370px; filter: drop-shadow(0 18px 30px rgb(12 44 68 / .2)); }
`)
await browser.close()
copyFileSync(resolve(docs, 'media/social-preview.png'), resolve(site, 'social-preview.png'))

// The film, rendered by film/render.mjs.
for (const file of ['film.mp4', 'film-poster.jpg']) {
	if (existsSync(resolve(root, 'build/film', file))) {
		copyFileSync(resolve(root, 'build/film', file), resolve(site, file))
	}
}
console.log(`Product page assets in ${site}`)
