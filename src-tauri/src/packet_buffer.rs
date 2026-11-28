//! Pacote binário de 16 bytes e buffer de jitter.
//!
//! O relay reencaminha estes bytes sem re-codificar. O buffer só remonta e
//! ordena. Perda de um delta pede PLI até o próximo keyframe.

use std::collections::BTreeMap;

pub const HEADER_LEN: usize = 16;
pub const MAX_PACKET_LEN: usize = 16_000;
pub const MAX_PAYLOAD: usize = MAX_PACKET_LEN - HEADER_LEN;
pub const KEYFRAME_FLAG: u8 = 0x01;
pub const GAMING_BUFFER_MS: u32 = 45;
pub const CINEMA_BUFFER_MS: u32 = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PacketError {
    Short,
    TooLarge,
    LengthMismatch,
    BadFragment,
    FrameTooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PacketHeader {
    pub media_type: u8,
    pub flags: u8,
    pub seq_number: u16,
    pub timestamp: u32,
    pub frag_idx: u8,
    pub frag_total: u8,
    pub payload_len: u16,
    pub stream_id: u32,
}

impl PacketHeader {
    pub fn is_keyframe(self) -> bool {
        self.flags & KEYFRAME_FLAG != 0
    }

    pub fn encode(self) -> [u8; HEADER_LEN] {
        let mut out = [0u8; HEADER_LEN];
        out[0] = self.media_type;
        out[1] = self.flags;
        out[2..4].copy_from_slice(&self.seq_number.to_be_bytes());
        out[4..8].copy_from_slice(&self.timestamp.to_be_bytes());
        out[8] = self.frag_idx;
        out[9] = self.frag_total;
        out[10..12].copy_from_slice(&self.payload_len.to_be_bytes());
        out[12..16].copy_from_slice(&self.stream_id.to_be_bytes());
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedPacket {
    pub header: PacketHeader,
    pub payload: Vec<u8>,
}

pub fn decode_packet(bytes: &[u8]) -> Result<DecodedPacket, PacketError> {
    if bytes.len() < HEADER_LEN {
        return Err(PacketError::Short);
    }
    if bytes.len() > MAX_PACKET_LEN {
        return Err(PacketError::TooLarge);
    }
    let header = PacketHeader {
        media_type: bytes[0],
        flags: bytes[1],
        seq_number: u16::from_be_bytes([bytes[2], bytes[3]]),
        timestamp: u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
        frag_idx: bytes[8],
        frag_total: bytes[9],
        payload_len: u16::from_be_bytes([bytes[10], bytes[11]]),
        stream_id: u32::from_be_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]),
    };
    if header.frag_total == 0 || header.frag_idx >= header.frag_total {
        return Err(PacketError::BadFragment);
    }
    if header.payload_len as usize > MAX_PAYLOAD {
        return Err(PacketError::TooLarge);
    }
    let payload = bytes[HEADER_LEN..].to_vec();
    if payload.len() != header.payload_len as usize {
        return Err(PacketError::LengthMismatch);
    }
    Ok(DecodedPacket { header, payload })
}

pub fn fragment_frame(
    media_type: u8,
    flags: u8,
    seq_number: u16,
    timestamp: u32,
    stream_id: u32,
    payload: &[u8],
) -> Result<Vec<Vec<u8>>, PacketError> {
    let chunks = payload.chunks(MAX_PAYLOAD).collect::<Vec<_>>();
    let total = if chunks.is_empty() { 1 } else { chunks.len() };
    if total > u8::MAX as usize {
        return Err(PacketError::FrameTooLarge);
    }
    let mut packets = Vec::with_capacity(total);
    if chunks.is_empty() {
        packets.push(encode_one(media_type, flags, seq_number, timestamp, stream_id, 0, 1, &[]));
        return Ok(packets);
    }
    for (index, chunk) in chunks.into_iter().enumerate() {
        packets.push(encode_one(
            media_type,
            flags,
            seq_number,
            timestamp,
            stream_id,
            index as u8,
            total as u8,
            chunk,
        ));
    }
    Ok(packets)
}

fn encode_one(
    media_type: u8,
    flags: u8,
    seq_number: u16,
    timestamp: u32,
    stream_id: u32,
    frag_idx: u8,
    frag_total: u8,
    chunk: &[u8],
) -> Vec<u8> {
    let header = PacketHeader {
        media_type,
        flags,
        seq_number,
        timestamp,
        frag_idx,
        frag_total,
        payload_len: chunk.len() as u16,
        stream_id,
    };
    let mut packet = Vec::with_capacity(HEADER_LEN + chunk.len());
    packet.extend_from_slice(&header.encode());
    packet.extend_from_slice(chunk);
    packet
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferMode {
    Gaming,
    Cinema,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledFrame {
    pub seq_number: u16,
    pub timestamp: u32,
    pub stream_id: u32,
    pub media_type: u8,
    pub keyframe: bool,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushOutcome {
    pub frames: Vec<AssembledFrame>,
    pub request_pli: bool,
}

struct Slot {
    media_type: u8,
    flags: u8,
    timestamp: u32,
    stream_id: u32,
    frag_total: u8,
    frags: BTreeMap<u8, Vec<u8>>,
}

impl Slot {
    fn new(header: &PacketHeader) -> Self {
        Self {
            media_type: header.media_type,
            flags: header.flags,
            timestamp: header.timestamp,
            stream_id: header.stream_id,
            frag_total: header.frag_total,
            frags: BTreeMap::new(),
        }
    }

    fn is_complete(&self) -> bool {
        self.frags.len() == self.frag_total as usize
    }

    fn is_keyframe(&self) -> bool {
        self.flags & KEYFRAME_FLAG != 0
    }

    fn assemble(self, seq_number: u16) -> AssembledFrame {
        let keyframe = self.is_keyframe();
        let mut payload = Vec::new();
        for (_, chunk) in self.frags {
            payload.extend_from_slice(&chunk);
        }
        AssembledFrame {
            seq_number,
            timestamp: self.timestamp,
            stream_id: self.stream_id,
            media_type: self.media_type,
            keyframe,
            payload,
        }
    }
}

pub struct JitterBuffer {
    target_ms: u32,
    slots: BTreeMap<u16, Slot>,
    next_seq: Option<u16>,
    waiting_keyframe: bool,
    playback_started: bool,
}

impl JitterBuffer {
    pub fn new(mode: BufferMode) -> Self {
        let target_ms = match mode {
            BufferMode::Gaming => GAMING_BUFFER_MS,
            BufferMode::Cinema => CINEMA_BUFFER_MS,
        };
        Self {
            target_ms,
            slots: BTreeMap::new(),
            next_seq: None,
            waiting_keyframe: false,
            playback_started: false,
        }
    }

    pub fn target_ms(&self) -> u32 {
        self.target_ms
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<PushOutcome, PacketError> {
        let decoded = decode_packet(bytes)?;
        let seq = decoded.header.seq_number;
        let slot = self.slots.entry(seq).or_insert_with(|| Slot::new(&decoded.header));
        if slot.frag_total != decoded.header.frag_total {
            *slot = Slot::new(&decoded.header);
        }
        slot.frags.insert(decoded.header.frag_idx, decoded.payload);
        self.next_seq = Some(match self.next_seq {
            Some(current) if self.playback_started => current,
            Some(current) => current.min(seq),
            None => seq,
        });
        Ok(self.drain())
    }

    fn drain(&mut self) -> PushOutcome {
        let mut frames = Vec::new();
        let mut request_pli = false;
        loop {
            let Some(expected) = self.next_seq else { break };
            let ready_later = self.later_complete(expected);
            match self.slots.get(&expected).map(|slot| slot.is_complete()) {
                Some(true) => {
                    let slot = self.slots.remove(&expected).expect("slot presente");
                    self.next_seq = Some(expected.wrapping_add(1));
                    if self.waiting_keyframe && !slot.is_keyframe() {
                        request_pli = true;
                        continue;
                    }
                    if slot.is_keyframe() {
                        self.waiting_keyframe = false;
                    }
                    self.playback_started = true;
                    frames.push(slot.assemble(expected));
                }
                Some(false) | None => {
                    if !self.gap_expired(expected, ready_later) {
                        break;
                    }
                    let lost_delta = self
                        .slots
                        .get(&expected)
                        .map(|slot| !slot.is_keyframe())
                        .unwrap_or(true);
                    self.slots.remove(&expected);
                    self.next_seq = Some(expected.wrapping_add(1));
                    self.playback_started = true;
                    if lost_delta {
                        self.waiting_keyframe = true;
                        request_pli = true;
                    }
                }
            }
        }
        PushOutcome { frames, request_pli }
    }

    fn later_complete(&self, expected: u16) -> Option<u32> {
        self.slots
            .iter()
            .filter(|(seq, slot)| **seq > expected && slot.is_complete())
            .map(|(_, slot)| slot.timestamp)
            .min()
    }

    fn gap_expired(&self, expected: u16, later_timestamp: Option<u32>) -> bool {
        let Some(later) = later_timestamp else { return false };
        let stalled = self.slots.get(&expected).map(|slot| slot.timestamp).unwrap_or(0);
        later.wrapping_sub(stalled) > self.target_ms
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_roundtrip_and_fragments_stay_inside_the_mtu() {
        let payload = vec![7u8; 20_000];
        let packets = fragment_frame(1, KEYFRAME_FLAG, 0x0102, 0x0304_0506, 0x0708_090a, &payload).unwrap();
        assert!(packets.len() > 1);
        let mut restored = Vec::new();
        for packet in &packets {
            assert!(packet.len() <= MAX_PACKET_LEN);
            let decoded = decode_packet(packet).unwrap();
            assert_eq!(decoded.header.seq_number, 0x0102);
            assert_eq!(decoded.header.stream_id, 0x0708_090a);
            assert!(decoded.header.is_keyframe());
            assert_eq!(decoded.header.frag_total as usize, packets.len());
            restored.extend_from_slice(&decoded.payload);
        }
        assert_eq!(restored, payload);
    }

    fn raw(seq: u16, timestamp: u32, flags: u8, frag_idx: u8, frag_total: u8, payload: &[u8]) -> Vec<u8> {
        let header = PacketHeader {
            media_type: 1,
            flags,
            seq_number: seq,
            timestamp,
            frag_idx,
            frag_total,
            payload_len: payload.len() as u16,
            stream_id: 3,
        };
        let mut packet = header.encode().to_vec();
        packet.extend_from_slice(payload);
        packet
    }

    #[test]
    fn out_of_order_fragments_reassemble_one_frame() {
        let mut buffer = JitterBuffer::new(BufferMode::Gaming);
        let first = buffer.push(&raw(4, 1_000, 0, 1, 2, b"def")).unwrap();
        assert!(first.frames.is_empty());
        let done = buffer.push(&raw(4, 1_000, 0, 0, 2, b"abc")).unwrap();
        assert!(!done.request_pli);
        assert_eq!(done.frames.len(), 1);
        assert_eq!(done.frames[0].payload, b"abcdef");
        assert_eq!(done.frames[0].seq_number, 4);
    }

    #[test]
    fn lost_delta_fragment_requests_pli_until_the_next_keyframe() {
        let mut buffer = JitterBuffer::new(BufferMode::Gaming);
        assert_eq!(buffer.target_ms(), GAMING_BUFFER_MS);
        let first = buffer.push(&raw(1, 0, 0, 0, 2, &[1, 2])).unwrap();
        assert!(first.frames.is_empty());
        assert!(!first.request_pli);

        let recovered = buffer.push(&raw(2, 300, KEYFRAME_FLAG, 0, 1, b"KEY")).unwrap();
        assert!(recovered.request_pli);
        assert_eq!(recovered.frames.len(), 1);
        assert!(recovered.frames[0].keyframe);
        assert_eq!(recovered.frames[0].payload, b"KEY");

        let resumed = buffer.push(&raw(3, 360, 0, 0, 1, b"ok")).unwrap();
        assert!(!resumed.request_pli);
        assert_eq!(resumed.frames.len(), 1);
        assert_eq!(resumed.frames[0].payload, b"ok");
    }

    #[test]
    fn cinema_buffer_waits_longer_than_gaming() {
        assert_eq!(JitterBuffer::new(BufferMode::Cinema).target_ms(), CINEMA_BUFFER_MS);
        let mut buffer = JitterBuffer::new(BufferMode::Cinema);
        buffer.push(&raw(1, 0, 0, 0, 2, &[9, 9])).unwrap();
        let held = buffer.push(&raw(2, 80, KEYFRAME_FLAG, 0, 1, b"K")).unwrap();
        assert!(held.frames.is_empty());
        assert!(!held.request_pli);
    }
}
