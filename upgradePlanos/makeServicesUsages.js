/**
 * Método responsável por pegar todos os serviços associados a uma assinatura e montar
 * a tabela de serviços da assinatura
 * 
 * @_input: {
 *  coverageId<string>: id do catalogo de cobertura
 *  membershipId<string>: id da cobertura pra ser atualizada
 *  planId<string>: id do plano que será usado na assinatura
 * }
 *
*/
const NO_CONFIG_MASTER_PLANS_IDS = ['6847212dc870901d6a554129', '68487c292b7ff0324af92361', '68487c4d2b7ff0324afa72e7'];
const WITH_CONFIG_MASTER_PLAN_ID = '67d0315f783db70d0d76138f';

let { coverage, membership } = getInputObjects(_input.coverageId, _input.membershipId);

let servicesList = getServices(coverage);

if (!servicesList || servicesList.length === 0) {
  throw new Error("Nenhum serviço foi encontrado para essa cobertura");
}

let servicesUsage = makeServicesUsage(membership, servicesList, _input.planId);
patchMembership(servicesUsage, membership, coverage);

// FUNCTIONS ---------------------------------------------------------------------------------------------------------------------

function getInputObjects(coverageId, membershipId) {

  const coverage = br.com.wevets.membershipManagement.CoverageCatalog._get({ _id: coverageId });

  const membership = br.com.wevets.membershipManagement.Membership._get({ _id: membershipId });

  return { "coverage": coverage, "membership": membership };
}

/**
 * @description Pega todos os objetos de versão de catalogo de serviço associados a cobertura passada.
 * 
 * @param {object} coverage catalogo de cobertura
 * @returns {Array<object>} Lista de serviços associados a cobertura
 */
function getServices(coverage) {
  return br.com.wevets.membershipManagement.CoverageCatalog.getRelatedServices({ "coverageId": coverage._id });
}

/**
 * @description Constroi a tabela de controle de uso de serviços para assinatura
 * 
 * @param {object} membership
 * @param {object} servicesList
 * @param {string} planId
 */
function makeServicesUsage(membership, servicesList, planId) {

  const oldServicesUsage = membership.servicesUsage || [];
  const currentDate = new Date();

  let coverageServicesUsage = [];

  let correctPlan = dealWithInvalidPlans(planId);

  servicesList.forEach(service => {

    const serviceConfig = service.productConfig?.find(config => config.plan?._id === correctPlan);
    if (!serviceConfig || !serviceConfig.coverage) return;

    coverageServicesUsage.push({
      "service": service.originalServiceCatalog,
      "usageLimit": serviceConfig.limitsDefinition,
      "pricing": serviceConfig.servicePricing,
      "waitingPeriodsData": serviceConfig.waitingPeriod
    });

  });

  let updatedServiceUsage = [];

  coverageServicesUsage.forEach(newServiceUsage => {

    const index = oldServicesUsage?.findIndex(existing => {
      return existing.service?._id === newServiceUsage.service?._id;
    });
    const isAlreadyCoverade = index !== -1;

    if (isAlreadyCoverade) {
      /**
       * Atualiza os dados para o do novo srviço quando cabível
      */
      oldServicesUsage[index].pricing = newServiceUsage.pricing;

      if (oldServicesUsage[index].waitingPeriodsData) {

        oldServicesUsage[index].waitingPeriodsData.oopDiscount = newServiceUsage.waitingPeriodsData?.oopDiscount || null;
        oldServicesUsage[index].waitingPeriodsData.minimumCost = newServiceUsage.waitingPeriodsData?.minimumCost || null;

      }

      oldServicesUsage[index].usageLimit = newServiceUsage.usageLimit;

      // Reinicializa as utilizações da assinatura se houver reset no upgrade
      if (!oldServicesUsage[index].usageLimit || oldServicesUsage[index].usageLimit.upgradeReset) {
        oldServicesUsage[index].uses = null;
      }

      updatedServiceUsage.push(oldServicesUsage[index]);

    } else {

      if (newServiceUsage.waitingPeriodsData) {
        newServiceUsage.waitingPeriodsData.waitingPeriodsStartDate = currentDate;
      }
      updatedServiceUsage.push(newServiceUsage);
    }
  });

  return updatedServiceUsage;
}

/**
 * 
 * @param {object} servicesUsage
 * @param {object} membership
 * @param {object} coverage
 * 
 */
function patchMembership(servicesUsage, membership, coverage) {
  br.com.wevets.membershipManagement.Membership._patch({
    _id: membership._id,
    _operationsList: [
      { op: 'replace', path: '/servicesUsage', value: servicesUsage },
      { op: 'replace', path: '/coverage', value: coverage },
    ]
  });
}

/**
 * @description Em produção, alguns planos não possuem serviços associados. Este método visa pegar esses planos e tranferir
 * o plano mais próximo que possua a configuração completa
 * 
 * @param {string} planId id do plano original, usado para validação.
 * @returns {string} retorna o id passado caso o plano seja válido ou o plano mais próximo caso seja necessário alterar
 */

function dealWithInvalidPlans(planId) {
  let isInvalidPlan = NO_CONFIG_MASTER_PLANS_IDS.some(id => id === planId);

  return isInvalidPlan ? WITH_CONFIG_MASTER_PLAN_ID : planId;
}