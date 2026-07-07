/**
 * Lista serviços (catálogo) vinculados a um plano (plan._id).
 *
 * @_input = {
 *   planId<string> (obrigatório),
 *   onlyCoverage<boolean> (opcional, default true), // só serviços cobertos
 *   limit<number> (opcional, default 100)           // ES costuma limitar; paginar se precisar
 * }
 *
 * @_output = {
 *   planId,
 *   onlyCoverage,
 *   total,
 *   items: [{
 *     _id, name, internalCode, guruVetCode, active, basePrice,
 *     planConfig: { coverage, endPrice, discount, waitingPeriodsInDays, usesPerYear }
 *   }]
 * }
 */

function normalizeLimit(n, defVal) {
  n = Number(n);
  if (!isFinite(n) || n <= 0) return defVal;
  return Math.min(n, 500); // evita payload gigante
}

var planId = (_input && _input.planId) ? String(_input.planId) : null;
if (!planId || !planId.length) {
  throw "planId é obrigatório";
}

var onlyCoverage = (_input && typeof _input.onlyCoverage === "boolean") ? _input.onlyCoverage : true;
var limit = normalizeLimit(_input && _input.limit, 100);

// Query nested para encontrar docs que tenham productConfig.plan._id = planId
var mustNested = [
  { term: { "productConfig.plan._id": planId } }
];

if (onlyCoverage) {
  mustNested.push({ term: { "productConfig.coverage": true } });
}

var query = {
  query: {
    bool: {
      must: [
        {
          nested: {
            path: "productConfig",
            query: { bool: { must: mustNested } }
          }
        },
        { term: { "active": true } } // opcional: só serviços ativos
      ]
    }
  },
  size: limit
  // se quiser reduzir payload: descomente e selecione só campos úteis
  // , _source: ["name","internalCode","guruVetCode","active","basePrice","productConfig"]
};

var result = br.com.wevets.ServiceCatalog._search(query);

// monta lista “limpa” + pega só a config do plano dentro do array
var hits = (result && result.hits && result.hits.hits) ? result.hits.hits : [];
var total = (result && result.hits && result.hits.total) ? result.hits.total : 0;

var items = hits.map(function (h) {
  var s = h._source || {};

  // acha dentro do productConfig o item do plano
  var cfg = null;
  if (s.productConfig && s.productConfig.length) {
    for (var i = 0; i < s.productConfig.length; i++) {
      var c = s.productConfig[i];
      if (c && c.plan && c.plan._id === planId) {
        if (!onlyCoverage || c.coverage === true) {
          cfg = c;
          break;
        }
      }
    }
  }

  // extrai uns campos úteis do cfg (sem cuspir o objeto inteiro)
  var endPrice = cfg && cfg.servicePricing && cfg.servicePricing.internaPricing
    ? cfg.servicePricing.internaPricing.endPrice
    : null;

  var discount = cfg && cfg.servicePricing && cfg.servicePricing.internaPricing
    ? cfg.servicePricing.internaPricing.discount
    : null;

  var waitingDays = cfg && cfg.waitingPeriod
    ? cfg.waitingPeriod.waitingPeriodsInDays
    : null;

  var usesPerYear = null;
  if (cfg && cfg.limitsDefinition && cfg.limitsDefinition.usageFrequencies && cfg.limitsDefinition.usageFrequencies.length) {
    // pega a primeira regra (no seu exemplo é 365 dias)
    usesPerYear = cfg.limitsDefinition.usageFrequencies[0].uses;
  }

  return {
    _id: s._id || h._id,
    name: s.name || null,
    internalCode: s.internalCode || null,
    guruVetCode: s.guruVetCode || null,
    active: s.active === true,
    basePrice: (typeof s.basePrice === "number") ? s.basePrice : null,
    planConfig: cfg ? {
      coverage: cfg.coverage === true,
      endPrice: endPrice,
      discount: discount,
      waitingPeriodsInDays: waitingDays,
      usesPerYear: usesPerYear
    } : null
  };
});

_output = {
  planId: planId,
  onlyCoverage: onlyCoverage,
  total: total,
  returned: items.length,
  items: items
};
