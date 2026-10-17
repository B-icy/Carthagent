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

    def test_workspace_render_requires_fresh_post_submit_route_and_loaded_section(self):
        screen = PROBE.Screen(rows=5, cols=80)
        screen.cells[1][2:25] = list("CARTHAGENT · WORKSPACE")
        before = ["old session", "slash autocomplete /ctg-workspace", "", "", ""]
        screen.cells[3][2:26] = list("Workspace native sessions")
        self.assertTrue(PROBE.workspace_render_completed(screen, before))

    def test_workspace_render_rejects_blank_partial_and_stale_frames(self):
        screen = PROBE.Screen(rows=5, cols=80)
        before = ["old session", "", "", "", ""]
        screen.cells[1][2:25] = list("CARTHAGENT · WORKSPACE")
        self.assertFalse(PROBE.workspace_render_completed(screen, before))
        screen.cells[3][2:26] = list("Workspace native sessions")
        stale = ["", "CARTHAGENT · WORKSPACE", "", "Workspace native sessions", ""]
        self.assertFalse(PROBE.workspace_render_completed(screen, stale))

    def test_workspace_command_is_not_timed_while_completion_or_old_editor_is_visible(self):
        screen = PROBE.Screen(rows=5, cols=80)
        screen.cells[1][2:16] = list("/ctg-workspace")
        screen.cells[2][2:20] = list("Carthagent commands")
        self.assertFalse(PROBE.workspace_command_staged(screen))
        screen.cells[2][2:20] = list("                  ")
        screen.cells[3][2:20] = list(PROBE.NATIVE_EDITOR_PLACEHOLDER)
        self.assertFalse(PROBE.workspace_command_staged(screen))
        screen.cells[3][2:20] = list("                  ")
        self.assertTrue(PROBE.workspace_command_staged(screen))


if __name__ == "__main__":
    unittest.main()
