# Telinha do Botecão no Windows

O aplicativo desktop é um `.exe` portátil, sem instalador, feito com Tauri v2. O site na Vercel (`web/`) e o servidor no Render (`server/`, `render.yaml`) continuam iguais. O desktop só embute o frontend e fala com o mesmo servidor de sinalização.

## Pré-requisitos

No Windows:

1. **Rust**, pelo [rustup](https://rustup.rs). No terminal, `rustup default stable`.
2. **Visual Studio Build Tools** com a carga **Desenvolvimento para desktop com C++** (MSVC e Windows SDK). O `link.exe` do Rust no Windows depende disso.
3. **WebView2**, que o Windows 11 já traz. No Windows 10, instale o [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) se a janela não abrir.
4. **Node.js**, o mesmo usado pelo resto do repositório.

Na raiz, uma vez:

```bash
npm install
npm run install:all
```

## Rodar em desenvolvimento

O `tauri dev` sobe o Vite em `http://localhost:3000` e abre a janela em cima dele. O servidor de sinalização não entra nesse comando. Para criar sala na máquina local, deixe o servidor rodando em outro terminal:

```bash
npm run dev:server
npm run tauri:dev
```

Nessa janela o endereço ainda é `localhost`, então o WebSocket vai para `ws://localhost:4000`. O `.exe` publicado não faz isso: ele aponta para o Render.

## Gerar o .exe portátil

```bash
npm run tauri:build
```

Isso compila o frontend (`npm --prefix web run build`) e o binário Rust, sem NSIS e sem MSI. O executável fica em:

```text
src-tauri/target/release/telinha-do-botecao.exe
```

Esse arquivo é o que se distribui. A pasta `src-tauri/target` não entra no git.

A versão do aplicativo está em três lugares, e os três precisam ser o mesmo número:

- `src-tauri/Cargo.toml` (`version`) — é este valor que o atualizador compara
- `src-tauri/tauri.conf.json` (`version`)
- `package.json` (`version`)

## Lançar uma versão automática

Um `git push` na `main` atualiza o site na Vercel. Ele não cria tag e não publica o desktop. A Release do `.exe` só nasce quando uma tag `v*` chega ao GitHub: o workflow `.github/workflows/release-desktop.yml` compila no Windows e anexa `telinha-do-botecao.exe` à Release dessa tag. Dá para disparar o mesmo workflow à mão em Actions, mas o anexo só entra se a ref for uma tag `v*`.

1. Atualize a `version` nos três arquivos acima, por exemplo `0.1.1`.
2. Grave o commit na `main`, crie a tag e envie os dois:

```bash
git tag v0.1.1
git push origin main --tags
```

A tag leva o `v`. O aplicativo tira esse prefixo e compara com a versão compilada. O atualizador ignora nomes com `setup`, `installer` ou `uninstall` e usa o `.exe` portátil.

Quem já está com o aplicativo aberto consulta `https://api.github.com/repos/cleberrandreazza/telinha-do-botecao/releases/latest` em segundo plano, com `User-Agent`. Se a tag for mais nova, aparece o banner **Versão … do aplicativo** e o botão **Atualizar aplicativo agora**. O download troca o `.exe` na mesma pasta (`nome.new.exe`, o atual vira `nome.old.exe`, o novo assume o nome original), abre o executável novo e fecha o processo atual. Na próxima abertura, os `*.old.exe` são apagados. Não há reload forçado: a troca só começa no botão.

## Servidor de sinalização

No `.exe` publicado a página vem de `https://tauri.localhost` ou do protocolo `tauri:`. Nesse caso o frontend não usa `ws://tauri.localhost`. A URL é `VITE_SIGNALING_URL`, se estiver definida na hora do `tauri:build`. Sem ela, o fallback é `wss://telinha-do-botecao.onrender.com`.

O site continua usando só `VITE_SIGNAL_HOST`. Essa variável não muda.
