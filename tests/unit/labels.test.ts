/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest'
import { catalog } from '../../shared/catalog.ts'
import { accessoryLabel, creatureLabel, decorLabel, layoutLabel, paletteLabel, propLabel, zoneLabel } from '../../src/labels.ts'

describe('labels', () => {
	// A missing label shows the raw catalog id to people.
	it('name everything the catalog offers', () => {
		const missing: string[] = []
		const check = (id: string, label: string) => label === id && missing.push(id)
		catalog.creatures.forEach((id) => check(id, creatureLabel(id)))
		catalog.palettes.forEach(({ id }) => check(id, paletteLabel(id)))
		catalog.accessories.forEach((id) => check(id, accessoryLabel(id)))
		for (const [slot, definition] of Object.entries(catalog.decor)) {
			check(slot, decorLabel(slot))
			definition.options.forEach((option) => check(option, decorLabel(slot, option)))
		}
		for (const [id, layout] of Object.entries(catalog.layouts)) {
			check(id, layoutLabel(id))
			layout.zones.forEach((zone) => check(zone.id, zoneLabel(zone.id)))
			layout.props.forEach((prop) => check(prop.id, propLabel(prop.id)))
		}
		expect(missing).toEqual([])
	})
})
