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
