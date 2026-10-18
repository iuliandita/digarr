# AudioMuse-AI contract fixtures

Checked against release [v3.6.4](https://github.com/NeptuneHub/AudioMuse-AI/tree/v3.6.4), commit `3564511de3c0b8d537afb1ff3aa11f06ec064af0`.

These are synthetic recordings of the response shapes built by upstream source, with example artist names and media-server IDs. No live AudioMuse-AI instance was available.

- `app_artist_similarity.py`: `/api/similar_artists` reads `artist` or `artist_id`, and `n` (not `name`, `id`, or `limit`); default n is configured, clamped to at least 1. Returns a bare array. Empty results produce code 1004 / HTTP 404; an unavailable index produces 3002 / HTTP 503.
- `tasks/artist_gmm_manager.py`: `_build_similar_artist_result` emits `artist`, nullable `artist_id`, numeric `divergence`; lower divergence ranks first. Optional explanation fields are absent unless requested.
- `error/error_dictionary.py`, `error/error_manager.py`, `error/responses.py`: error bodies contain `error_code`, `error_class`, `error_message`, and the legacy `error` alias. Request errors include 1003 / 400, 1004 / 404, 1005 / 401, and 1006 / 403. Code 3003 uses HTTP 500; other index codes such as 3002 default to 503.
- `app.py`: `/api/version` returns `{ "app_version": "..." }`; `/api/health` only returns liveness and bypasses auth, so it cannot validate a token.
- `app_auth.py`: Bearer auth uses `API_TOKEN` when `AUTH_ENABLED` is on; no token is needed when auth is disabled. Setup must be complete.

Digarr requests `artist` by name with `n=20`, omits component matches, and maps divergence to `1 / (1 + divergence)`. Media-server IDs are never MusicBrainz IDs. A future unversioned API change should fail these fixtures before changing the adapter.
