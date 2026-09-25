/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Appearance } from '../../shared/catalog.ts'

import { paletteById } from '../../shared/catalog.ts'

/**
 * Original creature artwork, generated as SVG so every palette and
 * accessory combination stays crisp. The canvas is 48×56 with the feet at
 * the bottom centre. West is east mirrored by CSS.
 */
export type Facing = 'south' | 'north' | 'east'

const INK = '#173b58'
const EYE = '#16354d'
const EAR_INNER = '#f7b6c2'
const CHEEK = '#f59aa8'
const BIRD_ORANGE = '#f4a24c'
const stroke = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`

function ears(creature: string, facing: Facing, body: string): string {
	switch (creature) {
		case 'rabbit':
			if (facing === 'east') {
				return `<ellipse cx="22" cy="7" rx="4.2" ry="11" transform="rotate(-12 22 7)" fill="${body}" ${stroke}/>`
					+ `<ellipse cx="22" cy="8" rx="2" ry="7.5" transform="rotate(-12 22 8)" fill="${EAR_INNER}"/>`
			}
			return `<ellipse cx="17" cy="7" rx="4.2" ry="11" transform="rotate(-8 17 7)" fill="${body}" ${stroke}/>`
				+ `<ellipse cx="31" cy="7" rx="4.2" ry="11" transform="rotate(8 31 7)" fill="${body}" ${stroke}/>`
				+ (facing === 'south'
					? `<ellipse cx="17" cy="8" rx="2" ry="7.5" transform="rotate(-8 17 8)" fill="${EAR_INNER}"/><ellipse cx="31" cy="8" rx="2" ry="7.5" transform="rotate(8 31 8)" fill="${EAR_INNER}"/>`
					: '')
		case 'cat':
			if (facing === 'east') {
				return `<path d="M17 14 L20 3 L28 11 Z" fill="${body}" ${stroke}/><path d="M19.5 11 L21 6 L25 10 Z" fill="${EAR_INNER}"/>`
			}
			return `<path d="M10 15 L12 3 L21 10 Z" fill="${body}" ${stroke}/><path d="M38 15 L36 3 L27 10 Z" fill="${body}" ${stroke}/>`
				+ (facing === 'south' ? `<path d="M13 12 L14 7 L18 10 Z" fill="${EAR_INNER}"/><path d="M35 12 L34 7 L30 10 Z" fill="${EAR_INNER}"/>` : '')
		case 'bear':
			if (facing === 'east') {
				return `<circle cx="19" cy="10" r="5.5" fill="${body}" ${stroke}/><circle cx="19" cy="10" r="2.6" fill="${EAR_INNER}"/>`
			}
			return `<circle cx="12" cy="11" r="5.5" fill="${body}" ${stroke}/><circle cx="36" cy="11" r="5.5" fill="${body}" ${stroke}/>`
				+ (facing === 'south' ? `<circle cx="12" cy="11" r="2.6" fill="${EAR_INNER}"/><circle cx="36" cy="11" r="2.6" fill="${EAR_INNER}"/>` : '')
		case 'bird':
			return facing === 'east'
				? `<path d="M22 8 C22 3 27 2 28 5 C25 5 24 7 24 9 Z" fill="${body}" ${stroke}/>`
				: `<path d="M22 8 C21 2 27 1 28 4 C25 4 25 6 26 9 Z" fill="${body}" ${stroke}/>`
	}
	return ''
}

function face(creature: string, facing: Facing, belly: string): string {
	if (facing === 'north') {
		return ''
	}
	const eye = (x: number) => `<ellipse cx="${x}" cy="21" rx="2" ry="2.4" fill="${EYE}"/><circle cx="${x + 0.7}" cy="20.2" r="0.7" fill="#fff"/>`
	if (facing === 'east') {
		let snout: string
		if (creature === 'bird') {
			snout = `<path d="M36 22 L42 24 L36 26 Z" fill="${BIRD_ORANGE}" ${stroke}/>`
		} else if (creature === 'bear') {
			snout = `<ellipse cx="35" cy="25" rx="5" ry="3.8" fill="${belly}" ${stroke}/><circle cx="38.5" cy="24" r="1.3" fill="${EYE}"/>`
		} else {
			snout = `<circle cx="37.6" cy="24" r="1.1" fill="${EYE}"/>`
		}
		return eye(31) + `<ellipse cx="29" cy="26" rx="2.6" ry="1.6" fill="${CHEEK}" opacity=".65"/>` + snout
	}
	let muzzle = `<path d="M22 26 Q23 27.3 24 26 Q25 27.3 26 26" fill="none" stroke="${EYE}" stroke-width="1.2" stroke-linecap="round"/>`
	if (creature === 'bear') {
		muzzle = `<ellipse cx="24" cy="26" rx="5.5" ry="4" fill="${belly}" ${stroke}/><ellipse cx="24" cy="24.8" rx="1.8" ry="1.2" fill="${EYE}"/>`
			+ `<path d="M22.4 27.2 Q24 28.4 25.6 27.2" fill="none" stroke="${EYE}" stroke-width="1.1" stroke-linecap="round"/>`
	} else if (creature === 'bird') {
		muzzle = `<path d="M21 24.5 L24 29 L27 24.5 Z" fill="${BIRD_ORANGE}" ${stroke}/>`
	} else if (creature === 'cat') {
		muzzle = `<path d="M23 24.6 L25 24.6 L24 25.8 Z" fill="${EYE}"/>` + muzzle
			+ `<path d="M13 24 L18 25 M13 27 L18 26.4 M35 24 L30 25 M35 27 L30 26.4" stroke="${INK}" stroke-width=".9" stroke-linecap="round"/>`
	}
	return eye(18.5) + eye(29.5)
		+ `<ellipse cx="14.5" cy="26" rx="2.8" ry="1.7" fill="${CHEEK}" opacity=".65"/><ellipse cx="33.5" cy="26" rx="2.8" ry="1.7" fill="${CHEEK}" opacity=".65"/>`
		+ muzzle
}

function tail(creature: string, facing: Facing, body: string, belly: string): string {
	if (facing === 'south') {
		return ''
	}
	const x = facing === 'east' ? 12 : 24
	switch (creature) {
		case 'rabbit':
			return `<circle cx="${x}" cy="43" r="4.5" fill="${belly}" ${stroke}/>`
		case 'cat':
			return facing === 'east'
				? `<path d="M14 44 C6 44 5 36 9 33" fill="none" stroke="${INK}" stroke-width="5.4" stroke-linecap="round"/><path d="M14 44 C6 44 5 36 9 33" fill="none" stroke="${body}" stroke-width="3" stroke-linecap="round"/>`
				: `<path d="M24 46 C24 52 32 51 33 45" fill="none" stroke="${INK}" stroke-width="5.4" stroke-linecap="round"/><path d="M24 46 C24 52 32 51 33 45" fill="none" stroke="${body}" stroke-width="3" stroke-linecap="round"/>`
		case 'bear':
			return `<circle cx="${x}" cy="44" r="3.2" fill="${body}" ${stroke}/>`
		case 'bird':
			return `<path d="M${x - 5} 43 L${x} 50 L${x + 5} 43 Z" fill="${body}" ${stroke}/>`
	}
	return ''
}

function arms(creature: string, facing: Facing, body: string): string {
	if (creature === 'bird') {
		return facing === 'east'
			? `<ellipse cx="21" cy="40" rx="6" ry="4" transform="rotate(20 21 40)" fill="${body}" ${stroke}/>`
			: `<ellipse cx="12.5" cy="40" rx="3.4" ry="5.5" transform="rotate(20 12.5 40)" fill="${body}" ${stroke}/><ellipse cx="35.5" cy="40" rx="3.4" ry="5.5" transform="rotate(-20 35.5 40)" fill="${body}" ${stroke}/>`
	}
	return facing === 'east'
		? `<ellipse cx="26" cy="41" rx="3" ry="4" fill="${body}" ${stroke}/>`
		: `<ellipse cx="13.5" cy="41" rx="3" ry="4" fill="${body}" ${stroke}/><ellipse cx="34.5" cy="41" rx="3" ry="4" fill="${body}" ${stroke}/>`
}

function jacket(facing: Facing): string {
	if (facing === 'north') {
		return `<path d="M14 37 Q24 33 34 37 L33 47 Q24 53 15 47 Z" fill="#0879bd" ${stroke}/>`
			+ '<path d="M18 37 Q24 40 30 37" fill="none" stroke="#85d6f1" stroke-width="1.5"/>'
	}
	if (facing === 'east') {
		return `<path d="M17 37 Q25 33 32 37 L33 47 Q25 52 18 47 Z" fill="#0082c9" ${stroke}/>`
			+ '<path d="M25 38v10 M19 47q7 4 13 0" fill="none" stroke="#88d9f3" stroke-width="1.3"/>'
	}
	return `<path d="M14 37 Q24 33 34 37 L33 47 Q24 53 15 47 Z" fill="#0082c9" ${stroke}/>`
		+ '<path d="M24 38v11 M16 47q8 6 16 0" fill="none" stroke="#89d9f3" stroke-width="1.3"/>'
		+ '<path d="M20.5 43h7" stroke="#fff" stroke-width="1"/>'
		+ '<circle cx="19.5" cy="43" r="1.4" fill="#fff"/><circle cx="24" cy="43" r="2" fill="#fff"/><circle cx="28.5" cy="43" r="1.4" fill="#fff"/>'
}

function accessory(id: string, facing: Facing): string {
	switch (id) {
		case 'scarf':
			return `<path d="M13 33 Q24 38 35 33 L35 36.5 Q24 41 13 36.5 Z" fill="#e0565b" ${stroke}/>`
				+ (facing === 'north' ? '' : `<path d="M${facing === 'east' ? 20 : 28} 36 l3 7 l3 -1 l-2 -7 Z" fill="#e0565b" ${stroke}/>`)
		case 'glasses':
			if (facing === 'north') {
				return `<path d="M9 20 L39 20" stroke="${INK}" stroke-width="1.4"/>`
			}
			return facing === 'east'
				? `<circle cx="31" cy="21" r="4.2" fill="#ffffff55" stroke="${INK}" stroke-width="1.4"/><path d="M27 21 L18 19" stroke="${INK}" stroke-width="1.4"/>`
				: `<circle cx="18.5" cy="21" r="4.2" fill="#ffffff55" stroke="${INK}" stroke-width="1.4"/><circle cx="29.5" cy="21" r="4.2" fill="#ffffff55" stroke="${INK}" stroke-width="1.4"/><path d="M22.7 21 L25.3 21" stroke="${INK}" stroke-width="1.4"/>`
		case 'flower': {
			const x = facing === 'east' ? 18 : 34
			const petals = [0, 72, 144, 216, 288].map((a) => `<circle cx="${x + 3 * Math.cos(a * Math.PI / 180)}" cy="${11 + 3 * Math.sin(a * Math.PI / 180)}" r="2.3" fill="#ff8fab" stroke="${INK}" stroke-width=".8"/>`).join('')
			return petals + `<circle cx="${x}" cy="11" r="1.8" fill="#ffd166" stroke="${INK}" stroke-width=".8"/>`
		}
		case 'beanie':
			return `<path d="M10 16 Q10 4 24 4 Q38 4 38 16 Z" fill="#086da9" ${stroke}/><rect x="9" y="14" width="30" height="4.5" rx="2.2" fill="#72c7eb" ${stroke}/><circle cx="24" cy="3.5" r="3" fill="#ffffff" ${stroke}/>`
	}
	return ''
}

export function creatureSvg(appearance: Appearance, facing: Facing): string {
	const { body, belly } = paletteById(appearance.palette)
	const creature = appearance.creature
	const feet = creature === 'bird' ? BIRD_ORANGE : body
	const hx = facing === 'east' ? 26 : 24
	const bellyShape = facing === 'south'
		? `<ellipse cx="24" cy="42" rx="6.5" ry="5.5" fill="${belly}"/>`
		: facing === 'east' ? `<ellipse cx="28" cy="42" rx="4" ry="5" fill="${belly}"/>` : ''
	return '<svg class="vo-creature" viewBox="0 0 48 56" width="48" height="56" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">'
		+ `<g class="vo-feet"><ellipse class="vo-foot vo-foot-l" cx="${facing === 'east' ? 20 : 18}" cy="51" rx="5" ry="3.2" fill="${feet}" ${stroke}/>`
		+ `<ellipse class="vo-foot vo-foot-r" cx="${facing === 'east' ? 29 : 30}" cy="51" rx="5" ry="3.2" fill="${feet}" ${stroke}/></g>`
		+ tail(creature, facing, body, belly)
		+ `<g class="vo-body"><ellipse cx="24" cy="41" rx="11" ry="9.5" fill="${body}" ${stroke}/>${bellyShape}${jacket(facing)}${arms(creature, facing, body)}`
		+ ears(creature, facing, body)
		+ `<circle cx="${hx}" cy="21" r="14.5" fill="${body}" ${stroke}/>`
		+ `<ellipse cx="${facing === 'east' ? 22 : 18}" cy="14" rx="7" ry="4.8" fill="#fff" opacity=".16"/>`
		+ face(creature, facing, belly)
		+ accessory(appearance.accessory, facing)
		+ '</g></svg>'
}
