//! Descobre monitores e janelas e captura quadro + áudio fora do seletor do WebView2.
//!
//! As miniaturas do seletor continuam em JPEG via `xcap`. O quadro ao vivo vem do
//! Windows Graphics Capture (Direct3D11) em BGRA8, com cabeçalho de largura e
//! altura, num WebSocket local. A troca de R e B fica no shader. Só existe um
//! quadro em voo: se o frontend ainda não confirmou o anterior, o novo é
//! descartado. O áudio vai noutro WebSocket, já em 48 kHz estéreo.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, RgbaImage};
use serde::Serialize;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::loopback;
use crate::ws_local;

const THUMB_WIDTH: u32 = 320;
const THUMB_QUALITY: u8 = 70;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSourceDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub app_name: String,
    pub width: u32,
    pub height: u32,
    pub thumbnail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSessionInfo {
    pub session_id: u64,
    pub video_url: String,
    pub audio_url: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub width: u32,
    pub height: u32,
    pub audio: bool,
}

struct StopFlag {
    flag: Arc<AtomicBool>,
}

impl StopFlag {
    fn new() -> Self {
        Self {
            flag: Arc::new(AtomicBool::new(false)),
        }
    }

    fn requested(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    fn request(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    fn share(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.flag)
    }
}

struct Session {
    stop: Arc<StopFlag>,
    shutdown: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

pub struct CaptureHost {
    sessions: Mutex<std::collections::HashMap<u64, Session>>,
    next_id: AtomicU64,
}

impl Default for CaptureHost {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

impl CaptureHost {
    pub async fn start(
        &self,
        source_id: String,
        kind: String,
        target_height: u32,
        fps: u32,
        capture_audio: bool,
    ) -> Result<CaptureSessionInfo, String> {
        let kind = kind.trim().to_ascii_lowercase();
        if kind != "window" && kind != "monitor" {
            return Err("Tipo de fonte inválido.".into());
        }
        let source_id: u32 = source_id
            .parse()
            .map_err(|_| "Identificador da fonte inválido.".to_string())?;
        let fps = fps.clamp(1, 60);
        let session_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let stop = Arc::new(StopFlag::new());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel();
        let stop_thread = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("telinha-capture".into())
            .spawn(move || {
                capture_thread(
                    source_id,
                    kind,
                    target_height,
                    fps,
                    capture_audio,
                    stop_thread,
                    shutdown_rx,
                    ready_tx,
                );
            })
            .map_err(|err| err.to_string())?;

        let ready = tauri::async_runtime::spawn_blocking(move || {
            ready_rx.recv_timeout(Duration::from_secs(8))
        })
        .await
        .map_err(|err| err.to_string())?;
        let ready = match ready {
            Ok(Ok(ready)) => ready,
            Ok(Err(err)) => {
                stop.request();
                let _ = shutdown_tx.send(());
                let _ = tauri::async_runtime::spawn_blocking(move || thread.join()).await;
                return Err(err);
            }
            Err(_) => {
                stop.request();
                let _ = shutdown_tx.send(());
                let _ = tauri::async_runtime::spawn_blocking(move || thread.join()).await;
                return Err("A captura não devolveu o primeiro quadro.".into());
            }
        };

        let mut sessions = self.sessions.lock().unwrap_or_else(|err| err.into_inner());
        sessions.insert(
            session_id,
            Session {
                stop,
                shutdown: Some(shutdown_tx),
                thread: Some(thread),
            },
        );
        Ok(CaptureSessionInfo {
            session_id,
            video_url: format!("ws://127.0.0.1:{}", ready.video_port),
            audio_url: if ready.audio_port == 0 {
                String::new()
            } else {
                format!("ws://127.0.0.1:{}", ready.audio_port)
            },
            sample_rate: ready.sample_rate,
            channels: ready.channels,
            width: ready.width,
            height: ready.height,
            audio: ready.audio,
        })
    }

    fn detach(&self, session_id: u64) -> Option<Session> {
        let session = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|err| err.into_inner());
            sessions.remove(&session_id)
        }?;
        session.stop.request();
        Some(session)
    }
}

struct ReadyFrame {
    width: u32,
    height: u32,
    sample_rate: u32,
    channels: u16,
    audio: bool,
    video_port: u16,
    audio_port: u16,
}

fn capture_thread(
    source_id: u32,
    kind: String,
    target_height: u32,
    fps: u32,
    capture_audio: bool,
    stop: Arc<StopFlag>,
    shutdown_rx: std::sync::mpsc::Receiver<()>,
    ready_tx: std::sync::mpsc::Sender<Result<ReadyFrame, String>>,
) {
    let booted = match boot_capture(source_id, kind, target_height, fps, capture_audio, Arc::clone(&stop)) {
        Ok(booted) => booted,
        Err(err) => {
            let _ = ready_tx.send(Err(err));
            return;
        }
    };
    let ready = ReadyFrame {
        width: booted.width,
        height: booted.height,
        sample_rate: booted.sample_rate,
        channels: booted.channels,
        audio: booted.audio,
        video_port: booted.video_port,
        audio_port: booted.audio_port,
    };
    if ready_tx.send(Ok(ready)).is_err() {
        release_side_threads(
            &stop,
            Some(booted.control),
            booted.audio_pump,
            booted.video_thread,
            booted.audio_thread,
        );
        return;
    }
    let _ = shutdown_rx.recv();
    release_side_threads(
        &stop,
        Some(booted.control),
        booted.audio_pump,
        booted.video_thread,
        booted.audio_thread,
    );
}

struct BootedCapture {
    control: CaptureControl<LiveVideo, String>,
    audio_pump: Option<loopback::AudioPump>,
    video_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
    width: u32,
    height: u32,
    sample_rate: u32,
    channels: u16,
    audio: bool,
    video_port: u16,
    audio_port: u16,
}

struct LiveFlags {
    target_height: u32,
    frame_budget: Duration,
    frames: SyncSender<Vec<u8>>,
    free: Receiver<Vec<u8>>,
    free_back: SyncSender<Vec<u8>>,
    inflight: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    ready: Mutex<Option<std::sync::mpsc::Sender<Result<(u32, u32), String>>>>,
}

struct LiveVideo {
    flags: LiveFlags,
    last_sent: Option<Instant>,
    announced: bool,
}

impl GraphicsCaptureApiHandler for LiveVideo {
    type Flags = LiveFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            flags: ctx.flags,
            last_sent: None,
            announced: false,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.flags.stop.load(Ordering::SeqCst) {
            capture_control.stop();
            return Ok(());
        }
        let now = Instant::now();
        if self.inflight_or_early(now) {
            return Ok(());
        }
        let Ok(mut packet) = self.flags.free.try_recv() else {
            return Ok(());
        };

        let mut buffer = match frame.buffer() {
            Ok(buffer) => buffer,
            Err(err) => {
                let _ = self.flags.free_back.try_send(packet);
                return self.fail_frame(err.to_string());
            }
        };
        if buffer.color_format() != ColorFormat::Bgra8 {
            drop(buffer);
            let _ = self.flags.free_back.try_send(packet);
            return self.fail_frame("Formato de cor da captura não é BGRA8.".into());
        }
        let width = buffer.width();
        let height = buffer.height();
        let row_pitch = buffer.row_pitch();
        let packed = pack_live_frame(
            buffer.as_raw_buffer(),
            width,
            height,
            row_pitch,
            self.flags.target_height,
            &mut packet,
        );
        drop(buffer);
        let (width, height) = match packed {
            Ok(size) => size,
            Err(err) => {
                let _ = self.flags.free_back.try_send(packet);
                return self.fail_frame(err);
            }
        };

        if !self.announced {
            self.announced = true;
            self.notify_ready(Ok((width, height)));
        }
        self.flags.inflight.store(true, Ordering::Release);
        match self.flags.frames.try_send(packet) {
            Ok(()) => self.last_sent = Some(now),
            Err(TrySendError::Full(packet)) => {
                self.flags.inflight.store(false, Ordering::Release);
                let _ = self.flags.free_back.try_send(packet);
            }
            Err(TrySendError::Disconnected(packet)) => {
                self.flags.inflight.store(false, Ordering::Release);
                let _ = self.flags.free_back.try_send(packet);
                capture_control.stop();
            }
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.notify_ready(Err("A janela de captura foi fechada.".into()));
        Ok(())
    }
}

impl LiveVideo {
    fn inflight_or_early(&self, now: Instant) -> bool {
        if self.flags.inflight.load(Ordering::Acquire) {
            return true;
        }
        let Some(last) = self.last_sent else {
            return false;
        };
        // Folga de 2 ms para um monitor a 60 Hz não cair para metade da taxa.
        let budget = self.flags.frame_budget.saturating_sub(Duration::from_millis(2));
        now.saturating_duration_since(last) < budget
    }

    fn notify_ready(&self, result: Result<(u32, u32), String>) {
        let mut slot = self.flags.ready.lock().unwrap_or_else(|err| err.into_inner());
        if let Some(tx) = slot.take() {
            let _ = tx.send(result);
        }
    }

    fn fail_frame(&mut self, err: String) -> Result<(), String> {
        if self.announced {
            eprintln!("[captura] quadro ignorado: {err}");
            Ok(())
        } else {
            self.notify_ready(Err(err.clone()));
            Err(err)
        }
    }
}

fn boot_capture(
    source_id: u32,
    kind: String,
    target_height: u32,
    fps: u32,
    capture_audio: bool,
    stop: Arc<StopFlag>,
) -> Result<BootedCapture, String> {
    let (video_listener, video_port) = ws_local::bind()?;
    let audio_bound = if capture_audio { ws_local::bind().ok() } else { None };

    let (frame_tx, frame_rx) = sync_channel::<Vec<u8>>(1);
    let (free_tx, free_rx) = sync_channel::<Vec<u8>>(1);
    let _ = free_tx.send(Vec::new());
    let inflight = Arc::new(AtomicBool::new(false));
    let stop_video = Arc::clone(&stop);
    let inflight_video = Arc::clone(&inflight);
    let free_for_socket = free_tx.clone();
    let video_thread = std::thread::Builder::new()
        .name("telinha-video-ws".into())
        .spawn(move || video_socket(video_listener, frame_rx, free_for_socket, inflight_video, stop_video))
        .ok();

    let (audio_tx, audio_rx) = sync_channel::<Vec<f32>>(loopback::PCM_QUEUE);
    let audio_port = audio_bound.as_ref().map(|(_, port)| *port).unwrap_or(0);
    let mut audio_thread = None;
    let audio_pump = if let Some((listener, _)) = audio_bound {
        let stop_audio = Arc::clone(&stop);
        audio_thread = std::thread::Builder::new()
            .name("telinha-audio-ws".into())
            .spawn(move || audio_socket(listener, audio_rx, stop_audio))
            .ok();
        // Tela inteira exclui o áudio deste processo. Build antiga cai no loopback do dispositivo.
        match loopback::start(&kind, source_id, audio_tx, stop.share()) {
            Ok(pump) => Some(pump),
            Err(err) => {
                eprintln!("[captura] áudio indisponível: {err}");
                None
            }
        }
    } else {
        None
    };

    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let flags = LiveFlags {
        target_height,
        frame_budget: Duration::from_secs_f64(1.0 / f64::from(fps.max(1))),
        frames: frame_tx,
        free: free_rx,
        free_back: free_tx,
        inflight,
        stop: stop.share(),
        ready: Mutex::new(Some(ready_tx)),
    };
    let control = match open_graphics_capture(&kind, source_id, flags) {
        Ok(control) => control,
        Err(err) => {
            release_side_threads(&stop, None, audio_pump, video_thread, audio_thread);
            return Err(err);
        }
    };
    let size = match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(size)) => size,
        Ok(Err(err)) => {
            release_side_threads(&stop, Some(control), audio_pump, video_thread, audio_thread);
            return Err(err);
        }
        Err(_) => {
            release_side_threads(&stop, Some(control), audio_pump, video_thread, audio_thread);
            return Err("A captura não devolveu o primeiro quadro.".into());
        }
    };
    let audio_on = audio_pump.is_some();
    Ok(BootedCapture {
        control,
        audio_pump,
        video_thread,
        audio_thread,
        width: size.0,
        height: size.1,
        sample_rate: if audio_on { 48_000 } else { 0 },
        channels: if audio_on { 2 } else { 0 },
        audio: audio_on,
        video_port,
        audio_port: if audio_on { audio_port } else { 0 },
    })
}

fn open_graphics_capture(
    kind: &str,
    source_id: u32,
    flags: LiveFlags,
) -> Result<CaptureControl<LiveVideo, String>, String> {
    if kind == "monitor" {
        let monitor = find_monitor(source_id)?;
        return start_live(monitor, flags);
    }
    let window = find_window(source_id)?;
    start_live(window, flags)
}

fn start_live<T>(item: T, flags: LiveFlags) -> Result<CaptureControl<LiveVideo, String>, String>
where
    T: TryInto<windows_capture::settings::GraphicsCaptureItemType> + Send + 'static,
{
    let settings = Settings::new(
        item,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );
    LiveVideo::start_free_threaded(settings).map_err(|err| err.to_string())
}

fn find_monitor(source_id: u32) -> Result<Monitor, String> {
    if let Ok(monitors) = Monitor::enumerate() {
        if let Some(monitor) = monitors
            .into_iter()
            .find(|monitor| handle_id(monitor.as_raw_hmonitor()) == source_id)
        {
            return Ok(monitor);
        }
    }
    let monitor = Monitor::from_raw_hmonitor(handle_from_id(source_id));
    if monitor.as_raw_hmonitor().is_null() {
        return Err("Tela não encontrada.".into());
    }
    Ok(monitor)
}

fn find_window(source_id: u32) -> Result<Window, String> {
    if let Ok(windows) = Window::enumerate() {
        if let Some(window) = windows
            .into_iter()
            .find(|window| handle_id(window.as_raw_hwnd()) == source_id)
        {
            return Ok(window);
        }
    }
    let window = Window::from_raw_hwnd(handle_from_id(source_id));
    if window.as_raw_hwnd().is_null() {
        return Err("Janela não encontrada.".into());
    }
    Ok(window)
}

fn handle_id(handle: *mut std::ffi::c_void) -> u32 {
    handle as usize as u32
}

fn handle_from_id(source_id: u32) -> *mut std::ffi::c_void {
    source_id as i32 as isize as *mut std::ffi::c_void
}

fn release_side_threads(
    stop: &StopFlag,
    control: Option<CaptureControl<LiveVideo, String>>,
    audio_pump: Option<loopback::AudioPump>,
    video_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
) {
    stop.request();
    if let Some(control) = control {
        if let Err(err) = control.stop() {
            eprintln!("[captura] encerrar WGC: {err}");
        }
    }
    if let Some(pump) = audio_pump {
        pump.stop(&stop.share());
    }
    if let Some(thread) = video_thread {
        let _ = thread.join();
    }
    if let Some(thread) = audio_thread {
        let _ = thread.join();
    }
}

fn video_socket(
    listener: std::net::TcpListener,
    frames: Receiver<Vec<u8>>,
    free: SyncSender<Vec<u8>>,
    inflight: Arc<AtomicBool>,
    stop: Arc<StopFlag>,
) {
    let Ok(mut stream) = ws_local::accept(&listener, &stop.share()) else {
        inflight.store(false, Ordering::Release);
        return;
    };
    while !stop.requested() {
        let buffer = match frames.recv_timeout(Duration::from_millis(50)) {
            Ok(buffer) => buffer,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if ws_local::write_binary(&mut stream, &buffer).is_err() {
            inflight.store(false, Ordering::Release);
            break;
        }
        // O frontend manda um byte depois do putImageData. Sem isso o quadro fica em voo.
        let _ = ws_local::read_client(&mut stream);
        let _ = free.send(buffer);
        inflight.store(false, Ordering::Release);
    }
}

fn audio_socket(listener: std::net::TcpListener, pcm: Receiver<Vec<f32>>, stop: Arc<StopFlag>) {
    let Ok(mut stream) = ws_local::accept(&listener, &stop.share()) else {
        return;
    };
    let mut packet = Vec::with_capacity(960 * 2 * 4);
    while !stop.requested() {
        let samples = match pcm.recv_timeout(Duration::from_millis(50)) {
            Ok(samples) => samples,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        packet.clear();
        packet.reserve(samples.len() * 4);
        for sample in &samples {
            packet.extend_from_slice(&sample.to_le_bytes());
        }
        if ws_local::write_binary(&mut stream, &packet).is_err() {
            break;
        }
    }
}

/// `u32` little-endian de largura, `u32` de altura, depois BGRA8 sem folga.
///
/// Os bytes saem como o Windows Graphics Capture entregou. O shader troca R e B.
/// Redimensionar só acontece quando a altura passa de `target_height`.
fn pack_live_frame(
    src: &[u8],
    src_width: u32,
    src_height: u32,
    row_pitch: u32,
    target_height: u32,
    dest: &mut Vec<u8>,
) -> Result<(u32, u32), String> {
    if src_width < 2 || src_height < 2 {
        return Err("Quadro pequeno demais.".into());
    }
    let pitch = row_pitch as usize;
    let tight = src_width as usize * 4;
    if pitch < tight {
        return Err("Passo de linha inválido.".into());
    }
    let need = (src_height as usize - 1)
        .checked_mul(pitch)
        .and_then(|offset| offset.checked_add(tight))
        .ok_or("Quadro grande demais.")?;
    if src.len() < need {
        return Err("Buffer de vídeo curto.".into());
    }
    let (dst_w, dst_h) = output_size(src_width, src_height, target_height);
    let pixels = (dst_w as usize)
        .checked_mul(dst_h as usize)
        .and_then(|count| count.checked_mul(4))
        .ok_or("Quadro grande demais.")?;
    dest.clear();
    dest.reserve(8 + pixels);
    dest.extend_from_slice(&dst_w.to_le_bytes());
    dest.extend_from_slice(&dst_h.to_le_bytes());
    let src_w = even_dim(src_width);
    let src_h = even_dim(src_height);
    if dst_w == src_w && dst_h == src_h {
        copy_plane(src, pitch, src_w, src_h, dest);
    } else {
        let start = dest.len();
        dest.resize(start + pixels, 0);
        scale_nearest(src, pitch, src_w, src_h, dst_w, dst_h, &mut dest[start..]);
    }
    Ok((dst_w, dst_h))
}

fn output_size(src_width: u32, src_height: u32, target_height: u32) -> (u32, u32) {
    let src_w = even_dim(src_width).max(2);
    let src_h = even_dim(src_height).max(2);
    if target_height == 0 || src_h <= target_height {
        return (src_w, src_h);
    }
    let dst_h = even_dim(target_height).max(2);
    let dst_w = even_dim(((u64::from(src_w) * u64::from(dst_h)) / u64::from(src_h)) as u32).max(2);
    (dst_w, dst_h)
}

fn copy_plane(src: &[u8], pitch: usize, width: u32, height: u32, dest: &mut Vec<u8>) {
    let row_bytes = width as usize * 4;
    if pitch == row_bytes {
        let bytes = row_bytes * height as usize;
        dest.extend_from_slice(&src[..bytes]);
        return;
    }
    for y in 0..height as usize {
        let start = y * pitch;
        dest.extend_from_slice(&src[start..start + row_bytes]);
    }
}

fn scale_nearest(
    src: &[u8],
    pitch: usize,
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    dest: &mut [u8],
) {
    for y in 0..dst_h {
        let sy = (u64::from(y) * u64::from(src_h) / u64::from(dst_h)) as usize;
        let src_row = &src[sy * pitch..];
        let dst_row = &mut dest[(y as usize) * (dst_w as usize) * 4..];
        for x in 0..dst_w {
            let sx = (u64::from(x) * u64::from(src_w) / u64::from(dst_w)) as usize;
            let pixel = &src_row[sx * 4..sx * 4 + 4];
            let out = &mut dst_row[(x as usize) * 4..(x as usize) * 4 + 4];
            out.copy_from_slice(pixel);
        }
    }
}

/// `u32` little-endian de largura, `u32` de altura, depois RGBA8 sem folga.
#[cfg(test)]
fn pack_into(buf: &mut Vec<u8>, image: &RgbaImage) -> Result<(), String> {
    let raw = image.as_raw();
    let pixels = (image.width() as usize)
        .checked_mul(image.height() as usize)
        .ok_or("Quadro grande demais.")?;
    let bytes = pixels.checked_mul(4).ok_or("Quadro grande demais.")?;
    if raw.len() != bytes {
        return Err("Buffer de vídeo inconsistente.".into());
    }
    buf.clear();
    buf.reserve(8 + bytes);
    buf.extend_from_slice(&image.width().to_le_bytes());
    buf.extend_from_slice(&image.height().to_le_bytes());
    buf.extend_from_slice(raw);
    Ok(())
}

#[cfg(test)]
fn pack_rgba(image: &RgbaImage) -> Vec<u8> {
    let mut bytes = Vec::new();
    pack_into(&mut bytes, image).expect("quadro de teste");
    bytes
}

pub fn list_sources() -> Result<Vec<CaptureSourceDto>, String> {
    let mut sources = Vec::new();
    let own_pid = std::process::id();

    let mut monitors = xcap::Monitor::all().map_err(|err| err.to_string())?;
    monitors.sort_by_key(|monitor| !monitor.is_primary().unwrap_or(false));
    for monitor in monitors {
        let id = monitor.id().map_err(|err| err.to_string())?;
        let name = monitor.name().unwrap_or_else(|_| "Tela".into());
        let width = monitor.width().unwrap_or(0);
        let height = monitor.height().unwrap_or(0);
        if width < 16 || height < 16 {
            continue;
        }
        let Ok(image) = monitor.capture_image() else { continue };
        let thumbnail = match thumbnail_data_url(&image) {
            Ok(url) => url,
            Err(_) => continue,
        };
        sources.push(CaptureSourceDto {
            id: id.to_string(),
            kind: "monitor".into(),
            title: name.clone(),
            app_name: "Tela".into(),
            width,
            height,
            thumbnail,
        });
    }

    let windows = xcap::Window::all().map_err(|err| err.to_string())?;
    for window in windows {
        let pid = window.pid().unwrap_or(0);
        if pid == own_pid {
            continue;
        }
        if window.is_minimized().unwrap_or(true) {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();
        if skip_window(&title, &app_name) {
            continue;
        }
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        if width < 16 || height < 16 {
            continue;
        }
        let Ok(image) = window.capture_image() else { continue };
        let thumbnail = match thumbnail_data_url(&image) {
            Ok(url) => url,
            Err(_) => continue,
        };
        let id = window.id().unwrap_or(0);
        sources.push(CaptureSourceDto {
            id: id.to_string(),
            kind: "window".into(),
            title,
            app_name,
            width,
            height,
            thumbnail,
        });
    }

    Ok(sources)
}

fn skip_window(title: &str, app_name: &str) -> bool {
    let title = title.trim();
    if title.is_empty() {
        return true;
    }
    let title_l = title.to_lowercase();
    let app_l = app_name.trim().to_lowercase();
    if title_l.contains("telinha do botecao") || title_l.contains("telinha do botecão") {
        return true;
    }
    if app_l.contains("telinha-do-botecao") || app_l.contains("telinha do botecao") {
        return true;
    }
    const EXACT: &[&str] = &[
        "program manager",
        "windows input experience",
        "windows shell experience host",
        "microsoft text input application",
        "msctfime ui",
        "default ime",
    ];
    EXACT.iter().any(|name| title_l == *name || app_l == *name)
        || (title_l.starts_with("ole") && title_l.contains("wnd"))
}

#[cfg(test)]
fn even_crop(image: RgbaImage) -> RgbaImage {
    let width = even_dim(image.width()).max(2);
    let height = even_dim(image.height()).max(2);
    if width == image.width() && height == image.height() {
        return image;
    }
    let width = width.min(image.width());
    let height = height.min(image.height());
    image::imageops::crop_imm(&image, 0, 0, width, height).to_image()
}

fn even_dim(value: u32) -> u32 {
    value - (value % 2)
}

fn thumbnail_data_url(image: &RgbaImage) -> Result<String, String> {
    let (width, height) = image.dimensions();
    let thumb = if width > THUMB_WIDTH && width > 0 {
        let next_h = ((u64::from(height) * u64::from(THUMB_WIDTH)) / u64::from(width)).max(1) as u32;
        image::imageops::resize(image, THUMB_WIDTH, next_h, image::imageops::FilterType::Triangle)
    } else {
        image.clone()
    };
    let jpeg = encode_jpeg(thumb, THUMB_QUALITY)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(jpeg);
    Ok(format!("data:image/jpeg;base64,{encoded}"))
}

fn encode_jpeg(image: RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = image::DynamicImage::ImageRgba8(image).into_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|err| err.to_string())?;
    Ok(bytes)
}

#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSourceDto>, String> {
    tauri::async_runtime::spawn_blocking(list_sources)
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn start_native_capture(
    host: tauri::State<'_, CaptureHost>,
    source_id: String,
    kind: String,
    target_height: u32,
    fps: u32,
    capture_audio: bool,
) -> Result<CaptureSessionInfo, String> {
    host.start(source_id, kind, target_height, fps, capture_audio)
        .await
}

#[tauri::command]
pub async fn stop_native_capture(
    host: tauri::State<'_, CaptureHost>,
    session_id: u64,
) -> Result<(), String> {
    let Some(session) = host.detach(session_id) else { return Ok(()) };
    if let Some(shutdown) = session.shutdown {
        let _ = shutdown.send(());
    }
    if let Some(thread) = session.thread {
        tauri::async_runtime::spawn_blocking(move || thread.join())
            .await
            .map_err(|err| err.to_string())?
            .map_err(|_| "A thread de captura não encerrou.".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_header_is_width_height_then_pixels() {
        let image = RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255]));
        let packed = pack_rgba(&image);
        assert_eq!(&packed[..4], &2u32.to_le_bytes());
        assert_eq!(&packed[4..8], &2u32.to_le_bytes());
        assert_eq!(packed.len(), 8 + 2 * 2 * 4);
        assert_eq!(&packed[8..12], &[1, 2, 3, 255]);
    }

    #[test]
    fn odd_frame_is_cropped_without_resampling() {
        let image = RgbaImage::from_fn(3, 3, |x, y| image::Rgba([x as u8, y as u8, 0, 255]));
        let cropped = even_crop(image);
        assert_eq!(cropped.dimensions(), (2, 2));
        assert_eq!(cropped.get_pixel(1, 1).0, [1, 1, 0, 255]);
    }

    #[test]
    fn bgra_rows_are_copied_without_swapping_and_skip_pitch_padding() {
        let mut src = vec![0u8; 12 * 2];
        src[0..4].copy_from_slice(&[1, 2, 3, 255]);
        src[4..8].copy_from_slice(&[4, 5, 6, 255]);
        src[12..16].copy_from_slice(&[7, 8, 9, 255]);
        src[16..20].copy_from_slice(&[10, 11, 12, 255]);
        let mut packed = Vec::new();
        let (width, height) = pack_live_frame(&src, 2, 2, 12, 0, &mut packed).unwrap();
        assert_eq!((width, height), (2, 2));
        assert_eq!(&packed[..4], &2u32.to_le_bytes());
        assert_eq!(&packed[4..8], &2u32.to_le_bytes());
        assert_eq!(&packed[8..12], &[1, 2, 3, 255]);
        assert_eq!(&packed[12..16], &[4, 5, 6, 255]);
        assert_eq!(&packed[16..20], &[7, 8, 9, 255]);
        assert_eq!(&packed[20..24], &[10, 11, 12, 255]);
        assert_eq!(packed.len(), 8 + 16);
    }

    #[test]
    fn live_frame_scales_only_when_taller_than_the_target() {
        let mut src = vec![0u8; 4 * 4 * 4];
        for y in 0..4 {
            for x in 0..4 {
                let i = (y * 4 + x) * 4;
                src[i] = x as u8;
                src[i + 1] = y as u8;
                src[i + 2] = 9;
                src[i + 3] = 255;
            }
        }
        let mut native = Vec::new();
        let native_size = pack_live_frame(&src, 4, 4, 16, 0, &mut native).unwrap();
        assert_eq!(native_size, (4, 4));
        assert_eq!(&native[8..12], &[0, 0, 9, 255]);

        let mut scaled = Vec::new();
        let scaled_size = pack_live_frame(&src, 4, 4, 16, 2, &mut scaled).unwrap();
        assert_eq!(scaled_size, (2, 2));
        assert_eq!(&scaled[8..12], &[0, 0, 9, 255]);
        assert_eq!(&scaled[12..16], &[2, 0, 9, 255]);
        assert_eq!(&scaled[16..20], &[0, 2, 9, 255]);
    }
}
