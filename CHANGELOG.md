<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Changelog

## 1.2.0

- New arrivals appear next to the biggest group, or at the coffee corner when the office is empty
- Two people close by who send the same reaction within 1.5 s react together: a high five, a shared heart, a shared laugh or shared confetti, also announced for screen readers
- Two or more people at the running coffee machine clink cups
- While the office tab is in the background, its title counts arrivals and reactions with you, for example "(2) Studio"
- "Share to chat" posts the office to its Talk conversation, where it shows as a live card
- The office list shows Team offices first, then conversation, group and organization offices
- Claim one of 12 desks. While you are not inside, your desk shows your name, your Nextcloud status (such as "In a meeting" from your calendar) and your note
- A one-line "Today" note, shown with your character and desk until the end of your day
- Knock on someone inside or at their desk: "got 2 minutes?". They answer Now, In 10 minutes or Later from the notification or the office, and Now opens a one-to-one Talk call for both
- Team offices show what is shared with the Team, such as Deck boards, folders and conversations, on the wall and in the people list; Deck boards show how many cards are due today
- A conversation office links to the office of the Team the conversation belongs to
- A Dashboard widget shows who is in your offices, busiest first, then offices where you have a desk
- "Tell me when someone arrives" on an empty office sends one notification when the next person comes in, until the end of your day
- Focus together: start a 25 or 50 minute session, others can join, and members get a timer badge and a "done" message
- Coffee roulette in group and organization offices: people who join are paired once a week for a short chat
- A balloon on your character and desk on your birthday, when your profile shares your birth date
- People inside whose Nextcloud status is away doze off; do not disturb and busy show on their name tag

Fixed

- People already inside are no longer announced as arriving when you enter
- Someone a manager removed for a while gets no knocks, arrival notifications or roulette pairs meanwhile, and their desk is hidden until they are back
- "Now" in a knock notification opens the call for the person answering, not only in the office page
- New arrivals appear next to a person, also when that person stands far from the middle of their area
- Office counts in the directory stay correct after "Show more offices"
- The directory finds every conversation office you take part in, also on instances with more than 500 of them
- The Dashboard widget no longer depends on the office list; it starts from the offices with someone inside
- Fields and switches that load later on an office page no longer move the "Enter office" button
- Using the coffee machine right after walking to it is retried once when the server has not seen the last step yet
- "Share to chat" works for every member who can open the conversation, not only managers
- The number of people shown on an office's door is right after you leave, and stays current while you look at it
- Starting or joining a focus session walks you to your desk, or to the focus desks
- Creating an office for a Talk conversation no longer asks for a name; it keeps the conversation's name

## 1.1.0

Talk conversations can have their own office.

- Any participant of a group or public conversation can open its office; everyone in the conversation can enter, nobody else
- "Open conversation office" in every Talk message menu, with an option to post and pin the office in the chat
- Office cards in Talk show who is inside and whether a call is running, and can be switched to an interactive view to enter and walk around right in the chat
- The office follows the conversation: renamed with it, deleted with it, and people removed from the conversation leave the office at once
- Offices linked to a conversation show when its call is running and who is in it, with Join call and Open chat
- Call a person from the office in a floating Talk call without leaving

Fixed

- A Team office no longer shows the call of a conversation after it was unshared from the Team
- Admins can still list and manage offices while Talk or Teams is disabled
- People who lost access leave the office within about 20 seconds while others are in or viewing it, even if their own window stopped polling
- The office list pages through Team, group, instance and conversation offices without skipping or repeating any, with "Show more offices"
- The Call button is hidden when Talk calls are disabled
- Deleting an office with a stale revision is refused inside the same lock as the delete
- Missed Client Push events are detected from any change, not only revision jumps
- Simultaneous preference saves no longer overwrite each other

## 1.0.0

First release.

- Team, group and admin-enabled instance offices with managers
- Four creatures, eight colours, four accessories, four reactions, coffee machine and shared plant
- Movement by click, tap, keyboard and an accessible people and places list
- Live updates through Client Push when available, otherwise polling
- One active character per person with explicit "Continue here"
- Temporary removal by managers, access re-checked every 20 seconds
- Talk conversation link, office cards for Talk and Text, Smart Picker, Unified Search and Team page entries
- Admin settings for room size and instance offices, setup check for Client Push
