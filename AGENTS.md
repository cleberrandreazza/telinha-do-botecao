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
4. **Deploy:** Frontend vai para Vercel (`web/`, usa `VITE_SIGNAL_HOST`) e servidor para Render (`render.yaml`). Nao quebre variaveis de ambiente existentes.