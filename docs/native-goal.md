# /goal: keep working until it's done

`/goal <objective>` gives a session one objective and lets Carthagent keep going
on its own, turn after turn, until the objective is achieved. Use it for work
that takes several rounds (make a failing suite pass, finish a migration, clear
all lint errors) instead of typing "continue" yourself.

```text
/goal make npm test pass without skipping tests
/goal --turns 15 migrate every page under app/ to the new layout
/goal            # show the goal and its status
/goal resume     # continue a paused goal with a fresh turn allowance
/goal clear      # drop the goal; Carthagent stops continuing on its own
```

How it works:

- Setting a goal sends it as the next prompt (in the session's current mode).
  Typed on the home screen, it starts a new session with the selected model.
- Every model request in that session carries the goal. When a turn ends and
  the goal is still active, Carthagent queues "Continue working toward the
  goal…". It never interrupts a message you have already sent.
- The model ends the goal with the `goal_update` tool: **done** (achieved and
  checked, with a summary) or **blocked** (it needs something from you). You get
  a toast either way.
- The goal **pauses** instead of looping when you press Esc (interrupt), when a
  turn fails, or after the turn limit (default 8, `--turns` up to 50). Paused
  goals keep their objective; `/goal resume` picks them back up.
- One goal per session; setting a new one replaces it. Goals are stored with the
  session in the local service, not in the cloud.

Every continuation is a normal turn and is billed like one; the turn limit is
the cost cap.
