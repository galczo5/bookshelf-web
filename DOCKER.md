# Bookshelf — Docker Quick Start

Single self-contained image: Next.js app + Postgres. No external database needed.

## Build

```sh
bash scripts/build-allinone.sh
# → bookshelf-test.tar.gz  (local arch, docker-loadable)
```

Run this any time you change app code and want the image to reflect it.

## Run

```sh
docker run -p 3000:3000 -v bookshelf-data:/data bookshelf:test
```

First boot takes ~15s (Postgres init + migrations). Open **http://localhost:3000** — you'll be redirected to `/setup`.

## Setup (first run only)

You need:

- **Google OAuth client** — [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
  - Type: Web application
  - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- **OpenAI API key** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

Fill in the form at `/setup`, click **Save & apply**, wait ~3s for the restart, then sign in with Google.

## Common commands

| Action                           | Command                           |
| -------------------------------- | --------------------------------- |
| Rebuild image after code changes | `bash scripts/build-allinone.sh`  |
| Run smoke test                   | `bash scripts/smoke-allinone.sh`  |
| Stop container                   | `docker stop <id>`                |
| Restart (data persists)          | `docker restart <id>`             |
| Full reset                       | `docker volume rm bookshelf-data` |
| View logs                        | `docker logs -f <id>`             |

## Full tester guide

See `context/changes/all-in-one-docker-image/handoff.md` for prerequisites, the OAuth setup walkthrough, demo-data option, and the remote-host `AUTH_URL` caveat.
