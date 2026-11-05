# Command and settings pickers

- In the `/` suggestion list, arrows move the highlight. What Enter does depends on the highlighted command:
  - A command that takes no arguments (for example `/stats`, `/settings`, `/clear`) runs on the first Enter, even when the typed name is partial.
  - A command that accepts arguments (for example `/theme [name]`, `/model [name]`, `/compact [notes]`) is only completed on the first Enter: `/the` becomes `/theme ` and the list closes so you can add an argument. Press Enter again to run it, with or without an argument.
  - Tab always completes the highlighted name without running it. Escape hides the list and keeps the typed text.
- `/model` opens a searchable provider/model list. Type a provider or model name, browse with arrows, and press Enter to switch. The current model is marked independently of the highlighted candidate. Successful selection returns to the prompt.
- Settings is a list of rows, not nested choosers. Enter, or →, advances the highlighted row to its next value and saves it immediately; ← moves it back to the previous value. Escape closes Settings and does not undo changes already made. This includes Theme, which changes as you cycle, and Permissions. To revert, cycle the row back before closing.
- Switching models during an active response is rejected with an explanation. While a switch is pending, repeated confirmation is ignored; errors leave the picker open for retry. Escape cancels browsing, not a request already submitted. Ctrl-C remains available.
- Opening settings does not consume the prompt draft. Activating a slash command consumes that command text, as before.
- `/clear` appears once in the suggestion list. Some other names, such as `/stats`, `/autocompact`, `/resume` and `/thinking`, still list both a native and a Carthagent entry because they run different actions. Inside a session `/clear` is the native "Clear transcript view" action; outside a session the Carthagent entry explains that it needs an open session. Either way it hides the visible transcript only and leaves durable session history unchanged.

Validation: `npm run quality` covers keyboard parsing, picker transitions, pending/error behavior and slash-entry deduplication. On POSIX, `python3 tools/test-picker-pty.py` starts the offline demo in a real pseudo-terminal and exercises opening and committing the model picker, Tab completion without activation, and Escape. It uses temporary configuration and makes no provider calls. This is not a substitute for native terminal visual review.
