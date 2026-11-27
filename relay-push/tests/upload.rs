//! Integration tests: real TCP mock relay + both transports.
//! Asserts POST /put, x-relay-master presence, exact body bytes, and the
//! 401/413 error mappings (readable, never echoing the secret).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use relay_push::{
    push_file, CurlTransport, RelayError, UreqTransport, MAX_BODY_BYTES, EXIT_TOO_LARGE,
    EXIT_UNAUTHORIZED,
};

const SECRET: &str = "test-master-secret-abc123";

#[derive(Debug)]
struct Captured {
    method: String,
    path: String,
    master: Option<String>,
    body: Vec<u8>,
}

fn temp_file(tag: &str, bytes: &[u8]) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "relay-push-it-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&p, bytes).expect("write temp file");
    p
}

fn spawn_mock(reply_status: u16, reply_body: &str) -> (String, mpsc::Receiver<Result<Captured, String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock");
    let addr = listener.local_addr().expect("mock addr");
    let reply = format!(
        "HTTP/1.1 {} x\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reply_status,
        reply_body.len(),
        reply_body
    );
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let res = (|| -> Result<Captured, String> {
            let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
            let captured = read_request(&mut stream)?;
            stream.write_all(reply.as_bytes()).map_err(|e| e.to_string())?;
            stream.flush().map_err(|e| e.to_string())?;
            Ok(captured)
        })();
        let _ = tx.send(res);
    });
    (format!("http://{addr}"), rx)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

/// Decode a chunked request body (ureq uses Transfer-Encoding: chunked).
fn decode_chunked(raw: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut i = 0usize;
    loop {
        let rel = raw[i..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("bad chunk size line")?;
        let size_line = String::from_utf8_lossy(&raw[i..i + rel]).to_string();
        let size = usize::from_str_radix(
            size_line.split(';').next().unwrap_or("0").trim(),
            16,
        )
        .map_err(|_| "bad chunk hex".to_string())?;
        i += rel + 2;
        if size == 0 {
            break;
        }
        if i + size + 2 > raw.len() {
            return Err("incomplete chunk".to_string());
        }
        out.extend_from_slice(&raw[i..i + size]);
        i += size + 2;
    }
    Ok(out)
}

fn read_request(stream: &mut TcpStream) -> Result<Captured, String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("client closed before headers finished".to_string());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(p) = find_header_end(&buf) {
            break p;
        }
        if buf.len() > 65_536 {
            return Err("headers too big".to_string());
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let reqline = lines.next().unwrap_or("");
    let mut parts = reqline.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    let mut master: Option<String> = None;
    let mut expect_continue = false;
    let mut chunked = false;
    for line in lines {
        let Some((k, v)) = line.split_once(':') else { continue };
        let k = k.trim().to_ascii_lowercase();
        let v = v.trim().to_string();
        if k == "content-length" {
            content_length = v.parse().unwrap_or(0);
        } else if k == "x-relay-master" {
            master = Some(v);
        } else if k == "expect" && v.to_ascii_lowercase().contains("100-continue") {
            expect_continue = true;
        } else if k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
            chunked = true;
        }
    }
    if expect_continue && content_length > buf.len() - header_end {
        stream
            .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
            .map_err(|e| e.to_string())?;
    }
    let mut body = buf[header_end..].to_vec();
    if chunked {
        while !body.ends_with(b"0\r\n\r\n") && body.len() < 1_048_576 {
            let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
        body = decode_chunked(&body)?;
    } else {
        while body.len() < content_length {
            let n = stream.read(&mut tmp).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
    }
    Ok(Captured {
        method,
        path,
        master,
        body,
    })
}

#[test]
fn ureq_success_posts_exact_body_and_parses_outcome() {
    let bytes = b"<html>hello relay</html>".to_vec();
    let f = temp_file("ureq-ok", &bytes);
    let (base, rx) = spawn_mock(
        200,
        r#"{"key":"ab12cd34","readUrl":"http://127.0.0.1:9/get/ab12cd34","expiresInSec":900}"#,
    );
    let out = push_file(&UreqTransport::default(), &base, &f, Some("text/html"), SECRET)
        .expect("upload ok");
    assert_eq!(out.key, "ab12cd34");
    assert_eq!(out.read_url, "http://127.0.0.1:9/get/ab12cd34");
    assert_eq!(out.expires_in_sec, 900);
    let captured = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("mock replied")
        .expect("mock read request");
    assert_eq!(captured.method, "POST");
    assert_eq!(captured.path, "/put");
    assert_eq!(captured.master.as_deref(), Some(SECRET));
    assert_eq!(captured.body, bytes);
    let _ = std::fs::remove_file(&f);
}

#[test]
fn curl_success_posts_exact_body_and_parses_outcome() {
    let bytes = b"<html>curl transport</html>".to_vec();
    let f = temp_file("curl-ok", &bytes);
    let (base, rx) = spawn_mock(
        200,
        r#"{"key":"ef90ab12","readUrl":"http://127.0.0.1:9/get/ef90ab12","expiresInSec":600}"#,
    );
    let out = push_file(&CurlTransport::default(), &base, &f, Some("text/html"), SECRET)
        .expect("upload ok");
    assert_eq!(out.key, "ef90ab12");
    assert_eq!(out.read_url, "http://127.0.0.1:9/get/ef90ab12");
    assert_eq!(out.expires_in_sec, 600);
    let captured = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("mock replied")
        .expect("mock read request");
    assert_eq!(captured.method, "POST");
    assert_eq!(captured.path, "/put");
    assert_eq!(captured.master.as_deref(), Some(SECRET));
    assert_eq!(captured.body, bytes);
    let _ = std::fs::remove_file(&f);
}

#[test]
fn unauthorized_maps_to_exit_2_without_echoing_secret() {
    let f = temp_file("u401", b"x");
    let (base, rx) = spawn_mock(401, r#"{"error":"bad key"}"#);
    let err = push_file(&CurlTransport::default(), &base, &f, None, SECRET).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("unauthorized"), "msg: {msg}");
    assert!(!msg.contains(SECRET), "secret leaked: {msg}");
    assert_eq!(err.exit_code(), EXIT_UNAUTHORIZED);
    let _ = rx.recv_timeout(Duration::from_secs(10));
    let _ = std::fs::remove_file(&f);
}

#[test]
fn too_large_maps_to_exit_5_with_limit() {
    let f = temp_file("e413", b"x");
    let (base, rx) = spawn_mock(413, r#"{"error":"too large"}"#);
    let err = push_file(&UreqTransport::default(), &base, &f, None, SECRET).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("too large"), "msg: {msg}");
    assert!(msg.contains(&MAX_BODY_BYTES.to_string()), "msg: {msg}");
    assert!(!msg.contains(SECRET));
    assert_eq!(err.exit_code(), EXIT_TOO_LARGE);
    let _ = rx.recv_timeout(Duration::from_secs(10));
    let _ = std::fs::remove_file(&f);
}

#[test]
fn oversize_file_is_rejected_before_any_network_call() {
    let big = vec![0u8; MAX_BODY_BYTES + 1];
    let f = temp_file("big", &big);
    let err = push_file(
        &CurlTransport::default(),
        "http://127.0.0.1:1",
        &f,
        None,
        SECRET,
    )
    .unwrap_err();
    assert!(matches!(err, RelayError::BodyTooLarge { .. }));
    assert_eq!(err.exit_code(), EXIT_TOO_LARGE);
    let _ = std::fs::remove_file(&f);
}
