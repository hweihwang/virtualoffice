/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import rawCatalog from '../catalog/catalog.json' with { type: 'json' }

export type Cell = [number, number]

export interface Zone {
	id: string
	rect: [number, number, number, number]
	/** No voice here, like a library. */
	quiet?: boolean
}

export interface Prop {
	id: string
	cell: Cell
	zone: string
	radius: number
	durationMs: number
}

export interface Layout {
	width: number
	height: number
	tileSize: number
	collision: string[]
	/** Most people inside at once; the admin setting can lower it further. */
	capacity: number
	spawn: Cell[]
	zones: Zone[]
	zoneAnchors: Record<string, Cell>
	props: Prop[]
	/** Seats people can claim as their desk. */
	desks?: { id: string, cell: Cell }[]
	/** Wall spots for the Team's shared resources. */
	fixtures?: { id: string, cell: Cell }[]
	/** The shared music player: full volume within radius, silent from hearing on. */
	player?: { cell: Cell, zone: string, radius: number, hearing: number }
}

export interface Palette {
	id: string
	body: string
	belly: string
}

export interface Appearance {
	creature: string
	palette: string
	accessory: string
}

export interface Catalog {
	schemaVersion: number
	defaultLayout: string
	layouts: Record<string, Layout>
	creatures: string[]
	palettes: Palette[]
	accessories: string[]
	emotes: { id: string, durationMs: number }[]
	modes: string[]
	decor: Record<string, { default: string, options: string[] }>
	defaults: { appearance: Appearance }
	movement: { msPerEdge: number, maxPathEdges: number }
	limits: { roomCapacity: number }
}

export const catalog = rawCatalog as unknown as Catalog

export function getLayout(id: string): Layout {
	const layout = catalog.layouts[id]
	if (!layout) {
		throw new Error(`Unknown layout ${id}`)
	}
	return layout
}

export function isWalkable(layout: Layout, cell: Cell): boolean {
	const [x, y] = cell
	return Number.isInteger(x) && Number.isInteger(y)
		&& y >= 0 && y < layout.height && x >= 0 && x < layout.width
		&& layout.collision[y][x] === '.'
}

/**
 * Zone of the cell containing a (possibly fractional) position.
 */
export function zoneAt(layout: Layout, position: Cell): string | null {
	const [x, y] = position
	const cx = Math.round(x)
	const cy = Math.round(y)
	for (const zone of layout.zones) {
		const [zx, zy, w, h] = zone.rect
		if (cx >= zx && cx < zx + w && cy >= zy && cy < zy + h) {
			return zone.id
		}
	}
	return null
}

export function paletteById(id: string): Palette {
	return catalog.palettes.find((p) => p.id === id) ?? catalog.palettes[0]
}
