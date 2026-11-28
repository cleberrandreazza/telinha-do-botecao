//! Rich Presence. Sala privada não leva código, party nem botão ao Discord.
//! Se o Discord não está aberto, a falha fica neste processo.

use std::sync::{mpsc, OnceLock};
use std::time::Duration;

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;

const DEFAULT_WEB_ORIGIN: &str = "https://telinha-do-botecao.vercel.app";
const PRIVATE_LABEL: &str = "Em uma sala privada";
const IDLE_DETAILS: &str = "Disponível para assistir e compartilhar";
const IDLE_STATE: &str = "Abra o Telinha para entrar com seus amigos";
const JOIN_LABEL: &str = "Entrar na Sala";
const CODE_ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceState {
    pub enabled: bool,
    pub in_room: bool,
    pub room_code: String,
    pub is_private: bool,
    pub is_streaming: bool,
    pub viewer_count: u32,
    pub max_peers: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivityPlan {
    Clear,
    /// Presença permanente enquanto o app estiver aberto, fora de uma sala.
    Idle,
    /// Sem código, sem party e sem botão.
    Private { is_streaming: bool },
    Public {
        details: String,
        state: String,
        party_id: Option<String>,
        party_size: Option<[i32; 2]>,
        join_url: Option<String>,
    },
}

fn web_origin() -> String {
    let from_env = std::env::var("PUBLIC_WEB_URL").ok();
    let compiled = option_env!("PUBLIC_WEB_URL").map(str::to_string);
    let raw = from_env.or(compiled).unwrap_or_else(|| DEFAULT_WEB_ORIGIN.to_string());
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.starts_with("https://") && !trimmed.contains(' ') {
        trimmed
    } else {
        DEFAULT_WEB_ORIGIN.to_string()
    }
}

fn client_id() -> Option<String> {
    let from_env = std::env::var("DISCORD_CLIENT_ID").ok();
    let compiled = option_env!("DISCORD_CLIENT_ID").map(str::to_string);
    let raw = from_env.or(compiled)?;
    let id = raw.trim();
    if id.len() >= 8 && id.chars().all(|c| c.is_ascii_digit()) {
        Some(id.to_string())
    } else {
        None
    }
}

pub fn normalize_room_code(raw: &str) -> Option<String> {
    let code: String = raw
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect();
    if code.len() == 6 && code.chars().all(|c| CODE_ALPHABET.contains(c)) {
        Some(code)
    } else {
        None
    }
}

fn party_numbers(viewer_count: u32, max_peers: u32) -> (i32, i32) {
    let max = max_peers.clamp(1, 500) as i32;
    let current = (viewer_count.max(1) as i32).min(max);
    (current, max)
}

/// O que pode ir ao Discord. `is_private` zera código, party e convite.
pub fn plan_activity(state: &PresenceState) -> ActivityPlan {
    if !state.enabled {
        return ActivityPlan::Clear;
    }
    if !state.in_room {
        return ActivityPlan::Idle;
    }
    if state.is_private {
        return ActivityPlan::Private { is_streaming: state.is_streaming };
    }
    let (current, max) = party_numbers(state.viewer_count, state.max_peers);
    let code = normalize_room_code(&state.room_code);
    let join_url = code
        .as_ref()
        .map(|room| format!("{}/{}", web_origin(), room));
    ActivityPlan::Public {
        details: if state.is_streaming {
            "🔴 LIVE — Transmitindo tela".to_string()
        } else {
            "Assistindo na sala".to_string()
        },
        state: format!("{current} / {max}"),
        party_id: code,
        party_size: Some([current, max]),
        join_url,
    }
}

#[cfg(test)]
fn plan_text(plan: &ActivityPlan) -> String {
    match plan {
        ActivityPlan::Clear => String::new(),
        ActivityPlan::Idle => format!("{IDLE_DETAILS}|{IDLE_STATE}"),
        ActivityPlan::Private { is_streaming } => if *is_streaming {
            format!("🔴 LIVE — {PRIVATE_LABEL}")
        } else {
            PRIVATE_LABEL.to_string()
        },
        ActivityPlan::Public {
            details,
            state,
            party_id,
            join_url,
            ..
        } => format!(
            "{details}|{state}|{}|{}",
            party_id.as_deref().unwrap_or(""),
            join_url.as_deref().unwrap_or("")
        ),
    }
}

/// Opcode 3 do IPC do Discord: ping. Não mexe na atividade.
const IPC_PING: u8 = 3;

fn pipe_accepts(client: &mut DiscordIpcClient) -> bool {
    client.send(serde_json::json!({}), IPC_PING).is_ok()
}

/// Liga no `discord-ipc-*` e só guarda o cliente depois do handshake.
fn connect_only(client: &mut Option<DiscordIpcClient>) -> bool {
    let Some(id) = client_id() else {
        *client = None;
        return false;
    };
    let mut created = DiscordIpcClient::new(&id);
    if created.connect().is_err() {
        *client = None;
        return false;
    }
    *client = Some(created);
    true
}

/// `true` só com handshake feito e o pipe ainda aceitando escrita.
fn is_handshake_up(client: &mut Option<DiscordIpcClient>, last: Option<&PresenceState>) -> bool {
    if let Some(current) = client.as_mut() {
        if pipe_accepts(current) {
            return true;
        }
    }
    *client = None;
    match last {
        Some(state) => apply(client, &plan_activity(state)).is_ok() && client.is_some(),
        None => connect_only(client),
    }
}

fn apply(client: &mut Option<DiscordIpcClient>, plan: &ActivityPlan) -> Result<(), ()> {
    let Some(id) = client_id() else {
        return Ok(());
    };
    if client.is_none() {
        let mut created = DiscordIpcClient::new(&id);
        created.connect().map_err(|_| ())?;
        *client = Some(created);
    }
    let result = {
        let connected = client.as_mut().ok_or(())?;
        match plan {
        ActivityPlan::Clear => connected.clear_activity().map_err(|_| ()),
        ActivityPlan::Idle => connected
            .set_activity(activity::Activity::new().details(IDLE_DETAILS).state(IDLE_STATE))
            .map_err(|_| ()),
        ActivityPlan::Private { is_streaming } => connected
            .set_activity(activity::Activity::new().details(if *is_streaming {
                "🔴 LIVE — Transmitindo tela em sala privada"
            } else {
                PRIVATE_LABEL
            }))
            .map_err(|_| ()),
        ActivityPlan::Public {
            details,
            state,
            party_id,
            party_size,
            join_url,
        } => {
            let mut act = activity::Activity::new().details(details.as_str()).state(state.as_str());
            if let (Some(party), Some(size)) = (party_id.as_ref(), party_size.as_ref()) {
                act = act.party(activity::Party::new().id(party.as_str()).size(*size));
            }
            if let Some(url) = join_url.as_ref() {
                act = act.buttons(vec![activity::Button::new(JOIN_LABEL, url.as_str())]);
            }
            connected.set_activity(act).map_err(|_| ())
        }
        }
    };
    if result.is_err() {
        *client = None;
    }
    result
}

enum PresenceJob {
    Update {
        state: PresenceState,
        reply: mpsc::Sender<bool>,
    },
    Status {
        reply: mpsc::Sender<bool>,
    },
}

fn worker(rx: mpsc::Receiver<PresenceJob>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut last: Option<PresenceState> = None;
    while let Ok(job) = rx.recv() {
        match job {
            PresenceJob::Update { state, reply } => {
                last = Some(state.clone());
                let up = apply(&mut client, &plan_activity(&state)).is_ok() && client.is_some();
                let _ = reply.send(up);
            }
            PresenceJob::Status { reply } => {
                let up = is_handshake_up(&mut client, last.as_ref());
                let _ = reply.send(up);
            }
        }
    }
}

fn sender() -> &'static mpsc::Sender<PresenceJob> {
    static TX: OnceLock<mpsc::Sender<PresenceJob>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || worker(rx))
            .ok();
        tx
    })
}

fn roundtrip(build: impl FnOnce(mpsc::Sender<bool>) -> PresenceJob) -> Result<bool, String> {
    let (reply, rx) = mpsc::channel();
    sender()
        .send(build(reply))
        .map_err(|_| "presença do Discord indisponível".to_string())?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "presença do Discord sem resposta".to_string())
}

#[tauri::command]
pub fn update_discord_presence(state: PresenceState) -> Result<bool, String> {
    roundtrip(|reply| PresenceJob::Update { state, reply })
}

/// `true` depois do handshake no `discord-ipc-*`. `false` se o Discord fechou.
#[tauri::command]
pub fn get_discord_rpc_status() -> Result<bool, String> {
    roundtrip(|reply| PresenceJob::Status { reply })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(private: bool) -> PresenceState {
        PresenceState {
            enabled: true,
            in_room: true,
            room_code: "AB234C".into(),
            is_private: private,
            is_streaming: true,
            viewer_count: 4,
            max_peers: 50,
        }
    }

    #[test]
    fn private_room_drops_code_party_and_button() {
        let plan = plan_activity(&sample(true));
        assert_eq!(plan, ActivityPlan::Private { is_streaming: true });
        let text = plan_text(&plan);
        assert!(!text.contains("AB234C"));
        assert!(!text.contains("Entrar na Sala"));
        assert!(!text.contains("https://"));
        assert!(text.contains("LIVE"));
        assert!(!text.contains("Transmitindo tela em sala privada"));
    }

    #[test]
    fn public_room_shows_status_count_and_join_button() {
        let plan = plan_activity(&sample(false));
        match plan {
            ActivityPlan::Public {
                details,
                state,
                party_id,
                party_size,
                join_url,
            } => {
                assert_eq!(details, "🔴 LIVE — Transmitindo tela");
                assert_eq!(state, "4 / 50");
                assert_eq!(party_id.as_deref(), Some("AB234C"));
                assert_eq!(party_size, Some([4, 50]));
                assert_eq!(
                    join_url.as_deref(),
                    Some("https://telinha-do-botecao.vercel.app/AB234C")
                );
            }
            other => panic!("plano público esperado, veio {other:?}"),
        }
    }

    #[test]
    fn watching_uses_the_viewer_label() {
        let mut state = sample(false);
        state.is_streaming = false;
        match plan_activity(&state) {
            ActivityPlan::Public { details, .. } => assert_eq!(details, "Assistindo na sala"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn leaving_the_room_keeps_permanent_presence_without_room_data() {
        let mut state = sample(false);
        state.in_room = false;
        assert_eq!(plan_activity(&state), ActivityPlan::Idle);
        let text = plan_text(&plan_activity(&state));
        assert!(!text.contains("AB234C"));
        assert!(text.contains(IDLE_DETAILS));
    }

    #[test]
    fn disabled_presence_clears_activity_even_outside_a_room() {
        let mut state = sample(false);
        state.enabled = false;
        state.in_room = false;
        assert_eq!(plan_activity(&state), ActivityPlan::Clear);
    }

    #[test]
    fn invalid_code_does_not_become_a_party_or_a_link() {
        let mut state = sample(false);
        state.room_code = "IO0000".into();
        match plan_activity(&state) {
            ActivityPlan::Public {
                party_id,
                join_url,
                ..
            } => {
                assert_eq!(party_id, None);
                assert_eq!(join_url, None);
            }
            other => panic!("{other:?}"),
        }
    }
}
