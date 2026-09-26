/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest'
import { catalog, getLayout } from '../../shared/catalog.ts'
import { mapSvg } from '../../src/scene/map.ts'
import { creatureSvg } from '../../src/scene/sprites.ts'

describe('office artwork', () => {
	it('renders every catalog appearance in each direction', () => {
		for (const creature of catalog.creatures) {
			for (const palette of catalog.palettes) {
				for (const accessory of catalog.accessories) {
					for (const facing of ['south', 'north', 'east'] as const) {
						const svg = creatureSvg({ creature, palette: palette.id, accessory }, facing)
						expect(svg).toContain('viewBox="0 0 48 56"')
						expect(svg).toContain(palette.body)
						expect(svg).not.toContain('undefined')
						expect(svg).toContain('aria-hidden="true"')
					}
				}
			}
		}
	})

	it('keeps the map dimensions and decor options intact', () => {
		const layout = getLayout(catalog.defaultLayout)
		for (const floor of catalog.decor.floor.options) {
			for (const rug of catalog.decor.rug.options) {
				const svg = mapSvg(layout, { floor, rug, wallArt: 'abstract', lights: 'warm' })
				expect(svg).toContain(`viewBox="0 0 ${layout.width * layout.tileSize} ${layout.height * layout.tileSize}"`)
				expect(svg).toContain('#0082c9')
				expect(svg).not.toContain('undefined')
			}
		}
	})
})
