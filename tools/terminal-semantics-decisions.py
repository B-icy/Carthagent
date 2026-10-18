"""Platform-neutral decisions shared by terminal-semantics PTY probes/tests."""


def picker_cancel_observation(heading, visible, home_ready, home_before, provider_requests):
    """Return a cancellation verdict only after overlay dismissal and home restoration."""
    screen = visible.lower()
    overlay_visible = (heading in screen or 'no matches' in screen or
                       'open                       esc' in screen)
    if overlay_visible or not home_ready:
        return None
    no_request = provider_requests == 0
    return {
        'status': 'PASS' if home_before and no_request else 'FAIL',
        'pickerObserved': True,
        'cancelKey': 'Escape',
        'dismissed': True,
        'composerRestored': True,
        'providerRequestsBeforePrompt': provider_requests,
        'noPromptProviderRequestBeforeAcceptance': no_request,
    }


def is_focused_terminal_case(focused_roundtrip, layout_regression):
    """Focused transport modes skip picker setup; picker-only is interactive."""
    return focused_roundtrip or layout_regression


def rendered_fixture_row(line, fixture_response):
    """Match the exact fixture after normalizing Markdown link delimiters.

    OpenCode renders `[text]` as `text` in the message body, while the session
    title can still contain the original brackets. This accepts both renderings
    without guessing the response text or requiring a particular screen row.
    """
    normalize = lambda value: value.replace('[', '').replace(']', '')
    response = normalize(fixture_response)
    return bool(response) and response in normalize(line)


def rendered_fixture_body_row(line, fixture_response):
    """Accept the rendered body, not a raw fixture echoed in a title/header."""
    return rendered_fixture_row(line, fixture_response) and fixture_response not in line


def active_session_prompt_ready(visible, staged_text):
    """Recognize the rendered active-session composer after home acceptance."""
    screen = visible.lower()
    return (bool(staged_text) and staged_text.lower() in screen and
            'build · offline fixture ctgfixture' in screen and
            'ask anything' not in screen and 'what is the tech' not in screen)
