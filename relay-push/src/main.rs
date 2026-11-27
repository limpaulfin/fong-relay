//! relay-push CLI: thin wrapper over the lib (discovery, transports, exit codes).

use std::path::{Path, PathBuf};
use std::process::exit;

use relay_push::{
    find_latest_pair, load_master_key, outcome_line, push_file, CurlTransport, RelayError,
    Transport, UreqTransport, DEFAULT_BASE, HTML_MIME, JSON_MIME,
};

fn default_mime(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => Some(HTML_MIME),
        Some("json") => Some(JSON_MIME),
        _ => None,
    }
}

fn upload<T: Transport>(
    t: &T,
    base: &str,
    path: &Path,
    mime: Option<&str>,
    secret: &str,
) -> i32 {
    match push_file(t, base, path, mime, secret) {
        Ok(o) => {
            println!("{}", outcome_line(path, &o));
            0
        }
        Err(e) => {
            eprintln!("relay-push: {e}");
            e.exit_code()
        }
    }
}

fn run() -> Result<i32, RelayError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut base = DEFAULT_BASE.to_string();
    let mut mime: Option<String> = None;
    let mut latest: Option<PathBuf> = None;
    let mut file: Option<PathBuf> = None;
    let mut version = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "--version" {
            version = true;
        } else if a == "--base" || a == "--mime" || a == "--latest" {
            i += 1;
            let v = args
                .get(i)
                .ok_or_else(|| RelayError::Usage(format!("{a} needs a value")))?
                .clone();
            if a == "--base" {
                base = v;
            } else if a == "--mime" {
                mime = Some(v);
            } else {
                latest = Some(PathBuf::from(v));
            }
        } else if a.starts_with('-') {
            return Err(RelayError::Usage(format!("unknown flag {a}")));
        } else if file.is_some() {
            return Err(RelayError::Usage("only one FILE is allowed".to_string()));
        } else {
            file = Some(PathBuf::from(a));
        }
        i += 1;
    }

    if version {
        println!("relay-push {}", env!("CARGO_PKG_VERSION"));
        return Ok(0);
    }
    if latest.is_some() && (file.is_some() || mime.is_some()) {
        return Err(RelayError::Usage(
            "--latest takes only DIR and --base".to_string(),
        ));
    }

    let secret = load_master_key()?;
    if std::env::var("RELAY_PUSH_TRANSPORT").as_deref() == Ok("curl") {
        let t = CurlTransport::default();
        dispatch(&t, &base, latest, file, mime.as_deref(), &secret)
    } else {
        let t = UreqTransport::default();
        dispatch(&t, &base, latest, file, mime.as_deref(), &secret)
    }
}

fn dispatch<T: Transport>(
    t: &T,
    base: &str,
    latest: Option<PathBuf>,
    file: Option<PathBuf>,
    mime: Option<&str>,
    secret: &str,
) -> Result<i32, RelayError> {
    if let Some(dir) = latest {
        let pair = find_latest_pair(&dir)?;
        let rc = upload(t, base, &pair.html, Some(HTML_MIME), secret);
        if rc != 0 {
            return Ok(rc);
        }
        if let Some(sc) = pair.sidecar {
            return Ok(upload(t, base, &sc, Some(JSON_MIME), secret));
        }
        return Ok(0);
    }
    let Some(file) = file else {
        return Err(RelayError::Usage(
            "expected FILE or --latest DIR (see --version)".to_string(),
        ));
    };
    let m = match mime {
        Some(v) => Some(v),
        None => default_mime(&file),
    };
    Ok(upload(t, base, &file, m, secret))
}

fn main() {
    let code = match run() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("relay-push: {e}");
            e.exit_code()
        }
    };
    if code != 0 {
        exit(code);
    }
}
