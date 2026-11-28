# AGENTS.md — Telinha do Botecao

## Visao Geral
Compartilhador de tela P2P gratuito via WebRTC (sem cadastro).
- **Frontend (`web/`):** React 18, TypeScript, Vite 6, Tailwind CSS 3 + Material Design 3 tokens.
- **Sinalizacao (`server/`):** Node.js + WebSocket (`ws`) em `server/index.mjs` (porta `4000`).
- **Documentacao Tecnica (`docs/`):** Leia `docs/diagnostics.md` e `docs/audio.md` antes de alterar metricas de player, FPS, bitrate RTP ou negociacao Opus.

## Comandos Essenciais
- Instalar dependencias: `npm run install:all`
- Rodar dev (frontend :3000 + server :4000): `npm run dev`
- Rodar testes de diagnostico (em `web/`): `npm test`
- Build de producao (em `web/`): `npm run build`

## Regras para os Agentes
1. **Sempre consulte `docs/`:** Nunca altere `web/src/lib/diagnostics/` ou `webrtc.ts` sem respeitar as regras documentadas em `docs/diagnostics.md` e `docs/audio.md` (ex.: valores ausentes devem ficar vazios, nunca copiados de outra metrica).
2. **Validacao obrigatoria (`@QA`):** Toda alteracao no frontend deve passar por `npm test` e `npm run build` dentro de `web/`. Use `http://localhost:3000/?mock` para validar visualmente os estados do player sem precisar abrir transmissao real.
3. **Escopo enxuto:** Modifique apenas os arquivos estritamente necessarios para a tarefa atual. Mantenha a tipagem TypeScript estrita em `web/src/lib/types.ts`.
4. **Deploy:** Frontend vai para Vercel (`web/`, usa `VITE_SIGNAL_HOST`) e servidor para Render (`render.yaml`). Nao quebre variaveis de ambiente existentes. `git push` comum na `main` serve apenas para atualizacoes web (Vercel) e nao deve criar tags nem disparar release desktop.
5. **Release desktop:** So quando o usuario pedir explicitamente para "publicar uma nova release desktop" ou "lancar versao do app":
   1. Incremente a versao semantica (patch, ou o nivel que ele pediu) sincronizada em `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` e `package.json`.
   2. Valide com `npm --prefix web test` e `cargo check --manifest-path src-tauri/Cargo.toml`.
   3. Crie o commit `chore(desktop): release vX.Y.Z`, a tag `vX.Y.Z` e rode `git push origin main --tags`. O GitHub Actions compila e publica o `telinha-do-botecao.exe` nessa tag.