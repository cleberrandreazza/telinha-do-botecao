# Diagnóstico de desempenho

O monitoramento mede a transmissão **na extremidade em que o navegador está**. Quem assiste não recebe as estatísticas outbound de quem compartilha, e o contrário também não. Os dois relatórios JSON é que permitem comparar os lados.

Não há banco, serviço externo nem tráfego novo no servidor de sinalização. Tudo fica em memória e some quando a conexão fecha.

## Arquitetura

`WebRTCManager` cria um `ConnectionMonitor` para cada `RTCPeerConnection`, assim que a conexão nasce — com o painel fechado ou aberto.

- A coleta usa um único `getStats()` por conexão a cada ciclo (1 segundo).
- Se a coleta anterior ainda não terminou, o ciclo é ignorado. Não há duas consultas empilhadas.
- O histórico guarda as últimas **600** amostras de métrica e de playback (10 minutos a 1 Hz) e até **600** eventos e diagnósticos por conexão. O gráfico do painel continua com 60 pontos.
- Há uma linha do tempo da sessão, no `WebRTCManager`, com o mesmo relógio (`Date.now`) dos monitores daquele navegador. Ela não é compartilhada entre máquinas.
- O painel e o controle adaptativo de bitrate (ABR) leem essa amostra. Nenhum dos dois chama `getStats()` por conta própria.
- O papel fica separado: `sender` (quem compartilha) usa `outbound-rtp` e `media-source`; `receiver` (quem assiste) usa `inbound-rtp`.
- Ao fechar a conexão, o timer para, os ouvintes são removidos e o histórico daquela conexão é descartado. A linha do tempo da sessão permanece até a página sair, com teto de 600 eventos.
- Um `disconnected` ou `failed` ainda encerra a conexão. O handler antigo não encerra a conexão que já a substituiu: o mapa é limpo antes do `close()`, e o evento só vale se aquele `RTCPeerConnection` ainda for o atual.

A reprodução é medida no `StreamViewer`, no elemento `<video>`:

- `requestVideoFrameCallback` conta callbacks do compositor. O callback não chama `setState` e não prova que o quadro foi pintado na tela.
- Uma vez por segundo essa contagem vira `presentedFps`. Zero é uma contagem real de callbacks. Sem essa API o campo fica `null`, não zero.
- `getVideoPlaybackQuality()` entra em separado: `totalVideoFrames` (inclui descartes), `droppedVideoFrames` e `corruptedVideoFrames`, com delta por intervalo. `qualityDisplayedEstimate` é o total menos os descartes. Não é FPS pintado.
- Sem as duas APIs, os FPS de reprodução ficam `n/d` e a situação é `measurement-unavailable`.
- Aba oculta (`document.visibilityState`) e falta de foco ficam em campos próprios. Aba oculta não é congelamento da transmissão. Um único intervalo irregular de `mediaTime` também não dispara alerta crítico.
- Trocar de stream, fechar o player ou desmontar o componente cancela o callback e o intervalo.

O ABR avalia a cada **2 segundos** (a cada duas amostras de 1 segundo). Com `qualityLimitationReason === bandwidth`, reduz 30% após 5 avaliações consecutivas, mesmo quando o FPS ainda está no alvo; enquanto a banda continuar limitada, não aumenta o bitrate. Com limitação `cpu`, não reduz bitrate por FPS baixo, pois isso não corrige o gargalo de codificação. Sem limitação explícita de CPU ou banda, mantém o fallback de FPS: reduz 30% após 5 avaliações abaixo de 25% do alvo e sobe 15% após 15 avaliações acima de 90%, entre 25% do teto e o bitrate inicial da resolução. A decisão usa só o FPS **codificado** (`framesEncoded` no intervalo, ou `framesPerSecond` do `outbound-rtp` se o intervalo ainda não existe) e a causa de limitação reportada pelo encoder. FPS inbound não entra. FPS `0` conta como queda quando não há limitação de CPU. FPS ausente (`null`) não altera o bitrate. O teto inicial é o da resolução escolhida (1080p = 8 Mbps) e não muda porque a captura veio menor: uma janela de 1078×730 com alvo 1080p continua com esse teto. O `contentHint` de aba e janela é `detail` (nitidez); o de tela inteira é `motion`.

## De onde vem cada número

`null` significa “o navegador não expôs isso” ou “ainda não há um intervalo válido”. A interface mostra **n/d**. Zero é medição real e continua zero. O FPS pedido em `getDisplayMedia()` não preenche um FPS medido ausente. O mesmo vale para a resolução: o 1080p escolhido na tela não substitui o tamanho da track, do encoder nem do espectador.

| Métrica | Origem | Conta |
| --- | --- | --- |
| FPS solicitado | Configuração de quem compartilha, ou `track.getSettings().frameRate` no player, sempre com esse nome | O que foi pedido, não o que saiu |
| Resolução solicitada | Rótulo da configuração (`1080`) e os pixels máximos (`max`) enviados ao `getDisplayMedia` | Pedido. Não é o tamanho que saiu |
| Resolução da track | `videoTrack.getSettings()` no instante em que a captura retorna: `width`, `height`, `frameRate`, `displaySurface`, `aspectRatio`, `resizeMode` | O que o navegador entregou na track. Campo ausente fica `null` |
| Resolução da origem | `media-source.width` / `height`, ligado ao `outbound-rtp` | O que o WebRTC diz que entrou no encoder, por conexão |
| Resolução codificada | `outbound-rtp.frameWidth` / `frameHeight` | O frame que o encoder produziu nessa conexão |
| Resolução recebida | `inbound-rtp.frameWidth` / `frameHeight` | O frame que este espectador recebeu. Quem compartilha não tem esse número |
| FPS da origem | `media-source.framesPerSecond`, ligado por `outbound-rtp.mediaSourceId` | Frames que a captura entregou ao encoder |
| FPS codificado | Delta de `outbound-rtp.framesEncoded` / intervalo. Se o delta ainda não existe, `framesPerSecond` | Frames que o encoder produziu |
| Tempo de encode | Delta de `totalEncodeTime` / delta de `framesEncoded`, em ms | Média do intervalo. Sem frames, fica n/d |
| Limitação | `qualityLimitationReason` e `qualityLimitationDurations` | `none`, `cpu`, `bandwidth` ou `other` |
| FPS recebido | Delta de `inbound-rtp.framesReceived` | Frames que chegaram neste navegador |
| FPS decodificado | Delta de `framesDecoded`. Se o delta ainda não existe, `framesPerSecond` do inbound | Frames que o decoder entregou |
| Tempo de decode | Delta de `totalDecodeTime` / delta de `framesDecoded`, em ms | Média do intervalo |
| Perda | Delta de `packetsLost` / (delta de perdidos + delta de recebidos) | Percentual **do intervalo**, não o acumulado |
| Jitter | `inbound-rtp.jitter` em segundos, convertido para ms | No transmissor, o jitter exibido é o do `remote-inbound-rtp` (RTCP), com esse nome |
| Jitter buffer | Delta de `jitterBufferDelay` / delta de `jitterBufferEmittedCount`, em ms | Espera média no buffer |
| Congelamentos | Delta de `freezeCount` e de `totalFreezesDuration` | Novos congelamentos no intervalo |
| Bitrate | Delta de `bytesSent` ou `bytesReceived` × 8 / segundos | Direção do papel. Não mistura os dois |
| RTT | `currentRoundTripTime` do par ICE selecionado, em ms | Não é “qualquer par succeeded” |
| Rota | Tipos dos candidatos do par selecionado | `host`/`srflx`/`prflx` = direta; algum `relay` = TURN/Relay |
| Callbacks do compositor | Contagem de `requestVideoFrameCallback` no intervalo (`presentedFps`) | Vezes que o compositor entregou um quadro ao callback. Não é quadro pintado. Sem a API, `null` |
| Total considerado/s | Delta de `totalVideoFrames` | Quadros que o elemento considerou, incluindo os descartados |
| Estimativa sem descarte/s | `qualityTotalDelta` menos `droppedFps` | Estimativa. Não prova pintura na tela |
| Descartes / corrompidos | Delta de `droppedVideoFrames` e `corruptedVideoFrames` | Só o elemento de vídeo |
| Visibilidade e foco | `document.visibilityState` e `document.hasFocus()` | Medição do navegador, separada do congelamento |

Intervalo válido: entre 200 ms e 5 s. Fora disso a taxa daquele ciclo fica n/d, mas o contador é atualizado para o ciclo seguinte não herdar um buraco.

Se um contador volta para trás (reconexão ou reset do navegador), o intervalo é descartado (`countersReset`) em vez de virar um pico de perda ou de FPS. O ciclo seguinte usa o valor novo como base.

O par ICE é escolhido nesta ordem:

1. `transport.selectedCandidatePairId`
2. o único `candidate-pair` com `selected === true`
3. o único par `nominated` e `succeeded`

Se houver vários pares só com `state === 'succeeded'` e nenhum desses sinais, o RTT fica n/d. Isso não é RTT zero. Endereço IP não é armazenado: só tipo do candidato (`host`, `srflx`, `prflx`, `relay`) e protocolo (`udp`/`tcp`).

TURN/Relay não é tratado como conexão ruim. É só o tipo da rota.

## FPS recebido, decodificado, compositor e descarte

São medidas diferentes. Nenhuma copia a outra quando falta:

- **Recebido:** o pacote de vídeo chegou e o jitter buffer contabilizou o frame (`inbound-rtp.framesReceived`).
- **Decodificado:** o decoder terminou o frame (`framesDecoded`). Pode ser menor que o recebido se o decoder não acompanha.
- **Callbacks do compositor:** `presentedFps`, a contagem de `requestVideoFrameCallback` naquele segundo. O Chrome chama isso quando o quadro está pronto para composição. Não significa que o pixel ficou visível o tempo todo, nem que a aba estava em primeiro plano.
- **Descarte do elemento:** delta de `droppedVideoFrames`. `totalVideoFrames` inclui esses descartes, então não é o total exibido.
- **Intervalo de `mediaTime`:** a distância entre os `mediaTime` de callbacks seguidos. Um salto isolado fica em `irregularIntervals` e não vira alerta crítico sozinho.

O `framesPerSecond` do `inbound-rtp` no Chrome é o ritmo decodificado, não o recebido. Por isso o painel mostra os dois, calculados pelos contadores.

`freezeSuspected` só fica verdadeiro quando a aba está visível (ou a visibilidade é desconhecida), o vídeo está tocando, já houve pelo menos um callback e o intervalo seguinte chegou a zero callbacks. Aba oculta usa `stall: "hidden"`. Vídeo pausado usa `stall: "paused"`. Sem as APIs, `stall: "measurement-unavailable"` e os FPS ficam `null`.

No JSON, `presentedFps` deixou de ser o delta de `totalVideoFrames` quando só existe `getVideoPlaybackQuality`. Esse delta agora é `qualityTotalDelta`. Os campos antigos (`presentedFps`, `droppedFps`, `totalPresentedFrames`, `freezeSuspected`, `api`) continuam no objeto; os novos descrevem visibilidade, foco, tamanho do vídeo, `currentTime`, `readyState`, a estimativa sem descarte e o último callback (`presentedFrames`, `mediaTime`, `expectedDisplayTime`, `presentationTime`, `processingDuration`, horário do callback).

## Diagnóstico

O classificador olha as últimas 3 amostras contra a mediana das anteriores (precisa de uns 6 segundos de base, salvo alarme absoluto de perda ou jitter). Não afirma causa. Cada resultado tem categoria, estado (`NORMAL`, `ATENÇÃO`, `CRÍTICO`, `INDETERMINADO`), motivo, métricas usadas, horário e confiança (`baixo`, `médio`, `alto`).

A ordem é a primeira camada em que a medição quebra:

| O que se vê nesta extremidade | Categoria | Resumo no painel |
| --- | --- | --- |
| Origem e codificação caem juntas, ou o encoder aponta `cpu` | CAPTURA/CODIFICAÇÃO | Possível problema de captura/codificação |
| Encoder aponta `bandwidth`, ou NACK/RTT/perda RTCP sobem no transmissor | REDE/TRANSPORTE | Possível problema de rede |
| Perda, jitter alto (> 80 ms) ou RTT alto junto com piora na recepção | REDE/TRANSPORTE | Possível problema de rede |
| Frames recebidos caem e perda/jitter/RTT não explicam | RECEPÇÃO | Possível problema de recepção |
| Recepção estável e a decodificação cai ou o tempo por frame sobe acima de 1,8× a base (e passa de 20 ms) | DECODIFICAÇÃO | Possível problema de decodificação |
| Decodificação estável e a apresentação cai, ou há 3+ descartes/s, ou congelamento | REPRODUÇÃO | Possível problema de reprodução |
| No transmissor, o número de espectadores subiu e a codificação piorou no mesmo período | ESCALA | Possível limitação pelo número de espectadores |
| Menos de 3 amostras, ou faltam as métricas da camada | INDETERMINADO | Dados insuficientes para diagnóstico |
| Nada disso | NORMAL | Transmissão normal |

Quedas usadas na comparação: todas as amostras recentes abaixo de 70% da referência (atenção) ou abaixo de 50% / em zero (crítico). A referência é a mediana da base, se ela for de pelo menos 5 fps. No transmissor, se ainda não há base, entra o FPS configurado — só como referência da queda, nunca como valor exibido no lugar do medido.

ESCALA só existe em quem compartilha, porque só esse navegador sabe quantas conexões de espectador estão abertas. Confiança média: coincidiu no tempo, não está provado. Se a rota é TURN e o FPS está estável, o estado continua normal.

O receptor não inventa o FPS codificado do outro lado. Se a recepção cai sem perda nem jitter, a categoria é RECEPÇÃO e o texto diz que a causa pode estar em quem transmite.

Eventos registrados, com cooldown de 10 segundos para não repetir o mesmo aviso: queda de FPS, mais perda, mais jitter, salto de RTT, menos frames codificados, mais descartes, congelamento, troca de rota ICE, reconexão ou mudança de estado da conexão, mudança do diagnóstico e alteração de bitrate do ABR.

## Painel

O mesmo painel de antes, no botão de informações do player:

- **Resumo:** diagnóstico, FPS solicitado, de origem, codificado, recebido, decodificado e callbacks do compositor, resolução, bitrate da direção local, codec, RTT, jitter, perda, tipo de conexão, estado do áudio e o teto do ABR quando existe. O estado do áudio não usa só a existência de um relatório RTP. A camada técnica também mostra o modo pedido (`off`, `source` ou `system`), a superfície, a política, as tracks devolvidas, as autorizadas e o motivo de descarte. O detalhe está em [`audio.md`](audio.md).
- **Técnico:** as quatro camadas, um gráfico SVG dos últimos 60 segundos (codificado, recebido, decodificado, callbacks do compositor) e os eventos recentes. A camada de reprodução também mostra visibilidade, foco, total considerado, estimativa sem descarte e a situação (`stall`).
- **Exportar JSON:** baixa o relatório no navegador, sem backend.

Quem compartilha abre o mesmo painel pelo botão **Diagnóstico** na sala. Sem espectador conectado ainda não existe `PeerConnection`, então não há FPS codificado para medir — a captura pedida ao sistema não é o FPS real.

O painel fechado não gera render do React por frame. A amostragem do vídeo segue em contadores; o React só atualiza cerca de uma vez por segundo enquanto o painel está aberto.

## Exportação

O arquivo traz:

- `sessionId` e `connectionId` (identificadores aleatórios, sem apelido e sem id do peer)
- `role`: `sender` ou `receiver`
- navegador e versão, a partir do user agent
- configuração de resolução/FPS/áudio, só em quem compartilha
- `capture`: pedido, `getSettings`, `getConstraints`, `getCapabilities` (ou `null` se o navegador não tiver), `readyState` e `contentHint` de antes de ajustarmos o hint
- `encoder`: por `connectionId`, `maxBitrate`, `maxFramerate`, `scaleResolutionDownBy` e `degradationPreference` antes e depois de `setParameters`. `after: null` significa que a aplicação falhou. O `scaleResolutionDownBy` compara só a altura da faixa enviada com a altura do preset: `sourceHeight / targetHeight` quando a fonte é mais alta, e 1 quando a altura já cabe. A largura não entra nessa conta, então 2560×1080 e 3440×1440 em 1080p não viram 640×270. O `minBitrate` do sender é 25% do teto da resolução. O `getDisplayMedia` pede só `frameRate`: a superfície ainda não é conhecida, e `width`/`height` nessa hora cortam janela e aba quando a pessoa redimensiona. Depois da escolha, só a tela inteira (`displaySurface === 'monitor'`) recebe `height: { max }` no `applyConstraints`, sem teto de largura; o navegador reduz pela altura, mantendo a proporção, sem ampliar. Janela e aba não recebem `width` nem `height`. Se a altura nativa já alcança o alvo (1080 em 1080p, inclusive ultrawide), a track nativa segue direto, sem canvas e sem esticar. Se a altura fica abaixo, um `<video>` de 2×2 px com opacidade 0,01 (sem `display: none`) alimenta um `<canvas>` que amplia só pela altura, com lados pares: 894×730 em 1080p vira 1322×1080, e 3000×1000 vira 3240×1080. O contexto 2D usa `alpha: false`, `desynchronized: true` e suavização `medium`. O desenho não depende de `requestAnimationFrame` da aba. Um Worker com `setInterval` de `1000/fps` chama o desenho em todo tick enquanto `video.readyState >= 2`, repetindo o último quadro quando a janela entrega menos que o alvo, para o `captureStream` manter o `sourceFps` no fps pedido. `requestVideoFrameCallback` só mantém o `<video>` oculto decodificando e não dita a cadência. Enquanto o upscale continua necessário, o `resize` muda o canvas sem trocar a track. Se a janela ou a aba cresce até o alvo, o canvas para e a track nativa volta; se encolhe de novo, o canvas liga e o `replaceTrack` troca o envio. A track do canvas usa `contentHint = 'detail'`. O `degradationPreference` do vídeo fica em `maintain-resolution` para aba, janela e tela inteira. A troca de resolução na tela inteira aplica o novo teto de altura com `applyConstraints`. Em janela e aba, muda o alvo da comparação pela altura e o canvas entra ou sai conforme essa altura. Trocar a fonte no meio da live encerra o canvas e o Worker anteriores, mede a altura da fonte nova do zero e reaplica `configureVideoSender` (escala pela altura, `maintain-resolution`, `minBitrate`) e `configureAudioSenders` em cada conexão que está transmitindo. Aba e janela voltam com `contentHint` `detail`
- `resolution`: solicitada, track capturada, origem WebRTC, codificada e recebida, cada uma com `null` quando aquela etapa não existe neste navegador
- `audio.captureFormat`: `getSettings`, `getConstraints` e `getCapabilities` da track de áudio autorizada, mais `suppressLocalAudioPlayback` da superfície quando o navegador informa. Cada grupo fica separado
- `audio.localNegotiation` e `audio.remoteNegotiation`: codec, payload, clock rate, canais e os parâmetros Opus permitidos. O SDP bruto não entra
- `audio.codecInfo`: `mimeType`, `clockRate`, `channels` e o `fmtp` já filtrado do relatório `codec`
- `audio.signal` e `audio.inbound`: nível, energia, RMS, dBFS, perda, jitter, amostras ocultadas, FEC e atraso do jitter buffer de áudio. Contador de vídeo não preenche esses campos
- histórico, eventos, diagnósticos
- rota ICE sem IP
- `collectedFrom` e `collectedTo`
- `sessionStartedAt`, `connectionCreatedAt`, `monitorStartedAt`, `firstConnectedAt`, `firstSampleAt`
- `timeline`: a sessão inteira em cada JSON do remetente; no receptor, só os eventos desta conexão e os que não têm `connectionId`

Não entram CPF, apelido, IP, conteúdo da tela, senha, token, SDP completo, rótulo de dispositivo, id de track ou `peerId`. O `fmtp` guardado é só a lista de parâmetros Opus conhecida. Bitrate, clock rate, `stereo=1` e o estado **ÁUDIO RECEBIDO E REPRODUZINDO** não provam fidelidade. A linha do tempo usa `connectionId`. Chaves como `address`, `credential`, `nickname` e `peerId` são removidas antes do download. Para comparar uma queda, exporte os dois lados com os horários alinhados.

## Linha do tempo e horários

São relógios diferentes. Um `null` não é preenchido com outro:

| Campo | Quando é gravado |
| --- | --- |
| `sessionStartedAt` | O `WebRTCManager` deste navegador foi construído |
| `transmission-started` | `start-sharing` foi enviado |
| `viewer-requested` | Chegou `stream-requested`. Ainda não há `connectionId` |
| `connectionCreatedAt` | `new RTCPeerConnection` |
| `monitorStartedAt` e `collectedFrom` | `ConnectionMonitor.start()`. Não é a primeira amostra |
| `firstConnectedAt` | `connectionState` chegou a `connected` |
| `firstSampleAt` | Primeira amostra de `getStats`, mesmo que o histórico depois descarte as anteriores |
| `collectedTo` | Horário da última amostra retida. `null` se ainda não houve amostra |

`connectionCreatedAt` e `monitorStartedAt` podem cair no mesmo milissegundo. A conexão e o monitor nascem na mesma função, no tratamento de `stream-requested`. Isso não é um relógio copiado: dois espectadores que entram com um minuto de diferença ficam com esses campos separados por esse minuto, e a `sequence` ordena dois pedidos que caem no mesmo milissegundo.

Numa sessão de cerca de 204 segundos com teto de 120 amostras, o primeiro ponto que restava nos dois JSON do remetente ficava por volta de “agora menos 120 segundos”. Os arquivos pareciam ter sido criados juntos mesmo quando o segundo espectador entrou depois. O `collectedFrom` já era a criação do monitor, mas não havia linha do tempo da solicitação, e a amostra mais antiga do arquivo era fácil de ler como se fosse o começo. O teto agora é 600. `firstSampleAt` continua guardado quando o buffer descarta o início.

Cada evento traz `timestamp`, `sequence`, `type`, `connectionId` e `viewerCount` naquele instante. `viewerCount` é quantos espectadores este navegador está atendendo. No receptor o número fica 0. Trocar de um para dois espectadores aparece como `viewer-count-changed`. Reconexão grava `connection-closed` da conexão antiga e `reconnected` da nova, sem contar como saída. Saída grava `viewer-disconnected` e o novo total.

O consumo fica limitado: 600 amostras, 600 playbacks, 600 diagnósticos e 600 eventos por conexão, mais 600 eventos na linha do tempo da página. Não há banco nem serviço externo. O gráfico da tela não cresce junto.

## Testes

Na pasta `web`:

```bash
npm test
npm run build
```

`npm test` usa o executor do Node (`node:test`) sobre `src/lib/diagnostics/diagnostics.test.ts`, `src/lib/diagnostics/audio.test.ts`, `src/lib/diagnostics/resolution.test.ts` e `src/lib/diagnostics/timeline.test.ts`. Cobre FPS normal e zero, queda, contadores e reset, perda, jitter, tempo de decode, descartes de reprodução, API ausente, aba visível, aba oculta, vídeo pausado, decoder estável com compositor mais baixo, ausência de callbacks, intervalo irregular, fechamento, troca de stream, coleta com o painel fechado, consulta sobreposta, retenção de 600 amostras, dois monitores com horários diferentes, a entrada do segundo espectador depois de 60 segundos, reconexão, saída, a linha do tempo compartilhada nos JSON do remetente, separação inbound/outbound, par ICE selecionado, o tratamento de FPS zero no ABR, o escopo da captura de áudio, a leitura de settings/constraints/capabilities, o `fmtp` Opus sem SDP bruto, concealment, energia, RMS e a separação entre resolução pedida, capturada, de origem, codificada e recebida. O teste de escuta no Chrome ou no Edge está separado, em [`audio.md`](audio.md), e não é substituído por estes testes. Estes testes não observam um `<video>` real no Chrome nem uma sala com dois espectadores de verdade.

## Roteiro manual (Chrome ou Edge)

1. Suba com `npm run dev`. Abra duas janelas na mesma sala.
2. Compartilhe a tela inteira em 1080p / 30 fps, com áudio se quiser.
3. No espectador, **não** abra o painel por 20 segundos. Abra depois: o gráfico de 60 segundos já deve ter pontos. Isso mostra que a coleta não depende do painel.
4. Confira no resumo que FPS recebido, decodificado e compositor aparecem separados. Se um deles for 0, o número mostrado é 0, não 30. Na camada técnica, “Total considerado/s” inclui descartes; “Callbacks do compositor” não é quadro pintado.
5. No transmissor, abra **Diagnóstico**. FPS de origem e FPS codificado são dessa máquina. No espectador esses dois ficam `n/d`.
6. Anote RTT e o tipo de conexão (Direta ou TURN/Relay). Não deve aparecer IP.
7. Exporte o JSON dos dois lados. Abra os arquivos e procure: sem IP, sem apelido, sem `peerId`, com `role` diferente em cada um. No remetente, os dois arquivos da mesma transmissão trazem a mesma `timeline`. `collectedFrom` é o início daquele monitor; a primeira amostra do array pode ser posterior se a sessão passar de 10 minutos.
8. Pause o player. Os callbacks podem ir a 0; o diagnóstico não deve chamar isso de falha de reprodução. Esconder a aba também não deve gerar “Congelamento detectado”.
9. Troque de stream ou feche o player e compartilhe de novo. O painel não pode continuar contando o vídeo anterior (o FPS apresentado zera e recomeça).
10. No DevTools, Performance ou na aba do console: não deve haver um `getStats` extra do ABR além do ciclo de 1 segundo, nem erro novo ao fechar a sala.

Para um teste visual sem segunda pessoa, `http://localhost:3000/?mock` mostra o player. Ali não há WebRTC, então recebido/decodificado ficam `n/d`. Callbacks do compositor só aparecem se o navegador entregar frames ao `<video>`. Isso é o comportamento esperado.

## Limitações que continuam

- Cada navegador só vê o próprio lado. Correlacionar captura com recepção exige os dois JSON.
- Sem espectador, quem compartilha não tem `PeerConnection` e portanto não tem `outbound-rtp`.
- Safari e Firefox omitem parte dos contadores (`totalEncodeTime`, `freezeCount`, `qualityLimitationReason`, `requestVideoFrameCallback`). O que falta aparece como `n/d`.
- O RTT some se o navegador não indicar o par selecionado. Não caímos num par `succeeded` qualquer.
- O diagnóstico é heurístico. Confiança alta ainda não é prova.
- ESCALA olha o número de conexões neste transmissor e o FPS daquela conexão. Não separa CPU de upload com certeza.
- O histórico da conexão é apagado quando ela fecha. A linha do tempo da sessão permanece na página, também com teto. Exporte antes de sair da sala se precisar guardar a queda.
- Os horários são o relógio local de cada navegador. Dois JSON de máquinas diferentes não estão sincronizados entre si.
- O ABR não ficou mais agressivo. Ele só passou a usar a medição certa, inclusive o zero.
- Não há métrica de “FPS da captura” fora de uma conexão WebRTC. `getSettings().frameRate` é o que a track informou na captura; o FPS codificado continua vindo do `outbound-rtp`.
- A linha “Resolução” do painel continua sendo o tamanho codificado (ou o da origem, se o frame codificado ainda não existe). O JSON é que separa o 1080p pedido da track, da origem, do encoder e do espectador. Um desses campos em `null` não é completado com outro.
- `presentedFps` é a taxa de callbacks do compositor, não a taxa pintada na tela. `totalPresentedFrames` é `totalVideoFrames` e inclui quadros descartados. Sem `requestVideoFrameCallback`, `presentedFps` fica `null`; o delta de `totalVideoFrames` vai para `qualityTotalDelta`.
- Aba em segundo plano e um único salto de `mediaTime` não são, sozinhos, congelamento da transmissão.
- O diagnóstico de áudio não mede espectro nem aprova a escuta. Chrome, Edge e Firefox podem omitir `getCapabilities`, `audioLevel`, `concealedSamples`, `channels` e `suppressLocalAudioPlayback`. O que falta fica `null` no JSON e `n/d` no painel, nunca zero presumido. `clockRate` do Opus não é o sample rate da captura.
