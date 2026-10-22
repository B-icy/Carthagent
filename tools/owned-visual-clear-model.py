"""Pure canonical projections used by the owned visual-clear proof."""
import json


def canonical_conversation(messages):
    """Normalize API message order without dropping IDs, content, or metadata."""
    return sorted(messages, key=lambda message: json.dumps(
        message, sort_keys=True, separators=(',', ':'), ensure_ascii=False))


def latest_message(messages):
    """Return the latest message from the native message.list() API response.

    The API returns the list newest-first (including non-conversational events
    such as the trailing idle message). Keep cutoff selection separate from
    canonical conversation ordering, which intentionally sorts for equality.
    """
    data = messages.get('data', [])
    if not data:
        raise ValueError('message.list() returned no messages')
    return data[0]
