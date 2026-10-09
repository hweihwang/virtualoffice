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
| `vo_offices` | token, audience (kind, id, hashed key), creator, title, layout, decor and Talk link, Talk token, managers, temporary removals, prop, call, focus and music state, config and presence revisions |
| `vo_presence` | office, slot, user, session, generation, entry time, name, appearance, mode, current path, current reaction, "Today" note, birthday (month and day, when shared), whether voice is on, lease and authorization deadlines |
| `vo_signals` | office, receiving and sending tab, one WebRTC offer, answer or goodbye, when; deleted when read, when either presence ends, or after 30 seconds |
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

**Desks and status.** Desks are the seats listed in the catalog layout: 12 in the large office, 6 in the small one. `GET /offices/{token}/desks` returns the owners and the Nextcloud status (`OCP\UserStatus\IManager`), time zone and working hours of owners and people inside. Status changes have no event, so clients fetch this list when they enter, a few seconds after someone arrives, when a claim bumps `desksRev` in the room state, and every minute while the page is visible. An owner's membership is re-checked at most once a minute, whoever is looking.

**Layouts.** An office has one of the catalog layouts: `starter-office-v1` (32 × 20 cells, 32 people, 12 desks) or `compact-office-v1` (22 × 14 cells, 12 people, 6 desks). Both use the same zone, prop and desk ids, so code that names `coffee`, `focus` or `d1` works on either. The people an office holds are the admin setting, at most the layout's `capacity`. A manager changes the layout only while nobody is inside, in the office lock: paths are stored as cells, so people inside would end up in walls. The change frees desk claims the new layout does not have and drops prop and music state. A browser whose snapshot names another layout asks to reload, like an outdated catalog.

**Music.** Each layout has a record player (`player` in the catalog: cell, zone, radius, hearing). Someone standing within its radius plays up to 10 of their own audio files: `room_state.music` holds who started it, when, and the tracks (file id, title, length as their browser measured it, kept between 1 second and 30 minutes). Snapshots and the `music` event leave out the file ids. The playlist loops: every browser computes the track and position from `serverNow() - startedAt`, plus its audio output latency.

Two windows in one room must not sound like an echo, which people hear from about 30 ms apart, so the sync is tighter than the plan's 0.75 s. Each track starts streaming at once and downloads alongside; once it is in memory, playback moves to that copy, because seeks over the network land late (in Safari by about 300 ms, with stalls in between). A browser seeks when it is more than 60 ms off, at most every 2 seconds, and learns how late its seeks land to aim that much ahead. Changing the playback speed instead would be smoother, but Safari then reports positions hundreds of milliseconds off. The volume is set on the element; only where that is ignored (iOS) the element goes through the shared `AudioContext`, since a routed element stalls in Safari on macOS. Chromium, Firefox and WebKit stay within about 20 ms of each other in `tests/e2e/room.spec.ts`; `tests/safari/music-sync.mjs` checks Safari itself against Chromium. `MusicLibrary` accepts files the person can read, with an `audio/*` type, up to 50 MB, and not from a share without download permission. The files stream through `GET /apps/virtualoffice/o/{token}/music/{index}`, a plain page route so `<audio>` can use it, with one byte range for seeking. Every request checks again that the caller is inside, that the music still plays, that the person who started it is still inside and may still read the file; anything else answers 404. When that person's presence ends, the music stops. The volume is the person's music volume times a falloff from full within the radius to silent at the hearing distance; out of hearing the element stops and drops its source, so people at the desks download nothing. The office card inside Talk stays silent.

**Time zones and working hours.** `TimeService` reads the time zone from Personal settings › Locale (`core/timezone`) directly: `IDateTimeZone::getTimeZone($timestamp, $userId)` falls back to the caller's session for other users. Working hours come from Personal settings › Availability, the `{urn:ietf:params:xml:ns:caldav}calendar-availability` property of `calendars/{uid}/inbox`, read like dav's `UserStatusAutomation` and parsed with Sabre VObject; Nextcloud has no public API for them. Without hours, Monday to Friday 09:00 to 17:00 counts. Members of an office see the time zone and hours of people inside and desk owners, like their status; Contacts and Talk show local times without asking too. Browsers compute local times and the hours shared today with `Intl` only. The coffee roulette pairs each person, in shuffled order, with whoever shares the most working minutes in the coming week, compared in UTC, still avoiding the last partner. Birthdays count on the person's own date.

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

Room: `POST /offices/{token}/room/{enter,move,stop,emote,interact,mode,profile,focus,focus/leave,music,music/stop,voice,signal,leave}`, `GET /offices/{token}/room?session=&rev=` (with voice on, also the signals waiting for this tab).

Together: `GET /offices/{token}/desks`, `PUT/DELETE /offices/{token}/desks/{deskId}`, `POST /offices/{token}/knocks`, `POST /knocks/{id}?answer=`, `GET/PUT/DELETE /offices/{token}/watch`, `GET/PUT/DELETE /offices/{token}/roulette`.

Preferences: `GET/PUT/DELETE /me/preferences`, `GET/PUT /me/today`. Admin: `GET/PUT /admin/settings`, `GET /admin/offices`.

Pages: `/apps/virtualoffice/`, `/apps/virtualoffice/o/{token}`, `/apps/virtualoffice/o/{token}/music/{index}` (the music, for people inside), `/apps/virtualoffice/o/{token}/talk` (checks access, then redirects to Talk; never joins a call), `/apps/virtualoffice/talk/{conversationToken}` (the door to a conversation's office, opened from the Talk message menu), `POST /apps/virtualoffice/beacon/leave/{token}`.

Push message `virtualoffice_room` with body `{office, rev, serverTime, events}`; events are `upsert` (full participant), `remove`, `prop`, `call`, `config`, `focus`, `music`, `desks` and `closed`. `virtualoffice_knock` goes to one person only, with a `knock` or `answer`. `virtualoffice_signal` goes to one person only, with `{office, id, to, from, body}`.

## Voice

Voice is peer-to-peer WebRTC; PHP only passes the signals. Audio goes from browser to browser, or through Talk's TURN server, encrypted with DTLS-SRTP, and never reaches PHP. Nothing is recorded. The microphone opens only in the click that turns voice on, and closes, with the browser's indicator, when voice turns off, the visit ends, or the person joins a Talk call from the office.

**Who hears whom.** Each browser decides from the paths everyone already has, 4 times a second. Two people connect when both have voice on, are open to chat and stand in the same zone, unless it is a `quiet` zone (the Focus desks), and are at most 5 cells apart. They stay connected up to 7 cells, so walking back and forth does not reconnect, and each person keeps the 6 nearest. The tab with the smaller session id sends the offer. The speaker's browser sends the microphone only to peers within 5 cells and sends nothing to the others (`replaceTrack(null)`), so a modified client cannot pull in voices from afar. Push to talk (hold V or the Talk button) is the default; an open mic mutes with M.

**Signals.** `POST /room/voice` turns voice on for the tab and shows its session as `voice` in the participant. `POST /room/signal {session, to, body}` checks that the admin allows voice, that both tabs are inside with voice on, that the body is an `offer`, `answer` or `bye` with only an SDP, and at most 16 KB. The server stores the signal in `vo_signals` and pushes `virtualoffice_signal` to the receiver; every tab of a person gets custom messages, so `to` names the tab. The next poll of that tab returns the stored signals and deletes them, and browsers skip ids they already had by push. Signals therefore arrive with Client Push, with polling, and after a dropped websocket. While someone close by is not connected yet, a browser without working pushes polls every 300 ms, for at most 15 seconds per person.

**No trickle ICE.** Client Push drops messages sent in a burst: each person has a channel for 4. Each side therefore gathers its candidates and sends one SDP: when gathering completes, or 150 ms after the TURN server gave a relay candidate (without TURN: the own address and the STUN answer), at most 2 seconds later. Machines with several network interfaces often never report "complete", because STUN requests on interfaces without a route never get an answer, and networks that only let TURN through never answer STUN at all. An offer without an answer after 6 seconds is sent again. Measured on the fixture: connected after about 0.85 s with Client Push, 1.4 to 2.9 s with polling, and 1.4 s through TURN alone.

**ICE servers.** Each time voice turns on, the browser asks Talk's documented `GET /ocs/v2.php/apps/spreed/api/v3/signaling/settings` for its STUN and TURN servers; TURN credentials are valid for a day. Without Talk, or when Talk refuses, voice uses `stun:stun.nextcloud.com:443`, Talk's default.

**Playback.** Each remote stream goes to a muted `<audio>` element, which keeps Chrome decoding it (crbug 933677), and through the shared `AudioContext`: gain (full within 2 cells, silent at 5), stereo panning by where the person stands, and an analyser that shows a ring under whoever speaks.

## Shared catalog

`catalog/catalog.json` defines the maps (cells, collision, zones, spawn cells, props, desks, wall spots and the music player for each layout), characters, reactions, modes and decor. PHP, the frontend bundle and the tests read the same file. Its SHA-256 is compared on entry, so an outdated browser asks to reload instead of using a different map.

## Known limits

- Two maps. More need only catalog entries and artwork, not API changes; changing an office's map waits until nobody is inside.
- Voice connects each person directly to at most 6 others, which suits a small group, not a crowd. Networks that block UDP need a TURN server in Talk. Safari lets one page use the microphone at a time.
- Music plays files people own or may download; the length comes from the browser that starts it, so a file it reads wrongly plays with gaps or cut short.
- Working hours are read from a dav property without a public API; a Nextcloud version that changes it needs an update of the app.
- No guests or federated users. Access follows Nextcloud accounts.
- Talk's message list unmounts messages that scroll far out of view; leaving the view of an interactive office card leaves the office.
- Circles applies web membership changes through a loopback request. If that request fails on an instance, Team removals are delayed until Circles catches up.
