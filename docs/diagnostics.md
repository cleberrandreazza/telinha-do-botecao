# Diagnóstico de desempenho

O monitoramento mede a transmissão **na extremidade em que o navegador está**. Quem assiste não recebe as estatísticas outbound de quem compartilha, e o contrário também não. Os dois relatórios JSON é que permitem comparar os lados.

Não há banco, serviço externo nem tráfego novo no servidor de sinalização. Tudo fica em memória e some quando a conexão fecha.

## Arquitetura

`WebRTCManager` cria um `ConnectionMonitor` para cada `RTCPeerConnection`, assim que a conexão nasce — com o painel fechado ou aberto.

- A coleta usa um único `getStats()` por conexão a cada ciclo (1 segundo).
- Se a coleta anterior ainda não terminou, o ciclo é ignorado. Não há duas consultas empilhadas.
- O histórico guarda as últimas **120** amostras e até **150** eventos, em buffer circular.
- O painel e o controle adaptativo de bitrate (ABR) leem essa amostra. Nenhum dos dois chama `getStats()` por conta própria.
- O papel fica separado: `sender` (quem compartilha) usa `outbound-rtp` e `media-source`; `receiver` (quem assiste) usa `inbound-rtp`.
- Ao fechar a conexão, o timer para, os ouvintes são removidos e o histórico daquela conexão é descartado.

A reprodução é medida no `StreamViewer`, no elemento `<video>`:

- `requestVideoFrameCallback` conta os frames apresentados. O callback não chama `setState`.
- Uma vez por segundo o contador vira FPS, descartes e um indício de congelamento.
- Sem `requestVideoFrameCallback`, a queda é `getVideoPlaybackQuality()` (`totalVideoFrames`, `droppedVideoFrames`, `corruptedVideoFrames`).
- Sem as duas APIs, o FPS apresentado fica `n/d`.
- Trocar de stream, fechar o player ou desmontar o componente cancela o callback e o intervalo.

O ABR continua avaliando a cada **2 segundos** (a cada duas amostras de 1 segundo). Os limiares antigos foram mantidos: reduz 30% depois de 3 avaliações abaixo de 60% do FPS alvo, e sobe 15% depois de 10 avaliações acima de 85%, entre 500 kbps e o bitrate inicial da resolução. A decisão usa só o FPS **codificado** (`framesEncoded` no intervalo, ou `framesPerSecond` do `outbound-rtp` se o intervalo ainda não existe). FPS inbound não entra. FPS `0` conta como queda. FPS ausente (`null`) não altera o bitrate.

## De onde vem cada número

`null` significa “o navegador não expôs isso” ou “ainda não há um intervalo válido”. A interface mostra **n/d**. Zero é medição real e continua zero. O FPS pedido em `getDisplayMedia()` ou em `track.getSettings()` não preenche um medido ausente.

| Métrica | Origem | Conta |
| --- | --- | --- |
| FPS solicitado | Configuração de quem compartilha, ou `track.getSettings().frameRate` no player, sempre com esse nome | O que foi pedido, não o que saiu |
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
| FPS apresentado | Contagem do `requestVideoFrameCallback`, ou delta de `totalVideoFrames` | Frames que o elemento de vídeo mostrou |
| Descartes / corrompidos | Delta de `droppedVideoFrames` e `corruptedVideoFrames` | Só a reprodução |

Intervalo válido: entre 200 ms e 5 s. Fora disso a taxa daquele ciclo fica n/d, mas o contador é atualizado para o ciclo seguinte não herdar um buraco.

Se um contador volta para trás (reconexão ou reset do navegador), o intervalo é descartado (`countersReset`) em vez de virar um pico de perda ou de FPS. O ciclo seguinte usa o valor novo como base.

O par ICE é escolhido nesta ordem:

1. `transport.selectedCandidatePairId`
2. o único `candidate-pair` com `selected === true`
3. o único par `nominated` e `succeeded`

Se houver vários pares só com `state === 'succeeded'` e nenhum desses sinais, o RTT fica n/d. Isso não é RTT zero. Endereço IP não é armazenado: só tipo do candidato (`host`, `srflx`, `prflx`, `relay`) e protocolo (`udp`/`tcp`).

TURN/Relay não é tratado como conexão ruim. É só o tipo da rota.

## FPS recebido, decodificado e apresentado

São três momentos diferentes:

- **Recebido:** o pacote de vídeo chegou e o jitter buffer contabilizou o frame.
- **Decodificado:** o decoder terminou o frame. Pode ser menor que o recebido se o decoder não acompanha.
- **Apresentado:** o `<video>` desenhou o frame. Pode ser menor que o decodificado se a página descarta ou congela na composição.

O `framesPerSecond` do `inbound-rtp` no Chrome é o ritmo decodificado, não o recebido. Por isso o painel mostra os dois, calculados pelos contadores.

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

- **Resumo:** diagnóstico, FPS solicitado, de origem, codificado, recebido, decodificado e apresentado, resolução, bitrate da direção local, codec, RTT, jitter, perda, tipo de conexão, estado do áudio e o teto do ABR quando existe. O estado do áudio não usa só a existência de um relatório RTP. A camada técnica também mostra o modo pedido (`off`, `source` ou `system`), a superfície, a política, as tracks devolvidas, as autorizadas e o motivo de descarte. O detalhe está em [`audio.md`](audio.md).
- **Técnico:** as quatro camadas, um gráfico SVG dos últimos 60 segundos (codificado, recebido, decodificado, apresentado) e os eventos recentes.
- **Exportar JSON:** baixa o relatório no navegador, sem backend.

Quem compartilha abre o mesmo painel pelo botão **Diagnóstico** na sala. Sem espectador conectado ainda não existe `PeerConnection`, então não há FPS codificado para medir — a captura pedida ao sistema não é o FPS real.

O painel fechado não gera render do React por frame. A amostragem do vídeo segue em contadores; o React só atualiza cerca de uma vez por segundo enquanto o painel está aberto.

## Exportação

O arquivo traz:

- `sessionId` e `connectionId` (identificadores aleatórios, sem apelido e sem id do peer)
- `role`: `sender` ou `receiver`
- navegador e versão, a partir do user agent
- configuração de resolução/FPS/áudio, só em quem compartilha
- histórico, eventos, diagnósticos
- rota ICE sem IP
- `collectedFrom` e `collectedTo`

Não entram CPF, apelido, IP, conteúdo da tela, senha, token ou SDP. Chaves como `address`, `credential` e `token` são removidas antes do download. Para comparar uma queda, exporte os dois lados com os horários alinhados.

## Testes

Na pasta `web`:

```bash
npm test
npm run build
```

`npm test` usa o executor do Node (`node:test`) sobre `src/lib/diagnostics/diagnostics.test.ts` e `src/lib/diagnostics/audio.test.ts`. Cobre FPS normal e zero, queda, contadores e reset, perda, jitter, tempo de decode, descartes de reprodução, API ausente, fechamento, troca de stream, coleta com o painel fechado, consulta sobreposta, limite de 120 amostras, duas conexões, separação inbound/outbound, par ICE selecionado, o tratamento de FPS zero no ABR e o escopo da captura de áudio. O teste de escuta no Chrome ou no Edge está separado, em [`audio.md`](audio.md), e não é substituído por estes testes.

## Roteiro manual (Chrome ou Edge)

1. Suba com `npm run dev`. Abra duas janelas na mesma sala.
2. Compartilhe a tela inteira em 1080p / 30 fps, com áudio se quiser.
3. No espectador, **não** abra o painel por 20 segundos. Abra depois: o gráfico de 60 segundos já deve ter pontos. Isso mostra que a coleta não depende do painel.
4. Confira no resumo que FPS recebido, decodificado e apresentado aparecem separados. Se um deles for 0, o número mostrado é 0, não 30.
5. No transmissor, abra **Diagnóstico**. FPS de origem e FPS codificado são dessa máquina. No espectador esses dois ficam `n/d`.
6. Anote RTT e o tipo de conexão (Direta ou TURN/Relay). Não deve aparecer IP.
7. Exporte o JSON dos dois lados. Abra os arquivos e procure: sem IP, sem apelido, com `role` diferente em cada um.
8. Pause o player. O FPS apresentado pode ir a 0; o diagnóstico não deve chamar isso de falha de reprodução.
9. Troque de stream ou feche o player e compartilhe de novo. O painel não pode continuar contando o vídeo anterior (o FPS apresentado zera e recomeça).
10. No DevTools, Performance ou na aba do console: não deve haver um `getStats` extra do ABR além do ciclo de 1 segundo, nem erro novo ao fechar a sala.

Para um teste visual sem segunda pessoa, `http://localhost:3000/?mock` mostra o player. Ali não há WebRTC, então recebido/decodificado ficam `n/d` e só o FPS apresentado tem número. Isso é o comportamento esperado.

## Limitações que continuam

- Cada navegador só vê o próprio lado. Correlacionar captura com recepção exige os dois JSON.
- Sem espectador, quem compartilha não tem `PeerConnection` e portanto não tem `outbound-rtp`.
- Safari e Firefox omitem parte dos contadores (`totalEncodeTime`, `freezeCount`, `qualityLimitationReason`, `requestVideoFrameCallback`). O que falta aparece como `n/d`.
- O RTT some se o navegador não indicar o par selecionado. Não caímos num par `succeeded` qualquer.
- O diagnóstico é heurístico. Confiança alta ainda não é prova.
- ESCALA olha o número de conexões neste transmissor e o FPS daquela conexão. Não separa CPU de upload com certeza.
- O histórico é apagado quando a conexão fecha. Exporte antes de sair da sala se precisar guardar a queda.
- O ABR não ficou mais agressivo. Ele só passou a usar a medição certa, inclusive o zero.
- Não há métrica de “FPS da captura” fora de uma conexão WebRTC. `getSettings().frameRate` continua sendo só o valor pedido.
