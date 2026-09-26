<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

## 1.0.0

First release.

Offices

- Offices for Teams and Talk conversations, created by their members, and group offices and offices for everyone, created by admins
- Any participant of a group or public Talk conversation can open its office from the message menu; everyone in the conversation can enter, nobody else
- A conversation office follows its conversation: renamed with it, deleted with it, and people removed from the conversation leave the office at once
- Office cards in Talk and Text show who is inside and whether a call is running, and can be switched to an interactive view to enter and walk around right in the chat
- "Share to chat" posts the office to its Talk conversation, with an option to pin it
- Offices linked to a conversation show when its call is running and who is in it, with Join call and Open chat; call a person from the office in a floating Talk call
- Team offices show what is shared with the Team, such as Deck boards, folders and conversations; Deck boards show how many cards are due today or overdue
- A conversation office links to the office of the Team the conversation belongs to
- Find offices in the Offices list, Unified Search, the Smart Picker, Team pages and a Dashboard widget

Together

- Four creatures, eight colors and four accessories; movement by click, tap, keyboard or an accessible people and places list
- Four reactions, a coffee machine and a shared plant. Two people close by who send the same reaction react together, and people at the running coffee machine clink cups
- New arrivals appear close to the biggest group, or at the coffee corner when the office is empty. People keep a little space between them, so name tags stay readable
- Claim one of 12 desks. It shows your name, and while you are not inside also your Nextcloud status and your note
- A one-line "Today" note, shown with your character and desk until the end of your day
- Knock on someone: "got 2 minutes?". They answer Now, In 10 minutes or Later, and Now opens a one-to-one Talk call
- "Tell me when someone arrives" on an empty office
- Focus together: 25 or 50 minute sessions others can join
- Weekly coffee roulette in group offices and offices for everyone
- A balloon on your birthday, when your profile shares your birth date
- People who are away doze off; do not disturb and busy show on their name tag
- While the office tab is in the background, its title counts arrivals and reactions with you

Administration and privacy

- Opening an office never places you inside; you choose Enter office. One active character per person, with an explicit "Continue here"
- Managers can remove someone from the office for an hour; access is re-checked about every 20 seconds
- Live updates through Client Push when available, otherwise polling, with a setup check
- Admin settings for office size and offices for everyone, and a list of all offices
- No history of visits or movement; `occ virtualoffice:purge` removes all app data
