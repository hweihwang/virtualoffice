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
/** A crop of the map, given in cells of the 32 × 20 office. */
function cells(from, to, [x, y, w, h]) {
	const [width] = size(at(from))
	const cell = width / 32
	magick(at(from), at(to), '-crop', `${Math.round(w * cell)}x${Math.round(h * cell)}+${Math.round(x * cell)}+${Math.round(y * cell)}`, '+repage')
}

// Screenshots for the App Store and the README: 2880 × 1800 PNG, as on a 2× screen.
// Nextcloud's header is 50 px; the Talk crop also leaves out Talk's navigation.
magick(at('office.png'), resolve(docs, 'screenshots/office.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('office-dark.png'), resolve(docs, 'screenshots/office-dark.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('picker.png'), resolve(docs, 'screenshots/character.png'), '-resize', '2880x', '-define', 'png:compression-level=9')
magick(at('dashboard.png'), resolve(docs, 'screenshots/dashboard.png'), '-define', 'png:compression-level=9')
magick(at('talk.png'), resolve(docs, 'screenshots/talk.png'), '-crop', '2264x2072+616+88', '+repage', '-define', 'png:compression-level=9')

// Link previews in Talk and Text show the real office.
magick(at('stage.png'), at('preview.png'), '-resize', '960x600!')
run('cwebp', '-quiet', '-q', '84', at('preview.png'), '-o', resolve(root, 'img/office-preview.webp'))

// Product page: the office inside Nextcloud's rounded content area, in light and dark.
for (const name of ['office', 'office-dark']) {
	magick(at(`${name}.png`), at(`${name}-page.png`), '-crop', '4272x2470+24+170', '+repage')
	webp(at(`${name}-page.png`), resolve(site, `${name}.webp`), 2880, 86)
	webp(at(`${name}-page.png`), resolve(site, `${name}-1440.webp`), 1440, 86)
}
// Close-ups of the map for the moments.
cells('coffee-2.png', 'm-coffee.png', [0.2, 0, 10, 5.13])
cells('stage.png', 'm-wave.png', [4, 1, 8, 8])
cells('stage.png', 'm-desks.png', [22.2, 1.4, 9.6, 9.6])
// Phones get the busy half of the map instead of the whole window.
cells('stage.png', 'office-phone.png', [2.5, 0.4, 17.4, 13.05])
webp(at('m-coffee.png'), resolve(site, 'm-coffee.webp'), 1400)
webp(at('m-wave.png'), resolve(site, 'm-wave.webp'), 800)
webp(at('m-desks.png'), resolve(site, 'm-desks.webp'), 800)
webp(at('office-phone.png'), resolve(site, 'office-phone.webp'), 1200)
// Cards captured on a transparent background, with their own shadow, evenly padded.
for (const name of ['knock', 'knock-answer', 'door']) {
	magick(at(`${name}.png`), at(`${name}-card.png`), '-trim', '+repage', '-bordercolor', 'none', '-border', '24')
}
webp(at('knock-card.png'), resolve(site, 'knock.webp'), size(at('knock-card.png'))[0])
webp(at('knock-answer-card.png'), resolve(site, 'knock-answer.webp'), size(at('knock-answer-card.png'))[0])
webp(at('door-card.png'), resolve(site, 'door.webp'), 1600)
webp(at('focus.png'), resolve(site, 'focus.webp'), size(at('focus.png'))[0])
// The conversation from Bảo's question to the office card, large enough to read.
magick(at('talk.png'), at('talk-page.png'), '-crop', '1840x1580+810+390', '+repage')
webp(at('talk-page.png'), resolve(site, 'talk.webp'), 1600)
// The Dashboard's greeting and first three widgets.
magick(at('dashboard.png'), at('dashboard-page.png'), '-crop', '3240x1920+540+210', '+repage')
webp(at('dashboard-page.png'), resolve(site, 'dashboard.webp'), 2000)
webp(at('phone.png'), resolve(site, 'phone.webp'), 780)
run(resolve(root, 'node_modules/.bin/esbuild'), resolve(import.meta.dirname, 'creatures.ts'), '--bundle', '--format=esm', '--minify', '--legal-comments=none', `--outfile=${resolve(site, 'creatures.js')}`)
copyFileSync(resolve(docs, 'media/logo.svg'), resolve(site, 'logo.svg'))

// The social preview and the touch icon, set in the film's fonts.
const face = (family, file, style = 'normal') => `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: 100 900; src: url(${dataUrl(resolve(fonts, file), 'font/woff2')}) format('woff2'); }`
const base = `
	${face('Fraunces', 'fraunces-latin.woff2')}
	${face('Fraunces', 'fraunces-italic-latin.woff2', 'italic')}
	${face('Source Sans 3', 'source-sans-3-latin.woff2')}
	* { box-sizing: border-box; margin: 0; }
	body { font-family: 'Source Sans 3', sans-serif; color: #0f2a3f; -webkit-font-smoothing: antialiased; }
	h1, .serif { font-family: 'Fraunces', serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; }
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
await render(resolve(site, 'icon-180.png'), 180, 180, `<img src="${logo}" width="180" height="180">`, 'body { background: transparent; } img { display: block; }')
await render(resolve(docs, 'media/social-preview.png'), 1280, 640, `
	<div class="text">
		<div class="brand"><img src="${logo}" width="52" height="52"><span class="serif">Virtual Office</span></div>
		<h1>See who's around.<br><em>Drop by.</em></h1>
		<p>A small shared office for Nextcloud Teams, groups and Talk conversations.</p>
		<p class="tag">Free and open source · Nextcloud 35</p>
	</div>
	<div class="shot"><img src="${dataUrl(at('stage.png'), 'image/png')}"></div>
	<img class="knock" src="${dataUrl(at('knock-card.png'), 'image/png')}">
`, `
	body {
		width: 1280px; height: 640px; overflow: hidden; position: relative;
		background:
			radial-gradient(560px 360px at 6% 0%, rgb(255 205 164 / .6), transparent 70%),
			radial-gradient(640px 420px at 100% 0%, rgb(185 231 248 / .8), transparent 70%),
			radial-gradient(circle at 1px 1px, rgb(15 42 63 / .09) 1px, transparent 1.6px) 0 0 / 26px 26px,
			#fbf8f3;
	}
	.text { position: absolute; left: 72px; top: 64px; bottom: 60px; width: 600px; display: flex; flex-direction: column; }
	.brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 620; letter-spacing: -.01em; }
	.brand img { border-radius: 13px; box-shadow: 0 8px 18px -8px rgb(11 79 130 / .6); }
	h1 { margin-top: 60px; font-size: 66px; line-height: .98; font-weight: 600; letter-spacing: -.03em; }
	h1 em { font-weight: 500; color: #0b5f96; position: relative; }
	h1 em::after { content: ''; position: absolute; left: 2%; right: 3%; bottom: 2px; height: 11px; border-radius: 9px; background: #f5ad79; opacity: .75; z-index: -1; }
	p { margin-top: 26px; max-width: 470px; font-size: 25px; line-height: 1.35; color: #2a4255; }
	.tag { margin-top: auto; font-size: 18px; font-weight: 700; letter-spacing: .02em; color: #587082; }
	.shot { position: absolute; left: 660px; top: 110px; width: 820px; border-radius: 26px; overflow: hidden; background: #fff; box-shadow: 0 0 0 1px rgb(15 42 63 / .08), 0 40px 80px -30px rgb(12 44 68 / .5); }
	.shot img { display: block; width: 100%; }
	.knock { position: absolute; left: 596px; top: 404px; width: 370px; filter: drop-shadow(0 18px 30px rgb(12 44 68 / .2)); }
`)
await browser.close()
copyFileSync(resolve(docs, 'media/social-preview.png'), resolve(site, 'social.png'))

// The film, rendered by film/render.mjs.
for (const file of ['film.mp4', 'film-poster.jpg']) {
	if (existsSync(resolve(root, 'build/film', file))) {
		copyFileSync(resolve(root, 'build/film', file), resolve(site, file))
	}
}
console.log(`Product page assets in ${site}`)
