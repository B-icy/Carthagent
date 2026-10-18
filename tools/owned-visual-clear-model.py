"""Pure canonical projections used by the owned visual-clear proof."""
import json


def canonical_conversation(messages):
    """Normalize API message order without dropping IDs, content, or metadata."""
    return sorted(messages, key=lambda message: json.dumps(
        message, sort_keys=True, separators=(',', ':'), ensure_ascii=False))
