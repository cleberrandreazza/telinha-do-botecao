# Discord

O site e o servidor de sinalização funcionam sem nada disso. O Rich Presence e o comando `/telinha` só ligam quando o aplicativo do Discord está configurado.

Há um aplicativo só no [Discord Developer Portal](https://discord.com/developers/applications). O **Application ID** (Client ID) é público e serve para o status do app desktop. O **Bot Token** é segredo e fica só no servidor do Render.

## 1. Criar o aplicativo

1. Abra o portal e clique em **New Application**. O nome aparece no status, por exemplo `Telinha do Botecão`.
2. Em **General Information**, copie o **Application ID**. Esse é o `DISCORD_CLIENT_ID`.
3. Em **Rich Presence → Art Assets**, se quiser um ícone no status, envie uma imagem. O status funciona sem arte.
4. Em **Bot**, clique em **Reset Token** e copie o token. Esse é o `DISCORD_BOT_TOKEN`. Ele não entra no `.exe` nem no frontend.
5. Na mesma página do Bot, em **Privileged Gateway Intents**, deixe desligados Presence, Server Members e Message Content. O `/telinha` só precisa do intent de voz, que não é privilegiado.
6. Em **OAuth2 → URL Generator**, marque o escopo `bot` e a permissão **Send Messages** (o comando em si usa o registro global de slash command; o bot precisa estar no servidor). Abra a URL gerada e convide o bot para o seu servidor.
7. Em **Installation**, se aparecer, escolha instalar em servidores (Guild Install).

O comando global pode levar até uma hora para aparecer em todos os servidores. Reiniciar o bot registra de novo.

## 2. Rich Presence no app desktop

O status sai do `.exe`, pelo IPC local do Discord. Se o Discord estiver fechado, o app segue normal e não mostra erro.

Na máquina que compila o desktop, defina o Client ID antes do build:

```bash
# Windows, no mesmo terminal do build
set DISCORD_CLIENT_ID=123456789012345678
npm run tauri:build
```

No PowerShell: `$env:DISCORD_CLIENT_ID = "123456789012345678"`.

Sem essa variável o comando `update_discord_presence` existe, mas não publica nada.

O que o Discord recebe:

| Situação | Status |
| --- | --- |
| Fora da sala | atividade limpa |
| Sala com senha, ou interruptor **Ocultar atividade no Discord** | só `Em uma sala privada`, sem código, sem party e sem botão |
| Sala pública, transmitindo | `Transmitindo tela`, contagem `pessoas / 50` e botão **Entrar na Sala** |
| Sala pública, assistindo | `Assistindo na sala`, a mesma contagem e o mesmo botão |

O botão aponta para `https://telinha-do-botecao.vercel.app/<CODIGO>`. Outro domínio: defina `PUBLIC_WEB_URL` (https, sem barra no fim) na compilação do desktop e no Render.

O interruptor fica no chat da sala e também em Configurações. Sala com senha já entra no modo privado, mesmo com o interruptor desligado.

## 3. Link `telinha://sala/<CODIGO>`

O `.exe` portátil registra o esquema `telinha` na primeira abertura (registro do usuário atual, sem instalador). Um segundo clique no link foca a janela que já está aberta e entra na sala. Não abre outra janela.

O convite que o bot entrega no privado inclui `?ticket=`. O aplicativo lê esse ticket e o manda na entrada. Sem ticket, a sala criada pelo `/telinha` recusa o código, mesmo que alguém o digite na Home.

## 4. Bot `/telinha` no Render

No serviço do `render.yaml`, além das variáveis que já existem, adicione:

| Variável | Valor |
| --- | --- |
| `DISCORD_BOT_TOKEN` | o token do passo 1. Segredo. |
| `DISCORD_CLIENT_ID` | o Application ID |
| `PUBLIC_WEB_URL` | opcional. Padrão `https://telinha-do-botecao.vercel.app` |

Sem o token ou sem o Client ID, o processo sobe só com a sinalização WebSocket.

No canal de voz, alguém usa `/telinha`. Opção `privada` (boolean, opcional):

- a pessoa precisa estar na call;
- o bot associa o id do canal de voz a uma sala do Telinha e marca essa sala como restrita;
- enquanto essa sala ainda existir, quem entrar depois na call e usar `/telinha` cai na mesma sala;
- quando a sala some (call encerrada e o tempo de espera acabou), o próximo `/telinha` cria outra;
- `privada: true`, sala com senha ou sala já marcada como privada: a resposta do comando é efêmera (`ephemeral: true`).

A mensagem do comando **não** mostra o código nem uma URL com `?sala=`. Ela tem um botão **Entrar na Sala** (`customId` `join_telinha:<id do canal de voz>`).

Quem clica precisa estar conectado exatamente naquele canal de voz. Fora da call, a resposta efêmera bloqueia a entrada. Dentro da call, o servidor gera um ticket de uso único, válido por 45 segundos, e só essa pessoa vê os links `?sala=<CODIGO>&ticket=<TOKEN>` e `telinha://sala/<CODIGO>?ticket=<TOKEN>`.

A sinalização recusa `join-room` numa sala restrita sem ticket válido e não expirado. Digitar o código na Home não entra. O ticket não fica salvo no navegador: atualizar a página pede um clique novo no botão.
