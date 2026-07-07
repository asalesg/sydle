Resumo das alterações no script original

Arquivos criados:
- `explicacao.md` — plano de execução detalhando as mudanças.
- `final.js` — script atualizado com suporte a `filters.unitType` e `description`.

Principais adições
- Suporte a `filters.unitType` (valores permitidos: `rede_wevets`, `volante`, `rede_credenciada`).
  - Validação do valor passado em `filters.unitType`.
- Inclusão do campo `description` no retorno das unidades, extraído de `additionalData[0].description`.
- Novo formato para o campo `unitType` no retorno: objeto com `name` e `id` (valores: "Rede WeVets"/`rede_wevets`, "Volante"/`volante`, "Rede Credenciada"/`rede_credenciada`).
- Lógica específica de filtragem por `unitType` aplicada antes dos demais filtros:
  - `rede_wevets`: inclui apenas unidades com `additionalData[0].isInternalUnit === true`.
  - `volante`: inclui apenas unidades cujo `additionalData[0].category._id` está em `UNIT_TYPE_IDS_BLOQUEADOS`.
    - Para unidades `volante`, `address` e `distanceInKm` são retornados como `null`.
    - O bloqueio global que exclui IDs da lista `UNIT_TYPE_IDS_BLOQUEADOS` é desativado quando `filters.unitType === 'volante'`.
  - `rede_credenciada`: inclui apenas unidades que não são volantes e não são internas (parceiros externos).

Alterações no fluxo e mapeamento
- Extração de `additional = unidade.additionalData?.[0] || {}` para uso nas decisões de filtro e nos campos de resposta.
- Cálculo de `isVolante` e `isInternal` (a partir de `additional`) para decidir filtros e o formato de `unitType`.
- No mapeamento (`unidadesMapeadas`):
  - Adicionado `description` logo após `name` no objeto de resposta.
  - `address` é definido como `null` e `distanceInKm` como `null` para unidades `volante`.
  - `logo` continua sendo calculado do mesmo modo (link para foto quando `unidade.photo` existe).

Remoções / Desativações
- O filtro estático anterior que sempre excluía unidades com `category._id` na lista `UNIT_TYPE_IDS_BLOQUEADOS` foi removido do início do pipeline.
  - Em vez de remoção global, o novo código aplica esse bloqueio apenas quando `filters.unitType` não é `'volante'` (comportamento padrão preservado).

Comportamento preservado
- Quando `filters.unitType` não é informado, o comportamento original é preservado: volantes são excluídos por padrão, filtros por `attendanceModes`, `plan`, raio, ordenação por distância e paginação continuam iguais.

Observações técnicas
- Ordenação por distância mantém unidades com `distanceInKm === null` ao final — isso garante que, quando `volante` estiver ativo, volantes apareçam ao final.
- Valores ausentes continuam sendo retornados como `null` para compatibilidade.
- Validações de entrada (page, size, lat, lon, radius, sort) foram mantidas e continuam lançando erros em casos inválidos.

Se precisar, gero um diff mais detalhado com trechos antes/depois ou anoto linhas específicas no `final.js`.

Localização rápida das alterações (trechos e linhas em `final.js`)

- Validação e leitura de `filters.unitType` (adição): [final.js](final.js#L43-L46)

```js
const rawUnitType = filters.unitType ?? null;
const ALLOWED_UNIT_TYPES = ["rede_wevets", "volante", "rede_credenciada"];
if (rawUnitType !== null && rawUnitType !== undefined && !ALLOWED_UNIT_TYPES.includes(rawUnitType)) {
  throw `Valor de filters.unitType inválido. Valores permitidos: ${ALLOWED_UNIT_TYPES.join(", ")}.`;
}
```

- Bloqueio controlado de volantes (substitui filtro estático): [final.js](final.js#L228-L233)

```js
// Se unitType não é 'volante', aplicar bloqueio global que exclui volantes
if (rawUnitType !== 'volante' && isVolante) {
  return false;
}
```

- Extração de `additional`, cálculo de `isVolante` e `isInternal` (uso nos filtros e mapeamento): [final.js](final.js#L222-L227)

```js
const additional = unidade.additionalData?.[0] || {};
const categoryId = additional.category?._id || null;
const isVolante = UNIT_TYPE_IDS_BLOQUEADOS.has(categoryId);
const isInternal = additional.isInternalUnit === true;
```

- Inclusão do campo `description` no objeto de resposta: [final.js](final.js#L313-L315)

```js
"description": additional.description || null,
```

- Definição de `unitType` no formato solicitado (mapeamento): [final.js](final.js#L291-L296)

```js
if (isInternal) {
  unitTypeObj = { name: "Rede WeVets", id: "rede_wevets" };
} else if (isVolante) {
  unitTypeObj = { name: "Volante", id: "volante" };
} else {
  unitTypeObj = { name: "Rede Credenciada", id: "rede_credenciada" };
}
```

- `address` e `distanceInKm` nulos para `volante` (mapeamento): [final.js](final.js#L298-L305)

```js
const mappedAddress = isVolante ? null : {
  "country": unidade.address?.country?.name || null,
  // ... demais campos ...
  "coordinates": isVolante ? { "lat": null, "lon": null } : { "lat": unidadeLatitude, "lon": unidadeLongitude }
};
```

Use os links acima para saltar diretamente aos trechos no arquivo `final.js`.
