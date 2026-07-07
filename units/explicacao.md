Plano de execução — Suporte a `filters.unitType`

1) Objetivo

 - Adicionar suporte ao parâmetro `filters.unitType` com três valores possíveis: `rede_wevets`, `volante` e `rede_credenciada`.
 - Incluir o campo `description` no retorno, lido de `additionalData[0].description`.
 - Ajustar lógica que bloqueia IDs de volantes para respeitar o novo parâmetro.
 - Alterar o formato do campo `unitType` no retorno para o objeto solicitado.

2) Passos de implementação

 - Ler `filters.unitType` do objeto `filters` (aceitar null/indefinido).
 - Validar, se informado, que o valor está entre os permitidos; caso contrário lançar erro.
 - Na etapa de filtragem das unidades (`unidadesFiltradas`):
   - Extrair de cada unidade `additionalData[0]` como `additional`.
   - Calcular `isVolante = UNIT_TYPE_IDS_BLOQUEADOS.has(additional.category?._id)` e `isInternal = additional.isInternalUnit === true`.
   - Aplicar as regras:
     - Se `unitType === 'volante'`: incluir apenas `isVolante === true` e DESATIVAR o bloqueio global que exclui volantes.
     - Se `unitType === 'rede_wevets'`: incluir apenas `isInternal === true`.
     - Se `unitType === 'rede_credenciada'`: incluir apenas unidades com `!isVolante && !isInternal`.
     - Se `unitType` não informado: manter comportamento atual (excluir volantes por padrão).
   - Manter os filtros existentes de `attendanceModes` e `plan`.

 - No mapeamento (`unidadesMapeadas`):
   - Ler `description = additional.description || null` e inserir após `name` no objeto de resposta.
   - Se a unidade for `volante` (isVolante): setar `address` para `null` e `distanceInKm` para `null`.
   - Para outras unidades, calcular distância com Haversine como antes.
   - Montar `unitType` conforme:
     - `isInternal === true` -> { name: "Rede WeVets", id: "rede_wevets" }
     - `isVolante === true` -> { name: "Volante", id: "volante" }
     - caso contrário -> { name: "Rede Credenciada", id: "rede_credenciada" }

 - Ordenação: manter ordenação por distância crescente; unidades com `distanceInKm === null` ficam ao final, então volantes serão exibidos por último quando `unitType === 'volante'`.

3) Testes e verificação

 - Verificar manualmente com combinações:
   - sem `unitType` (comportamento atual)
   - `unitType=volante` — somente volantes retornados e sem endereço/distância
   - `unitType=rede_wevets` — somente unidades internas
   - `unitType=rede_credenciada` — somente não-internas e não-volantes

4) Entregáveis

 - `explicacao.md` (este arquivo)
 - `final.js` com o script atualizado

Observações

 - O bloqueio global de IDs volantes é controlado dinamicamente para não interferir quando o usuário solicita `volante`.
 - Campos ausentes são retornados como `null` para compatibilidade.
