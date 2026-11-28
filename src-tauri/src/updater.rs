use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use semver::Version;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const USER_AGENT: &str = "telinha-do-botecao";
const RELEASES_URL: &str =
    "https://api.github.com/repos/cleberrandreazza/telinha-do-botecao/releases/latest";
const EVENT_AVAILABLE: &str = "desktop-update-available";
const EVENT_PROGRESS: &str = "desktop-update-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub asset_name: String,
    pub download_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub received: u64,
    pub total: Option<u64>,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// Apaga `*.old.exe` deixados pela troca anterior. Não mexe no executável atual.
pub fn cleanup_old_executables() {
    let Ok(current) = std::env::current_exe() else { return };
    let Some(dir) = current.parent() else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.to_ascii_lowercase().ends_with(".old.exe") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn remote_is_newer(tag_name: &str, local: &str) -> bool {
    let remote = tag_name.trim().trim_start_matches('v');
    let Ok(remote) = Version::parse(remote) else { return false };
    let Ok(local) = Version::parse(local) else { return false };
    remote > local
}

fn pick_portable_exe(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    assets.iter().find(|asset| is_portable_exe_name(&asset.name))
}

fn is_portable_exe_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".exe")
        && !name.ends_with(".old.exe")
        && !name.contains("setup")
        && !name.contains("installer")
        && !name.contains("uninstall")
}

fn github_host(host: &str) -> bool {
    matches!(
        host,
        "github.com"
            | "api.github.com"
            | "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com"
            | "github-releases.githubusercontent.com"
    )
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            match attempt.url().host_str() {
                Some(host) if github_host(host) => attempt.follow(),
                _ => attempt.stop(),
            }
        }))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())
}

async fn latest_release() -> Result<Option<UpdateInfo>, String> {
    let response = http_client()?
        .get(RELEASES_URL)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("GitHub respondeu {}", response.status()));
    }

    let release: GithubRelease = response.json().await.map_err(|error| error.to_string())?;
    let local = env!("CARGO_PKG_VERSION");
    if !remote_is_newer(&release.tag_name, local) {
        return Ok(None);
    }
    let asset = pick_portable_exe(&release.assets)
        .ok_or_else(|| "A release não tem um .exe portátil.".to_string())?;
    if !download_url_allowed(&asset.browser_download_url) {
        return Err("O asset da release não está no GitHub.".into());
    }
    Ok(Some(UpdateInfo {
        version: release.tag_name.trim().trim_start_matches('v').to_string(),
        asset_name: asset.name.clone(),
        download_url: asset.browser_download_url.clone(),
    }))
}

fn download_url_allowed(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    parsed.scheme() == "https" && parsed.host_str().is_some_and(github_host)
}

fn portable_paths(current: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = current.parent().ok_or("O executável não tem pasta.")?;
    let stem = current
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("O nome do executável é inválido.")?;
    Ok((
        parent.join(format!("{stem}.new.exe")),
        parent.join(format!("{stem}.old.exe")),
    ))
}

fn swap_executable(current: &Path, downloaded: &Path) -> Result<(), String> {
    let (_, old_path) = portable_paths(current)?;
    if old_path.exists() {
        std::fs::remove_file(&old_path)
            .map_err(|error| format!("Não apaguei o executável antigo: {error}"))?;
    }
    std::fs::rename(current, &old_path)
        .map_err(|error| format!("Não renomeei o executável em execução: {error}"))?;
    if let Err(error) = std::fs::rename(downloaded, current) {
        let _ = std::fs::rename(&old_path, current);
        return Err(format!("Não coloquei o executável novo no lugar: {error}"));
    }
    Ok(())
}

async fn download_update(app: &AppHandle, info: &UpdateInfo, destination: &Path) -> Result<(), String> {
    let response = http_client()?
        .get(&info.download_url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("O download respondeu {}", response.status()));
    }

    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| error.to_string())?;
    let mut received: u64 = 0;
    let mut last_mark = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk).await.map_err(|error| error.to_string())?;
        received += chunk.len() as u64;
        let changed = match total {
            Some(total) if total > 0 => {
                let percent = received.saturating_mul(100) / total;
                let previous = last_mark.saturating_mul(100) / total;
                percent != previous || received == total
            }
            _ => received - last_mark >= 512 * 1024,
        };
        if changed {
            last_mark = received;
            let _ = app.emit(EVENT_PROGRESS, UpdateProgress { received, total });
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    Ok(())
}

/// Consulta a release em segundo plano e avisa a janela sem segurar a abertura.
pub fn spawn_startup(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        cleanup_old_executables();
        match latest_release().await {
            Ok(Some(info)) => {
                let _ = app.emit(EVENT_AVAILABLE, info);
            }
            Ok(None) => {}
            Err(error) => eprintln!("[updater] {error}"),
        }
    });
}

#[tauri::command]
pub async fn check_for_update() -> Result<Option<UpdateInfo>, String> {
    latest_release().await
}

#[tauri::command]
pub async fn install_portable_update(app: AppHandle) -> Result<(), String> {
    let info = latest_release()
        .await?
        .ok_or_else(|| "Nenhuma atualização disponível.".to_string())?;
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let (new_path, _) = portable_paths(&current)?;
    if let Err(error) = download_update(&app, &info, &new_path).await {
        let _ = tokio::fs::remove_file(&new_path).await;
        return Err(error);
    }
    swap_executable(&current, &new_path)?;
    std::process::Command::new(&current)
        .spawn()
        .map_err(|error| format!("Não iniciei o executável novo: {error}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_com_v_maior_que_a_versao_local_pede_update() {
        assert!(remote_is_newer("v0.2.0", "0.1.0"));
        assert!(remote_is_newer("0.1.1", "0.1.0"));
        assert!(!remote_is_newer("v0.1.0", "0.1.0"));
        assert!(!remote_is_newer("v0.0.9", "0.1.0"));
        assert!(!remote_is_newer("lancamento", "0.1.0"));
    }

    #[test]
    fn escolhe_o_exe_portatil_e_ignora_instalador() {
        let assets = vec![
            GithubAsset {
                name: "Telinha-setup.exe".into(),
                browser_download_url: "https://github.com/x/y/releases/download/v1/setup.exe".into(),
            },
            GithubAsset {
                name: "notas.txt".into(),
                browser_download_url: "https://github.com/x/y/releases/download/v1/notas.txt".into(),
            },
            GithubAsset {
                name: "telinha-do-botecao.exe".into(),
                browser_download_url: "https://github.com/x/y/releases/download/v1/app.exe".into(),
            },
        ];
        let picked = pick_portable_exe(&assets).unwrap();
        assert_eq!(picked.name, "telinha-do-botecao.exe");
    }

    #[test]
    fn url_de_download_fica_no_github() {
        assert!(download_url_allowed(
            "https://github.com/cleberrandreazza/telinha-do-botecao/releases/download/v0.2.0/app.exe"
        ));
        assert!(download_url_allowed(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/app.exe"
        ));
        assert!(!download_url_allowed("http://github.com/a/b.exe"));
        assert!(!download_url_allowed("https://example.test/app.exe"));
    }

    #[test]
    fn nomes_do_exe_novo_e_antigo_ficam_ao_lado_do_atual() {
        let current = PathBuf::from("C:/Apps/Telinha do Botecao.exe");
        let (new_path, old_path) = portable_paths(&current).unwrap();
        assert_eq!(new_path, PathBuf::from("C:/Apps/Telinha do Botecao.new.exe"));
        assert_eq!(old_path, PathBuf::from("C:/Apps/Telinha do Botecao.old.exe"));
    }
}
