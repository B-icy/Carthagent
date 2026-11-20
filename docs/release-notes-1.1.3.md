# Carthagent 1.1.3

A stable update to 1.1.2. `ctg update` on the stable channel installs it; no
profile, sign-in or session migration is needed. On first launch Carthagent
downloads the updated checksum-pinned runtime for your platform (runtime patch
v21).

## Faster start

- The plugin interface is compiled once and reused on later launches, instead
  of being compiled on every start. On the one-core test machine this cut that
  step from about 1.7 s to about 0.15 s.
- In a terminal that never reports its background colour, the first screen
  waits at most 0.3 s for it instead of 1 s.

## Projects sidebar

- Session titles no longer show stray block characters.
- A long title ends in `…`; hover over it to see the full title beside the
  sidebar.
- Collapsing or expanding a folder keeps the list where it was.
- The sidebar appears once, in its final layout, instead of first showing a
  flat list and then regrouping.
- Opening on the home screen keeps your folders in view.
- Tooltips and folder paths draw above the main pane instead of under it.
- Dragging the divider past the edge of the page stops at the widest sidebar
  that fits instead of snapping to the narrow layout. Releasing the drag no
  longer clicks whatever is under the pointer.
- Folder paths and the folder browser show your home folder as `~`, and Home
  in the folder browser opens it.

## Commands

- `/help`, `/ctg-help` and their aliases open on the first Enter from the
  command list.

## Voyages

- Voyages and daily goals load when the open session's folder was moved or
  deleted, instead of showing "Could not load".
- The Voyages pane no longer shows a "Friends · WIP" label.

"Verified" means the declared required checks passed against the current code.
It is not proof that the code is free of bugs, and Quick mode is not tested.
