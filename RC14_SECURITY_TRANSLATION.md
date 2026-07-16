# RC14 — Segurança, limites e tradução

- `/api/chat`: limite por minuto e por dia, máximo de duas solicitações simultâneas por cliente, tamanho máximo do histórico e logs estruturados sem conteúdo das mensagens.
- `/api/translate`: gera romanização Hepburn e tradução em português ou inglês.
- `APP_CLIENT_TOKEN` é opcional. Quando configurado na Vercel, o mesmo valor deve ser informado no projeto Xcode pela chave `NIHONGO_CHAT_CLIENT_TOKEN`.
- As respostas usam `Cache-Control: no-store`, `X-Request-ID` e cabeçalhos de limite.
- O limite em memória reduz abuso por instância; para uma publicação com grande volume, substitua o Map local por um armazenamento distribuído, como Redis/KV.
