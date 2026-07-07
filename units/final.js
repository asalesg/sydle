// ============================================================
// INPUTS (via Query Params / _input)
// ============================================================

if (!_input) {
  throw "Input não informado";
}

let filters = {};

if (_input.filters) {
  if (typeof _input.filters === "string") {
    try {
      filters = JSON.parse(_input.filters);
    } catch (e) {
      throw "Formato inválido no parâmetro filters. Deve ser um JSON válido.";
    }
  } else {
    filters = _input.filters;
  }
}

const rawPage = _input.page;
const rawSize = _input.size;
const rawSort = _input.sort || "_geo_distance";

const rawLat = filters.userLocation?.lat;
const rawLon = filters.userLocation?.lon;
const rawQuery = filters.query ?? "";
const rawPlan = filters.plan ?? null;
const rawRadius = filters.radius ?? 10;
const BASE_URL = "https://wevets-dev.sydle.one/";

const rawAttendanceModes = filters.attendanceModes ?? null;
const attendanceModesList = Array.isArray(rawAttendanceModes)
  ? rawAttendanceModes
  : rawAttendanceModes
    ? rawAttendanceModes.split(",").map(s => s.trim())
    : [];

const serviceModelIds = new Set(attendanceModesList);

const rawUnitType = filters.unitType ?? null;
const ALLOWED_UNIT_TYPES = ["rede_wevets", "volante", "rede_credenciada"];
if (rawUnitType !== null && rawUnitType !== undefined && !ALLOWED_UNIT_TYPES.includes(rawUnitType)) {
  throw `Valor de filters.unitType inválido. Valores permitidos: ${ALLOWED_UNIT_TYPES.join(", ")}.`;
}

if (!rawPage) {
  throw "Número da página não informado";
}

if (!rawSize) {
  throw "Quantidade de itens por página não informada";
}

if (rawLat == null) {
  throw "Latitude não informada";
}

if (rawLon == null) {
  throw "Longitude não informada";
}

const page = parseInt(rawPage, 10);
if (isNaN(page) || page <= 0) {
  throw "Número da página inválido. Deve ser um número inteiro maior que 0.";
}

const size = parseInt(rawSize, 10);
if (isNaN(size) || size <= 0) {
  throw "Quantidade de itens por página inválido. Deve ser um número inteiro maior que 0.";
}

const MAX_SIZE = 100;
if (size > MAX_SIZE) {
  throw `Quantidade de itens por página inválido. O valor máximo permitido é ${MAX_SIZE}.`;
}

const minhaLatitude = parseFloat(rawLat);
const minhaLongitude = parseFloat(rawLon);

if (isNaN(minhaLatitude) || minhaLatitude < -90 || minhaLatitude > 90) {
  throw "Latitude inválida. Deve ser um número entre -90 e 90.";
}

if (isNaN(minhaLongitude) || minhaLongitude < -180 || minhaLongitude > 180) {
  throw "Longitude inválida. Deve ser um número entre -180 e 180.";
}

const raioEmKm = rawRadius !== null ? parseFloat(rawRadius) : null;
if (raioEmKm !== null && (isNaN(raioEmKm) || raioEmKm <= 0)) {
  throw "Raio inválido. Deve ser um número maior que 0.";
}

const sort = rawSort;
const SORTS_PERMITIDOS = ["_geo_distance"];

if (!SORTS_PERMITIDOS.includes(sort)) {
  throw `Valor de sort inválido. Os valores permitidos são: ${SORTS_PERMITIDOS.join(", ")}.`;
}

const planId = rawPlan;

// ============================================================
// CONSTANTES
// ============================================================

const query = sanitizarQuery(rawQuery);

const tipoUnidadeVolante2 = "6821e5fac499684446623236";
const tipoUnidadeVolante3 = "68bf87bb450d37004758e89b";
const tipoUnidadeMudeiONome = "689c773e7201995696e9c906";

const UNIT_TYPE_IDS_BLOQUEADOS = new Set([
  tipoUnidadeVolante2,
  tipoUnidadeVolante3,
  tipoUnidadeMudeiONome
]);

const LIMITE_MAXIMO_ELASTIC = 10000;
const limiteBuscaElastic = 10000;

function hasVolanteCategory(additionalData) {
  return Array.isArray(additionalData) && additionalData.some(
    item => UNIT_TYPE_IDS_BLOQUEADOS.has(item.category?._id)
  );
}

function hasInternalUnit(additionalData) {
  return Array.isArray(additionalData) && additionalData.some(
    item => item.isInternalUnit === true
  );
}

function getPrimaryAdditional(additionalData) {
  return additionalData?.[0] || {};
}

// ============================================================
// BUSCAS EXTERNAS
// ============================================================

let listaUnidadesGestaoServico = [];
let listaUnidadesServico = [];

if (query) {

  // Busca IDs de unidades que possuem o serviço pesquisado
  const idsGestaoServicoBrutos =
    br.com.wevets.accreditedNetwork.ServiceManagement._search({
      "size": limiteBuscaElastic,
      "query": {
        "bool": {
          "should": [
            {
              "wildcard": {
                "serviceConfiguration.service.name": {
                  "value": `*${query}*`,
                  "case_insensitive": true
                }
              }
            }
          ],
          "minimum_should_match": 1
        }
      }
    }).hits.hits.map(hit => hit._source.unit?._id).filter(Boolean);

  // Deduplica os IDs antes de buscar
  const idsGestaoServico = [...new Set(idsGestaoServicoBrutos)];

  // Busca os objetos completos das unidades pelos IDs encontrados
  if (idsGestaoServico.length > 0) {
    listaUnidadesGestaoServico =
      crm.ServiceUnit._search({
        "size": idsGestaoServico.length,
        "query": {
          "terms": {
            "_id": idsGestaoServico
          }
        }
      }).hits.hits.map(hit => hit._source);
  }

  // Busca unidades cujo nome bate com a query
  listaUnidadesServico =
    crm.ServiceUnit._search({
      "size": limiteBuscaElastic,
      "query": {
        "bool": {
          "should": [
            {
              "wildcard": {
                "name": {
                  "value": `*${query}*`,
                  "case_insensitive": true
                }
              }
            }
          ],
          "minimum_should_match": 1
        }
      }
    }).hits.hits.map(hit => hit._source);

} else {

  listaUnidadesServico =
    crm.ServiceUnit._search({
      "size": limiteBuscaElastic,
      "query": {
        "match_all": {}
      }
    }).hits.hits.map(hit => hit._source);
}

// Une os resultados, eliminando duplicatas pelo _id
const listaUnidades = [
  ...listaUnidadesGestaoServico,
  ...listaUnidadesServico
].reduce((map, unidade) => {
  if (unidade && !map.has(unidade._id)) {
    map.set(unidade._id, unidade);
  }
  return map;
}, new Map());

const listaUnidadesUnicas = Array.from(listaUnidades.values());

// ============================================================
// FILTROS
// ============================================================

const unidadesFiltradas = listaUnidadesUnicas
  .filter(unidade => {

    const additional = getPrimaryAdditional(unidade.additionalData);
    const isVolante = hasVolanteCategory(unidade.additionalData);
    const isInternal = hasInternalUnit(unidade.additionalData);

    // Se unitType não é 'volante', aplicar bloqueio global que exclui volantes
    if (rawUnitType !== 'volante' && isVolante) {
      return false;
    }

    // Aplicar filtro por unitType quando informado
    if (rawUnitType === 'rede_wevets' && !isInternal) {
      return false;
    }

    if (rawUnitType === 'volante' && !isVolante) {
      return false;
    }

    if (rawUnitType === 'rede_credenciada' && (isVolante || isInternal)) {
      return false;
    }

    // Filtro por attendanceModes (serviceModel)
    if (serviceModelIds.size === 0) {
      // continua
    } else if (!unidade.serviceModel?.some(service => serviceModelIds.has(service._id))) {
      return false;
    }

    // Filtro por plan
    if (!planId) {
      // continua
    } else if (!unidade.additionalData?.some(data => data.plansServiced?.some(plan => plan._id === planId))) {
      return false;
    }

    return true;
  });

// ============================================================
// MAPEAMENTO
// ============================================================

const unidadesMapeadas = unidadesFiltradas.map(unidade => {

  const additional = getPrimaryAdditional(unidade.additionalData);
  const isVolante = hasVolanteCategory(unidade.additionalData);
  const isInternal = hasInternalUnit(unidade.additionalData);

  const unidadeLatitude = unidade.address?.coordinates?.lat ?? null;
  const unidadeLongitude = unidade.address?.coordinates?.lon ?? null;

  // Para unidades volantes, address e distância devem ser nulos
  const distanciaReal = isVolante
    ? null
    : calcularDistanciaHaversine(
      minhaLatitude,
      minhaLongitude,
      unidadeLatitude,
      unidadeLongitude
    );

  const logo = unidade.photo ? `${BASE_URL}api/1/main/crm/ServiceUnit/_extGetPhotoLink/${unidade._id}` : null;

  // unitType formatado
  let unitTypeObj;
  if (isVolante) {
    unitTypeObj = { name: "Volante", id: "volante" };
  } else if (isInternal) {
    unitTypeObj = { name: "Rede WeVets", id: "rede_wevets" };
  } else {
    unitTypeObj = { name: "Rede Credenciada", id: "rede_credenciada" };
  }

  const mappedAddress = {
    "country": unidade.address?.country?.name || null,
    "state": unidade.address?.state || null,
    "city": unidade.address?.city || null,
    "quarter": unidade.address?.quarter || null,
    "street": unidade.address?.street || null,
    "number": unidade.address?.number || null,
    "zipcode": unidade.address?.zipcode || null,
    "complement": unidade.address?.complement || null,
    "coordinates": { "lat": unidadeLatitude, "lon": unidadeLongitude }
  };

  return {
    "_id": unidade._id,
    "name": unidade.name || null,
    "description": additional.description || null,
    "logo": logo,
    "address": mappedAddress,
    "distanceInKm": distanciaReal,
    "openingStatus": calcularStatusAbertura(unidade),
    "unitType": unitTypeObj
  };
});

// ============================================================
// FILTRO DE RAIO + ORDENAÇÃO + PAGINAÇÃO
// ============================================================

const unidadesDentroDoRaio = unidadesMapeadas.filter(u => {
  if (u.distanceInKm === null) {
    return rawUnitType === 'volante' && u.unitType?.id === 'volante';
  }

  return raioEmKm === null || u.distanceInKm <= raioEmKm;
});

unidadesDentroDoRaio.sort((a, b) => {

  if (a.distanceInKm === null) {
    return 1;
  }

  if (b.distanceInKm === null) {
    return -1;
  }

  return a.distanceInKm - b.distanceInKm;
});

// Se o usuário solicitou apenas volantes, todos os mapeados serão volantes com distanceInKm === null
// e portanto aparecerão ao final; manter comportamento consistente.

const inicio = (page - 1) * size;
const fim = inicio + size;

_output = {
  "metadata": {
    "total": unidadesDentroDoRaio.length,
    "page": page,
    "size": size
  },
  "units": unidadesDentroDoRaio.slice(inicio, fim)
};

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function sanitizarQuery(q) {

  if (typeof q !== "string") {
    return "";
  }

  return q.replace(/[?\\]/g, "").trim();
}

function calcularDistanciaHaversine(
  minhaLatitude,
  minhaLongitude,
  unidadeLatitude,
  unidadeLongitude
) {

  if (
    minhaLatitude == null ||
    minhaLongitude == null ||
    unidadeLatitude == null ||
    unidadeLongitude == null
  ) {
    return null;
  }

  const R = 6371;

  const dLat =
    (unidadeLatitude - minhaLatitude) *
    Math.PI / 180;

  const dLon =
    (unidadeLongitude - minhaLongitude) *
    Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(minhaLatitude * Math.PI / 180) *
    Math.cos(unidadeLatitude * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  const distancia = R * c;

  return Math.round(distancia * 10) / 10;
}

function calcularStatusAbertura(unidade) {

  const additionalData =
    unidade.additionalData?.[0] || {};

  const businessHoursList =
    additionalData.businessHours || [];

  if (!additionalData.active) {
    return "CLOSED";
  }

  const weekdayList = [
    "Dom",
    "Seg",
    "Ter",
    "Qua",
    "Qui",
    "Sex",
    "Sab"
  ];

  const currentDate = new Date();

  const currentWeekday =
    weekdayList[currentDate.getDay()];

  const hours =
    String(currentDate.getHours()).padStart(2, "0");

  const minutes =
    String(currentDate.getMinutes()).padStart(2, "0");

  const currentTime =
    `${hours}:${minutes}`;

  const today =
    businessHoursList.find(
      bh => bh.day === currentWeekday
    );

  if (!today || !today.open) {
    return "CLOSED";
  }

  const {
    openingTime,
    closingTime
  } = today;

  if (!openingTime && !closingTime) {
    return "OPEN_24";
  }

  if (
    openingTime === "00:00" &&
    closingTime === "00:00"
  ) {
    return "OPEN_24";
  }

  if (
    openingTime &&
    closingTime &&
    currentTime >= openingTime &&
    currentTime < closingTime
  ) {
    return "OPEN";
  }

  return "CLOSED";
}
