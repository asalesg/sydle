/**
 * ==========================================
 * USO DE COBERTURA (FINAL - GROUP + servicesUsage)
 * ==========================================
 *
 * @_input = {
 *   membershipId: string,
 *   serviceId: string,
 *   planId: string
 * }
 */


function safe(arr) {
  return Array.isArray(arr) ? arr : [];
}

function safeNumber(n, def = 0) {
  return (typeof n === "number" && !isNaN(n)) ? n : def;
}

function buildGroupKey(cfg) {
  const uses = safeNumber(cfg.usesPerYear);
  const wait = safeNumber(cfg.waitingPeriodsInDays);
  return `U${uses}_W${wait}`;
}


/**
 * =========================
 * CONFIG DO SERVIÇO
 * =========================
 */
function getServiceConfig(serviceId, planId) {

  const doc = br.com.wevets.ServiceCatalog._get({ _id: serviceId });
  const s = doc || {};

  const cfg = safe(s.productConfig).find(c =>
    c &&
    c.coverage === true &&
    c.plan?._id === planId
  );

  if (!cfg) throw "Serviço não coberto no plano";

  const usesPerYear =
    safeNumber(cfg?.limitsDefinition?.usageFrequencies?.[0]?.uses);

  const waiting =
    safeNumber(cfg?.waitingPeriod?.waitingPeriodsInDays);

  return {
    serviceId,
    usesPerYear,
    waitingPeriodsInDays: waiting,
    groupKey: buildGroupKey({
      usesPerYear,
      waitingPeriodsInDays: waiting
    })
  };
}


/**
 * =========================
 * BUSCA MEMBERSHIP
 * =========================
 */
function getMembership(membershipId) {
  return br.com.wevets.membershipManagement.Membership._get({
    _id: membershipId
  });
}


/**
 * =========================
 * AGRUPA USO POR GRUPO
 * =========================
 */
function calculateGroupUsage(servicesUsage, groupKey, planId) {

  let total = 0;

  servicesUsage.forEach(item => {

    const serviceId = item?.service?._id;
    if (!serviceId) return;

    try {

      const cfg = getServiceConfig(serviceId, planId);

      if (cfg.groupKey === groupKey) {
        total += safeNumber(item.uses);
      }

    } catch (e) {
      // ignora serviço inválido
    }

  });

  return total;
}


/**
 * =========================
 * ATUALIZA USO DO SERVIÇO
 * =========================
 */
function incrementServiceUsage(list, serviceId) {

  let item = list.find(i => i.service?._id === serviceId);

  if (!item) {
    throw "Serviço não encontrado em servicesUsage";
  }

  item.uses = safeNumber(item.uses) + 1;

  return item;
}


/**
 * =========================
 * MAIN
 * =========================
 */
(function main() {

  try {

    const { membershipId, serviceId, planId } = _input || {};

    if (!membershipId) throw "membershipId obrigatório";
    if (!serviceId) throw "serviceId obrigatório";
    if (!planId) throw "planId obrigatório";

    const service = getServiceConfig(serviceId, planId);

    const { groupKey, usesPerYear } = service;

    /**
     * ✅ ILIMITADO
     */
    if (usesPerYear === 0) {

      _output = {
        allowed: true,
        groupKey,
        limit: "UNLIMITED"
      };

      return;
    }

    /**
     * ✅ BUSCA ASSINATURA
     */
    const membership = getMembership(membershipId);

    if (!membership) throw "Assinatura não encontrada";

    const servicesUsage = safe(membership.servicesUsage);

    /**
     * ✅ USO ATUAL DO GRUPO
     */
    const used = calculateGroupUsage(
      servicesUsage,
      groupKey,
      planId
    );

    /**
     * ✅ BLOQUEIO
     */
    if (used >= usesPerYear) {

      _output = {
        allowed: false,
        groupKey,
        used,
        remaining: 0,
        limit: usesPerYear
      };

      return;
    }

    /**
     * ✅ INCREMENTA NO SERVIÇO
     */
    incrementServiceUsage(servicesUsage, serviceId);

    /**
     * ✅ SALVA
     */
    br.com.wevets.membershipManagement.Membership._update({
      _id: membershipId,
      servicesUsage: servicesUsage
    });

    _output = {
      allowed: true,
      groupKey,
      used: used + 1,
      remaining: usesPerYear - (used + 1),
      limit: usesPerYear
    };

  } catch (e) {

    _output = {
      allowed: false,
      error: String(e)
    };

  }

})();
