# Áudio

O áudio sai da captura da tela (`getDisplayMedia`), entra no `RTCPeerConnection` de quem compartilha e toca no mesmo `<video>` de quem assiste. Não há segundo elemento de áudio.

## Onde a implementação anterior falhava

Havia dois defeitos no código, independentes do seletor do navegador.

1. **Reprodução.** `StreamViewer` chamava `play()` com o vídeo mudo e, no instante seguinte, o efeito de volume fazia `muted = false` fora de um gesto. O `catch` de `play()` engolia o erro. No Chrome e no Edge isso deixa a imagem tocando e o som bloqueado, sem aviso. O botão de volume só mudava o estado React; o `play()` audível não rodava dentro do clique.

2. **Track tardia.** O `ontrack` de vídeo publica a `MediaStream` assim que ela chega. O áudio pode entrar nessa mesma stream depois. O Chromium não passa a reproduzir uma track adicionada a uma stream que já está em `srcObject`. O vídeo seguia; o áudio não.

A captura pede `audio: true` ou `audio: false`. Isso não cria a track. O Chrome e o Edge só a entregam se a pessoa marcar a caixa do seletor, e a caixa muda conforme a superfície. Os hints não obrigam o navegador a devolver áudio.

Há três modos, gravados em `localStorage` como `audioMode`:

| Modo | Pedido ao navegador | O que pode ser transmitido |
| --- | --- | --- |
| `off` | `audio: false` | Só vídeo |
| `source` (padrão) | `audio: true`, `systemAudio: "exclude"`, `windowAudio: "window"` | Áudio da aba, ou só o do programa quando a superfície é uma janela e o navegador isola esse som |
| `system` | `audio: true`, `systemAudio: "include"`, `windowAudio: "system"` | Áudio do Windows, na tela inteira ou junto com uma janela |

`windowAudio: "system"` só é pedido no modo `system`, que a pessoa escolhe de propósito: ele leva o áudio de todo o Windows também quando a superfície é uma janela. O modo padrão nunca pede esse valor. Uma preferência antiga `shareAudio: true` migra para `source`. `shareAudio: false` migra para `off`. Nada migra sozinho para `system`. Um `audioMode: "device"` salvo pela versão antiga, que capturava uma entrada como o VB-Cable, não é mais aceito e segue a mesma migração de `shareAudio`.

A captura pede `audio: true` como boolean. Logo depois, na faixa já devolvida de aba ou janela, aplica `echoCancellation: false`, `noiseSuppression: false` e `autoGainControl: false`. Esses campos não entram no `getDisplayMedia`: um objeto de processamento nessa chamada faz o Chrome descartar a faixa. Se o navegador recusar o trio, cada filtro é pedido sozinho. Qualquer recusa é ignorada, o vídeo segue, e o valor que realmente ficou é o de `getSettings` — nada é escrito no lugar de uma recusa.

Se o navegador rejeitar uma opção com `TypeError`, `NotSupportedError` ou `OverconstrainedError`, a captura desce uma escada que nunca alarga o escopo:

1. O pedido completo (`windowAudio: "window"` em `source`, `"system"` em `system`).
2. O mesmo pedido com `windowAudio: "exclude"`, o escopo de antes. O `systemAudio` não muda. `requestDisplayMedia` devolve `windowAudioFallback: true`.
3. Só vídeo (`audioScopeFallback: true`).

`windowAudio` nunca é omitido quando há áudio. Sem o campo vale o padrão do navegador, que no Chrome para Windows pode incluir o áudio global. Com `windowAudioFallback`, uma janela não tem o escopo pedido garantido: qualquer track devolvida é descartada (política `window-unsupported`). Na troca de fonte (`fallbackToVideoOnly: false`), o degrau 2 acontece dentro de `requestDisplayMedia`, e só o erro do degrau 3 volta para quem chamou. Cancelamento (`NotAllowedError`) não é repetido. Uma falha só de áudio não cancela o vídeo. A troca que dá certo reaplica o teto do sender de áudio em cada conexão que está transmitindo.

Depois que a pessoa confirma o seletor, e antes de `localStream` e de `start-sharing`, o código lê `videoTrack.getSettings().displaySurface` e aplica a política. Track descartada é interrompida com `stop()` e removida da stream. Não se usa `track.label`.

| Modo | Superfície | Áudio transmitido |
| --- | --- | --- |
| `source` | `browser` | A track da aba, se existir |
| `source` | `window` | A track da janela, se existir (política `window-audio`) |
| `source` ou `system` | `window` com `windowAudioFallback` | Nenhum. O navegador não isolou o áudio (política `window-unsupported`) |
| `source` | `monitor` | Nenhum. Áudio global fica de fora neste modo |
| `source` | desconhecida | Nenhum |
| `system` | `monitor` | A track, se o seletor a devolveu |
| `system` | `window` | A track do áudio do Windows, se existir (política `system-window`) |
| `system` | `browser` | Nenhum. O aviso diz que o áudio do Windows exige a tela inteira ou uma janela |
| `system` | desconhecida | Nenhum |
| `off` | qualquer | Nenhum |

Mensagens possíveis: “Áudio da aba disponível.”, “Áudio da janela disponível.”, “Áudio do Windows transmitido junto com a janela.”, “O navegador não isola o áudio desta janela.”, “Áudio não capturado pela superfície selecionada.”, “Áudio do Windows exige tela inteira ou janela.” e “Navegador não oferece opções suficientes para garantir o escopo solicitado.” Quando o modo não é `off` e `returnedTracks` é 0, a mensagem de captura indisponível fica num banner âmbar no topo da sala enquanto a transmissão durar. Existir uma track não significa que o áudio está sendo enviado. O painel separa modo, superfície, política, tracks devolvidas, tracks autorizadas e o motivo do descarte. O estado **ÁUDIO SENDO ENVIADO** continua exigindo pacotes ou bytes em avanço.

## Como o som chega ao espectador

- Quem compartilha dá `addTrack` de cada track de áudio no mesmo `MediaStream` do vídeo.
- A oferta do transmissor passa por `configureOpusSenderSdp()` e a resposta do espectador por `configureOpusReceiverSdp()`. Ambos declaram `maxaveragebitrate=192000` e `usedtx=0` como preferências de recepção (RFC 7587 §7.1); esses campos do SDP não configuram o bitrate enviado. O SDP do transmissor usa `stereo=1`; a resposta usa `stereo=0` quando a oferta informa `sprop-stereo=0`, e `stereo=1` nos demais casos. `sprop-stereo` só é incluído quando `getSettings().channelCount` confirma 1 ou 2+ canais. Depois de `setRemoteDescription()` da resposta, o sender RTP de áudio recebe `encodings[0].maxBitrate=192000`; o código relê `getParameters()` para confirmar o valor aplicado. Esse limite não garante bitrate efetivo. `usedtx=0` é uma preferência receive-only no SDP que pede ao peer remoto para não usar DTX; não configuramos `encoding.dtx`, que não é uma opção padronizada de `setParameters`. O `stereo` é preferência de recepção e não afirma a capacidade da fonte nem que o endpoint envia áudio estéreo. Os parâmetros existentes são atualizados sem duplicação; `useinbandfec` é preservado. O restante do SDP, inclusive o vídeo, não é reescrito. Sem `opus/48000/2`, o SDP segue intacto. `maxaveragebitrate=192000` é uma preferência/teto de recepção, não uma garantia de bitrate ou nitidez; a taxa real continua sendo medida pelos bytes RTP.
- `suppressLocalAudioPlayback` não é pedido. Na especificação de screen capture essa restrição fica dentro de `audio`, não no topo de `getDisplayMedia`. O valor antigo no topo era inválido. Não o movemos para dentro de `audio` nesta etapa, porque isso mudaria o que a pessoa ouve na própria máquina. O comportamento local fica o padrão do navegador, e a track continua sendo capturada e enviada.
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
| ÁUDIO RECEBIDO E REPRODUZINDO | Pacotes aumentam e o elemento está tocando, desmutado e com volume. Isso não diz que o som chegou nítido |
| ÁUDIO SEM DADOS SUFICIENTES | Ainda não há intervalo ou leitura do elemento |

## O que cada número de áudio significa

Um bitrate de cerca de 128 kbps e cerca de 50 pacotes por segundo só dizem que há fluxo. Não dizem que a fidelidade da origem chegou ao espectador. Estes valores ficam separados no JSON e na camada técnica do painel. Dado que o navegador não expõe aparece como `null` no JSON e `n/d` no painel. Não é preenchido com zero.

| Medida | O que ela é | O que ela não é |
| --- | --- | --- |
| Bitrate RTP | Bytes de áudio no intervalo, vezes 8 | Qualidade sonora, nem a taxa que o Opus realmente usou em cada quadro |
| Clock rate | Relógio do payload, em geral 48000 no Opus | Sample rate da track capturada |
| Sample rate da captura | `getSettings().sampleRate`, se o navegador informar | Clock rate do SDP |
| Canais negociados | O terceiro número de `opus/48000/2`, ou `channels` no relatório `codec` | Prova de que os dois canais estão saindo ou chegando |
| Canais capturados | `channelCount` em `getSettings()`, quando existe | O número pedido no SDP |
| `stereo` e `sprop-stereo` | Preferência do receptor e indicação da capacidade provável do transmissor (`0` ou `1`) | Estéreo de fato, nem confirmação de que os dois canais atravessaram a rede |
| `maxaveragebitrate=192000` | Preferência/teto médio de recepção declarado no `fmtp` | Bitrate medido, garantia de 192 kbps ou nitidez |
| Energia (`totalAudioEnergy`) | Soma de energia do relatório de origem, no transmissor, ou do `inbound-rtp`, no espectador | Espectro, agudos ou “som abafado” |
| Nível (`audioLevel`) | Nível instantâneo informado por aquele relatório | Qualidade |
| RMS e dBFS | `sqrt(delta da energia / delta da duração)` e `20 * log10(rms)`, só com dois intervalos válidos | Uma nota de qualidade. RMS 0 não vira dBFS, porque o logaritmo não é finito |
| Pacotes perdidos | Delta de `packetsLost` do áudio | Perda do vídeo. Os contadores não se misturam |
| Amostras ocultadas, FEC, aceleração e desaceleração | O que o jitter buffer do áudio fez neste intervalo | Prova de que o ouvinte percebeu ou deixou de perceber um defeito |
| Reprodução | `PLAYING`, volume, mudo e bloqueio do `<video>` | Audição boa |

No transmissor, a energia vem do `media-source` de áudio associado ao `mediaSourceId` do `outbound-rtp`. O `media-source` de vídeo não entra nessa conta. No espectador, os campos de recepção vêm só do `inbound-rtp` de áudio. A coleta continua sendo o `getStats()` que o monitor já faz uma vez por segundo. Não há `AudioContext` nem uma segunda consulta.

A leitura da track acontece quando `getDisplayMedia()` devolve a faixa autorizada: `getSettings()`, `getConstraints()` e `getCapabilities()`. Cada um fica no seu campo. Identificador, rótulo e o SDP completo não são gravados. O `fmtp` exportado só pode conter `stereo`, `sprop-stereo`, `maxaveragebitrate`, `maxplaybackrate`, `sprop-maxcapturerate`, `useinbandfec`, `usedtx`, `ptime` e `maxptime`.

Chrome, Edge e Firefox não expõem o mesmo conjunto. Quando falta `getCapabilities`, o campo `capabilities` fica `null`. Uma faixa numérica com mínimo diferente do máximo não vira um único `sampleRate`. `concealedSamples`, `fecPacketsReceived`, `audioLevel` e `suppressLocalAudioPlayback` podem aparecer como `n/d` sem que isso signifique zero. A supressão local na superfície só entra se `getSettings()` da track de vídeo realmente trouxer o campo.

Nada disso aprova a qualidade auditiva. O classificador continua dizendo apenas se há captura, envio, recepção e reprodução.

Eventos locais, também no JSON: captura iniciada, áudio indisponível, track adicionada ao sender, negociação, áudio recebido, áudio interrompido, reprodução bloqueada, áudio ativado pelo usuário.

## O que os testes automatizados cobrem

`npm test` cobre os modos de `getDisplayMedia`, a política por superfície (inclusive janela em `source` e `system`), a ordem (descarte antes de `localStream` e de `start-sharing`), a escada de fallback `window`/`system` para `exclude` e depois só vídeo, que não alarga o escopo, a migração de `shareAudio` e o classificador. Isso não é um teste auditivo.

## Roteiro físico no Chrome e no Edge (Windows 11)

Estes testes precisam ser ouvidos por uma pessoa. Não marque como aprovado sem essa execução. O seletor do navegador é quem escolhe a superfície.

**Teste A — aba**

1. Reproduza áudio na aba que será compartilhada.
2. Reproduza outro áudio em um aplicativo externo do Windows.
3. Na Telinha, deixe o modo **Áudio da aba ou janela**.
4. Compartilhe somente essa aba e marque “Compartilhar áudio da guia”.
5. O espectador deve ouvir só o áudio da aba. O aplicativo externo não pode aparecer no som dele.
6. No painel de quem transmite, a superfície é `browser`, a política é “Áudio da aba disponível.” e **ÁUDIO SENDO ENVIADO** só aparece com pacotes/s acima de zero.

**Teste B — janela**

1. Reproduza som na janela escolhida e também em outro aplicativo.
2. Compartilhe a janela, no modo **Áudio da aba ou janela**. Marque a opção de áudio no seletor, se aparecer.
3. Se o navegador isola o áudio da janela: o espectador ouve só o programa compartilhado, e a política no painel é “Áudio da janela disponível.”. O outro aplicativo não pode aparecer no som dele.
4. Se o navegador não isola: o vídeo continua sem áudio, e a política é “O navegador não isola o áudio desta janela.” (`window-unsupported`) ou a mensagem de janela sem track. Nenhum som global chega ao espectador.

**Teste C — áudio de todo o Windows**

1. Selecione explicitamente **Áudio de todo o Windows**.
2. Compartilhe a tela inteira e marque o áudio do sistema no seletor. O espectador deve ouvir o áudio do Windows, e a superfície no painel é `monitor`.
3. Repita compartilhando uma janela. O espectador ouve o áudio de todo o Windows, a superfície é `window` e a política é “Áudio do Windows transmitido junto com a janela.”.

**Teste D — privacidade**

1. Volte ao modo **Áudio da aba ou janela**.
2. Compartilhe uma janela, com som em um aplicativo que não é essa janela.
3. Nenhum som de aplicativo externo chega ao espectador.

Se aparecer **Ativar áudio** no espectador, o clique é que libera o som. Codec no painel, sozinho, não conta.

**Teste E — referência conhecida, ainda não executado**

Este teste não foi feito nesta etapa e não aprova o áudio. Ele serve para comparar a captura com a recepção depois que os campos novos existem.

1. No Chrome, reproduza um WAV estéreo de 48 kHz conhecido na aba que será compartilhada.
2. Confirme que quem transmite continua ouvindo essa referência na própria máquina.
3. Conecte um espectador.
4. Deixe tocar por pelo menos 60 segundos.
5. Exporte o JSON dos dois lados.
6. Anote, ouvindo, se o espectador percebe som abafado, perda de agudos, mono, distorção ou falhas.
7. Compare sample rate e canais da captura, parâmetros Opus locais e remotos, clock rate e canais do relatório `codec`, energia e nível dos dois lados, perda, jitter e amostras ocultadas.

Um teste A/B seguinte, também ainda não feito, compara a negociação Opus atual com a negociação nativa do navegador. Só uma variável muda de cada vez. Essa troca não está implementada.
