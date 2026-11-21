<p align="center">
  <img src="https://raw.githubusercontent.com/cleberrandreazza/telinha-do-botecao/main/web/public/favicon.svg" width="80" alt="Telinha do Botecão" />
</p>

<h1 align="center">Telinha do Botecão</h1>

<p align="center">
  <strong>Compartilhador de tela P2P gratuito, sem travamentos e sem cadastro.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WebRTC-P2P-10b981?style=flat-square&logo=webrtc&logoColor=white" />
  <img src="https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite_6-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/100%25_Gratuito-10b981?style=flat-square" />
</p>

---

## Sobre

**Telinha do Botecão** nasceu pra resolver um problema simples: assistir a tela de alguém sem precisar instalar nada, sem criar conta e sem pagar. Ideal pra assistir jogos, acompanhar apresentações ou qualquer situação onde você quer compartilhar a tela com amigos — como se fosse a TV do boteco.

A comunicação é **peer-to-peer (P2P)** via WebRTC, ou seja, o vídeo vai direto de quem compartilha pra quem assiste. O servidor só faz a conexão inicial (sinalização) — nenhum vídeo passa por ele.

## Como funciona

```
┌──────────┐    WebSocket     ┌──────────────┐    WebSocket     ┌──────────┐
│  Quem    │◄────────────────►│  Servidor de │◄────────────────►│  Quem    │
│ compartilha│   (sinalização)  │  Sinalização │   (sinalização)  │  assiste │
└──────────┘                  └──────────────┘                  └──────────┘
      │                                                              ▲
      │                     WebRTC (P2P direto)                      │
      └──────────────────────────────────────────────────────────────┘
                           vídeo + áudio
```

1. Alguém cria uma sala e recebe um código
2. Outros entram com o código
3. Quem quiser compartilha a tela
4. Todos assistem em tempo real, direto pelo navegador

O painel de estatísticas do player mede, em cada navegador, onde o FPS cai: captura, codificação, rede, recepção, decodificação ou reprodução. A resolução pedida (por exemplo 1080p), o tamanho real da track, o que o WebRTC entrega ao encoder, o frame codificado e o frame recebido são números diferentes; o JSON de diagnóstico guarda cada um, e um valor ausente fica vazio em vez de copiar outro. O detalhe está em [`docs/diagnostics.md`](docs/diagnostics.md). O áudio tem três modos: desligado, áudio da aba (padrão) e áudio de todo o Windows, este último só na tela inteira. Compartilhar uma janela não transmite o áudio global. O roteiro está em [`docs/audio.md`](docs/audio.md).

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript + Vite 6 |
| Estilo | Tailwind CSS 3 + Material Design 3 tokens |
| Comunicação | WebRTC (`getDisplayMedia` + `RTCPeerConnection`) |
| Sinalização | Node.js + WebSocket (`ws`) |
| Deploy | Vercel (frontend) + Render (servidor) |

## Rodando localmente

**Pré-requisitos:** Node.js 18+

```bash
# Clone o repositório
git clone https://github.com/cleberrandreazza/telinha-do-botecao.git
cd telinha-do-botecao

# Instale as dependências
npm run install:all

# Rode tudo (servidor + frontend)
npm run dev
```

O frontend abre em `http://localhost:3000` e o servidor de sinalização roda na porta `8080`.

```bash
# Testes do diagnóstico (na pasta web) e build de produção
npm test
npm run build
```

> **Dica:** Adicione `?mock` na URL para testar com streams fake sem precisar de outra pessoa.

## Estrutura do projeto

```
telinha-do-botecao/
├── server/                # Servidor de sinalização WebSocket
│   └── index.mjs          # Gerencia salas, peers e sinalização WebRTC
├── web/                   # Frontend React
│   └── src/
│       ├── components/    # Componentes da UI
│       │   ├── Home.tsx           # Tela inicial (criar/entrar sala)
│       │   ├── Room.tsx           # Sala com sidebar + viewer
│       │   ├── StreamViewer.tsx   # Player de stream com controles
│       │   ├── StatsPanel.tsx     # Painel de diagnóstico do player
│       │   ├── CrtEmptyState.tsx  # TV retrô quando ninguém transmite
│       │   ├── SettingsModal.tsx  # Config de qualidade/fps
│       │   └── StreamSettings.tsx # Seleção de tela pra compartilhar
│       ├── lib/           # Lógica de negócio
│       │   ├── signaling.ts       # Cliente WebSocket
│       │   ├── webrtc.ts          # Conexões WebRTC, ABR e monitor
│       │   ├── diagnostics/       # Cálculo, histórico, diagnóstico e exportação
│       │   ├── mock.ts            # Dados fake pra testes
│       │   └── types.ts           # Tipos TypeScript
│       └── App.tsx        # Estado global da aplicação
├── docs/
│   ├── diagnostics.md     # Métricas, painel, exportação e testes
│   └── audio.md           # Captura, reprodução e diagnóstico de áudio
├── render.yaml            # Config de deploy no Render
└── package.json           # Scripts de dev e build
```

## Deploy

O projeto já está configurado para deploy gratuito:

- **Frontend (Vercel):** Faça deploy da pasta `web/` como projeto Vite
- **Servidor (Render):** Use o `render.yaml` incluído — ele configura o serviço automaticamente

Lembre de setar a variável de ambiente `VITE_SIGNALING_URL` no Vercel apontando para a URL do servidor no Render.

## Licença

MIT — use, modifique e distribua como quiser.
