# relay-push

Static CLI that uploads a DOM capture (and its `.context.json` sidecar) to the
fong-relay relay. Built on the dev host, the musl binary is copied to host
`chodien` (Ubuntu 24.04, glibc 2.39, no cargo) and runs there with zero deps.

## Usage

```
relay-push FILE [--base URL] [--mime M]    # upload one file
relay-push --latest DIR [--base URL]       # newest dom-capture_*.html + its .html.context.json
relay-push --version
```

- Default base: `https://fong-relay-fong11.vercel.app`; endpoint `POST {base}/put`.
- `--latest` picks the newest `dom-capture_*.html` by modification time and
  uploads it, then its sidecar `<same>.html.context.json` when present,
  printing exactly one JSON line per upload:
  `{"file":...,"key":...,"readUrl":...,"expiresInSec":...}`.
- Default mimes: `.html` -> `text/html`, `.json` -> `application/json`;
  `--mime` overrides (single-file mode only). Header sent: `x-relay-mime`.

## Master key

`RELAY_MASTER_KEY` env first, else `~/.config/fong-relay/master`
(refused when group/world readable, i.e. mode & 0o077 != 0).
The key is never printed, never placed in argv, never written to disk, and
never appears in an error message.

## Transports shipped

- **Primary: ureq (rustls)** — connect timeout 10s, total timeout 30s.
- **Fallback: CurlTransport** (system `curl`) — same deadlines; the master key
  is passed via a `curl -K -` config fed on stdin so it never lands in argv.
  Select with `RELAY_PUSH_TRANSPORT=curl`.

Both are built and tested. ureq/rustls was chosen as primary (per SOP
Rust-first, TLS in-binary); `ring` does need a C compiler for the musl target,
and `musl-gcc` is present on the build host, so the musl build works. If a
future host lacks it, build with `RELAY_PUSH_TRANSPORT=curl` usage and no
dependency on the TLS stack at runtime is needed — curl is pure-Rust-called,
so the binary stays fully static either way (no openssl, no C deps in the
crate itself).

## Exit codes

| code | meaning |
|---|---|
| 0 | success (one JSON line per upload on stdout) |
| 1 | usage error / other transport or HTTP error (incl. 503 unconfigured) |
| 2 | unauthorized — relay rejected the master key (401) |
| 3 | `--latest` found no capture in the directory |
| 4 | missing master key, insecure key file permissions, or malformed key |
| 5 | too large — client-side > 4194304 bytes or server 413 |

## Build

```
cargo test
cargo build --release --target x86_64-unknown-linux-musl
# artifact: target/x86_64-unknown-linux-musl/release/relay-push (statically linked)
```

Release profile sets `panic = "abort"` (panics never unwind silently) and
`strip = true`. No `unsafe`, no `unwrap` in non-test code.
