# Command and settings pickers

- In the `/` command palette, **Enter activates the highlighted command once**, even when the typed name is partial. **Tab completes** the command without running it. Escape dismisses the palette without changing the text.
- `/model` opens model search directly across providers. Type a provider or model name, browse with arrows, and press Enter to switch. The current model is marked independently of the highlighted candidate. Successful selection returns to the prompt.
- Settings uses the same interaction: Enter opens a row's choices, arrows browse, Enter applies, Escape cancels. Choosing from settings returns to settings. Provider selection is only a model-list filter; it never switches the model by itself. Theme changes are applied only on confirmation, not previewed.
- Switching models during an active response is rejected with an explanation. While a switch is pending, repeated confirmation is ignored; errors leave the picker open for retry. Escape cancels browsing, not a request already submitted. Ctrl-C remains available.
- Opening settings does not consume the prompt draft. Activating a slash command consumes that command text, as before.

Validation: `npm run quality` covers keyboard parsing, picker transitions and pending/error behavior. On POSIX, `python3 tools/test-picker-pty.py` starts the offline demo in a real pseudo-terminal and exercises single-Enter opening, model selection, Tab completion and Escape. It uses temporary configuration and makes no provider calls. This is not a substitute for native terminal visual review.
