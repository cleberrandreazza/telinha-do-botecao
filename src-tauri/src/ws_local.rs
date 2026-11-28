//! WebSocket binário mínimo em `127.0.0.1`. O quadro fica no `Vec` de quem chama:
//! o envio escreve esse buffer e não guarda outra cópia.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

pub fn bind() -> Result<(TcpListener, u16), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
    let port = listener.local_addr().map_err(|err| err.to_string())?.port();
    Ok((listener, port))
}

pub fn accept(listener: &TcpListener, stop: &AtomicBool) -> Result<TcpStream, String> {
    listener.set_nonblocking(true).map_err(|err| err.to_string())?;
    let started = Instant::now();
    let stream = loop {
        if stop.load(Ordering::Relaxed) {
            return Err("A captura foi encerrada.".into());
        }
        if started.elapsed() > Duration::from_secs(30) {
            return Err("O frontend não conectou na captura local.".into());
        }
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(err) => return Err(err.to_string()),
        }
    };
    stream.set_nonblocking(false).map_err(|err| err.to_string())?;
    // Vídeo e áudio usam este aceite. Sem Nagle, o quadro não espera no TCP.
    stream.set_nodelay(true).map_err(|err| err.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|err| err.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(500)))
        .map_err(|err| err.to_string())?;
    handshake(&stream)?;
    Ok(stream)
}

pub fn write_binary(stream: &mut TcpStream, payload: &[u8]) -> Result<(), String> {
    let mut header = [0u8; 10];
    header[0] = 0x82;
    let header_len = if payload.len() < 126 {
        header[1] = payload.len() as u8;
        2
    } else if payload.len() <= u16::MAX as usize {
        header[1] = 126;
        header[2..4].copy_from_slice(&(payload.len() as u16).to_be_bytes());
        4
    } else {
        header[1] = 127;
        header[2..10].copy_from_slice(&(payload.len() as u64).to_be_bytes());
        10
    };
    stream.write_all(&header[..header_len]).map_err(|err| err.to_string())?;
    stream.write_all(payload).map_err(|err| err.to_string())?;
    stream.flush().map_err(|err| err.to_string())
}

/// Lê um quadro do cliente. `Ok(None)` é timeout: o quadro anterior segue valendo.
pub fn read_client(stream: &mut TcpStream) -> Result<Option<u8>, String> {
    let mut head = [0u8; 2];
    match stream.read_exact(&mut head) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::WouldBlock || err.kind() == std::io::ErrorKind::TimedOut => {
            return Ok(None);
        }
        Err(err) => return Err(err.to_string()),
    }
    let opcode = head[0] & 0x0f;
    let masked = head[1] & 0x80 != 0;
    let mut len = (head[1] & 0x7f) as u64;
    if len == 126 {
        let mut ext = [0u8; 2];
        stream.read_exact(&mut ext).map_err(|err| err.to_string())?;
        len = u16::from_be_bytes(ext) as u64;
    } else if len == 127 {
        let mut ext = [0u8; 8];
        stream.read_exact(&mut ext).map_err(|err| err.to_string())?;
        len = u64::from_be_bytes(ext);
    }
    if len > 1024 * 1024 {
        return Err("Quadro de controle grande demais.".into());
    }
    let mut mask = [0u8; 4];
    if masked {
        stream.read_exact(&mut mask).map_err(|err| err.to_string())?;
    }
    let mut payload = vec![0u8; len as usize];
    if len > 0 {
        stream.read_exact(&mut payload).map_err(|err| err.to_string())?;
        if masked {
            for (index, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[index % 4];
            }
        }
    }
    if opcode == 0x8 {
        return Err("O frontend fechou o WebSocket.".into());
    }
    if opcode == 0x9 {
        let mut frame = Vec::with_capacity(2 + payload.len());
        frame.push(0x8A);
        frame.push(payload.len() as u8);
        frame.extend_from_slice(&payload);
        stream.write_all(&frame).map_err(|err| err.to_string())?;
    }
    Ok(Some(opcode))
}

fn handshake(mut stream: &TcpStream) -> Result<(), String> {
    let mut request = Vec::new();
    let mut byte = [0u8; 1];
    while request.len() < 8192 {
        stream.read_exact(&mut byte).map_err(|err| err.to_string())?;
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8(request).map_err(|err| err.to_string())?;
    let key = text
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("sec-websocket-key") {
                Some(value.trim())
            } else {
                None
            }
        })
        .ok_or("Pedido WebSocket sem chave.")?;
    let accept = accept_key(key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).map_err(|err| err.to_string())?;
    stream.flush().map_err(|err| err.to_string())
}

fn accept_key(key: &str) -> String {
    let digest = sha1(format!("{key}{GUID}").as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

fn sha1(message: &[u8]) -> [u8; 20] {
    let mut h = [
        0x6745_2301u32,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let bit_len = (message.len() as u64).saturating_mul(8);
    let mut data = Vec::with_capacity(message.len() + 72);
    data.extend_from_slice(message);
    data.push(0x80);
    while data.len() % 64 != 56 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in data.chunks_exact(64) {
        let mut word = [0u32; 80];
        for index in 0..16 {
            word[index] = u32::from_be_bytes(chunk[index * 4..index * 4 + 4].try_into().unwrap());
        }
        for index in 16..80 {
            word[index] = (word[index - 3] ^ word[index - 8] ^ word[index - 14] ^ word[index - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for index in 0..80 {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(word[index]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (index, value) in h.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_accept_matches_the_rfc_sample() {
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }
}
