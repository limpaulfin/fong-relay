//! relay-push: upload a DOM capture (and its sidecar) to the fong-relay relay.
//!
//! Pure logic + transports live here; `src/main.rs` is a thin CLI wrapper.
//! No `unsafe`, no `unwrap` outside tests, every network call carries deadlines.

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};

pub const MAX_BODY_BYTES: usize = 4_194_304;
pub const DEFAULT_BASE: &str = "https://fong-relay-fong11.vercel.app";
pub const CONNECT_TIMEOUT_SECS: u64 = 10;
pub const TOTAL_TIMEOUT_SECS: u64 = 30;

pub const EXIT_OTHER: i32 = 1;
pub const EXIT_UNAUTHORIZED: i32 = 2;
pub const EXIT_NO_CAPTURE: i32 = 3;
pub const EXIT_SECRET: i32 = 4;
pub const EXIT_TOO_LARGE: i32 = 5;

pub const HTML_MIME: &str = "text/html";
pub const JSON_MIME: &str = "application/json";

/// Errors carry no secret material: the master key is never formatted into a message.
#[derive(Debug)]
pub enum RelayError {
    Usage(String),
    MissingMasterKey,
    InsecureMasterKeyFile(PathBuf),
    InvalidMasterKey,
    NoCaptureFound(PathBuf),
    BodyTooLarge { size: usize, limit: usize },
    Unauthorized,
    ServerUnconfigured,
    Http(u16),
    BadResponse(String),
    Transport(String),
}

impl fmt::Display for RelayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Usage(m) => write!(f, "usage: {m}"),
            Self::MissingMasterKey => write!(
                f,
                "missing master key: set RELAY_MASTER_KEY or create ~/.config/fong-relay/master (mode 0600)"
            ),
            Self::InsecureMasterKeyFile(p) => write!(
                f,
                "insecure permissions on master key file {}: mode must not be group or world readable",
                p.display()
            ),
            Self::InvalidMasterKey => {
                write!(f, "master key contains control characters; refusing to send it")
            }
            Self::NoCaptureFound(d) => write!(f, "no capture found in {}", d.display()),
            Self::BodyTooLarge { size, limit } => {
                write!(f, "too large: {size} bytes exceeds relay limit {limit}")
            }
            Self::Unauthorized => write!(f, "unauthorized: relay rejected the master key (HTTP 401)"),
            Self::ServerUnconfigured => write!(f, "relay server unconfigured (HTTP 503)"),
            Self::Http(s) => write!(f, "relay returned HTTP {s}"),
            Self::BadResponse(m) => write!(f, "bad relay response: {m}"),
            Self::Transport(m) => write!(f, "upload failed: {m}"),
        }
    }
}

impl std::error::Error for RelayError {}

impl RelayError {
    pub fn exit_code(&self) -> i32 {
        match self {
            Self::Unauthorized => EXIT_UNAUTHORIZED,
            Self::NoCaptureFound(_) => EXIT_NO_CAPTURE,
            Self::MissingMasterKey | Self::InsecureMasterKeyFile(_) | Self::InvalidMasterKey => {
                EXIT_SECRET
            }
            Self::BodyTooLarge { .. } => EXIT_TOO_LARGE,
            _ => EXIT_OTHER,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadOutcome {
    pub key: String,
    pub read_url: String,
    pub expires_in_sec: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturePair {
    pub html: PathBuf,
    pub sidecar: Option<PathBuf>,
}

/// One POST of the raw bytes at `body_path` to `url`, carrying the master key
/// (and optional `x-relay-mime`) as headers. Returns (status, raw body).
pub trait Transport {
    fn post(
        &self,
        url: &str,
        master: &str,
        mime: Option<&str>,
        body_path: &Path,
    ) -> Result<(u16, Vec<u8>), RelayError>;
}

// ---------------------------------------------------------------------------
// Transport 1 (default): ureq with rustls, connect 10s / total 30s.
// ---------------------------------------------------------------------------

pub struct UreqTransport {
    agent: ureq::Agent,
}

impl Default for UreqTransport {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(CONNECT_TIMEOUT_SECS))
                .timeout(Duration::from_secs(TOTAL_TIMEOUT_SECS))
                .build(),
        }
    }
}

impl Transport for UreqTransport {
    fn post(
        &self,
        url: &str,
        master: &str,
        mime: Option<&str>,
        body_path: &Path,
    ) -> Result<(u16, Vec<u8>), RelayError> {
        let bytes = fs::read(body_path)
            .map_err(|e| RelayError::Transport(format!("cannot read {}: {e}", body_path.display())))?;
        let mut req = self.agent.post(url).set("x-relay-master", master);
        if let Some(m) = mime {
            req = req.set("x-relay-mime", m).set("Content-Type", m);
        } else {
            req = req.set("Content-Type", "application/octet-stream");
        }
        let res = match req.send(&bytes[..]) {
            Ok(r) => r,
            Err(ureq::Error::Status(_code, r)) => r,
            Err(e) => return Err(RelayError::Transport(e.to_string())),
        };
        let status = res.status();
        let body = res
            .into_string()
            .map_err(|e| RelayError::Transport(format!("cannot read relay body: {e}")))?
            .into_bytes();
        Ok((status, body))
    }
}

// ---------------------------------------------------------------------------
// Transport 2 (fallback): system curl. The master key travels through a
// `curl -K -` config fed on stdin, so it never lands in argv or on disk.
// ---------------------------------------------------------------------------

pub struct CurlTransport {
    pub curl: String,
    pub connect_timeout: Duration,
    pub total_timeout: Duration,
}

impl Default for CurlTransport {
    fn default() -> Self {
        Self {
            curl: "curl".to_string(),
            connect_timeout: Duration::from_secs(CONNECT_TIMEOUT_SECS),
            total_timeout: Duration::from_secs(TOTAL_TIMEOUT_SECS),
        }
    }
}

/// Escape a value for a double-quoted `curl -K -` config line: backslash and
/// quote escaped, control characters dropped so the master key can never
/// break out of its quoted token.
pub fn curl_config_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out
}

fn config_line(option: &str, value: &str) -> String {
    format!("{option} = \"{}\"\n", curl_config_escape(value))
}

impl Transport for CurlTransport {
    fn post(
        &self,
        url: &str,
        master: &str,
        mime: Option<&str>,
        body_path: &Path,
    ) -> Result<(u16, Vec<u8>), RelayError> {
        let mut cfg = String::new();
        cfg.push_str(&config_line("header", &format!("x-relay-master: {master}")));
        if let Some(m) = mime {
            cfg.push_str(&config_line("header", &format!("x-relay-mime: {m}")));
        }
        cfg.push_str(&config_line("request", "POST"));
        cfg.push_str(&config_line("data-binary", &format!("@{}", body_path.display())));

        let mut child = Command::new(&self.curl)
            .arg("-sS")
            .arg("--connect-timeout")
            .arg(self.connect_timeout.as_secs().to_string())
            .arg("--max-time")
            .arg(self.total_timeout.as_secs().to_string())
            .args(["-o", "-", "-w", "\n%{http_code}", "-K", "-"])
            .arg(url)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RelayError::Transport(format!("cannot spawn {}: {e}", self.curl)))?;
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| RelayError::Transport("curl stdin unavailable".to_string()))?;
            stdin
                .write_all(cfg.as_bytes())
                .map_err(|e| RelayError::Transport(format!("cannot feed curl config: {e}")))?;
        }
        let out = child
            .wait_with_output()
            .map_err(|e| RelayError::Transport(format!("cannot wait for curl: {e}")))?;
        if !out.status.success() {
            let mut msg = String::from_utf8_lossy(&out.stderr).to_string();
            if msg.len() > 300 {
                msg.truncate(300);
            }
            return Err(RelayError::Transport(format!(
                "curl exit {}: {}",
                out.status,
                msg.trim()
            )));
        }
        split_status_body(&out.stdout)
            .ok_or_else(|| RelayError::BadResponse("curl output missing HTTP status".to_string()))
    }
}

/// curl stdout is `<body>\n<status>`; split on the last newline (binary safe).
pub fn split_status_body(stdout: &[u8]) -> Option<(u16, Vec<u8>)> {
    let pos = stdout.iter().rposition(|&b| b == b'\n')?;
    let status_txt = std::str::from_utf8(&stdout[pos + 1..]).ok()?;
    let status: u16 = status_txt.trim().parse().ok()?;
    Some((status, stdout[..pos].to_vec()))
}

// ---------------------------------------------------------------------------
// Upload flow (transport-agnostic).
// ---------------------------------------------------------------------------

pub fn push_file<T: Transport>(
    transport: &T,
    base: &str,
    path: &Path,
    mime: Option<&str>,
    master: &str,
) -> Result<UploadOutcome, RelayError> {
    let meta = fs::metadata(path)
        .map_err(|e| RelayError::Usage(format!("cannot read {}: {e}", path.display())))?;
    let size = meta.len();
    if size > MAX_BODY_BYTES as u64 {
        return Err(RelayError::BodyTooLarge {
            size: size as usize,
            limit: MAX_BODY_BYTES,
        });
    }
    let url = format!("{}/put", base.trim_end_matches('/'));
    let (status, body) = transport.post(&url, master, mime, path)?;
    finish_response(status, &body)
}

/// Map an HTTP status + body to an outcome or a readable error.
pub fn finish_response(status: u16, body: &[u8]) -> Result<UploadOutcome, RelayError> {
    match status {
        200 => parse_outcome(body),
        401 => Err(RelayError::Unauthorized),
        413 => Err(RelayError::BodyTooLarge {
            size: MAX_BODY_BYTES,
            limit: MAX_BODY_BYTES,
        }),
        503 => Err(RelayError::ServerUnconfigured),
        s => Err(RelayError::Http(s)),
    }
}

fn truncate_snippet(body: &[u8]) -> String {
    let s = String::from_utf8_lossy(body);
    let mut s: String = s.chars().take(200).collect();
    if s.contains('\n') {
        s = s.replace('\n', " ");
    }
    s
}

/// Parse a 200 body `{"key":..,"readUrl":..,"expiresInSec":..}`.
pub fn parse_outcome(body: &[u8]) -> Result<UploadOutcome, RelayError> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| RelayError::BadResponse(format!("invalid JSON: {e}")))?;
    let key = v.get("key").and_then(Value::as_str).unwrap_or_default();
    let read_url = v.get("readUrl").and_then(Value::as_str).unwrap_or_default();
    let expires_in_sec = v.get("expiresInSec").and_then(Value::as_u64).unwrap_or(0);
    if key.is_empty() || read_url.is_empty() {
        return Err(RelayError::BadResponse(format!(
            "missing key/readUrl in: {}",
            truncate_snippet(body)
        )));
    }
    Ok(UploadOutcome {
        key: key.to_string(),
        read_url: read_url.to_string(),
        expires_in_sec,
    })
}

/// Exactly one stdout line per upload: {file, key, readUrl, expiresInSec}.
pub fn outcome_line(file: &Path, o: &UploadOutcome) -> String {
    json!({
        "file": file.display().to_string(),
        "key": o.key,
        "readUrl": o.read_url,
        "expiresInSec": o.expires_in_sec,
    })
    .to_string()
}

// ---------------------------------------------------------------------------
// Capture discovery (--latest).
// ---------------------------------------------------------------------------

pub fn is_capture_html(name: &str) -> bool {
    name.starts_with("dom-capture_") && name.ends_with(".html")
}

pub fn sidecar_for(html: &Path) -> PathBuf {
    let mut s = html.as_os_str().to_os_string();
    s.push(".context.json");
    PathBuf::from(s)
}

/// Newest `dom-capture_*.html` by modification time, plus its
/// `<same>.html.context.json` sidecar when present.
pub fn find_latest_pair(dir: &Path) -> Result<CapturePair, RelayError> {
    let entries = fs::read_dir(dir).map_err(|e| {
        RelayError::Usage(format!("cannot read directory {}: {e}", dir.display()))
    })?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !is_capture_html(name) {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().map_or(true, |(_, t)| mtime > *t) {
            best = Some((entry.path(), mtime));
        }
    }
    let Some((html, _)) = best else {
        return Err(RelayError::NoCaptureFound(dir.to_path_buf()));
    };
    let sidecar = sidecar_for(&html);
    let sidecar = if sidecar.exists() { Some(sidecar) } else { None };
    Ok(CapturePair { html, sidecar })
}

// ---------------------------------------------------------------------------
// Master key resolution. The key is never printed, never in argv, never in errors.
// ---------------------------------------------------------------------------

/// Reject keys that could not travel as an HTTP header value (no value is echoed).
fn validate_master_key(key: &str) -> Result<String, RelayError> {
    if key.is_empty() {
        return Err(RelayError::MissingMasterKey);
    }
    if key.chars().any(|c| (c as u32) < 0x20 || (c as u32) == 0x7f) {
        return Err(RelayError::InvalidMasterKey);
    }
    Ok(key.to_string())
}

pub fn master_key_from_env() -> Option<String> {
    std::env::var("RELAY_MASTER_KEY")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn master_key_file() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let mut p = PathBuf::from(home);
    p.push(".config");
    p.push("fong-relay");
    p.push("master");
    Some(p)
}

/// Read the key file; refuse when group or world can read it (mode & 0o077 != 0).
pub fn master_key_from_file(path: &Path) -> Result<String, RelayError> {
    let meta = fs::metadata(path).map_err(|_| RelayError::MissingMasterKey)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err(RelayError::InsecureMasterKeyFile(path.to_path_buf()));
        }
    }
    let content = fs::read_to_string(path).map_err(|_| RelayError::MissingMasterKey)?;
    validate_master_key(content.trim())
}

/// RELAY_MASTER_KEY first, then ~/.config/fong-relay/master (mode-checked).
pub fn load_master_key() -> Result<String, RelayError> {
    if let Some(k) = master_key_from_env() {
        return validate_master_key(&k);
    }
    match master_key_file() {
        Some(p) => master_key_from_file(&p),
        None => Err(RelayError::MissingMasterKey),
    }
}

// ---------------------------------------------------------------------------
// Tests: pure logic (discovery, response mapping, secret file mode, escapes).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "relay-push-lib-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&d).expect("mkdir");
        d
    }

    fn write_with_mtime(p: &Path, secs: u64) {
        fs::write(p, "x").expect("write");
        let f = fs::File::options().write(true).open(p).expect("open");
        f.set_times(
            fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(secs)),
        )
        .expect("set mtime");
    }

    #[test]
    fn find_latest_pair_picks_newest_html_with_sidecar() {
        let d = temp_dir("latest");
        write_with_mtime(&d.join("dom-capture_120000_a_aa11bb22.html"), 1000);
        write_with_mtime(&d.join("dom-capture_130000_b_cc33dd44.html"), 2000);
        write_with_mtime(&d.join("dom-capture_140000_c_ee55ff66.html"), 3000);
        fs::write(d.join("dom-capture_140000_c_ee55ff66.html.context.json"), "{}").expect("sidecar");
        fs::write(d.join("other.html"), "x").expect("noise");
        let pair = find_latest_pair(&d).expect("pair");
        assert_eq!(
            pair.html,
            d.join("dom-capture_140000_c_ee55ff66.html")
        );
        assert_eq!(
            pair.sidecar,
            Some(d.join("dom-capture_140000_c_ee55ff66.html.context.json"))
        );
        fs::remove_dir_all(&d).expect("cleanup");
    }

    #[test]
    fn find_latest_pair_missing_sidecar_is_none_and_empty_dir_errors() {
        let d = temp_dir("latest2");
        write_with_mtime(&d.join("dom-capture_090000_z_1234abcd.html"), 500);
        let pair = find_latest_pair(&d).expect("pair");
        assert_eq!(pair.sidecar, None);
        let empty = temp_dir("latest2-empty");
        let err = find_latest_pair(&empty).unwrap_err();
        assert!(matches!(err, RelayError::NoCaptureFound(_)));
        assert_eq!(err.exit_code(), EXIT_NO_CAPTURE);
        assert!(err.to_string().contains("no capture found"));
        fs::remove_dir_all(&d).expect("cleanup");
        fs::remove_dir_all(&empty).expect("cleanup");
    }

    #[test]
    fn parse_outcome_reads_all_fields() {
        let o = parse_outcome(
            br#"{"key":"ab12cd34","readUrl":"https://r/get/ab12cd34","expiresInSec":900}"#,
        )
        .expect("ok");
        assert_eq!(o.key, "ab12cd34");
        assert_eq!(o.read_url, "https://r/get/ab12cd34");
        assert_eq!(o.expires_in_sec, 900);
    }

    #[test]
    fn status_mapping_is_readable_and_without_secrets() {
        let e = finish_response(401, br#"{"error":"nope"}"#).unwrap_err();
        assert!(matches!(e, RelayError::Unauthorized));
        assert_eq!(e.exit_code(), EXIT_UNAUTHORIZED);
        assert!(e.to_string().contains("unauthorized"));

        let e = finish_response(413, b"").unwrap_err();
        assert_eq!(e.exit_code(), EXIT_TOO_LARGE);
        assert!(e.to_string().contains("too large"));
        assert!(e.to_string().contains("4194304"));

        let e = finish_response(503, b"").unwrap_err();
        assert!(matches!(e, RelayError::ServerUnconfigured));

        let e = finish_response(200, b"not json").unwrap_err();
        assert!(matches!(e, RelayError::BadResponse(_)));
    }

    #[test]
    fn master_key_file_mode_is_enforced() {
        let d = temp_dir("keyfile");
        let p = d.join("master");
        fs::write(&p, " secret-value \n").expect("write");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).expect("chmod");
        assert_eq!(master_key_from_file(&p).expect("ok"), "secret-value");

        fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).expect("chmod");
        let err = master_key_from_file(&p).unwrap_err();
        assert!(matches!(err, RelayError::InsecureMasterKeyFile(_)));
        assert_eq!(err.exit_code(), EXIT_SECRET);
        assert!(err.to_string().contains("insecure permissions"));
        assert!(!err.to_string().contains("secret-value"));

        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).expect("chmod");
        fs::write(&p, "   \n").expect("write");
        let err = master_key_from_file(&p).unwrap_err();
        assert!(matches!(err, RelayError::MissingMasterKey));

        let err = master_key_from_file(&d.join("absent")).unwrap_err();
        assert!(matches!(err, RelayError::MissingMasterKey));
        fs::remove_dir_all(&d).expect("cleanup");
    }

    #[test]
    fn master_key_validation_rejects_control_chars_without_echo() {
        let err = validate_master_key("bad\nkey").unwrap_err();
        assert!(matches!(err, RelayError::InvalidMasterKey));
        assert!(!err.to_string().contains("bad"));
        assert!(validate_master_key("plain-key").is_ok());
    }

    #[test]
    fn curl_config_escape_never_breaks_out_of_quotes() {
        assert_eq!(curl_config_escape("a\"b\\c"), "a\\\"b\\\\c");
        assert_eq!(curl_config_escape("x\ny\rz"), "xyz");
    }

    #[test]
    fn split_status_body_is_binary_safe() {
        let (s, b) = split_status_body(b"hi\nthere\n200").expect("split");
        assert_eq!(s, 200);
        assert_eq!(b, b"hi\nthere");
        let (s, b) = split_status_body(b"\n404").expect("split");
        assert_eq!(s, 404);
        assert!(b.is_empty());
        assert!(split_status_body(b"garbage").is_none());
    }
}
