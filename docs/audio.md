# Áudio

O áudio sai da captura da tela (`getDisplayMedia`), entra no `RTCPeerConnection` de quem compartilha e toca no mesmo `<video>` de quem assiste. Não há microfone e não há segundo elemento de áudio.

## Onde a implementação anterior falhava

Havia dois defeitos no código, independentes do seletor do navegador.

1. **Reprodução.** `StreamViewer` chamava `play()` com o vídeo mudo e, no instante seguinte, o efeito de volume fazia `muted = false` fora de um gesto. O `catch` de `play()` engolia o erro. No Chrome e no Edge isso deixa a imagem tocando e o som bloqueado, sem aviso. O botão de volume só mudava o estado React; o `play()` audível não rodava dentro do clique.

2. **Track tardia.** O `ontrack` de vídeo publica a `MediaStream` assim que ela chega. O áudio pode entrar nessa mesma stream depois. O Chromium não passa a reproduzir uma track adicionada a uma stream que já está em `srcObject`. O vídeo seguia; o áudio não.

A captura pede `audio: true` ou `audio: false`. Isso não cria a track. O Chrome e o Edge só a entregam se a pessoa marcar a caixa do seletor, e a caixa muda conforme a superfície. Os hints não obrigam o navegador a devolver áudio.

Há três modos, gravados em `localStorage` como `audioMode`:

| Modo | Pedido ao navegador | O que pode ser transmitido |
| --- | --- | --- |
| `off` | `audio: false` | Só vídeo |
| `source` (padrão) | `audio: true`, `systemAudio: "exclude"`, `windowAudio: "exclude"` | Áudio da aba, se o seletor devolver a track |
| `system` | `audio: true`, `systemAudio: "include"`, `windowAudio: "exclude"` | Áudio do Windows, e só se a superfície confirmada for a tela inteira |

`windowAudio: "system"` não é usado. Esse valor pedia o áudio de todo o Windows quando a pessoa escolhia uma janela. Uma preferência antiga `shareAudio: true` migra para `source`. `shareAudio: false` migra para `off`. Nada migra sozinho para `system`.

Constraints de processamento (`echoCancellation`, `noiseSuppression`, `autoGainControl`) não são enviadas: no Chrome elas fazem a captura de áudio da tela ser ignorada.

Se o navegador rejeitar uma opção com `TypeError`, `NotSupportedError` ou `OverconstrainedError`, há uma segunda tentativa, só com vídeo. A restrição `exclude` não é retirada para seguir com áudio. Cancelamento (`NotAllowedError`) não é repetido. Uma falha só de áudio não cancela o vídeo.

Depois que a pessoa confirma o seletor, e antes de `localStream` e de `start-sharing`, o código lê `videoTrack.getSettings().displaySurface` e aplica a política. Track descartada é interrompida com `stop()` e removida da stream. Não se usa `track.label`.

| Modo | Superfície | Áudio transmitido |
| --- | --- | --- |
| `source` | `browser` | A track da aba, se existir |
| `source` | `window` | Nenhum. O navegador não oferece o áudio exclusivo da janela |
| `source` | `monitor` | Nenhum. Áudio global fica de fora neste modo |
| `source` | desconhecida | Nenhum |
| `system` | `monitor` | A track, se o seletor a devolveu |
| `system` | `browser` ou `window` | Nenhum. O aviso diz que o áudio do Windows exige a tela inteira |
| `system` | desconhecida | Nenhum |
| `off` | qualquer | Nenhum |

Mensagens possíveis: “Áudio da aba disponível.”, “Áudio não capturado pela superfície selecionada.”, “Áudio global desabilitado para janelas.”, “Áudio do Windows exige compartilhamento da tela inteira.” e “Navegador não oferece opções suficientes para garantir o escopo solicitado.” Existir uma track não significa que o áudio está sendo enviado. O painel separa modo, superfície, política, tracks devolvidas, tracks autorizadas e o motivo do descarte. O estado **ÁUDIO SENDO ENVIADO** continua exigindo pacotes ou bytes em avanço.

## Como o som chega ao espectador

- Quem compartilha dá `addTrack` de cada track de áudio no mesmo `MediaStream` do vídeo.
- O SDP não é reescrito. Depois da oferta e da resposta, a seção `m=audio` é só lida: presença, porta 0 (rejeitada), direção e codec.
- Quem assiste escuta `addtrack`. Se o conjunto de tracks mudou, o `<video>` recebe um `MediaStream` novo com vídeo e áudio juntos, e `play()` é chamado de novo.
- O primeiro `play()` já pede som, se o volume for maior que zero. Se o navegador recusar (`NotAllowedError`), o vídeo segue mudo e aparece o botão **Ativar áudio**. O clique chama `play()` desmutado na hora. O slider de volume faz o mesmo.
- Uma track de áudio `muted` no receptor não derruba a conexão. Track de áudio de aba começa muda até existir som.

## O que o diagnóstico distingue

O painel não trata “existe um relatório `inbound-rtp` de áudio” como áudio funcionando. O estado sai dos fatos:

| Estado | Evidência |
| --- | --- |
| ÁUDIO DESABILITADO | A configuração pediu para não capturar |
| ÁUDIO NÃO CAPTURADO | Áudio pedido e `getAudioTracks().length === 0` |
| ÁUDIO CAPTURADO, MAS NÃO ENVIADO | Track encerrada, desabilitada, muted, sem sender, ou pacotes/bytes parados |
| ÁUDIO NÃO NEGOCIADO | SDP sem seção de áudio aceita, ou direção que não envia/recebe |
| ÁUDIO NÃO RECEBIDO | Sem track remota, ou bytes recebidos que não aumentam |
| ÁUDIO RECEBIDO, MAS SILENCIADO | Pacotes aumentam e o elemento está mudo, pausado, com volume 0 ou com `play()` recusado |
| ÁUDIO SENDO ENVIADO | No transmissor, pacotes ou bytes de áudio aumentam. Não prova que o outro lado ouve |
| ÁUDIO RECEBIDO E REPRODUZINDO | Pacotes aumentam e o elemento está tocando, desmutado e com volume |
| ÁUDIO SEM DADOS SUFICIENTES | Ainda não há intervalo ou leitura do elemento |

Eventos locais, também no JSON: captura iniciada, áudio indisponível, track adicionada ao sender, negociação, áudio recebido, áudio interrompido, reprodução bloqueada, áudio ativado pelo usuário.

## O que os testes automatizados cobrem

`npm test` cobre os modos de `getDisplayMedia`, a política por superfície, a ordem (descarte antes de `localStream` e de `start-sharing`), o fallback que não alarga o escopo, a migração de `shareAudio` e o classificador. Isso não é um teste auditivo.

## Roteiro físico no Chrome e no Edge (Windows 11)

Estes quatro testes precisam ser ouvidos por uma pessoa. Não marque como aprovado sem essa execução. O seletor do navegador é quem escolhe a superfície.

**Teste A — aba**

1. Reproduza áudio na aba que será compartilhada.
2. Reproduza outro áudio em um aplicativo externo do Windows.
3. Na Telinha, deixe o modo **Áudio da aba**.
4. Compartilhe somente essa aba e marque “Compartilhar áudio da guia”.
5. O espectador deve ouvir só o áudio da aba. O aplicativo externo não pode aparecer no som dele.
6. No painel de quem transmite, a superfície é `browser`, a política é “Áudio da aba disponível.” e **ÁUDIO SENDO ENVIADO** só aparece com pacotes/s acima de zero.

**Teste B — janela**

1. Reproduza som na janela escolhida e também em outro aplicativo.
2. Compartilhe a janela, no modo **Áudio da aba**.
3. O espectador não recebe áudio global. O vídeo continua.
4. O aviso deve dizer que o áudio global está desabilitado para janelas. O Chrome e o Edge no Windows não entregam o áudio exclusivo dessa janela.

**Teste C — tela inteira**

1. Selecione explicitamente **Áudio de todo o Windows**.
2. Compartilhe a tela inteira e marque o áudio do sistema no seletor.
3. O espectador deve ouvir o áudio do Windows. A superfície no painel é `monitor`.

**Teste D — privacidade**

1. Volte ao modo **Áudio da aba**.
2. Compartilhe uma janela, com som em um aplicativo que não é essa janela.
3. Nenhum som de aplicativo externo chega ao espectador.

Se aparecer **Ativar áudio** no espectador, o clique é que libera o som. Codec no painel, sozinho, não conta.
