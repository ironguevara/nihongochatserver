# Nihongo Chat Server — RC14

Backend do Chat do **Nihongo Quest**, com personalidades de Dan e Rika, fallback automático entre modelos Gemini, tradução de mensagens japonesas e proteções básicas de produção.

## Endpoints

```text
GET  /api/health
POST /api/chat
POST /api/translate
```

`/api/chat` recebe o histórico recente, personagem, modo professor e nível de amizade.

`/api/translate` recebe:

```json
{
  "text": "今日は元気ですか？",
  "targetLanguage": "pt"
}
```

E devolve:

```json
{
  "romaji": "Kyou wa genki desu ka?",
  "translation": "Você está bem hoje?"
}
```

O idioma pode ser `pt` ou `en`.

## Variáveis na Vercel

Obrigatória:

```text
GEMINI_API_KEY = sua chave do Google AI Studio
```

Recomendadas:

```text
GEMINI_MODELS = gemini-3.1-flash-lite,gemini-3.5-flash,gemini-flash-latest
ALLOWED_ORIGIN = *
```

Proteção opcional do aplicativo:

```text
APP_CLIENT_TOKEN = um valor longo e aleatório
```

Quando `APP_CLIENT_TOKEN` for configurado, coloque exatamente o mesmo valor na chave `NIHONGO_CHAT_CLIENT_TOKEN` do arquivo `Nihongo-Quest-Info.plist` no projeto Xcode. Durante testes, os dois podem permanecer vazios.

## Proteções RC14

- Limite por minuto e por dia por dispositivo/IP.
- Máximo de duas requisições simultâneas por cliente.
- Limites de tamanho do corpo, histórico e mensagens.
- Cabeçalhos `Cache-Control: no-store` e `X-Request-ID`.
- Logs estruturados sem armazenar o conteúdo das conversas.
- Moderação de entrada e saída do Chat.
- Token opcional para reduzir uso externo direto dos endpoints.

Os limites em memória funcionam por instância serverless. Para alto volume, migre-os para Redis/KV distribuído.

## Atualização

1. Substitua no GitHub os arquivos antigos pelo conteúdo desta pasta.
2. Faça commit no branch conectado à Vercel.
3. Confira as variáveis de ambiente.
4. Aguarde o deployment ficar `Ready`.
5. Teste `/api/health`, depois Dan/Rika e a tradução pelo aplicativo.

Uma resposta bem-sucedida inclui `X-Gemini-Model`, indicando qual modelo respondeu.
