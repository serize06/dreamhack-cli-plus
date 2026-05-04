# dreamhack-cli-plus

Extended fork of [dreamhack-cli](https://github.com/sihyeokpark/dreamhack-cli) with quality-of-life upgrades for users who log in via Google OAuth and want a smoother local pwn workflow.

![preview](preview.png)

## What's added

### Auth
- **Cookie-based auth (`--sessionid` / `--csrf`)** — for accounts that use Google OAuth (no email/password). The CLI uses your browser session directly, no `User.login()` call.
- **Updated download flow** — uses the current dreamhack download API (`POST /api/v1/wargame/challenges/<id>/download/`) instead of the deprecated `wargameJSON.public` field.

### New commands
- **`dh init [path]`** — fix a wargame working directory. Once set, every other command (`create`/`vm`/`analyze`) runs there regardless of cwd. Run with no arg to show the current setting.
- **`dh vm`** — manage dreamhack-hosted VM instances (create / get / delete) without opening the web UI. `-c` and `-g` also auto-patch `solve/solve.py`'s `HOST, PORT = ...` line to the running VM's address.
- **`dh submit`** — submit a flag from the terminal.
- **`dh analyze [link_or_path]`** — static analysis dumped to `solve/analysis.md`:
  - checksec (RELRO/Stack/NX/PIE) + Build ID for binary and libc
  - Interesting symbols, PLT/GOT entries (handy as leak targets)
  - ROP gadgets (`pop rdi; ret`, `pop rsi/rdx/rax; ret`, `syscall; ret`, `ret`, `leave; ret`)
  - libc version (Ubuntu build string + GLIBC release), key symbols (system, hooks, `_IO_*`), `/bin/sh` string offset
  - **Auto-generated `leak → libc_base` table** for 10+ common leak sources (one line copy/paste instead of looking up every offset)
  - **`one_gadget` candidates** if the tool is installed
  - **Heap base recovery snippets** (safe-linking unmangle for glibc 2.32+)

### `dh create` upgrades
- **`-c / --continue`** — skip download/extract and reuse the existing wargame directory (preserves manual edits like Dockerfile tweaks, in-progress exploit code, etc.).
- **`-l / --libc`** — extract `libc.so.6` and `ld-linux-*.so` out of the built challenge image into the wargame directory, ready for exploit dev.
- **Auto-chmod from Dockerfile** — after extraction, parses `ADD/COPY` and `RUN chmod` directives in the wargame's Dockerfile and applies the same permissions to local source files (e.g. `chall=550`, `flag=440`, `init.sh=700`). Falls back to `chmod 755` on any ELF if the Dockerfile has no chmods.
- **Auto-generates `solve/solve.py`** — pwntools boilerplate with `BINARY` and `PORT` auto-detected (from the first ELF in `deploy/` and the xinetd config). `python3 solve.py REMOTE` toggles to remote target. Skipped if `solve/` already exists.
- **Smarter docker run** — when the wargame Dockerfile lacks `EXPOSE` / `CMD` (common dreamhack pattern), automatically:
  - Detects the xinetd port from `<wargame>/deploy/*.xinetd` and adds `-p N:N`
  - Falls back to `/etc/init.sh` as the container command if `<wargame>/deploy/init.sh` exists
- **Auto-cleanup of stale containers** — before each run, removes any prior container from the same image OR holding the same port (catches stale containers from older image digests after rebuild).
- **Docker Compose v2** support (`docker compose` instead of legacy `docker-compose`).

## Install

```sh
git clone https://github.com/serize06/dreamhack-cli-plus.git
cd dreamhack-cli-plus
npm install
sudo npm link        # makes `dh` globally available

# Optional but recommended for `dh analyze`:
pip install pwntools
gem install one_gadget   # or: snap install one_gadget
```

## Configure

### 1. Pin a wargame directory

```sh
dh init ~/Dreamhack/pwnable     # all subsequent dh commands work in this dir
```

### 2. Auth — Option A: Google OAuth users (recommended)

1. Log in to dreamhack.io in your browser
2. Open DevTools → Application → Cookies → `https://dreamhack.io`
3. Copy `sessionid` and `csrf_token` values
4. Run:

```sh
dh config --sessionid=<sessionid> --csrf=<csrf_token>
```

`csrf_token` rarely refreshes (rotates only on login); `sessionid` is valid for ~1 week. Re-run `dh config` if you see auth errors.

### 2. Auth — Option B: email/password

```sh
dh config --email=<email> --password=<password>
```

## Usage

```sh
dh init ~/Dreamhack/pwnable     # one-time, fixes the working dir

dh create <link>                # download + auto-chmod + create solve/
dh create <link> -d             # ... + build/run docker
dh create <link> -d -l          # ... + extract libc/ld into wargame dir
dh create <link> -c -d          # skip download (continue), rebuild docker with edits

dh analyze <link>               # write solve/analysis.md (checksec + symbols + ROP +
                                # libc + leak→base offsets + one_gadget + heap snippets)

dh vm <link> -c                 # create hosted VM (also patches solve.py HOST/PORT)
dh vm <link> -g                 # show VM host:port (also patches solve.py)
dh vm <link> -d                 # delete VM (frees instance time)

dh submit <link> --flag='DH{...}'

dh help
```

### What you get after `dh create <link>`

```
<Wargame Title>/
├── Dockerfile
├── deploy/
│   ├── chall            (chmod-ed per Dockerfile)
│   ├── flag
│   ├── init.sh
│   ├── pwn.xinetd
│   └── ...
└── solve/
    └── solve.py         (pwntools template, BINARY/PORT pre-filled)
```

Add `-d -l` and you also get `libc.so.6` + `ld-linux-*.so` in the wargame dir, plus a running container on the detected port.

Add `dh analyze <link>` after that and you also get `solve/analysis.md` — the cheat sheet you'd otherwise build by hand from `checksec`, `nm`, `ROPgadget`, and `one_gadget`.

## A typical session

```sh
# one-time setup
dh init ~/Dreamhack/pwnable
dh config --sessionid=... --csrf=...

# pick a challenge
dh create https://dreamhack.io/wargame/challenges/624 -d -l
dh analyze https://dreamhack.io/wargame/challenges/624

# spin up the hosted VM (also rewrites solve.py target)
dh vm https://dreamhack.io/wargame/challenges/624 -c

# write your exploit using the symbols/offsets from solve/analysis.md
$EDITOR "House of Pumpkin/solve/solve.py"

# test locally first, then run against the VM
cd "House of Pumpkin/solve"
python3 solve.py
python3 solve.py REMOTE

# submit when you have the flag
dh submit https://dreamhack.io/wargame/challenges/624 --flag='DH{...}'

# clean up
dh vm https://dreamhack.io/wargame/challenges/624 -d
```

## Notes

- `src/data/user.json` stores credentials in plaintext (same as upstream). Don't commit it — the `.gitignore` excludes it.
- Auto-detection heuristics target the common dreamhack pwn challenge layout (`deploy/*.xinetd`, `deploy/init.sh`, ELF binary in `deploy/`). If a challenge breaks them, edit the Dockerfile in the wargame dir and use `dh create <link> -c -d` to rebuild with your edits.
- `solve/` is treated as user-owned: never overwritten on re-download, never recreated by `--continue`. The only thing `dh` rewrites in `solve.py` is the `HOST, PORT = ...` line (when a VM is created/queried). The rest of your exploit code is untouched.
- Local docker is fine for most challenges. For `needs_vm: true` challenges (heap challenges with `vm.overcommit_memory` requirements, etc.), prefer `dh vm`.
- WSL2 / native Linux are tested; native Windows likely needs adjustments to the docker shell quoting and `chmod` paths.

## License

MIT — see [LICENSE](LICENSE). Original work © 2024 EXON; this fork's additions © 2026 serize06.
