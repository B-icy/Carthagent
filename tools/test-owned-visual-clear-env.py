#!/usr/bin/env python3
"""Unit tests for the visual-clear probe's subprocess environment boundary."""
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).with_name('owned-visual-clear-env.py')
SPEC = importlib.util.spec_from_file_location('owned_visual_clear_env', MODULE)
ENV = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENV)
MODEL_PATH = Path(__file__).with_name('owned-visual-clear-model.py')
MODEL_SPEC = importlib.util.spec_from_file_location('owned_visual_clear_model', MODEL_PATH)
MODEL = importlib.util.module_from_spec(MODEL_SPEC)
MODEL_SPEC.loader.exec_module(MODEL)


class ChildEnvironmentTests(unittest.TestCase):
    def test_canonical_conversation_matches_newest_first_data_and_detects_mutation(self):
        oldest = {
            'id': 'msg_old', 'type': 'user', 'text': 'first exact prompt',
            'time': {'created': 1},
        }
        newest = {
            'id': 'msg_new', 'type': 'assistant', 'text': 'second exact reply',
            'time': {'created': 2},
        }
        after_followup = [oldest, newest]
        # The API's newest-first ordering must compare equal to the same durable
        # transcript captured in a different order, retaining exact message data.
        newest_first_api = [newest, oldest]
        self.assertEqual(MODEL.canonical_conversation(newest_first_api),
                         MODEL.canonical_conversation(after_followup))
        self.assertEqual(MODEL.canonical_conversation(newest_first_api),
                         MODEL.canonical_conversation([oldest, newest]))

        mutated_api = [newest, {**oldest, 'text': 'changed prompt'}]
        self.assertNotEqual(MODEL.canonical_conversation(mutated_api),
                            MODEL.canonical_conversation(after_followup))
        changed_id_api = [newest, {**oldest, 'id': 'msg_replaced'}]
        self.assertNotEqual(MODEL.canonical_conversation(changed_id_api),
                            MODEL.canonical_conversation(after_followup))

    def test_fixture_environment_only_inherits_explicit_platform_basics(self):
        ambient = {
            'PATH': '/trusted/test/path',
            'LANG': 'C.UTF-8',
            'LC_ALL': 'C',
            'HOME': '/real/user/home',
            'AWS_SECRET_ACCESS_KEY': 'FAKE_AWS_SECRET_FOR_TEST',
            'GITHUB_TOKEN': 'FAKE_GITHUB_TOKEN_FOR_TEST',
            'CTG_RUNTIME_GITHUB_TOKEN': 'FAKE_RUNTIME_TOKEN_FOR_TEST',
            'NODE_OPTIONS': '--require=/credential-stealing.js',
            'OPENCODE_CONFIG': '/real/user/profile.json',
        }
        result = ENV.fixture_environment(
            ambient, '/tmp/clear-test-home', '/tmp/owned-root', '/tmp/release.json')
        self.assertEqual(result['PATH'], ambient['PATH'])
        self.assertEqual(result['LANG'], ambient['LANG'])
        self.assertEqual(result['LC_ALL'], ambient['LC_ALL'])
        self.assertEqual(result['HOME'], '/tmp/clear-test-home')
        self.assertEqual(result['CTG_OWNED_OPENCODE_RUNTIME'], '/tmp/owned-root')
        self.assertEqual(result['CTG_TEST_RUNTIME_RELEASE_MANIFEST'], '/tmp/release.json')
        self.assertFalse({'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN',
                          'CTG_RUNTIME_GITHUB_TOKEN', 'NODE_OPTIONS',
                          'OPENCODE_CONFIG'} & result.keys())

    def test_tui_allowlist_rejects_unknown_and_case_variant_reserved_credentials(self):
        clean = ENV.fixture_environment(
            {'PATH': '/usr/bin', 'LANG': 'C.UTF-8'},
            '/tmp/clear-test-home', '/tmp/owned-root', '/tmp/release.json')
        clean = {key: value for key, value in clean.items() if key in ENV.TUI_ENV_KEYS}
        clean.update({'TERM': 'xterm-256color', 'OPENCODE_PASSWORD': 'FAKE_FIXTURE_PASSWORD'})
        ENV.assert_clean_child_environment(clean)

        with self.assertRaisesRegex(AssertionError, 'non-allowlisted'):
            ENV.assert_clean_child_environment({**clean, 'AWS_SECRET_ACCESS_KEY': 'FAKE'})
        with self.assertRaisesRegex(AssertionError, 'reserved runtime download'):
            ENV.assert_clean_child_environment({**clean, 'ctg_runtime_github_token': 'FAKE'})

    def test_node_helper_environment_does_not_forward_parent_credentials(self):
        fake_parent = {
            'PATH': '/usr/bin',
            'LANG': 'C.UTF-8',
            'AWS_SECRET_ACCESS_KEY': 'FAKE_AWS_SECRET_FOR_TEST',
            'SSH_AUTH_SOCK': '/fake/agent.sock',
            'NPM_TOKEN': 'FAKE_NPM_TOKEN_FOR_TEST',
            'GH_TOKEN': 'FAKE_GH_TOKEN_FOR_TEST',
        }
        child = ENV.fixture_environment(
            fake_parent, '/tmp/isolated-home', '/tmp/owned', '/tmp/manifest.json')
        self.assertEqual(set(child) - set(ENV.SAFE_PARENT_ENV) - {
            'HOME', 'USERPROFILE', 'CTG_OWNED_OPENCODE_RUNTIME',
            'CTG_TEST_RUNTIME_RELEASE_MANIFEST', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
            'XDG_STATE_HOME', 'XDG_CACHE_HOME'}, set())

    def test_preflight_receives_no_ambient_secrets_or_runtime_download_token(self):
        ambient = {
            'PATH': '/usr/bin', 'LANG': 'C.UTF-8',
            'CTG_RUNTIME_GITHUB_TOKEN': 'FAKE_RUNTIME_GITHUB_TOKEN',
            'GITHUB_TOKEN': 'FAKE_GITHUB_TOKEN',
            'AWS_ACCESS_KEY_ID': 'FAKE_AWS_ACCESS_KEY',
            'NODE_OPTIONS': '--require=fake-preload.js',
        }
        child = ENV.fixture_environment(
            ambient, '/tmp/isolated-home', '/tmp/owned', '/tmp/manifest.json')
        ENV.assert_clean_child_environment(child, ENV.FIXTURE_ENV_KEYS)
        self.assertFalse(any(name.casefold() == 'ctg_runtime_github_token' for name in child))
        self.assertFalse({'GITHUB_TOKEN', 'AWS_ACCESS_KEY_ID', 'NODE_OPTIONS'} & child.keys())



if __name__ == '__main__':
    unittest.main()
