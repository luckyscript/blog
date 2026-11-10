"""Read-only, line-delimited JSON bridge for twitter-cli 0.8.5.

Credentials stay in an owner-only file; stdout contains public profile/tweet
data or fixed error codes. No publishing, account mutation or browser extraction.
"""
import importlib.metadata
import json
import logging
import os
import re
import stat
import sys

logging.disable(logging.CRITICAL)


class BridgeError(Exception):
    pass


def credential():
    path = os.environ.get("MOMENTS_X_CREDENTIAL_FILE", "")
    if not path:
        raise BridgeError("X_AUTH_REQUIRED")
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise BridgeError("X_AUTH_REQUIRED") from None
    with os.fdopen(descriptor) as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise BridgeError("X_CREDENTIAL_PERMISSIONS")
        value = json.load(file)
    if not all(isinstance(value.get(k), str) and value[k] for k in ("auth_token", "ct0")):
        raise BridgeError("X_AUTH_REQUIRED")
    return value


def get(data, *keys):
    for key in keys:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def runtime():
    if importlib.metadata.version("twitter-cli") != "0.8.5":
        raise BridgeError("X_RUNTIME_VERSION")
    from twitter_cli.client import TwitterClient
    from twitter_cli.graphql import FEATURES
    return TwitterClient, FEATURES


def timeline_entries(instructions):
    tweets, cursor = [], None
    for instruction in instructions:
        # A pinned tweet must not become the incremental checkpoint.
        entries = instruction.get("entries") or ([instruction["entry"]] if instruction.get("entry") else [])
        for entry in entries:
            content = entry.get("content") or {}
            if content.get("cursorType") == "Bottom":
                cursor = content.get("value")
            candidates = [content.get("itemContent") or {}]
            candidates.extend((item.get("item") or {}).get("itemContent") or {} for item in content.get("items", []))
            for item in candidates:
                if item.get("promotedMetadata"):
                    continue
                result = get(item, "tweet_results", "result")
                if result:
                    tweets.append(result)
    return tweets, cursor


def main():
    allowed = {v.strip().lower() for v in os.environ.get("MOMENTS_X_ACCOUNTS", "").split(",") if v.strip()}
    client, profiles = None, {}
    for line in sys.stdin:
        try:
            if len(line) > 16_000:
                raise BridgeError("X_INVALID_REQUEST")
            request = json.loads(line)
            account, cursor = request.get("account", ""), request.get("cursor")
            if not re.fullmatch(r"[a-z0-9_]{1,15}", account) or account not in allowed:
                raise BridgeError("X_INVALID_ACCOUNT")
            if cursor is not None and (not isinstance(cursor, str) or not re.fullmatch(r"[A-Za-z0-9_+=/-]{1,4096}", cursor)):
                raise BridgeError("X_INVALID_CURSOR")
            if client is None:
                TwitterClient, FEATURES = runtime()
                cookies = credential()
                client = TwitterClient(cookies["auth_token"], cookies["ct0"], cookie_string=cookies.get("cookie_string"), rate_limit_config={"maxRetries": 0, "requestDelay": 3})
            if account not in profiles:
                features = dict(FEATURES)
                features.update({"hidden_profile_subscriptions_enabled": True, "rweb_tipjar_consumption_enabled": True,
                                 "subscriptions_verification_info_is_identity_verified_enabled": True,
                                 "subscriptions_verification_info_verified_since_enabled": True,
                                 "highlights_tweets_tab_ui_enabled": True,
                                 "responsive_web_graphql_exclude_directive_enabled": True,
                                 "responsive_web_twitter_article_notes_tab_enabled": True,
                                 "subscriptions_feature_can_gift_premium": True,
                                 "creator_subscriptions_tweet_preview_api_enabled": True,
                                 "responsive_web_graphql_timeline_navigation_enabled": True})
                data = client._graphql_get("UserByScreenName", {"screen_name": account, "withSafetyModeUserFields": True}, features)
                user = get(data, "data", "user", "result")
                if not user or user.get("__typename") == "UserUnavailable":
                    raise BridgeError("X_ACCOUNT_NOT_FOUND")
                name = get(user, "core", "screen_name") or get(user, "legacy", "screen_name")
                if not isinstance(name, str) or name.lower() != account or not re.fullmatch(r"\d+", user.get("rest_id", "")):
                    raise BridgeError("X_ACCOUNT_MISMATCH")
                if get(user, "legacy", "protected") or get(user, "privacy", "protected"):
                    raise BridgeError("X_PRIVATE_ACCOUNT")
                profiles[account] = {"id": user["rest_id"], "screenName": name, "protected": False}
            profile = profiles[account]
            variables = {"userId": profile["id"], "count": 40, "includePromotedContent": False,
                         "withQuickPromoteEligibilityTweetFields": True, "withVoice": True, "withV2Timeline": True}
            if cursor:
                variables["cursor"] = cursor
            data = client._graphql_get("UserTweets", variables, FEATURES)
            user = get(data, "data", "user", "result")
            if get(user, "legacy", "protected") or get(user, "privacy", "protected"):
                raise BridgeError("X_PRIVATE_ACCOUNT")
            instructions = next((value for value in [get(user, "timeline_v2", "timeline", "instructions"),
                                                     get(user, "timeline", "timeline", "instructions"),
                                                     get(user, "timeline", "instructions")]
                                 if isinstance(value, list)), None)
            if not isinstance(instructions, list):
                raise BridgeError("X_INVALID_TIMELINE")
            tweets, next_cursor = timeline_entries(instructions)
            response = {"ok": True, "profile": profile, "tweets": tweets, "nextCursor": next_cursor}
        except Exception as error:
            message = str(error)
            if isinstance(error, BridgeError):
                code = message
            elif getattr(error, "status_code", None) == 429:
                code = "X_RATE_LIMITED"
            elif getattr(error, "status_code", None) == 401:
                code = "X_AUTH_REQUIRED"
            elif getattr(error, "status_code", None) == 403:
                code = "X_ACCESS_DENIED"
            elif isinstance(error, (TimeoutError, ConnectionError)):
                code = "X_TIMEOUT"
            else:
                code = "X_UPSTREAM_FAILED"
            response = {"ok": False, "error": code}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
