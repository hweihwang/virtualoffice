<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Virtual Office: administration

## Install

Install and enable the app from the App Store. There is nothing else to set up; offices work right away.

Team offices need the Teams app (Circles). Group offices work without it. Conversation offices and call features need Talk; they are tested with Talk 25.

## Client Push

Virtual Office uses [Client Push](https://github.com/nextcloud/notify_push) when it is installed and configured. The setup check in *Administration settings › Overview* shows which mode is active.

| | Without Client Push | With Client Push |
|---|---|---|
| Others see a walk, reaction or coffee | within about 1.5 s (0.7 s on average), played from its start | after about 0.1 s |
| Requests from a full office (32 people) | about 32 per second | about 13 per second |
| Nextcloud CPU for a full office | about 0.35 of a core | about 0.13 of a core |

Measured with `tests/load/room-load.mjs` on the test fixture (Nextcloud 35, PHP 8.5, PostgreSQL 16, Apache, 10 CPU cores, Docker on macOS), 32 signed-in people each walking every 5 seconds, request latency p95 below 30 ms. Your numbers depend on your hardware; run the load script against a staging copy to measure them.

Browsers detect when pushes stop arriving and switch back to polling on their own.

## Settings

*Administration settings › Virtual Office*:

- **People per office**: 2 to 32. Lowering it never takes anyone out; it only stops new people from entering a full office.
- **Offices for everyone**: lets admins create offices every account can enter. Off by default. Turning it off keeps these offices, but nobody can open them until it is on again.
- **All offices**: every office with who it is for and how many people are inside. Offices where no manager has access anymore are marked **No manager**. Open one to add a manager or delete it.

## Who can do what

| Action | Who |
|---|---|
| Find, open and enter an office | Current members of its Team or group, or participants of its Talk conversation (every account for offices for everyone) |
| Create a Team office | Any member of that Team; they become its manager |
| Open a conversation office | Any participant of a group or public Talk conversation; the first one becomes its manager |
| Create a group office or an office for everyone | Admins, who choose the first manager |
| Change name, decor, Talk link, managers | Managers who still have access, and admins. A conversation office keeps the conversation's name and link |
| Remove someone from the office for an hour | Same as above; managers cannot remove other managers |
| Delete an office | Same as above |

Admins can manage every office but only enter offices they have access to. People without access get the same answer as for an office that does not exist.

Access is checked when someone opens or enters an office, and again about every 20 seconds while they are inside. Leaving a group or Talk conversation, being disabled or being deleted ends their presence immediately. Leaving a Team ends it within about 20 seconds while anyone is in or viewing the office; otherwise the background job does it within 5 minutes, and office cards stop showing them after at most 40 seconds.

People add the **Virtual Office** Dashboard widget with **Customize** on the Dashboard. To show it to everyone by default, add `virtualoffice` to the default layout, for example `occ config:app:set dashboard layout --value="recommendations,spreed,virtualoffice,mail,calendar"`.

When Talk or Teams is disabled, admins can still list, edit and delete offices of that kind, but nobody can open or enter them until the app is back.

## Privacy

- Nothing about past visits is stored: no join or leave log, no history of positions or reactions.
- The database holds the current presence of people who are inside right now: when they entered, where they are walking and their last reaction. It is hidden when they leave, close the page or stop sending heartbeats for 90 seconds, and deleted within 5 minutes at the latest.
- Each office stores who created it, its managers, and who a manager removed for a while and until when. Expired removals are cleared the next time a manager removes someone. Deleting an account removes the person from all three.
- While a Talk call runs, the office stores who is in it, and clears the list when the call ends. A focus session stores who joined; the list is deleted when the session ends and its members leave.
- A claimed desk stores who owns which desk and since when. While the owner is not inside, members see their name, their Nextcloud status as the status menu shows it (nothing for invisible or offline people) and their "Today" note. Owners who lose access lose the desk within a minute of someone looking; deleted accounts lose it at once.
- "Tell me when someone arrives" stores who asked for which office until the next arrival or the end of their day. The notification shows only while the person who arrived is still inside.
- A knock ("got 2 minutes?") is stored only until it is answered or for 30 minutes, then deleted with its notification. The answer is a notification that disappears after 30 minutes.
- Coffee roulette stores who joined in which group office or office for everyone, and only each person's most recent partner, to avoid the same pair twice in a row. Leaving the roulette or deleting the account removes the entry at once; leaving the group removes it at the next weekly pairing. Pairing notifications show for 7 days.
- Birthdays come from the profile's birth date, only when it is shared beyond "Private". Only month and day are used, shown on the day by the server's date.
- The "Today" note is per-user app config. It is hidden at the end of the person's day, 24 hours at the latest, and deleted by the background job within 5 minutes after that.
- Knocks, answers, arrivals and roulette pairs are ordinary Nextcloud notifications. Arrival notifications disappear after 30 minutes.
- Office cards in Talk and Text are cached by Nextcloud for up to an hour. The cached part only says "Virtual Office"; the name and people count are fetched for each viewer and only shown to members.
- As with any Nextcloud request, your web server and database may write their own logs and backups. Their retention is up to you.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Movement appears with a delay of about a second | Client Push is not active. Check the setup check and `occ notify_push:self-test`. |
| An office says Teams or Talk is not available | The Teams or Talk app is disabled or failing. Group offices keep working. |
| Removing someone from a Team takes effect only after minutes | Circles applies web changes through a loopback request to your own server. Run `occ circles:check` and fix the loopback address. |
| "Virtual Office was updated. Reload the page" | The browser still runs an older version. Reloading fixes it. |
| "This Talk conversation is not available" | The conversation is no longer shared with the Team, or Talk is disabled for the user. |

## Upgrade and uninstall

Upgrades need no special steps. People inside an office during the upgrade may be asked to reload.

Disabling the app keeps all offices. To delete the contents of every app table, setting, preference, and Virtual Office notification before removing the app, run:

~~~sh
occ virtualoffice:purge --force
~~~

The empty tables stay in the database, as with other Nextcloud apps.

## Background jobs

Use system cron so these run on time. With AJAX or Webcron they run only when people use Nextcloud.

- `ExpirePresence` runs every 5 minutes. It removes presences whose heartbeats stopped while nobody else was in the office, re-checks access of people inside offices nobody is viewing, and deletes unanswered knocks, expired arrival requests and expired "Today" notes. Normal cleanup happens during requests; the job catches the rest.
- `PairRoulette` runs every 7 days and pairs the people who joined coffee roulette.
