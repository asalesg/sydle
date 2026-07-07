/* 
 * @description Este script gerencia o ciclo de vida da alteração de planos para assinaturas.
 * * Funcionalidades principais:
 * 1. Portabilidade: Realiza a transição imediata entre planos sem gerar cobrança ou faturas de pró-rata.
 * 2. Upgrade: Executa a troca de plano com faturamento e arrecadação 
 * imediata da fatura e tratamento de erros para pagamentos recusados.
 * 3. Gestão de Vigência: Em casos de upgrade para planos anuais, realiza o cálculo e a atualização 
 * automática da data de validade da assinatura (Membership).
 * 4. Processamento Assíncrono: Utiliza a fila de prioridade (Prioritized Queue) para disparar 
 * notificações de confirmação (e-mail/push) e recalcular descontos progressivos sem onerar 
 * o tempo de resposta do fluxo principal.
 *
 * @input
 * {
 *  planChangeRegistration: (Obrigatório se invoice não existir) (object sydle) - Objeto de Registro de troca de plano
 *  invoice: (Obrigatório se planChangeRegistration não existir) (object sydle) - Objeto de Fatura já criada
 * }
 * 
*/

const PAID_STATE = "5977c246ce027227c4269e3a";
const COMPLETED_STATE_ID = "67e1bfdd43647c7aa3e76920";
const PAYMENT_REFUSED_STATE_ID = "67e1c01943647c7aa3e95072";
const IN_PROCESSING_PLAN_CHANGE_STATUS_ID = "67e1bff9ab11374fb21981e7";
const ERROR_PLAN_CHANGE_STATUS_ID = "685e95e804132767310553b5";
const PLAN_CHANGE_TYPE_PORTABILITY_ID = "68b08a6de2824a0188b40961";
const ANNUAL_PERIODICITY_ID = "5cd476096535f8784a539dbf";
const UPGRADE_ERROR_PUSH_TEMPLATE = "69b2df27b2e23d7455bb917c";
const PLAN_CHANGE_REGISTRATION_CLASS_ID = "67e4603437ee107e84f6de2c";
const MEMBERSHIP_CLASS_ID = "67d038dd783db70d0d2650bb";
const PUSH_NOTIFICATION_TEMPLATE_CLASS_ID = "69a9df43823e2d20bb4ac65a";

let planChangeRegistration;


validateInput();

const contract = planChangeRegistration.contract;
const userId = contract.buyer?._id ?? null;
const isPortability = planChangeRegistration.changeType._id === PLAN_CHANGE_TYPE_PORTABILITY_ID;
const planPeriodicityId = getCurrentPlanPeriodicity(contract.productData);
const isAnnualUpgrade = planPeriodicityId === ANNUAL_PERIODICITY_ID;

let invoice = _input.invoice || planChangeRegistration.invoice;
let success = false;
try {
  updatePlanChangeRegistration(IN_PROCESSING_PLAN_CHANGE_STATUS_ID, "Troca de plano em processamento.");

  if (isPortability) {
    executePortability();
  } else {
    executeUpgrade();
  }

  if (success) {
    queueNotification(planChangeRegistration, PLAN_CHANGE_REGISTRATION_CLASS_ID, "emailConfirmingPlanChange", { planChangeRegistration: planChangeRegistration._id });
    updatePlanChangeRegistration(COMPLETED_STATE_ID, "A troca de plano foi realizada!");
  }

  updateProgressiveDiscounts();
} catch (e) {
  throw e.stack;
}

// =====================================================================================================================
// Funções Principais
// =====================================================================================================================

/**
 * @description Valida os parâmetros de entrada e carrega o registro de troca de plano.
 * * @returns {void}
 * @throws {Error} Lança erro caso o registro de troca de plano não seja encontrado.
 * */
function validateInput() {
  planChangeRegistration = _object || br.com.wevets.membershipManagement.PlanChangeRegistration._get({ "_id": _input.planChangeRegistration?._id });

  if (!planChangeRegistration) {
    throw new Error("Registro de troca de plano não encontrado.");
  }

  if (!planChangeRegistration.membership || !planChangeRegistration.contract || !planChangeRegistration.membership.contract) {
    throw new Error("Dados de assinatura ou contrato ausentes no registro.");
  }
}

/**
 * @description Atualiza o status do registro de troca de plano.
 * * @param {string} newStatus ID do novo status.
 * @param {string} extraInformation Informação adicional.
 * @returns {void}
 */
function updatePlanChangeRegistration(newStatus, extraInformation) {
  planChangeRegistration = br.com.wevets.membershipManagement.PlanChangeRegistration.statusUpdate({
    planChangeRegistration: planChangeRegistration._id,
    newStatus,
    extraInformation
  });
}

/**
 * @description Executa o fluxo de portabilidade, realizando a troca de plano sem gerar cobrança imediata.
 * * @returns {void}
 * @throws {Error} Lança erro caso ocorra falha na alteração do contrato.
 */
function executePortability() {
  try {
    changeContractPlan();
    success = true;
  } catch (e) {
    updatePlanChangeRegistration(ERROR_PLAN_CHANGE_STATUS_ID, "Erro ao realizar a troca de plano: " + e.message);
    throw new Error(e.stack);
  }
}

/**
 * @description Orquestra o fluxo de upgrade, incluindo geração de fatura, arrecadação e validação de pagamento.
 * * @returns {void}
 * @throws {Error} Lança erro se houver falha crítica no processo ou ausência de remessa.
 */
function executeUpgrade() {
  if (!invoice) {
    changeContractPlan();

    br.com.wevets.membershipManagement.PlanChangeRegistration._patch({
      _id: planChangeRegistration._id,
      _operationsList: [{ "op": "replace", "path": "/invoice", "value": invoice._id }]
    });
  }

  refreshInvoice();

  if (invoice?.invoiceState?._id !== PAID_STATE) {
    collectInvoice();
    refreshInvoice();
  }

  if (invoice?.invoiceState?._id === PAID_STATE) {
    if (isAnnualUpgrade) {
      updateAnnualMembershipValidityDate();
    }
    success = true;
  } else {
    const lastRemittance = invoice.lastRemittance;

    if (!lastRemittance) {
      updatePlanChangeRegistration(ERROR_PLAN_CHANGE_STATUS_ID, "Não foi possível obter a remessa da fatura.");
      throw new Error("Falha ao obter remessa.");
    }

    const errorDetail = (lastRemittance.remittanceReturnCode?.returnCode || "") + " / " + (lastRemittance.remittanceReturnCode?.name || "Erro Desconhecido");

    updatePlanChangeRegistration(PAYMENT_REFUSED_STATE_ID, errorDetail);
    br.com.wevets.membershipManagement.PlanChangeRegistration.cancelnvoice({ invoiceObject: invoice });

    queueNotification(planChangeRegistration, PLAN_CHANGE_REGISTRATION_CLASS_ID, "emailFailedPlanChange", { planChangeRegistration: planChangeRegistration._id });
    sendPushNotification(userId, "all", UPGRADE_ERROR_PUSH_TEMPLATE);

  }
}

/**
 * @description Realiza a chamada ao motor de faturamento para alterar o plano do contrato.
 * * @returns {void}
 * @throws {Error} Lança erro se a API de faturamento falhar.
 */
function changeContractPlan() {
  let componentsPlan = billing.planChange.fillComponents({
    "object": { "plan": planChangeRegistration.newPlan },
    "oldObject": { "plan": contract.product },
    "contract": contract
  });

  componentsPlan.forEach(component => {
    component.active = component.deal.periodicity?._id === planPeriodicityId;
  });

  const body = {
    "_id": contract._id,
    "newPlan": {
      "components": componentsPlan,
      "classificationParameters": contract.classificationParameters,
      "plan": planChangeRegistration.newPlan
    },
    "currentPlan": {
      "components": contract.productData,
      "classificationParameters": contract.classificationParameters,
      "plan": contract.product
    },
    "simulateInvoice": false,
    "generatePlanChangeInvoice": !isPortability,
    "collectImmediately": !isPortability,
    "keepContractReferenceDate": false,
    "ignoreProrataDiscounts": isPortability
  };

  try {
    invoice = billing.contract.changeContractPlan(body);
    const newCoverage = br.com.wevets.membershipManagement.CoverageCatalogModel.searchActiveCoverage({ planId: planChangeRegistration.newPlan._id });
    br.com.wevets.membershipManagement.PlanChangeRegistration._patch({
      _id: planChangeRegistration._id,
      _operationsList: [{ op: 'replace', path: '/newCoverage', value: newCoverage }]
    });
  } catch (e) {
    updatePlanChangeRegistration(ERROR_PLAN_CHANGE_STATUS_ID, "Erro ao tentar alterar plano ou gerar fatura. Mensagem de erro: " + e.message);
    throw new Error(e.stack);
  }
}

/**
 * @description Tenta realizar a arrecadação da fatura gerada.
 * * @returns {void}
 * @throws {Error} Lança erro caso a API de collect falhe.
 */
function collectInvoice() {
  try {
    billing.invoice.collect({ "invoices": [invoice] });
  } catch (e) {
    updatePlanChangeRegistration(ERROR_PLAN_CHANGE_STATUS_ID, "Erro na arrecadação da fatura: " + e.message);
    throw new Error(e.stack);
  }
}

/**
 * @description Recarrega os dados da fatura para garantir o estado mais recente.
 * * @returns {void}
 * */
function refreshInvoice() {
  invoice = billing.invoice._get({ _id: invoice?._id });
}

/**
 * @description Atualiza a data de vigência da assinatura somando um ano em casos de upgrade anual.
 * * @returns {void}
 * @throws {Error} Lança erro caso não seja possível atualizar a data de vigência
 */
function updateAnnualMembershipValidityDate() {
  let newValidityDate = new Date();
  newValidityDate.setFullYear(newValidityDate.getFullYear() + 1);

  try {
    br.com.wevets.membershipManagement.Membership._patch({
      "_id": planChangeRegistration.membership._id,
      "_operationsList": [{ "op": "replace", "path": "validityDate", "value": newValidityDate }]
    });
  } catch (e) {
    updatePlanChangeRegistration(ERROR_PLAN_CHANGE_STATUS_ID, "Erro ao tentar atualizar vigência: " + e.stack);
    throw new Error(e.stack);
  }
}

/**
 * @description Agenda a validação e atualização dos descontos progressivos da assinatura.
 * @returns {void}
 * */
function updateProgressiveDiscounts() {
  const validateDiscountMethodInput = {
    "subId": planChangeRegistration.membership._id,
    "type": "planChange",
    "simulate": false,
    "newPlanId": planChangeRegistration.newPlanComponent._id
  };

  queueNotification(planChangeRegistration, MEMBERSHIP_CLASS_ID, "_extValidateProgressiveDiscounts", validateDiscountMethodInput);
}

/**
 * @description Função responsável por realizar o envio do Push notification
 * @param {object} productData - Objeto de componente de planos
 * @returns {string} Id do objeto de periodicidade
 */
function getCurrentPlanPeriodicity(productData) {
  return productData.find(plan => plan.active === true).deal.periodicity._id;
}

/**
 * @description Agenda o envio de uma notificação Push via fila de prioridade.
 * * @param {string} userId ID do usuário destino.
 * @param {string} sendType Tipo do envio.
 * @param {string} templateId ID do template de push.
 * @returns {void}
 * */
function sendPushNotification(userId, sendType, templateId) {
  const PUSH_NOTIFICATION_TEMPLATE_CLASS_ID = "69a9df43823e2d20bb4ac65a";
  const payload = { userId, sendType, templateId };
  queueNotification(planChangeRegistration, PUSH_NOTIFICATION_TEMPLATE_CLASS_ID, "sendPushNotification", payload);
};

/**
 * @description Insere uma tarefa na fila de prioridade para processamento assíncrono.
 * * @param {object} sender Objeto de origem
 * @param {string} targetClassId ID da classe alvo.
 * @param {string} targetMethod Nome do método alvo.
 * @param {object} parameter Parâmetros para o método.
 * @returns {void}
 * */
function queueNotification(sender, targetClassId, targetMethod, parameter) {
  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    sender: sender,
    schedulingDate: new Date(),
    body: {
      targetClass: { _id: targetClassId },
      targetMethod: targetMethod,
      parameter: _utils.stringifyAsJson(parameter),
      invokerUser: _user
    }
  });
}