//! Áudio da captura.
//!
//! Janela: loopback WASAPI só da árvore do processo (`ActivateAudioInterfaceAsync`
//! + `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`, modo incluir). Tela inteira: o mesmo
//! cliente, no modo excluir, com o PID deste executável, para o som do próprio
//! app e do WebView2 não voltar para a sala. Build anterior à 20348, ou falha
//! nessa ativação, cai no loopback do dispositivo. Os dois saem em f32
//! intercalado, 48 kHz, 2 canais.

use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use windows::core::{implement, HRESULT, IUnknown, Interface, PCWSTR, Result as WinResult};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_LOOPBACK, PROCESS_LOOPBACK_MODE, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemAlloc, CoUninitialize, IAgileObject, IAgileObject_Impl, BLOB,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

const TARGET_RATE: u32 = 48_000;
const TARGET_CHANNELS: u16 = 2;
const FLUSH_FRAMES: usize = 960;
pub const PCM_QUEUE: usize = 3;
const SILENT: u32 = 2;
const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x8001_0106u32 as i32);
const E_FAIL: HRESULT = HRESULT(0x8000_4005u32 as i32);
/// Pacote maior que isto não vira slice. Dois segundos a 48 kHz já é folga.
const MAX_PACKET_FRAMES: u32 = 96_000;
/// Excluir a árvore do processo só existe a partir do Windows 10 build 20348.
const EXCLUDE_PROCESS_TREE_BUILD: u32 = 20_348;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessCapture {
    /// Tela inteira: todo o sistema, menos este processo e os filhos.
    ExcludeOwnTree,
    /// Janela: só o processo daquela janela.
    IncludeWindow,
}

fn process_capture(kind: &str, build: u32) -> Option<ProcessCapture> {
    match kind {
        "monitor" if build >= EXCLUDE_PROCESS_TREE_BUILD => Some(ProcessCapture::ExcludeOwnTree),
        "window" => Some(ProcessCapture::IncludeWindow),
        _ => None,
    }
}

fn loopback_mode(choice: ProcessCapture) -> PROCESS_LOOPBACK_MODE {
    match choice {
        ProcessCapture::ExcludeOwnTree => PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        ProcessCapture::IncludeWindow => PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    }
}

fn windows_build() -> u32 {
    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }
    let mut info = OsVersionInfoW {
        size: std::mem::size_of::<OsVersionInfoW>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        service_pack: [0; 128],
    };
    let status = unsafe { RtlGetVersion(&mut info) };
    if status < 0 { 0 } else { info.build }
}

pub struct AudioPump {
    kind: PumpKind,
}

enum PumpKind {
    Device(cpal::Stream),
    Process(JoinHandle<()>),
}

impl AudioPump {
    pub fn stop(self, session_stop: &AtomicBool) {
        session_stop.store(true, Ordering::SeqCst);
        match self.kind {
            PumpKind::Device(stream) => drop(stream),
            PumpKind::Process(thread) => {
                let _ = thread.join();
            }
        }
    }
}

pub fn start(
    kind: &str,
    window_id: u32,
    tx: SyncSender<Vec<f32>>,
    stop: Arc<AtomicBool>,
) -> Result<AudioPump, String> {
    if let Some(choice) = process_capture(kind, windows_build()) {
        let pid = match choice {
            ProcessCapture::ExcludeOwnTree => Ok(std::process::id()),
            ProcessCapture::IncludeWindow => process_id(window_id),
        };
        let started = match pid {
            Ok(pid) => spawn_process_loopback(pid, loopback_mode(choice), tx.clone(), Arc::clone(&stop)),
            Err(err) => Err(err),
        };
        match started {
            Ok(pump) => return Ok(AudioPump { kind: pump }),
            Err(err) => {
                let what = match choice {
                    ProcessCapture::ExcludeOwnTree => "exclusão do próprio processo",
                    ProcessCapture::IncludeWindow => "loopback do processo",
                };
                eprintln!("[captura] {what} falhou ({err}). Seguindo com o loopback do dispositivo.");
            }
        }
    }
    let stream = start_device_loopback(tx, stop)?;
    Ok(AudioPump {
        kind: PumpKind::Device(stream),
    })
}

/// PID da janela via `GetWindowThreadProcessId`. Se o HWND truncado não resolver,
/// usa o PID que o xcap leu do HWND completo.
pub fn process_id(window_id: u32) -> Result<u32, String> {
    let mut pid = 0u32;
    // HWND de 32 bits no xcap: o bit alto precisa ser estendido para o ponteiro de 64 bits.
    let hwnd = HWND(window_id as i32 as isize as *mut _);
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    if pid != 0 {
        return Ok(pid);
    }
    for window in xcap::Window::all().map_err(|err| err.to_string())? {
        if window.id().unwrap_or(0) == window_id {
            let pid = window.pid().unwrap_or(0);
            if pid != 0 {
                return Ok(pid);
            }
        }
    }
    Err("Não foi possível identificar o processo da janela.".into())
}

fn spawn_process_loopback(
    pid: u32,
    mode: PROCESS_LOOPBACK_MODE,
    tx: SyncSender<Vec<f32>>,
    stop: Arc<AtomicBool>,
) -> Result<PumpKind, String> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("telinha-proc-audio".into())
        .spawn(move || run_process_loopback(pid, mode, tx, stop, ready_tx))
        .map_err(|err| err.to_string())?;
    match ready_rx.recv_timeout(Duration::from_secs(4)) {
        Ok(Ok(())) => Ok(PumpKind::Process(thread)),
        Ok(Err(err)) => {
            let _ = thread.join();
            Err(err)
        }
        Err(_) => {
            let _ = thread.join();
            Err("O loopback do processo não respondeu.".into())
        }
    }
}

fn run_process_loopback(
    pid: u32,
    mode: PROCESS_LOOPBACK_MODE,
    tx: SyncSender<Vec<f32>>,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) {
    // O cliente WASAPI vive nesta thread. CoUninitialize só depois de soltá-lo.
    let _com = match enter_mta() {
        Ok(guard) => guard,
        Err(err) => {
            let _ = ready.send(Err(err));
            return;
        }
    };
    let capture = match activate_process_client(pid, mode) {
        Ok(capture) => capture,
        Err(err) => {
            let _ = ready.send(Err(err));
            return;
        }
    };
    if ready.send(Ok(())).is_err() {
        unsafe { capture.client.Stop().ok() };
        return;
    }
    if let Err(err) = read_process_audio(capture, &tx, &stop) {
        eprintln!("[captura] áudio do processo: {err}");
    }
}

struct ProcessClient {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    format: MixFormat,
}

fn enter_mta() -> Result<MtaGuard, String> {
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr == RPC_E_CHANGED_MODE {
        return Ok(MtaGuard { uninit: false });
    }
    if hr.is_err() {
        return Err(format!("COM: {hr}"));
    }
    Ok(MtaGuard { uninit: true })
}

struct EventGuard(HANDLE);

impl Drop for EventGuard {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe { CloseHandle(self.0).ok() };
            self.0 = HANDLE::default();
        }
    }
}

struct MtaGuard {
    uninit: bool,
}

impl Drop for MtaGuard {
    fn drop(&mut self) {
        if self.uninit {
            unsafe { CoUninitialize() };
        }
    }
}

fn activate_process_client(pid: u32, mode: PROCESS_LOOPBACK_MODE) -> Result<ProcessClient, String> {
    // O MMDevAPI libera este blob com CoTaskMemFree. Tem de nascer no
    // CoTaskMemAlloc, e a gente não libera de novo.
    let params_ptr = unsafe { CoTaskMemAlloc(std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>()) }
        .cast::<AUDIOCLIENT_ACTIVATION_PARAMS>();
    if params_ptr.is_null() {
        return Err("Sem memória para o loopback do processo.".into());
    }
    unsafe {
        params_ptr.write(AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: mode,
                },
            },
        });
    }
    let prop = Box::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: params_ptr.cast(),
                    },
                },
            }),
        },
    });

    let event = EventGuard(unsafe { CreateEventW(None, true, false, PCWSTR::null()).map_err(|err| err.to_string())? });
    let slot: Arc<Mutex<WinResult<IAudioClient>>> = Arc::new(Mutex::new(Err(E_FAIL.into())));
    let handler: IActivateAudioInterfaceCompletionHandler = ActivateHandler {
        done: event.0,
        slot: Arc::clone(&slot),
    }
    .into();

    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &<IAudioClient as Interface>::IID,
            Some(&*prop),
            &handler,
        )
        .map_err(|err| err.to_string())?
    };
    let wait = unsafe { WaitForSingleObject(event.0, 3000) };
    // A operação e o handler precisam viver até o callback.
    drop(operation);
    drop(event);
    if wait != WAIT_OBJECT_0 {
        std::mem::forget(prop);
        return Err("A ativação do loopback do processo expirou.".into());
    }

    let client = slot
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone()
        .map_err(|err| err.to_string())?;

    // GetMixFormat neste cliente devolve E_NOTIMPL. O formato é o nosso,
    // e o AUTOCONVERTPCM faz o sistema entregar nesse arranjo.
    let format = requested_pcm(true);
    let flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
    let started = unsafe {
        client
            .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, mix_ptr(&format), None)
            .map_err(|err| err.to_string())
    };
    let format = if started.is_err() {
        let format = requested_pcm(false);
        unsafe {
            client
                .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, mix_ptr(&format), None)
                .map_err(|err| err.to_string())?;
        }
        format
    } else {
        format
    };
    unsafe { client.Start().map_err(|err| err.to_string())? };
    let capture = unsafe { client.GetService::<IAudioCaptureClient>().map_err(|err| err.to_string())? };
    drop(prop);
    Ok(ProcessClient {
        client,
        capture,
        format,
    })
}

fn requested_pcm(float: bool) -> MixFormat {
    let tag: u16 = if float { 3 } else { 1 };
    let bits: u16 = if float { 32 } else { 16 };
    let channels: u16 = TARGET_CHANNELS;
    let rate = TARGET_RATE;
    let block = channels * bits / 8;
    let average = rate * u32::from(block);
    let mut wave = Vec::with_capacity(std::mem::size_of::<WAVEFORMATEX>());
    wave.extend_from_slice(&tag.to_le_bytes());
    wave.extend_from_slice(&channels.to_le_bytes());
    wave.extend_from_slice(&rate.to_le_bytes());
    wave.extend_from_slice(&average.to_le_bytes());
    wave.extend_from_slice(&block.to_le_bytes());
    wave.extend_from_slice(&bits.to_le_bytes());
    wave.extend_from_slice(&0u16.to_le_bytes());
    MixFormat {
        rate,
        channels,
        bits,
        float,
        wave,
    }
}

fn mix_ptr(format: &MixFormat) -> *const WAVEFORMATEX {
    format.wave.as_ptr().cast()
}

fn read_process_audio(opened: ProcessClient, tx: &SyncSender<Vec<f32>>, stop: &AtomicBool) -> Result<(), String> {
    let mut converter = ToStereo48k::new(opened.format.rate, opened.format.channels);
    let mut pending = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        unsafe {
            opened
                .capture
                .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                .map_err(|err| err.to_string())?;
        }
        if frames == 0 {
            std::thread::sleep(Duration::from_millis(5));
            continue;
        }
        let outcome = if frames > MAX_PACKET_FRAMES {
            Err("Pacote de áudio grande demais.".to_string())
        } else if data.is_null() || flags & SILENT != 0 {
            let channels = opened.format.channels.max(1) as usize;
            let silent = vec![0f32; frames as usize * channels];
            converter.push(&silent, &mut pending);
            flush_pcm(&mut pending, tx);
            Ok(())
        } else {
            match decode_samples(data, frames, &opened.format) {
                Ok(samples) => {
                    converter.push(&samples, &mut pending);
                    flush_pcm(&mut pending, tx);
                    Ok(())
                }
                Err(err) => Err(err),
            }
        };
        unsafe {
            opened.capture.ReleaseBuffer(frames).map_err(|err| err.to_string())?;
        }
        outcome?;
    }
    unsafe { opened.client.Stop().ok() };
    Ok(())
}

#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct ActivateHandler {
    done: HANDLE,
    slot: Arc<Mutex<WinResult<IAudioClient>>>,
}

impl IAgileObject_Impl for ActivateHandler_Impl {}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivateHandler_Impl {
    fn ActivateCompleted(
        &self,
        activateoperation: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> WinResult<()> {
        let client = (|| -> WinResult<IAudioClient> {
            let operation = activateoperation.as_ref().ok_or_else(|| windows::core::Error::from(E_FAIL))?;
            let mut hr = HRESULT::default();
            let mut unknown: Option<IUnknown> = None;
            unsafe { operation.GetActivateResult(&mut hr, &mut unknown)? };
            if hr.is_err() {
                return Err(hr.into());
            }
            unknown.ok_or_else(|| windows::core::Error::from(E_FAIL))?.cast()
        })();
        *self.slot.lock().unwrap_or_else(|err| err.into_inner()) = client;
        unsafe { SetEvent(self.done).ok() };
        Ok(())
    }
}

struct MixFormat {
    rate: u32,
    channels: u16,
    bits: u16,
    float: bool,
    wave: Vec<u8>,
}

fn decode_samples(data: *const u8, frames: u32, format: &MixFormat) -> Result<Vec<f32>, String> {
    if data.is_null() || frames == 0 {
        return Err("Buffer de áudio vazio.".into());
    }
    if frames > MAX_PACKET_FRAMES || format.channels == 0 || format.channels > 32 {
        return Err("Pacote de áudio fora do limite.".into());
    }
    let width = match (format.float, format.bits) {
        (true, 32) | (false, 32) => 4usize,
        (false, 16) => 2usize,
        _ => return Err(format!("Formato de {} bits sem conversão.", format.bits)),
    };
    let channels = format.channels as usize;
    let count = (frames as usize)
        .checked_mul(channels)
        .ok_or("Pacote de áudio grande demais.")?;
    let bytes = count.checked_mul(width).ok_or("Pacote de áudio grande demais.")?;
    let raw = unsafe { std::slice::from_raw_parts(data, bytes) };
    Ok(decode_pcm(raw, format.float, format.bits))
}

fn decode_pcm(raw: &[u8], float: bool, bits: u16) -> Vec<f32> {
    if float && bits == 32 {
        return raw
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
    }
    if !float && bits == 16 {
        return raw
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
            .collect();
    }
    if !float && bits == 32 {
        return raw
            .chunks_exact(4)
            .map(|chunk| i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as f32 / 2147483648.0)
            .collect();
    }
    Vec::new()
}

fn start_device_loopback(tx: SyncSender<Vec<f32>>, stop: Arc<AtomicBool>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("Sem dispositivo de saída para o loopback da tela.")?;
    let preferred = [
        cpal::StreamConfig {
            channels: TARGET_CHANNELS,
            sample_rate: cpal::SampleRate(TARGET_RATE),
            buffer_size: cpal::BufferSize::Fixed(FLUSH_FRAMES as u32),
        },
        cpal::StreamConfig {
            channels: TARGET_CHANNELS,
            sample_rate: cpal::SampleRate(TARGET_RATE),
            buffer_size: cpal::BufferSize::Default,
        },
    ];
    for config in &preferred {
        if let Ok(stream) = build_f32(&device, config, tx.clone(), Arc::clone(&stop)) {
            if stream.play().is_ok() {
                return Ok(stream);
            }
        }
    }
    let supported = device.default_output_config().map_err(|err| err.to_string())?;
    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels();
    let config: cpal::StreamConfig = supported.into();
    let stream = match sample_format {
        SampleFormat::F32 => build_f32(&device, &config, tx, stop)?,
        SampleFormat::I16 => {
            let mut converter = ToStereo48k::new(sample_rate, channels);
            let mut pending = Vec::new();
            let err_fn = |err| eprintln!("[captura] áudio: {err}");
            device
                .build_input_stream::<i16, _, _>(
                    &config,
                    move |data, _| {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let converted: Vec<f32> = data.iter().map(|sample| *sample as f32 / 32768.0).collect();
                        converter.push(&converted, &mut pending);
                        flush_pcm(&mut pending, &tx);
                    },
                    err_fn,
                    None,
                )
                .map_err(|err| err.to_string())?
        }
        SampleFormat::U16 => {
            let mut converter = ToStereo48k::new(sample_rate, channels);
            let mut pending = Vec::new();
            let err_fn = |err| eprintln!("[captura] áudio: {err}");
            device
                .build_input_stream::<u16, _, _>(
                    &config,
                    move |data, _| {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        let converted: Vec<f32> = data
                            .iter()
                            .map(|sample| (*sample as f32 - 32768.0) / 32768.0)
                            .collect();
                        converter.push(&converted, &mut pending);
                        flush_pcm(&mut pending, &tx);
                    },
                    err_fn,
                    None,
                )
                .map_err(|err| err.to_string())?
        }
        other => return Err(format!("Formato de áudio {other:?} sem conversão.")),
    };
    stream.play().map_err(|err| err.to_string())?;
    Ok(stream)
}

fn build_f32(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    tx: SyncSender<Vec<f32>>,
    stop: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let mut converter = ToStereo48k::new(config.sample_rate.0, config.channels);
    let mut pending = Vec::new();
    let err_fn = |err| eprintln!("[captura] áudio: {err}");
    device
        .build_input_stream::<f32, _, _>(
            config,
            move |data, _| {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                converter.push(data, &mut pending);
                flush_pcm(&mut pending, &tx);
            },
            err_fn,
            None,
        )
        .map_err(|err| err.to_string())
}

fn flush_pcm(pending: &mut Vec<f32>, tx: &SyncSender<Vec<f32>>) {
    let channels = usize::from(TARGET_CHANNELS);
    if pending.len() < FLUSH_FRAMES * channels {
        return;
    }
    let chunk = std::mem::take(pending);
    match tx.try_send(chunk) {
        Ok(()) => {}
        Err(TrySendError::Full(chunk)) => {
            // A fila já tem ~60 ms. O trecho novo sai para a latência não crescer.
            drop(chunk);
        }
        Err(TrySendError::Disconnected(chunk)) => drop(chunk),
    }
}

pub struct ToStereo48k {
    channels: usize,
    step: f64,
    cursor: f64,
    prev_l: f32,
    prev_r: f32,
}

impl ToStereo48k {
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        Self {
            channels: usize::from(channels.max(1)),
            step: f64::from(sample_rate.max(1)) / f64::from(TARGET_RATE),
            cursor: 0.0,
            prev_l: 0.0,
            prev_r: 0.0,
        }
    }

    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let channels = self.channels.max(1);
        if input.len() < channels {
            return;
        }
        if (self.step - 1.0).abs() < 1e-9 {
            for frame in input.chunks_exact(channels) {
                let left = frame[0];
                let right = if channels > 1 { frame[1] } else { left };
                out.push(left);
                out.push(right);
            }
            return;
        }
        let frames = input.len() / channels;
        let mut cursor = self.cursor;
        while cursor < frames as f64 {
            let index = cursor.floor() as isize;
            let frac = (cursor - index as f64) as f32;
            let next = index + 1;
            if next >= frames as isize {
                break;
            }
            let (left_0, right_0) = if index < 0 {
                (self.prev_l, self.prev_r)
            } else {
                stereo_at(input, channels, index as usize)
            };
            let (left_1, right_1) = stereo_at(input, channels, next as usize);
            out.push(left_0 + (left_1 - left_0) * frac);
            out.push(right_0 + (right_1 - right_0) * frac);
            cursor += self.step;
        }
        let (prev_l, prev_r) = stereo_at(input, channels, frames - 1);
        self.prev_l = prev_l;
        self.prev_r = prev_r;
        self.cursor = cursor - frames as f64;
    }
}

fn stereo_at(input: &[f32], channels: usize, index: usize) -> (f32, f32) {
    let offset = index * channels;
    let left = input.get(offset).copied().unwrap_or(0.0);
    let right = if channels > 1 {
        input.get(offset + 1).copied().unwrap_or(left)
    } else {
        left
    };
    (left, right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_screen_excludes_this_process_tree() {
        assert_eq!(process_capture("monitor", 20_348), Some(ProcessCapture::ExcludeOwnTree));
        assert_eq!(
            loopback_mode(ProcessCapture::ExcludeOwnTree),
            PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        );
        assert_eq!(PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE.0, 1);
    }

    #[test]
    fn old_windows_keeps_the_device_loopback_for_the_screen() {
        assert_eq!(process_capture("monitor", 20_347), None);
        assert_eq!(process_capture("monitor", 0), None);
    }

    #[test]
    fn window_capture_still_includes_only_that_process() {
        assert_eq!(process_capture("window", 10_240), Some(ProcessCapture::IncludeWindow));
        assert_eq!(
            loopback_mode(ProcessCapture::IncludeWindow),
            PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        );
    }

    #[test]
    fn stereo_48k_passes_samples_through() {
        let mut converter = ToStereo48k::new(48_000, 2);
        let mut out = Vec::new();
        converter.push(&[0.25, -0.5, 1.0, 0.0], &mut out);
        assert_eq!(out, vec![0.25, -0.5, 1.0, 0.0]);
    }

    #[test]
    fn mono_48k_is_copied_to_both_channels() {
        let mut converter = ToStereo48k::new(48_000, 1);
        let mut out = Vec::new();
        converter.push(&[0.5, -0.25], &mut out);
        assert_eq!(out, vec![0.5, 0.5, -0.25, -0.25]);
    }

    #[test]
    fn pcm_i16_is_scaled_without_reading_past_the_buffer() {
        let raw = 16_384i16.to_le_bytes();
        let samples = decode_pcm(&raw, false, 16);
        assert_eq!(samples, vec![0.5]);
    }
}
