/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { recommended } from '@nextcloud/eslint-config'

export default [
	...recommended,
	{
		ignores: ['js/', 'css/', 'vendor/', 'build/', 'test-results/'],
	},
	{
		// Types document parameters; JSDoc is used where behaviour needs explaining.
		rules: {
			'jsdoc/require-jsdoc': 'off',
			'jsdoc/require-param': 'off',
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-returns': 'off',
		},
	},
]
