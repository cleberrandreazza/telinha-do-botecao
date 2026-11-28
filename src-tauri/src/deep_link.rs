//! `telinha://sala/<CODIGO>` abre a janela que já existe e pede a entrada.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const SCHEME: &str = "telinha://";
const ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Clone, Serialize)]
pub struct PendingRoom {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discord_session: Option<String>,
}

pub struct PendingJoin(pub Mutex<Option<PendingRoom>>);

impl Default for PendingJoin {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Clone, Serialize)]
struct JoinPayload {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    ticket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discord_session: Option<String>,
}

/// Código de sala de 6 caracteres, no mesmo alfabeto do servidor.
pub fn normalize_room_code(raw: &str) -> Option<String> {
    let code: String = raw
        .chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect();
    if code.len() != 6 {
        return None;
    }
    if code.chars().all(|c| ALPHABET.contains(c)) {
        Some(code)
    } else {
        None
    }
}

/// `telinha://sala/ABC234`, com barra final ou traço no código.
pub fn room_code_from_url(raw: &str) -> Option<String> {
    let text = raw.trim().trim_matches('"');
    let lower = text.to_ascii_lowercase();
    let rest = lower
        .strip_prefix(SCHEME)
        .or_else(|| lower.strip_prefix("telinha:"))?;
    let rest = rest.trim_start_matches('/');
    let rest = rest
        .strip_prefix("sala/")
        .or_else(|| rest.strip_prefix("sala"))?;
    let rest = rest.trim_start_matches('/');
    let code = rest.split(['/', '?', '#', '&', ' ']).next().unwrap_or("");
    normalize_room_code(code)
}

pub fn normalize_discord_session(raw: &str) -> Option<String> {
    let token = raw.trim();
    if (32..=128).contains(&token.len()) && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Some(token.to_string())
    } else {
        None
    }
}

pub fn normalize_ticket(raw: &str) -> Option<String> {
    let ticket = raw.trim();
    if (16..=128).contains(&ticket.len())
        && ticket
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Some(ticket.to_string())
    } else {
        None
    }
}

fn query_value(raw: &str, name: &str) -> Option<String> {
    let query = raw.split_once('?')?.1;
    let query = query.split('#').next().unwrap_or(query);
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        if key == name {
            return Some(value.to_string());
        }
    }
    None
}

pub struct RoomTarget {
    pub code: String,
    pub ticket: Option<String>,
    pub discord_session: Option<String>,
}

/// `telinha://sala/ABC234?ticket=...`. O ticket curto é descartado.
pub fn room_target_from_url(raw: &str) -> Option<RoomTarget> {
    let code = room_code_from_url(raw)?;
    Some(RoomTarget {
        code,
        ticket: query_value(raw, "ticket").and_then(|value| normalize_ticket(&value)),
        discord_session: query_value(raw, "discord_session").and_then(|value| normalize_discord_session(&value)),
    })
}

pub fn publish(app: &AppHandle, code: &str, ticket: Option<String>, discord_session: Option<String>) {
    let Some(code) = normalize_room_code(code) else {
        return;
    };
    let ticket = ticket.and_then(|value| normalize_ticket(&value));
    let pending = PendingRoom {
        code: code.clone(),
        ticket: ticket.clone(),
        discord_session: discord_session.clone(),
    };
    if let Some(state) = app.try_state::<PendingJoin>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(pending);
        }
    }
    let discord_session = discord_session.and_then(|value| normalize_discord_session(&value));
    let _ = app.emit("telinha-join", JoinPayload { code, ticket, discord_session });
}

pub fn accept_args(app: &AppHandle, argv: &[String]) {
    for arg in argv {
        if let Some(target) = room_target_from_url(arg) {
            publish(app, &target.code, target.ticket, target.discord_session);
        }
    }
}

pub fn focus_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn take_pending_join(state: tauri::State<'_, PendingJoin>) -> Option<PendingRoom> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

/// Entrega o código da abertura. O `setup` já registrou `telinha://`.
#[cfg(windows)]
pub fn install(app: &tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            if let Some(target) = room_target_from_url(url.as_str()) {
                publish(&handle, &target.code, target.ticket, target.discord_session);
            }
        }
    });

    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            if let Some(target) = room_target_from_url(url.as_str()) {
                publish(app.handle(), &target.code, target.ticket, target.discord_session);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sala_code() {
        assert_eq!(room_code_from_url("telinha://sala/AB234C"), Some("AB234C".into()));
        assert_eq!(room_code_from_url("telinha://sala/ab2-34c/"), Some("AB234C".into()));
    }

    #[test]
    fn keeps_the_one_time_ticket() {
        let target = room_target_from_url("telinha://sala/AB234C?ticket=abcdefghij123456").unwrap();
        assert_eq!(target.code, "AB234C");
        assert_eq!(target.ticket.as_deref(), Some("abcdefghij123456"));
        let short = room_target_from_url("telinha://sala/AB234C?ticket=curto").unwrap();
        assert_eq!(short.ticket, None);
    }

    #[test]
    fn preserves_discord_session_in_deep_link() {
        let target = room_target_from_url("telinha://sala/AB234C?discord_session=abcdefghijklmnopqrstuvwxyz123456").unwrap();
        assert_eq!(target.discord_session.as_deref(), Some("abcdefghijklmnopqrstuvwxyz123456"));
    }

    #[test]
    fn rejects_ambiguous_letters_and_other_schemes() {
        assert_eq!(room_code_from_url("telinha://sala/IO0000"), None);
        assert_eq!(room_code_from_url("https://exemplo/AB234C"), None);
        assert_eq!(room_code_from_url("telinha://outra/AB234C"), None);
    }
}
