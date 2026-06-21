# Bookshelf — Tester Handoff Guide

This guide walks you through loading the all-in-one Docker image, configuring it via the browser, and starting to use Bookshelf as a tester. No registry or cloud account required.

---

## Prerequisites

| Requirement                                         | Notes                                             |
| --------------------------------------------------- | ------------------------------------------------- |
| **Docker** (Engine 24+ or Docker Desktop)           | `docker --version` to verify                      |
| **Google Cloud project with OAuth 2.0 credentials** | Free; instructions below                          |
| **OpenAI API key**                                  | Needed for metadata enrichment during epub import |

---

## Step 1 — Set up Google OAuth

Bookshelf uses Google sign-in and (optionally) Google Drive for file storage. You need your own OAuth client.

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create credentials → OAuth 2.0 Client ID**.
3. Set application type to **Web application**.
4. Under **Authorized redirect URIs**, add exactly:
   ```
   http://localhost:3000/api/auth/callback/google
   ```
5. Click **Create**. Copy the **Client ID** and **Client Secret** — you'll paste them into the setup form.

> **localhost:3000 assumption:** The redirect URI is hard-coded to `localhost:3000`. If you're running the container on a remote host (e.g. a VM or a remote machine), see [Remote hosts](#remote-hosts) below.

---

## Step 2 — Load the image

```sh
gunzip -c bookshelf-test.tar.gz | docker load
```

Verify it loaded:

```sh
docker images bookshelf
```

You should see `bookshelf:test` in the list.

---

## Step 3 — Run the container

```sh
docker run -p 3000:3000 -v bookshelf-data:/data bookshelf:test
```

The first boot takes 10–20 seconds while Postgres initialises. You'll see log lines like:

```
[entrypoint] First boot: initializing Postgres data directory...
[entrypoint] Postgres is ready.
[entrypoint] Running database migrations...
[entrypoint] Migrations complete.
[supervisor] Starting Node...
```

Leave this terminal open (or add `-d` to run in the background).

---

## Step 4 — Configure Bookshelf

Open **http://localhost:3000** in your browser. You'll be redirected to the setup page.

Fill in:

| Field                    | Where to get it                                                      |
| ------------------------ | -------------------------------------------------------------------- |
| **Google Client ID**     | From Step 1                                                          |
| **Google Client Secret** | From Step 1                                                          |
| **OpenAI API Key**       | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **OpenAI Model**         | Optional; defaults to gpt-4.1-mini if blank                          |
| **Owner email**          | The Google account email you'll sign in with                         |

Check **"Load 50-book demo dataset"** if you want a pre-populated library (public-domain books; no Drive required).

Click **Save & apply**. The app shows "Applying settings…" for a few seconds while it restarts with your credentials, then redirects you to sign in.

---

## Step 5 — Sign in

Sign in with the Google account matching the email you entered. You'll land in the library.

---

## Resetting to a clean first-run

Removing the named volume wipes the database, secrets, and config entirely:

```sh
docker stop <container-id>
docker volume rm bookshelf-data
```

Next `docker run` will be a fresh first boot.

---

## Restarting the container

```sh
docker restart <container-id>
```

Data, secrets, and config are all on the named volume and survive restarts.

---

## Reconfiguring (rotating keys / changing email)

Sign in, then open **Settings → Reconfigure**. This takes you back to `/setup`, where you can update credentials. The app restarts after saving.

---

## Remote hosts

The OAuth redirect URI `http://localhost:3000/api/auth/callback/google` only works when you access the app from the same machine running Docker. For a remote host:

1. Add the remote URL as an additional authorized redirect URI in Google Cloud Console, e.g. `http://192.168.1.100:3000/api/auth/callback/google`.
2. Pass `AUTH_URL` when starting the container:
   ```sh
   docker run -p 3000:3000 -v bookshelf-data:/data \
     -e AUTH_URL=http://192.168.1.100:3000 \
     bookshelf:test
   ```

---

## For maintainers — building the image

From the repo root:

```sh
# Local arch (docker-loadable tarball for handoff)
bash scripts/build-allinone.sh
# → produces bookshelf-test.tar.gz

# Multi-arch verification (OCI layout; not directly loadable)
MULTI_ARCH=1 bash scripts/build-allinone.sh
```

Send `bookshelf-test.tar.gz` to the tester. They load it with the command in Step 2.

---

## Running the smoke test (maintainers)

After building the image, verify the critical boot path:

```sh
bash scripts/smoke-allinone.sh
```

This boots a throwaway container, asserts Postgres started, migrations ran, `/setup` responds before config, and the app comes back after a simulated config write + restart. Exit 0 = all checks passed.
