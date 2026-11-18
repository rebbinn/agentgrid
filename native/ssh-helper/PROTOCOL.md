# agentgrid-ssh protocol

`agentgrid-ssh.exe` is a child process of the Electron main process. It owns every SSH connection.
Electron talks to it over stdin/stdout: one JSON object per line, UTF-8, `\n` terminated.
stderr is free-form diagnostics only (never secrets).

The helper exits when stdin reaches EOF, after closing every session.

## Start

```
agentgrid-ssh.exe --known-hosts <path> [--extra-known-hosts <path>]...
```

- `--known-hosts`: AgentGrid's own known_hosts file. Read and appended to. The file and its folder may not exist yet.
- `--extra-known-hosts`: read-only files (for example `~/.ssh/known_hosts`). Missing files are skipped. Never written.

First line on stdout: `{"ev":"ready","version":1}`.

## Host spec

```json
{
  "label": "xl-app-01",
  "address": "10.20.4.11",
  "port": 22,
  "username": "deploy",
  "auth": "password" | "key" | "agent",
  "password": "optional stored password",
  "keyPath": "C:\\Users\\me\\.ssh\\id_ed25519 (required when auth is key)",
  "passphrase": "optional stored key passphrase"
}
```

## Commands (Electron → helper)

| op | fields | meaning |
| --- | --- | --- |
| `connect` | `sid`, `mode` (`shell` or `test`), `target` (host spec), `jump` (host spec or null), `cols`, `rows` | Open a session. `sid` is chosen by Electron and unique. |
| `input` | `sid`, `data` (base64 bytes) | Bytes for the remote shell's stdin. |
| `resize` | `sid`, `cols`, `rows` | Window change. |
| `pause` | `sid` | Stop reading remote output for this session (back-pressure through the SSH window). |
| `resume` | `sid` | Read again. |
| `answer` | `sid`, `rid`, and one of: `accept` (bool, for `hostkey`), `answers` (string array, for `prompt`), `cancel: true` | Reply to a pending `hostkey` or `prompt`. |
| `close` | `sid` | Close the session (and its connections). |

Unknown `sid` on `input`/`resize`/`pause`/`resume`/`answer`/`close`: ignore silently.
Malformed line: write a diagnostic to stderr, ignore it, keep running.

## Events (helper → Electron)

| ev | fields | meaning |
| --- | --- | --- |
| `ready` | `version` | Helper started. |
| `phase` | `sid`, `phase` (`connecting` or `authenticating`), `host` (label) | Progress. With a jump host, the jump host goes through both phases first. |
| `hostkey` | `sid`, `rid`, `host`, `address` (normalized, e.g. `[10.20.4.11]:2222` or `10.20.4.11`), `keyType`, `fingerprint` (`SHA256:…`) | The host key is not known. The handshake waits for `answer`. `accept: true` appends the key to `--known-hosts` and continues. `accept: false` or `cancel` fails the session with `hostkey-rejected`. |
| `prompt` | `sid`, `rid`, `host`, `kind` (`password`, `passphrase` or `keyboard-interactive`), `name`, `instruction`, `questions` (`[{ "text": "Password: ", "echo": false }]`) | The helper needs input from the user. Waits for `answer` with exactly one string per question. `cancel` fails the session with `cancelled`. |
| `connected` | `sid` | Authenticated. In `shell` mode the PTY and shell are running. In `test` mode the helper then closes the session and emits `closed` with `reason: "closed"`. |
| `data` | `sid`, `data` (base64 bytes) | Remote output (stdout and stderr of the shell, in arrival order). Never split into more than one event per read; no size limit beyond the read buffer (32 KiB). |
| `latency` | `sid`, `ms` | Round trip of the latest keepalive. |
| `failed` | `sid`, `kind`, `message`, `host` (label), optional `fingerprint`, optional `knownHostsFile` | The session never reached `connected`. Final event for the session. |
| `closed` | `sid`, `reason` (`exit`, `lost` or `closed`), optional `exitStatus` (int) | The session ended after `connected`. Final event for the session. `exit`: the remote shell exited (`exitStatus` when the server sent one). `lost`: the connection dropped or keepalive timed out. `closed`: Electron sent `close`, or `test` mode finished. |

`failed.kind` values: `dns`, `refused`, `timeout`, `unreachable`, `auth`, `hostkey-changed`, `hostkey-rejected`, `cancelled`, `key-file`, `agent-unavailable`, `jump`, `other`.
`hostkey-changed` carries the presented key's `fingerprint` and the `knownHostsFile` holding the old key.

After `failed` or `closed` the `sid` is forgotten; later commands for it are ignored.

## Behaviour

- TCP connect timeout 15 s. Waiting for `answer` has no timeout (the user may be away); `close` cancels it.
- Auth methods, in order:
  - `password`: password auth that first tries `password` (if given), then asks with a `prompt` of kind `password` (up to 3 tries in total). Plus keyboard-interactive: a single non-echo question whose text contains "password" (case-insensitive) is answered with the stored password once; any other question is asked with a `prompt` of kind `keyboard-interactive`.
  - `key`: the private key at `keyPath`. Encrypted key: use `passphrase`, else ask with a `prompt` of kind `passphrase`; a wrong passphrase asks again (3 tries). Unreadable file → `failed` `key-file`. Plus keyboard-interactive (prompted) for servers that want a second factor.
  - `agent`: the Windows OpenSSH agent pipe `\\.\pipe\openssh-ssh-agent`. Not reachable → `failed` `agent-unavailable`. Plus keyboard-interactive (prompted).
- Host keys: checked against `--known-hosts` plus every `--extra-known-hosts`. Address key: `knownhosts.Normalize(host:port)`. A mismatch fails with `hostkey-changed` and never asks.
- Jump host: connect and authenticate to `jump` first (its own host key check and prompts, `host` = its label), then open a direct-tcpip channel to the target and run the target handshake over it. Any failure on the jump leg is reported with the real kind and `host` = the jump label.
- Shell: PTY `xterm-256color` with `cols`×`rows`, echo on, then the login shell.
- Keepalive: every 15 s a `keepalive@openssh.com` global request with want-reply. Emit `latency` after each reply. No reply within 20 s → close the connection and emit `closed` with `reason: "lost"`.
- Output ordering per session is preserved. Events from different sessions may interleave.
- Secrets (passwords, passphrases, prompt answers) are never written to stdout, stderr or disk.
