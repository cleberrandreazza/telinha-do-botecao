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

## Novidades

O que entrou na branch `feature/room-experience`:

1. **Chat por sala** — painel lateral com o histórico da sala; as mensagens são sanitizadas no
   servidor, com rate limit de 500 ms e no máximo 500 caracteres por mensagem.
2. **Trocar resolução durante a live** — quem transmite muda entre 4K / Full HD / HD / SD sem
   derrubar o compartilhamento; se a troca falhar, a transmissão continua como estava.
3. **Zoom in/out na live assistida** — de 100% a 200% em passos de 25%, com atalhos `+` / `-` / `0`.
4. **Grade de até 4 transmissões** — 2 a 4 streams lado a lado, com foco em tela cheia por stream e
   áudio/volume independentes em cada tile.
5. **Sala fixa do Botecão** — o código `BOTECO` nunca muda: compartilhe com a galera sem passar
   código por aí. Detalhes em [`docs/rooms.md`](docs/rooms.md).
6. **Reconexão após recarregar a página** — a sessão da sala é salva por 12 h e o app reentra
   sozinho; o histórico do chat sobrevive ao F5.
7. **Login lado a lado** — "Criar sala" e "Entrar na sala" na mesma tela, com acesso rápido à
   sala fixa (`BOTECO`).

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

O painel de estatísticas do player mede, em cada navegador, onde o FPS cai: captura, codificação, rede, recepção, decodificação ou reprodução. O JSON guarda até 10 minutos de amostras e uma linha do tempo da sessão: início da transmissão, entrada de cada espectador, conexão e primeira amostra são horários separados. No espectador, FPS recebido, FPS decodificado, callbacks do compositor e quadros descartados pelo `<video>` são números separados. Callback do compositor não significa quadro pintado, e `totalVideoFrames` inclui descartes. Aba oculta não entra como congelamento. A resolução pedida (por exemplo 1080p), o tamanho real da track, o que o WebRTC entrega ao encoder, o frame codificado e o frame recebido são números diferentes; o JSON de diagnóstico guarda cada um, e um valor ausente fica vazio em vez de copiar outro. O detalhe está em [`docs/diagnostics.md`](docs/diagnostics.md). O áudio tem três modos: desligado, áudio da aba (padrão) e áudio de todo o Windows, este último só na tela inteira. Compartilhar uma janela não transmite o áudio global. O JSON separa sample rate da captura, clock rate do Opus, bitrate RTP, energia, perda e amostras ocultadas. Nenhum desses números, sozinho, prova que o espectador ouve com nitidez. A negociação Opus declara a capacidade provável de canais da origem e um limite de recepção de até 320 kbps; a taxa efetiva depende do encoder e é medida no RTP. O roteiro está em [`docs/audio.md`](docs/audio.md).

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

O frontend abre em `http://localhost:3000` e o servidor de sinalização roda na porta `4000`.

```bash
# Testes do diagnóstico (na pasta web) e build de produção
npm test
npm run build
```

> **Dica:** Adicione `?mock` na URL para testar com streams fake sem precisar de outra pessoa.

### Assistir pelo celular (mesma rede Wi-Fi)

O dev server já sobe em `0.0.0.0`, então o celular na mesma rede abre `http://<ip-do-pc>:3000`.
O endereço do servidor de sinalização é derivado do hostname da página (`<ip-do-pc>:4000`), então
não há nada a configurar — só não defina `VITE_SIGNAL_HOST` com `localhost`, que o celular
resolveria como ele mesmo e a conexão cairia.

Duas limitações do navegador valem para o celular:

- **Celular não compartilha a tela.** A API de captura (`getDisplayMedia`) só existe em
  navegadores de computador. No celular o botão aparece desabilitado com o aviso explicando o
  motivo — quem compartilha é o PC, o celular assiste.
- **Captura de tela exige contexto seguro.** Abrir pelo IP (`http://192.168.x.x:3000`) não é
  contexto seguro, então o PC não consegue capturar por esse endereço. Compartilhe abrindo
  `http://localhost:3000` no próprio PC; o celular só assiste.

## Estrutura do projeto

```
telinha-do-botecao/
├── server/                # Servidor de sinalização WebSocket
│   └── index.mjs          # Gerencia salas, peers e sinalização WebRTC
├── web/                   # Frontend React
│   └── src/
│       ├── components/    # Componentes da UI
│       │   ├── Home.tsx           # Tela inicial (criar/entrar sala, sala fixa)
│       │   ├── Room.tsx           # Sala com sidebar + viewer + grade
│       │   ├── StreamViewer.tsx   # Player de stream com controles e zoom
│       │   ├── StreamTile.tsx     # Tile da grade (áudio e zoom próprios)
│       │   ├── ChatPanel.tsx      # Chat da sala
│       │   ├── ResolutionControl.tsx # Troca de resolução durante a live
│       │   ├── StatsPanel.tsx     # Painel de diagnóstico do player
│       │   ├── CrtEmptyState.tsx  # TV retrô quando ninguém transmite
│       │   ├── SettingsModal.tsx  # Config de qualidade/fps
│       │   └── StreamSettings.tsx # Seleção de tela pra compartilhar
│       ├── lib/           # Lógica de negócio
│       │   ├── signaling.ts       # Cliente WebSocket
│       │   ├── webrtc.ts          # Conexões WebRTC, ABR e monitor
│       │   ├── constants.ts       # Código da sala fixa e limite de streams
│       │   ├── diagnostics/       # Cálculo, histórico, diagnóstico e exportação
│       │   ├── mock.ts            # Dados fake pra testes
│       │   └── types.ts           # Tipos TypeScript
│       └── App.tsx        # Estado global da aplicação
├── docs/
│   ├── diagnostics.md     # Métricas, painel, exportação e testes
│   ├── audio.md           # Captura, reprodução e diagnóstico de áudio
│   └── rooms.md           # Salas, chat, grade e reconexão
├── render.yaml            # Config de deploy no Render
└── package.json           # Scripts de dev e build
```

## Deploy

O projeto já está configurado para deploy gratuito:

- **Frontend (Vercel):** Faça deploy da pasta `web/` como projeto Vite
- **Servidor (Render):** Use o `render.yaml` incluído — ele configura o serviço automaticamente

Lembre de setar a variável de ambiente `VITE_SIGNAL_HOST` no Vercel apontando para o host do servidor no Render (só o host, sem `https://` e sem porta: `telinha-do-botecao.onrender.com`). Sem ela, o app cai no fallback `${hostname}:4000`.

## Licença

MIT — use, modifique e distribua como quiser.
