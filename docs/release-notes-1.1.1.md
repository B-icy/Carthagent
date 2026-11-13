# Carthagent 1.1.1

A stable update to 1.1.0. `ctg update` on the stable channel installs it; no
profile, sign-in or session migration is needed. On first launch Carthagent
downloads the updated checksum-pinned runtime for your platform.

## Daily goals replace daily quests

`/quests` now shows three quick wins for today, such as **Change 20 lines of
code**, **Run your tests** or **Run a code review**. They rotate every UTC day and
are counted automatically from your sessions in any mode (Ship, Quick, Plan or
Build): there is nothing to select, write up or submit. Each goal pays coins and
XP once when it fills, and a toast celebrates it. For variety, some goals come
up **★ Bigger** (double the target, 25 coins and 125 XP) or **★ Stretch** (4×, 60
coins and 300 XP). Counts are local motivation, not verified activity. See
[daily goals](native-daily-goals.md).

## Ship and modes

- `ctg -p/--json --agent <ship|quick|plan|build>` (alias `--mode`) picks the mode
  for a new headless session. Quick finishes small tasks in seconds.
- Switching away from Ship mid-turn no longer fails with "Delivery tools require
  Ship mode", and the model is told the delivery tools are gone.
- A lone short word ("ok", "cs") is no longer framed as a delivery task;
  "just tell me, I'll fix it myself" is answered as a question.
- Ship guidance avoids reading secrets files and off-task web/history digging.

## Reliability

- Ship's PR review step no longer kills your live session; review works for
  Carthagent Cloud users and falls back to a connected model.
- The automatic review offer defaults to **Not now**, so a reflexive Enter never
  opens a pull request.
- Headless runs: long runs exit 0 with their output, a dropped model stream says
  how to continue, and unanswerable question forms are declined instead of
  hanging for five minutes.
- A slow but live service gets patience before being declared unhealthy.
- The web-search prompt says Carthagent, not OpenCode (runtime patch v15).

## Voyages

- The Shop opens on its first row; Esc in the Shop returns to Character.
- Owned items show "Owned" (and "equipped") instead of "0 coins"; the equip
  dialog uses singular slot names.
