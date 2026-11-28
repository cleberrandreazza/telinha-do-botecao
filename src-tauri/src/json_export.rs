/// Salva o JSON de estatísticas pelo seletor nativo.
/// O WebView2 bloqueia download por `blob:` + `<a download>`.

#[tauri::command]
pub fn save_json_file(default_filename: String, content: String) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name(&default_filename)
        .add_filter("JSON", &["json"])
        .save_file();
    let Some(path) = path else {
        return Ok(None);
    };
    std::fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
