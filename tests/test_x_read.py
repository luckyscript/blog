import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / 'scripts' / 'x-read.py'
spec = importlib.util.spec_from_file_location('x_read', script)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class XReadTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('twitter_cli'), 'requires pinned X runtime')
    def test_pinned_runtime_imports_match_published_package(self):
        client, features = bridge.runtime()
        self.assertEqual(client.__name__, 'TwitterClient')
        self.assertIsInstance(features, dict)

    def test_raw_timeline_preserves_retweet_wrapper_and_cursor(self):
        tweet = {'rest_id': '2000000000000000001', 'legacy': {'retweeted_status_result': {'result': {'rest_id': '10'}}}}
        result = bridge.timeline_entries([{'entries': [
            {'content': {'itemContent': {'tweet_results': {'result': tweet}}}},
            {'content': {'itemContent': {'promotedMetadata': {}, 'tweet_results': {}}}},
            {'content': {'cursorType': 'Bottom', 'value': 'DAABC_12-='}},
        ]}])
        self.assertEqual(result, ([tweet], 'DAABC_12-='))

    def test_invalid_account_fails_without_credentials_or_network(self):
        env = {**os.environ, 'MOMENTS_X_ACCOUNTS': 'rainonpiano,raininpiano'}
        result = subprocess.run([sys.executable, str(script)], input='{"account":"../secret"}\n', text=True, env=env, capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout), {'ok': False, 'error': 'X_INVALID_ACCOUNT'})
        self.assertEqual(result.stderr, '')

    def test_credentials_require_owner_only_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'session.json'
            file.write_text('{"auth_token":"test-only-token","ct0":"test-only-csrf"}')
            file.chmod(0o644)
            os.environ['MOMENTS_X_CREDENTIAL_FILE'] = str(file)
            with self.assertRaisesRegex(bridge.BridgeError, 'X_CREDENTIAL_PERMISSIONS'):
                bridge.credential()
            file.chmod(0o600)
            self.assertEqual(bridge.credential()['ct0'], 'test-only-csrf')


if __name__ == '__main__':
    unittest.main()
