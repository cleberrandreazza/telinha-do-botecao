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
- A oferta do transmissor passa por `configureOpusSenderSdp()` e a resposta do espectador por `configureOpusReceiverSdp()`. Ambos declaram `maxaveragebitrate=320000`, limite de recepção do endpoint local. A oferta do transmissor anuncia sua capacidade provável com `sprop-stereo`, somente quando `getSettings().channelCount` informa 1 ou 2+ canais. A resposta do espectador usa `stereo=1` quando o transmissor anuncia uma fonte estéreo ou não informa o dado; se a oferta anuncia `sprop-stereo=0`, a resposta usa `stereo=0` para não pedir upmix de uma fonte mono. A resposta do espectador não afirma que ele envia áudio estéreo. Os parâmetros existentes são atualizados sem duplicação; `useinbandfec` é preservado. O restante do SDP, inclusive o vídeo, não é reescrito. Sem `opus/48000/2`, o SDP segue intacto. `maxaveragebitrate=320000` é um teto de recepção, não uma garantia de bitrate ou nitidez; a taxa real continua sendo medida pelos bytes RTP.
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
| `maxaveragebitrate=320000` | Teto médio de recepção declarado no `fmtp` | Bitrate medido, garantia de 320 kbps ou nitidez |
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
