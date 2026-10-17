import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "test-native-terminal-performance.py"
SPEC = importlib.util.spec_from_file_location("native_terminal_probe", MODULE_PATH)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class EditorEchoTests(unittest.TestCase):
    def test_native_placeholder_anchor_and_exact_changed_cell_are_required(self):
        screen = PROBE.Screen(rows=4, cols=40)
        row, col = 2, 5
        line = PROBE.NATIVE_EDITOR_PLACEHOLDER
        for offset, char in enumerate(line):
            screen.cells[row][col + offset] = char
        before = [cells[:] for cells in screen.cells]
        self.assertEqual(PROBE.locate_text(screen, line), (row, col))
        screen.cells[row][col] = "z"
        self.assertTrue(PROBE.editor_contains_typed_cell(screen, "z", before, row, col))

    def test_arbitrary_transcript_or_another_editor_cell_is_not_an_echo(self):
        screen = PROBE.Screen(rows=4, cols=40)
        row, col = 2, 5
        for offset, char in enumerate(PROBE.NATIVE_EDITOR_PLACEHOLDER):
            screen.cells[row][col + offset] = char
        before = [cells[:] for cells in screen.cells]
        screen.cells[row][col + 4] = "z"
        self.assertFalse(PROBE.editor_contains_typed_cell(screen, "z", before, row, col))
        screen.cells[row][col + 4] = before[row][col + 4]
        screen.cells[0][0] = "z"
        self.assertFalse(PROBE.editor_contains_typed_cell(screen, "z", before, row, col))

    def test_pty_ready_detection_uses_the_actual_current_product_hint(self):
        screen = PROBE.Screen(rows=4, cols=80)
        hint = "Message carthagent…"
        for offset, char in enumerate(hint):
            screen.cells[2][5 + offset] = char
        self.assertEqual(PROBE.locate_text(screen, PROBE.NATIVE_EDITOR_PLACEHOLDER), (2, 5))
        self.assertNotEqual(PROBE.NATIVE_EDITOR_PLACEHOLDER, "Ask anything")


if __name__ == "__main__":
    unittest.main()
