<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Virtual Office

**See who's around, right inside Talk.**

Give a Talk group conversation its own little office. Open it from a message, see who's there, and enter as a character without leaving the chat. Walk over, wave, or make coffee. Open the full office when you want to join the call.

[Get the app](https://apps.nextcloud.com/apps/virtualoffice) · [Watch the 24-second demo](https://hweihwang.github.io/virtualoffice/#demo-title) · [Admin guide](docs/admin.md)

![An interactive office inside a Talk conversation](docs/screenshots/talk.png)

Offices also work for Teams, groups, and the whole organization when an admin enables it. Only members can enter a Team, group, or conversation office. Opening a link never puts you in the room; you choose **Enter office**.

- **Meet naturally.** See who's here, move around, react together, or ask a colleague “got 2 minutes?” before a call.
- **Spend a little time together.** Make coffee, join a 25 or 50 minute focus session, or sign up for weekly coffee roulette in group and organization offices.
- **Use it where you already are.** Open an office from Talk, Team pages, search, or the Dashboard. Team rooms show shared boards, folders, and conversations.
- **Make it yours.** Pick a rabbit, cat, bear, or bird, then choose a colour and accessory. Claim a desk and leave a short “Today” note.

![Three colleagues in The Studio office](docs/screenshots/office.png)

Virtual Office does not keep a history of visits or movement. Desks, notes, knocks, and other optional features keep only the data they need. The [admin guide](docs/admin.md) explains what is stored and when it is removed.

## Requirements

- Nextcloud 35
- Optional: Teams (Circles) for Team offices, Talk 25 for conversation offices and calls, Deck for due cards on Team boards
- Optional: Client Push (notify_push) for faster updates

The app works without an extra service. Without Client Push, browsers check for changes about once a second. See the [admin guide](docs/admin.md) for setup and measured performance.

## Using it

1. Install Virtual Office from the [Nextcloud App Store](https://apps.nextcloud.com/apps/virtualoffice), then open **Office** from the app menu.
2. Create an office for one of your Teams or groups, or open one from a Talk conversation.
3. Choose your character and select **Enter office**.
4. Click or tap a spot to walk there. You can also use the keyboard or the accessible people and places list.
5. Select **Leave** when you are done. Closing the page also leaves the office.

With the map focused, arrow keys or W A S D move, **Enter** uses a nearby coffee machine or plant, and **1** to **4** react.

## Development

~~~sh
npm ci && composer install
npm run build            # frontend into js/
tests/fixture/setup.sh push   # Nextcloud 35 + PostgreSQL + Talk + Client Push on http://localhost:18935
~~~

| Check | Command |
|---|---|
| PHP unit tests | `composer test:unit` |
| PHP static analysis | `composer psalm` |
| PHP code style | `composer cs:check` |
| JS unit tests | `npm run test:unit` |
| Types and lint | `npm run typecheck && npm run lint` |
| API and browser end-to-end | `npm run test:e2e` (use `VO_TRANSPORT=polling` after `tests/fixture/setup.sh polling`) |
| Load | `npm run test:load -- --people 32 --seconds 60 --mode push` |
| Release archive | `npm run package` |

The architecture and the reasons behind it are in the [developer guide](https://github.com/hweihwang/virtualoffice/blob/main/docs/architecture.md). Release instructions are in [docs/releasing.md](https://github.com/hweihwang/virtualoffice/blob/main/docs/releasing.md).

## License

AGPL-3.0-or-later. Bundled libraries keep their own licenses, listed next to each file in `js/*.license`, with texts in `LICENSES/`. The icons and interactive scene are original SVG artwork from `img/` and `src/scene/`. The office preview in `img/office-preview.webp` was created with Codex image generation and optimized for the app; its source PNG is in `art/office-preview-source.png`.
