# Configuração do nó HTTP POST para Teams

## Passo a Passo:

### 1. Adicione um nó HTTP no fluxo
- Após o nó JavaScript, clique em "+" e procure por "HTTP Request"

### 2. Configure o nó HTTP:

**Método:** POST

**URL:** 
```
https://outlook.webhook.office.com/webhookb2/[SEU_WEBHOOK_URL]
```
(Obtenha essa URL ao configurar o Incoming Webhook no Teams)

**Headers:**
```
Content-Type: application/json
```

**Body (JSON):**
```json
{{ $('Nome_Do_Seu_Node_JS').first().json.payloadTeams }}
```

---

## Exemplo Completo:

Se seu nó JavaScript se chama "Observabilidade Script", o body ficaria:

```
{{ $('Observabilidade Script').first().json.payloadTeams }}
```

---

## Como obter a URL do Webhook do Teams:

1. Abra o Teams
2. Clique no seu canal → ⋯ (Mais opções) → Conectores
3. Procure por "Incoming Webhook"
4. Configure um nome e cole a imagem do webhook
5. Clique em "Criar"
6. Copie a URL gerada

---

## O que o código faz:

✅ Gera um Adaptive Card completo com o relatório
✅ Muda a cor baseado no status (verde se sucesso, vermelho se falhas)
✅ Inclui imagem, dados dos validadores e estatísticas
✅ Envia tudo formatado para o Teams

**Pronto! Seu flow enviará o card automaticamente!**
