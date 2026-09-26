<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Virtual Office: architecture

## Decisions

**PHP is the only authority; no extra service is required.** Admins install one app. A separate realtime server, as used by Whiteboard, is the most common source of setup problems for that app (about a fifth of its issues mention the websocket server). Movement here does not need a stream of positions, so the server can stay a normal Nextcloud app.

**Movement is a timed path, not a stream of positions.** The client plans a path on the grid and sends it once. The server checks that every step is adjacent and walkable, then fixes the timing: 250 ms per cell. Everyone renders the same path from the same times. A walk that arrives late, for example through polling, is replayed from its start with a small delay, so characters never jump.

**Changing direction never speeds a character up.** A new path must start at a cell of the current path that has not been reached yet. The steps up to that cell keep their original deadlines. The client picks a cell about one network round trip ahead; if the server finds it already passed, it answers `PATH_CONFLICT` with the current state and the client retries once.

**Client Push when available, polling otherwise.** After each change the server pushes one small event batch to the people in the room through notify_push custom events (which are not debounced). Each batch carries the room revision. A client applies batches in order and fetches a snapshot on a gap. Without Client Push, clients poll every 1.2 s; unchanged rooms answer with a tiny `changed: false`.

**The office row is the lock.** Every change runs in a transaction that first increments the office's presence revision. That takes the row's write lock on PostgreSQL, MySQL, MariaDB and SQLite, so capacity, ownership and movement for one office are decided one at a time. Unique indexes back this up: one presence per user (`uid_key`) and one per slot (`office_id, slot`).

**Arriving close to people.** A new presence starts on the free cell nearest to one of the people in the zone with the most people, or at the coffee corner in an empty office. A character reaches above its cell and its name tag below and to the sides, so the two cells around everyone count as taken, both here and when the client picks a spot in a zone or at a prop. Reacting together and clinking cups are derived on every client from state everyone already has (same reaction within 1.5 s and at most 3 cells apart; two or more people at the running coffee machine), so they need no extra requests or storage.

**Current state only.** `vo_presence` holds people who are inside now. There is no history table.

## Talk conversations

A conversation office has the audience kind `talk` and the conversation token as its id. Everything goes through public or documented interfaces:

| Need | Interface |
|---|---|
| Is this user a participant? | `OCP\Collaboration\Resources\IProviderManager`: Talk's `room` provider `canAccessResource()`, true for participants added directly or through a group or Team, false for people who only joined a public conversation. The provider is called directly because Server's access cache is only invalidated by Talk for rooms in a collection. |
| Name and type of a conversation | Same provider, `getResourceRichObject()` |
| Follow the conversation | Talk's documented PHP events: `RoomDeletedEvent`, `RoomModifiedEvent` (name), `AttendeesRemovedEvent`, `AttendeeRemovedEvent`, `CallStartedEvent`, `CallEndedEvent`, `CallEndedForEveryoneEvent`, `ParticipantModifiedEvent` (inCall), `SessionLeftRoomEvent` |
| Entry from Talk | `OCA.Talk.registerMessageAction` (Talk's frontend integration API), loaded through `RenderReferenceEvent` on Talk pages |
| Office inside a message | Reference widget with an interactive view (`referenceInteractiveOptIn` in Talk); the office code loads only after the viewer turns it on |
| Keep it at the top | Talk's pin API, called by the person who created the office if they are a moderator |
| Calls | `/call/{token}#direct-call` joins the conversation's call; `/apps/spreed/?callUser={uid}#direct-call` opens Talk's floating one-to-one call on the current page |

The call state (running, since when, which users) is kept in the office row while the call runs and shown only where the office audience equals the conversation's participants: conversation offices and Team offices whose conversation is shared with that Team (checked against the Team participants of the conversation on every read, since Talk's `isSharedWithTeam()` is true for any existing conversation). Talk has no public API to read the current call, so an office created or linked while a call runs reports the call as unknown (`known: false`) and offers "Join or start call" until Talk's next call event.

One-to-one conversations do not get an office. A conversation keeps at most one office; if two participants create it at the same moment, the older one wins.

Talk has no public API for a tab in the conversation sidebar or for status in the conversation header, so the office lives in a pinned message and the message menu instead.

## Data

| Table | Content |
|---|---|
| `vo_offices` | token, audience (kind, id, hashed key), creator, title, decor and Talk link, Talk token, managers, temporary removals, prop and call state, config and presence revisions |
| `vo_presence` | office, slot, user, session, generation, entry time, name, appearance, mode, current path, current reaction, "Today" note, birthday (month and day, when shared), lease and authorization deadlines |
| `vo_desks` | office, desk, owner, when it was claimed, access check deadline |
| `vo_knocks` | office, who knocked on whom, when; deleted on answer or after 30 minutes |
| `vo_roulette` | office, who joined, their most recent partner |
| `vo_watches` | office, who asked to be told about the next arrival, until when; deleted when it fires or expires |

Preferences (character and view choices) and the "Today" note are ordinary per-user app config, which Nextcloud removes with the account. `ExpirePresence` deletes expired notes.

**Knocks.** A knock creates a Nextcloud notification for the person asked. In 10 minutes and Later are POST actions on `/knocks/{id}?answer=…`. Notifications ignores what a POST action returns, so Now is a web link to the office page with `?knock=…&answer=now`, which answers and continues to the call. The answer is a notification for the knocker; Now links both to a one-to-one Talk call (`/apps/spreed/?callUser=…#direct-call`), or to the office without Talk. With Client Push, a `virtualoffice_knock` message goes to that one person only, so an open office shows the knock or answer at once; it never goes through the room's event batch, which everyone inside receives.

**Directory and conversation offices.** Talk has no public PHP API to list a user's conversations. The directory page gets the user's conversation tokens from Talk's own API and sends them with `POST /offices/directory`; the server looks up the offices of those conversations and still checks participation for each. `GET /offices` without tokens checks the 500 most recently updated conversation offices.

**Dashboard and arrivals.** The Dashboard widget starts from the offices with someone inside and the user's desks, then checks membership. It is an `IAPIWidgetV2` with a 60-second reload, so the web Dashboard and the mobile apps render it without app JavaScript. After a new presence is committed, outside the office lock, `WatchService` notifies each watcher who still belongs to the audience and is not inside, and deletes their request.

**Team places.** A Team office asks `OCP\Teams\ITeamManager::getSharedWith()` for the resources shared with its Team, the same list as the Team page, and shows up to 6 on the wall and in the people list. Other offices are left out. Icons given as SVG markup are shown as `<img>` data URLs, so the markup never runs in the page. Deck boards get a badge with the cards due today or overdue, from Deck's `overview/upcoming` API as the viewer; the office's own conversation shows when its call is running. A conversation office links to the offices of the Teams the conversation belongs to (`getTeamsForResource('talk', …)`).

**Focus sessions.** Starting or joining one walks you to your desk, or to the focus desks. A shared 25 or 50 minute session lives in the office's room state (`focus`: start, end, length, members) and changes like props, in the office lock with a `focus` event. Ending a presence takes the person out of it; the last one out ends it, and a session that ran out is dropped when a member leaves; snapshots only list members who are still inside.

**Coffee roulette.** Group offices and offices for everyone offer a weekly roulette. `PairRoulette` runs every 7 days, drops sign-ups of people who left the audience, shuffles the others who are welcome (not removed for a while), avoids each person's most recent partner when possible, and notifies both with a link to a one-to-one Talk call. With an odd number, one person waits. When the audience cannot be checked, nobody is paired that week.

**Temporary removal.** A manager's removal blocks entering and also hides the person's desk (without freeing it) and stops knocks to them, arrival notifications and roulette pairs for that office until it ends (`AccessPolicy::isWelcome`).

**Desks and status.** Desks are the 12 seats listed in the catalog layout. `GET /offices/{token}/desks` returns the owners and the Nextcloud status (`OCP\UserStatus\IManager`) of owners and people inside. Status changes have no event, so clients fetch this list when they enter, a few seconds after someone arrives, when a claim bumps `desksRev` in the room state, and every minute while the page is visible. An owner's membership is re-checked at most once a minute, whoever is looking.

## Lifecycle of a visit

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant N as Nextcloud (PHP)
    participant P as Client Push
    B->>N: enter(session, takeover?)
    N->>N: access check, lock office, capacity, slot
    N-->>B: snapshot + generation
    N->>P: upsert event for everyone inside
    loop every 1.2 s (polling) or 5 s (push)
        B->>N: poll(session, rev)
        N->>N: renew lease, re-check access every 20 s
        N-->>B: changed: false, or a snapshot
    end
    B->>N: move(session, path)
    N->>N: validate path, fix timing
    N-->>B: own trajectory
    N->>P: event batch with new revision
    B->>N: leave (button, or sendBeacon on page close)
~~~

Presence ends when the person leaves, closes the page, another window takes over, a manager removes them, they lose access, or 90 seconds pass without a heartbeat.

One person has at most one character. A second window gets `ACTIVE_ELSEWHERE` and must choose **Continue here**, which increments the generation; the first window then receives `TAKEN_OVER` and stops.

## API

OCS base `/ocs/v2.php/apps/virtualoffice/api/v1`. Every response is `no-store`. Errors carry a stable `code`:

| Code | HTTP | Meaning |
|---|---|---|
| `OFFICE_UNAVAILABLE` | 404 | Missing, or not in the audience (indistinguishable on purpose) |
| `ACTION_DENIED` | 403 | Visible, but not allowed |
| `OFFICE_REMOVED` | 403 | Temporarily removed by a manager |
| `AUTH_REQUIRED` | 401 | Not signed in (beacon) |
| `KNOCK_GONE`, `PERSON_UNAVAILABLE` | 404 | Knock answered or expired; person cannot be knocked on |
| `ACTIVE_ELSEWHERE`, `TAKEN_OVER`, `ROOM_FULL`, `PATH_CONFLICT` | 409 | Room state |
| `DESK_TAKEN`, `KNOCK_PENDING`, `LAST_MANAGER`, `CONFLICT` | 409 | Desk, knock, manager or concurrent change |
| `NOT_PRESENT` | 410 | Lease ran out |
| `REVISION_MISMATCH` | 412 | Stale `If-Match` |
| `REVISION_REQUIRED` | 428 | Missing `If-Match` |
| `INVALID_INPUT`, `OUT_OF_REACH`, `CONVERSATION_NOT_SUPPORTED` | 422 | Input; `INVALID_INPUT` carries a translated message for the form |
| `RATE_LIMITED` | 429 | Too fast |
| `AUDIENCE_UNAVAILABLE` | 503 | Teams or Talk failed; never treated as "not a member" |

Offices: `GET/POST /offices`, `POST /offices/directory`, `GET/PATCH/DELETE /offices/{token}` (PATCH and DELETE need `If-Match`), `/offices/{token}/managers`, `/offices/{token}/removals`, `/offices/{token}/people`, `/offices/{token}/talk-conversations`, `/offices/{token}/resources`, `/offices/{token}/card`, `POST /summaries`, `GET /audiences`.

Conversations: `POST /conversations/{token}/office`, `GET /conversations/{token}/team-offices`.

Room: `POST /offices/{token}/room/{enter,move,stop,emote,interact,mode,profile,focus,focus/leave,leave}`, `GET /offices/{token}/room?session=&rev=`.

Together: `GET /offices/{token}/desks`, `PUT/DELETE /offices/{token}/desks/{deskId}`, `POST /offices/{token}/knocks`, `POST /knocks/{id}?answer=`, `GET/PUT/DELETE /offices/{token}/watch`, `GET/PUT/DELETE /offices/{token}/roulette`.

Preferences: `GET/PUT/DELETE /me/preferences`, `GET/PUT /me/today`. Admin: `GET/PUT /admin/settings`, `GET /admin/offices`.

Pages: `/apps/virtualoffice/`, `/apps/virtualoffice/o/{token}`, `/apps/virtualoffice/o/{token}/talk` (checks access, then redirects to Talk; never joins a call), `/apps/virtualoffice/talk/{conversationToken}` (the door to a conversation's office, opened from the Talk message menu), `POST /apps/virtualoffice/beacon/leave/{token}`.

Push message `virtualoffice_room` with body `{office, rev, serverTime, events}`; events are `upsert` (full participant), `remove`, `prop`, `call`, `config`, `focus`, `desks` and `closed`. `virtualoffice_knock` goes to one person only, with a `knock` or `answer`.

## Shared catalog

`catalog/catalog.json` defines the map (32 × 20 cells, collision, zones, spawn cells, props), characters, reactions, modes and decor. PHP, the frontend bundle and the tests read the same file. Its SHA-256 is compared on entry, so an outdated browser asks to reload instead of using a different map.

## Known limits

- One map. More maps need only catalog entries and artwork, not API changes.
- No guests or federated users. Access follows Nextcloud accounts.
- Talk's message list unmounts messages that scroll far out of view; leaving the view of an interactive office card leaves the office.
- Circles applies web membership changes through a loopback request. If that request fails on an instance, Team removals are delayed until Circles catches up.
