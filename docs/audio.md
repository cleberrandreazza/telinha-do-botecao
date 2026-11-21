# Áudio

O áudio sai da captura da tela (`getDisplayMedia`), entra no `RTCPeerConnection` de quem compartilha e toca no mesmo `<video>` de quem assiste. Não há microfone e não há segundo elemento de áudio.

## Onde a implementação anterior falhava

Havia dois defeitos no código, independentes do seletor do navegador.

1. **Reprodução.** `StreamViewer` chamava `play()` com o vídeo mudo e, no instante seguinte, o efeito de volume fazia `muted = false` fora de um gesto. O `catch` de `play()` engolia o erro. No Chrome e no Edge isso deixa a imagem tocando e o som bloqueado, sem aviso. O botão de volume só mudava o estado React; o `play()` audível não rodava dentro do clique.

2. **Track tardia.** O `ontrack` de vídeo publica a `MediaStream` assim que ela chega. O áudio pode entrar nessa mesma stream depois. O Chromium não passa a reproduzir uma track adicionada a uma stream que já está em `srcObject`. O vídeo seguia; o áudio não.

A captura em si já pedia `audio: true`. Isso não cria a track. O Chrome e o Edge só a entregam se a pessoa marcar a caixa do seletor, e a caixa muda conforme a superfície:

| Superfície | O que o seletor oferece no Windows | O que a track contém |
| --- | --- | --- |
| Aba (`browser`) | “Compartilhar áudio da guia” | O som daquela aba |
| Tela inteira (`monitor`) | “Compartilhar áudio do sistema” | O áudio do sistema, não o microfone |
| Janela (`window`) | Em geral nenhuma opção de áudio | Zero tracks |

`systemAudio: "include"` e `windowAudio: "system"` só pedem que o seletor mostre a opção. Não garantem a track. Se o navegador rejeitar `windowAudio`, a chamada é repetida sem esse campo. Constraints de processamento (`echoCancellation`, `noiseSuppression`, `autoGainControl`) não são enviadas: no Chrome elas fazem a captura de áudio da tela ser ignorada.

Se o áudio foi pedido e voltaram zero tracks, o estado é `AUDIO_CAPTURE_UNAVAILABLE`. A transmissão continua em vídeo e a sala mostra o motivo. Não é apresentada como transmissão com áudio.

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

## O que este ambiente não conseguiu ouvir

A correção foi verificada por testes do classificador, do SDP, da recusa de `play()` e da reatribuição da stream, mais build TypeScript. Ouvir o áudio de uma aba real em um segundo navegador depende de uma pessoa marcar a caixa do seletor e confirmar o som. Isso não foi executado daqui. O roteiro está abaixo.

## Roteiro manual no Chrome e no Edge (Windows)

1. Abra uma aba tocando áudio (um vídeo, por exemplo) e outra com a Telinha.
2. Compartilhe **a aba do vídeo** e marque “Compartilhar áudio da guia”. O painel de quem transmite, com um espectador conectado, deve ir a **ÁUDIO SENDO ENVIADO**, com pacotes/s acima de zero. Sem a caixa, a sala deve mostrar `AUDIO_CAPTURE_UNAVAILABLE` e zero tracks.
3. Compartilhe a **tela inteira** com “Compartilhar áudio do sistema”. O estado de captura usa a superfície `monitor`. Sem a caixa, zero tracks e o aviso correspondente.
4. Compartilhe uma **janela**. Se o seletor não oferecer áudio, a track não vem. O aviso deve dizer que janela no Windows em geral não entrega áudio. Não trate isso como falha de rede.
5. No outro navegador, o vídeo e o áudio estão no mesmo elemento. Se aparecer **Ativar áudio**, clique nele. O som tem que sair nesse clique, e o slider precisa abaixar e cortar o volume.
6. Repita com dois espectadores. Cada conexão tem o próprio diagnóstico. Um lado mudo não silencia o outro.
7. O teste só passa quando o espectador **ouve**. Codec `opus` no painel, sozinho, não conta.
