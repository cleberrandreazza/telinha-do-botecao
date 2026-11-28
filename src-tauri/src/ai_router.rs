//! Topologia de relay escolhida no próprio app.
//!
//! O UCB1 trata cada peer desktop como um braço. O filtro de Kalman 1D
//! suaviza RTT e jitter antes da recompensa. Quem não roda o Tauri, está
//! com CPU alta, sem upload ou já tem 2 filhos não entra na eleição.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sysinfo::{Networks, System};

/// CPU a partir daqui o nó não aceita mais um filho.
pub const MAX_RELAY_CPU: f64 = 85.0;
/// Upload mínimo para encaminhar um fluxo sem re-codificar.
pub const MIN_RELAY_UPLOAD_KBPS: f64 = 2_500.0;
/// Cada relay carrega no máximo dois espectadores desktop.
pub const MAX_RELAY_CHILDREN: u8 = 2;
/// Com relay saudável, o host só envia um fluxo para um desktop.
pub const HOST_DESKTOP_CHILD_LIMIT: u8 = 1;
/// RTT de referência da recompensa do modo jogo, em ms.
const RTT_SCALE_MS: f64 = 400.0;
/// Jitter de referência da recompensa do modo cinema, em ms.
const JITTER_SCALE_MS: f64 = 80.0;

#[derive(Debug, Clone)]
pub struct Kalman1D {
    estimate: f64,
    covariance: f64,
    process_noise: f64,
    measurement_noise: f64,
}

impl Kalman1D {
    pub fn new(initial: f64) -> Self {
        Self {
            estimate: finite_or(initial, 0.0),
            covariance: 1.0,
            process_noise: 0.05,
            measurement_noise: 1.0,
        }
    }

    /// Um passo: prevê, corrige e devolve a estimativa suavizada.
    pub fn update(&mut self, measurement: f64) -> f64 {
        let measurement = finite_or(measurement, self.estimate);
        self.covariance += self.process_noise;
        let gain = self.covariance / (self.covariance + self.measurement_noise);
        self.estimate += gain * (measurement - self.estimate);
        self.covariance *= 1.0 - gain;
        self.estimate
    }
}

/// `(total_reward / n_i) + c * sqrt(ln(N) / n_i)`.
/// Braço ainda não puxado vale infinito, para ser visitado antes dos outros.
pub fn ucb1_score(total_reward: f64, pulls: u64, total_pulls: u64, exploration: f64) -> f64 {
    if pulls == 0 || total_pulls == 0 {
        return f64::INFINITY;
    }
    let mean = total_reward / pulls as f64;
    let bonus = exploration * ((total_pulls as f64).ln() / pulls as f64).sqrt();
    mean + bonus
}

/// Modo jogo olha RTT e perda. Cinema olha jitter e perda.
pub fn mode_reward(gaming_mode: bool, rtt_ms: f64, jitter_ms: f64, loss: f64) -> f64 {
    let loss_score = 1.0 - finite_or(loss, 1.0).clamp(0.0, 1.0);
    if gaming_mode {
        let rtt_score = higher_is_worse(rtt_ms, RTT_SCALE_MS);
        0.7 * rtt_score + 0.3 * loss_score
    } else {
        let jitter_score = higher_is_worse(jitter_ms, JITTER_SCALE_MS);
        0.7 * jitter_score + 0.3 * loss_score
    }
}

fn higher_is_worse(value: f64, scale: f64) -> f64 {
    if scale <= 0.0 {
        return 0.0;
    }
    1.0 - (finite_or(value, scale) / scale).clamp(0.0, 1.0)
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() { value } else { fallback }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerTelemetry {
    pub peer_id: String,
    pub rtt_ms: f64,
    pub jitter_ms: f64,
    pub loss: f64,
    pub upload_kbps: f64,
    pub cpu_percent: f64,
    pub is_desktop: bool,
    pub active_children: u8,
    pub is_desktop_relay_capable: bool,
}

impl PeerTelemetry {
    pub fn refresh_capability(&mut self) {
        self.active_children = self.active_children.min(MAX_RELAY_CHILDREN);
        let cpu = if self.cpu_percent.is_finite() { self.cpu_percent } else { 100.0 };
        let upload = if self.upload_kbps.is_finite() { self.upload_kbps } else { 0.0 };
        self.cpu_percent = cpu;
        self.upload_kbps = upload;
        self.rtt_ms = finite_or(self.rtt_ms, 0.0).max(0.0);
        self.jitter_ms = finite_or(self.jitter_ms, 0.0).max(0.0);
        self.loss = finite_or(self.loss, 1.0).clamp(0.0, 1.0);
        self.is_desktop_relay_capable = self.is_desktop
            && cpu < MAX_RELAY_CPU
            && upload >= MIN_RELAY_UPLOAD_KBPS
            && self.active_children < MAX_RELAY_CHILDREN;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelayHop {
    pub peer_id: String,
    pub parent_id: String,
    pub hop: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutingPlan {
    pub primary_relay_id: Option<String>,
    pub secondary_relay_id: Option<String>,
    pub split_even_odd: bool,
    pub can_local_node_relay: bool,
    pub viewer_count: u32,
    pub total_peers: u32,
    /// 1 = P2P direto. A partir de 2 espectadores, árvore de `ceil(log2(total)) + 1`, entre 2 e 6.
    pub max_hops: u8,
    /// Filhos desktop diretos do host. Vale 1 quando existe relay desktop saudável e há 2+ espectadores.
    pub host_max_children: u8,
    /// Fluxos que o host envia para desktops. Com relay, é 1 para qualquer N.
    pub host_desktop_streams: u8,
    pub hops: Vec<RelayHop>,
}

/// Com um espectador o caminho é direto. Com dois ou mais, a profundidade
/// acompanha `ceil(log2(total_peers)) + 1`, limitada a 6.
pub fn max_hops_for(viewer_count: u32, total_peers: u32) -> u8 {
    if viewer_count <= 1 {
        return 1;
    }
    let log = (total_peers.max(2) as f64).log2().ceil();
    if !log.is_finite() || log < 0.0 {
        return 2;
    }
    let hops = (log as u32).saturating_add(1).min(u32::from(u8::MAX)) as u8;
    hops.clamp(2, 6)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSystemLoad {
    pub cpu_percent: f64,
    pub upload_kbps: f64,
    pub is_desktop: bool,
}

struct Arm {
    telemetry: PeerTelemetry,
    rtt_filter: Kalman1D,
    jitter_filter: Kalman1D,
    gaming_reward: f64,
    cinema_reward: f64,
    pulls: u64,
}

struct SystemProbe {
    system: System,
    networks: Networks,
    last_transmitted: u64,
    last_at: Instant,
    cpu_percent: f64,
    upload_kbps: f64,
}

impl SystemProbe {
    fn new() -> Self {
        Self {
            system: System::new(),
            networks: Networks::new_with_refreshed_list(),
            last_transmitted: 0,
            last_at: Instant::now(),
            cpu_percent: 0.0,
            upload_kbps: 0.0,
        }
    }

    fn sample(&mut self) -> (f64, f64) {
        self.system.refresh_cpu_usage();
        let cpu = self.system.global_cpu_usage();
        if cpu.is_finite() {
            self.cpu_percent = f64::from(cpu);
        }
        self.networks.refresh(false);
        let transmitted: u64 = self.networks.iter().map(|(_, data)| data.total_transmitted()).sum();
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_at).as_secs_f64();
        if self.last_transmitted > 0 && elapsed >= 0.05 && transmitted >= self.last_transmitted {
            let bits = (transmitted - self.last_transmitted) as f64 * 8.0;
            self.upload_kbps = bits / elapsed / 1000.0;
        }
        self.last_transmitted = transmitted;
        self.last_at = now;
        (self.cpu_percent, self.upload_kbps)
    }
}

pub struct AiTopologyEngine {
    peers: HashMap<String, Arm>,
    total_pulls: u64,
    local_peer_id: String,
    local_cpu: f64,
    local_upload_kbps: f64,
    local_children: u8,
    exploration: f64,
    probe: SystemProbe,
}

impl Default for AiTopologyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AiTopologyEngine {
    pub fn new() -> Self {
        Self {
            peers: HashMap::new(),
            total_pulls: 0,
            local_peer_id: String::new(),
            local_cpu: 0.0,
            local_upload_kbps: 0.0,
            local_children: 0,
            exploration: std::f64::consts::SQRT_2,
            probe: SystemProbe::new(),
        }
    }

    pub fn update_peer(&mut self, mut telemetry: PeerTelemetry) {
        let peer_id = telemetry.peer_id.clone();
        if peer_id.is_empty() || peer_id == self.local_peer_id {
            return;
        }
        telemetry.refresh_capability();
        let reward_rtt = telemetry.rtt_ms;
        let reward_jitter = telemetry.jitter_ms;
        let loss = telemetry.loss;
        let arm = self.peers.entry(peer_id).or_insert_with(|| Arm {
            rtt_filter: Kalman1D::new(reward_rtt),
            jitter_filter: Kalman1D::new(reward_jitter),
            gaming_reward: 0.0,
            cinema_reward: 0.0,
            pulls: 0,
            telemetry: telemetry.clone(),
        });
        let smoothed_rtt = arm.rtt_filter.update(reward_rtt);
        let smoothed_jitter = arm.jitter_filter.update(reward_jitter);
        arm.telemetry = telemetry;
        arm.telemetry.rtt_ms = smoothed_rtt;
        arm.telemetry.jitter_ms = smoothed_jitter;
        arm.gaming_reward += mode_reward(true, smoothed_rtt, smoothed_jitter, loss);
        arm.cinema_reward += mode_reward(false, smoothed_rtt, smoothed_jitter, loss);
        arm.pulls += 1;
        self.total_pulls += 1;
    }

    pub fn set_local_children(&mut self, children: u8) {
        self.local_children = children.min(MAX_RELAY_CHILDREN);
    }

    /// Tira o participante da árvore. O retorno diz se ele estava no motor.
    pub fn remove_peer(&mut self, peer_id: &str) -> bool {
        let Some(arm) = self.peers.remove(peer_id) else {
            return false;
        };
        self.total_pulls = self.total_pulls.saturating_sub(arm.pulls);
        true
    }

    pub fn refresh_local_probe(&mut self) {
        let (cpu, upload) = self.probe.sample();
        self.local_cpu = cpu;
        self.local_upload_kbps = upload;
    }

    pub fn local_load(&self) -> LocalSystemLoad {
        LocalSystemLoad {
            cpu_percent: self.local_cpu,
            upload_kbps: self.local_upload_kbps,
            is_desktop: true,
        }
    }

    pub fn compute_plan(&mut self, gaming_mode: bool, local_peer_id: &str) -> RoutingPlan {
        if !local_peer_id.is_empty() {
            self.local_peer_id = local_peer_id.to_string();
            self.peers.remove(local_peer_id);
        }
        let mut ranked: Vec<(String, f64)> = self
            .peers
            .iter()
            .filter(|(_, arm)| arm.telemetry.is_desktop_relay_capable)
            .map(|(id, arm)| {
                let accumulated = if gaming_mode { arm.gaming_reward } else { arm.cinema_reward };
                let score = ucb1_score(accumulated, arm.pulls, self.total_pulls.max(1), self.exploration);
                (id.clone(), score)
            })
            .collect();
        ranked.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });
        let viewer_count = self.peers.len() as u32;
        let total_peers = viewer_count.saturating_add(1);
        let max_hops = max_hops_for(viewer_count, total_peers);
        let host_id = if self.local_peer_id.is_empty() {
            "host".to_string()
        } else {
            self.local_peer_id.clone()
        };
        let healthy_relay = !ranked.is_empty();
        let use_tree = viewer_count >= 2 && healthy_relay;
        let mut hops = Vec::with_capacity(self.peers.len());
        let mut child_count: HashMap<String, u8> = HashMap::new();

        let place = |hops: &mut Vec<RelayHop>, child_count: &mut HashMap<String, u8>, peer_id: String, parent_id: &str, hop: u8| {
            *child_count.entry(parent_id.to_string()).or_insert(0) += 1;
            hops.push(RelayHop { peer_id, parent_id: parent_id.to_string(), hop });
        };

        if !use_tree {
            for id in self.peers.keys() {
                place(&mut hops, &mut child_count, id.clone(), &host_id, 1);
            }
        } else {
            let primary = ranked[0].0.clone();
            place(&mut hops, &mut child_count, primary.clone(), &host_id, 1);
            let mut rest: Vec<String> = ranked.iter().skip(1).map(|(id, _)| id.clone()).collect();
            let mut leaves: Vec<String> = self
                .peers
                .iter()
                .filter(|(id, arm)| *id != &primary && !arm.telemetry.is_desktop_relay_capable && arm.telemetry.is_desktop)
                .map(|(id, _)| id.clone())
                .collect();
            leaves.sort();
            rest.append(&mut leaves);
            for peer_id in rest {
                let parent = hops
                    .iter()
                    .filter(|hop| {
                        self.peers.get(&hop.peer_id).is_some_and(|arm| arm.telemetry.is_desktop_relay_capable)
                            && hop.hop < max_hops
                            && child_count.get(&hop.peer_id).copied().unwrap_or(0) < MAX_RELAY_CHILDREN
                    })
                    .min_by(|left, right| left.hop.cmp(&right.hop).then_with(|| left.peer_id.cmp(&right.peer_id)))
                    .map(|hop| (hop.peer_id.clone(), hop.hop));
                if let Some((parent_id, parent_hop)) = parent {
                    place(&mut hops, &mut child_count, peer_id, &parent_id, parent_hop.saturating_add(1));
                }
            }
        }

        if use_tree {
            let mut web: Vec<String> = self
                .peers
                .iter()
                .filter(|(_, arm)| !arm.telemetry.is_desktop)
                .map(|(id, _)| id.clone())
                .collect();
            web.sort();
            for id in web {
                place(&mut hops, &mut child_count, id, &host_id, 1);
            }
        }

        let host_desktop_streams = hops
            .iter()
            .filter(|hop| hop.parent_id == host_id && self.peers.get(&hop.peer_id).is_some_and(|arm| arm.telemetry.is_desktop))
            .count() as u8;
        let host_max_children = if use_tree {
            HOST_DESKTOP_CHILD_LIMIT
        } else {
            host_desktop_streams
        };
        let primary_relay_id = if use_tree { ranked.first().map(|(id, _)| id.clone()) } else { None };
        let secondary_relay_id = if use_tree { ranked.get(1).map(|(id, _)| id.clone()) } else { None };
        RoutingPlan {
            primary_relay_id,
            secondary_relay_id,
            // O host não reparte o upload: o segundo relay fica na árvore, não como segundo envio.
            split_even_odd: false,
            can_local_node_relay: self.local_cpu.is_finite()
                && self.local_cpu < MAX_RELAY_CPU
                && self.local_upload_kbps >= MIN_RELAY_UPLOAD_KBPS
                && self.local_children < MAX_RELAY_CHILDREN,
            viewer_count,
            total_peers,
            max_hops,
            host_max_children,
            host_desktop_streams,
            hops,
        }
    }
}

pub struct RouterState(Mutex<AiTopologyEngine>);

impl Default for RouterState {
    fn default() -> Self {
        Self(Mutex::new(AiTopologyEngine::new()))
    }
}

#[tauri::command]
pub fn update_peer_telemetry(
    state: tauri::State<'_, RouterState>,
    telemetry: PeerTelemetry,
) -> Result<(), String> {
    let mut engine = state.0.lock().map_err(|err| err.to_string())?;
    engine.update_peer(telemetry);
    Ok(())
}

#[tauri::command]
pub fn forget_routing_peer(state: tauri::State<'_, RouterState>, peer_id: String) -> Result<bool, String> {
    let mut engine = state.0.lock().map_err(|err| err.to_string())?;
    Ok(engine.remove_peer(&peer_id))
}

#[tauri::command]
pub fn compute_routing_plan(
    state: tauri::State<'_, RouterState>,
    gaming_mode: bool,
    local_peer_id: String,
    local_children: u8,
) -> Result<RoutingPlan, String> {
    let mut engine = state.0.lock().map_err(|err| err.to_string())?;
    engine.set_local_children(local_children);
    Ok(engine.compute_plan(gaming_mode, &local_peer_id))
}

#[tauri::command]
pub fn get_local_system_load(state: tauri::State<'_, RouterState>) -> Result<LocalSystemLoad, String> {
    let mut engine = state.0.lock().map_err(|err| err.to_string())?;
    engine.refresh_local_probe();
    Ok(engine.local_load())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn peer(id: &str, rtt: f64, jitter: f64, cpu: f64, upload: f64, children: u8, desktop: bool) -> PeerTelemetry {
        let mut telemetry = PeerTelemetry {
            peer_id: id.into(),
            rtt_ms: rtt,
            jitter_ms: jitter,
            loss: 0.0,
            upload_kbps: upload,
            cpu_percent: cpu,
            is_desktop: desktop,
            active_children: children,
            is_desktop_relay_capable: false,
        };
        telemetry.refresh_capability();
        telemetry
    }

    #[test]
    fn kalman_moves_toward_the_measurement_without_jumping() {
        let mut filter = Kalman1D::new(0.0);
        let first = filter.update(10.0);
        let second = filter.update(10.0);
        assert!(first > 0.0 && first < 10.0);
        assert!(second > first && second < 10.0);
    }

    #[test]
    fn ucb1_matches_the_formula_and_explores_an_unpulled_arm() {
        let exploration = 2.0;
        let score = ucb1_score(3.0, 2, 8, exploration);
        let expected = 3.0 / 2.0 + exploration * (8.0_f64.ln() / 2.0).sqrt();
        assert!((score - expected).abs() < 1e-9);
        assert!(ucb1_score(0.0, 0, 8, exploration).is_infinite());
    }

    #[test]
    fn capability_requires_desktop_cpu_upload_and_a_free_child_slot() {
        assert!(peer("a", 20.0, 5.0, 84.0, 2_500.0, 0, true).is_desktop_relay_capable);
        assert!(!peer("a", 20.0, 5.0, 85.0, 4_000.0, 0, true).is_desktop_relay_capable);
        assert!(!peer("a", 20.0, 5.0, 10.0, 2_499.0, 0, true).is_desktop_relay_capable);
        assert!(!peer("a", 20.0, 5.0, 10.0, 4_000.0, 0, false).is_desktop_relay_capable);
        assert!(!peer("a", 20.0, 5.0, 10.0, 4_000.0, 2, true).is_desktop_relay_capable);
    }

    #[test]
    fn gaming_picks_lower_rtt_and_cinema_picks_lower_jitter() {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 10.0;
        engine.local_upload_kbps = 8_000.0;
        for _ in 0..40 {
            engine.update_peer(peer("baixa-latencia", 20.0, 70.0, 20.0, 8_000.0, 0, true));
            engine.update_peer(peer("estavel", 300.0, 5.0, 20.0, 8_000.0, 0, true));
            engine.update_peer(peer("celular", 15.0, 2.0, 10.0, 9_000.0, 0, false));
        }
        let gaming = engine.compute_plan(true, "eu");
        assert_eq!(gaming.primary_relay_id.as_deref(), Some("baixa-latencia"));
        assert_eq!(gaming.secondary_relay_id.as_deref(), Some("estavel"));
        assert!(!gaming.split_even_odd);
        assert_eq!(gaming.host_max_children, 1);
        assert_eq!(gaming.host_desktop_streams, 1);
        assert_eq!(parent_of(&gaming, "celular"), Some("eu"));
        assert!(gaming.can_local_node_relay);
        let cinema = engine.compute_plan(false, "eu");
        assert_eq!(cinema.primary_relay_id.as_deref(), Some("estavel"));
        assert_eq!(cinema.secondary_relay_id.as_deref(), Some("baixa-latencia"));
        assert_eq!(parent_of(&cinema, "baixa-latencia"), Some("estavel"));
    }

    #[test]
    fn local_node_above_the_cpu_ceiling_does_not_relay() {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 90.0;
        engine.local_upload_kbps = 8_000.0;
        let plan = engine.compute_plan(false, "eu");
        assert!(!plan.can_local_node_relay);
        assert!(plan.primary_relay_id.is_none());
        assert!(!plan.split_even_odd);
        assert_eq!(plan.viewer_count, 0);
        assert_eq!(plan.max_hops, 1);
        assert_eq!(plan.host_desktop_streams, 0);
    }

    fn parent_of<'a>(plan: &'a RoutingPlan, peer_id: &str) -> Option<&'a str> {
        plan.hops.iter().find(|hop| hop.peer_id == peer_id).map(|hop| hop.parent_id.as_str())
    }

    fn capable_desktop(id: &str, rtt: f64) -> PeerTelemetry {
        peer(id, rtt, 8.0, 20.0, 8_000.0, 0, true)
    }

    fn room_of(viewers: u32) -> RoutingPlan {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 10.0;
        engine.local_upload_kbps = 8_000.0;
        for _ in 0..6 {
            for index in 0..viewers {
                engine.update_peer(capable_desktop(&format!("d{index:02}"), 20.0 + f64::from(index)));
            }
        }
        engine.compute_plan(true, "host")
    }

    fn assert_one_desktop_upload(plan: &RoutingPlan) {
        assert_eq!(plan.host_max_children, HOST_DESKTOP_CHILD_LIMIT);
        assert_eq!(plan.host_desktop_streams, 1);
        assert!(!plan.split_even_odd);
        let mut children: HashMap<&str, u8> = HashMap::new();
        for hop in &plan.hops {
            assert!(hop.hop >= 1 && hop.hop <= plan.max_hops);
            let count = children.entry(hop.parent_id.as_str()).or_insert(0);
            *count += 1;
            if hop.parent_id != "host" {
                assert!(*count <= MAX_RELAY_CHILDREN);
            }
        }
        let direct = plan.hops.iter().filter(|hop| hop.parent_id == "host").count();
        assert_eq!(direct, 1);
        assert_eq!(plan.hops.len(), plan.viewer_count as usize);
    }

    #[test]
    fn one_viewer_stays_on_a_direct_path() {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 10.0;
        engine.local_upload_kbps = 8_000.0;
        engine.update_peer(capable_desktop("solo", 30.0));
        let plan = engine.compute_plan(false, "host");
        assert_eq!(plan.viewer_count, 1);
        assert_eq!(plan.total_peers, 2);
        assert_eq!(plan.max_hops, 1);
        assert!(plan.primary_relay_id.is_none());
        assert_eq!(plan.host_desktop_streams, 1);
        assert_eq!(parent_of(&plan, "solo"), Some("host"));
        assert_eq!(plan.hops[0].hop, 1);
    }

    #[test]
    fn two_desktop_viewers_make_the_host_send_one_stream() {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 10.0;
        engine.local_upload_kbps = 8_000.0;
        for _ in 0..12 {
            engine.update_peer(capable_desktop("relay-1", 20.0));
            engine.update_peer(capable_desktop("espectador-2", 180.0));
        }
        let plan = engine.compute_plan(true, "host");
        assert_eq!(plan.viewer_count, 2);
        assert_eq!(plan.total_peers, 3);
        assert_eq!(plan.max_hops, max_hops_for(2, 3));
        assert_eq!(plan.max_hops, 3);
        assert_eq!(plan.primary_relay_id.as_deref(), Some("relay-1"));
        assert_eq!(parent_of(&plan, "relay-1"), Some("host"));
        assert_eq!(parent_of(&plan, "espectador-2"), Some("relay-1"));
        assert_eq!(plan.hops.iter().find(|hop| hop.peer_id == "espectador-2").unwrap().hop, 2);
        assert_one_desktop_upload(&plan);
    }

    #[test]
    fn ten_viewers_keep_a_single_host_desktop_stream() {
        let plan = room_of(10);
        assert_eq!(plan.viewer_count, 10);
        assert_eq!(plan.total_peers, 11);
        assert_eq!(plan.max_hops, 5);
        assert_eq!(plan.primary_relay_id.as_deref(), Some("d00"));
        assert_one_desktop_upload(&plan);
    }

    #[test]
    fn fifty_viewers_stay_inside_six_hops_with_one_host_stream() {
        let plan = room_of(50);
        assert_eq!(plan.viewer_count, 50);
        assert_eq!(plan.total_peers, 51);
        assert_eq!(plan.max_hops, 6);
        assert_eq!(plan.primary_relay_id.as_deref(), Some("d00"));
        assert_one_desktop_upload(&plan);
    }

    #[test]
    fn removing_the_primary_relay_promotes_the_next_peer() {
        let mut engine = AiTopologyEngine::new();
        engine.local_cpu = 10.0;
        engine.local_upload_kbps = 8_000.0;
        for _ in 0..8 {
            engine.update_peer(capable_desktop("relay-1", 12.0));
            engine.update_peer(capable_desktop("relay-2", 28.0));
            engine.update_peer(capable_desktop("folha", 40.0));
        }
        let before = engine.compute_plan(true, "host");
        assert_eq!(before.primary_relay_id.as_deref(), Some("relay-1"));
        assert!(before.hops.iter().any(|hop| hop.parent_id == "relay-1"));
        assert!(engine.remove_peer("relay-1"));
        assert!(!engine.remove_peer("relay-1"));
        let after = engine.compute_plan(true, "host");
        assert_eq!(after.viewer_count, 2);
        assert_eq!(after.primary_relay_id.as_deref(), Some("relay-2"));
        assert!(after.hops.iter().all(|hop| hop.peer_id != "relay-1" && hop.parent_id != "relay-1"));
        assert_one_desktop_upload(&after);
    }
}
