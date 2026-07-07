/**
 * Método responsável por criar um novo registro de plano além de chamar o método de gerar fatura e arrecadar para este 
 * novo plano.
 * @input {
 *  membership<string> - Id da assinatura que terá o plano alterado
 *  newPlan<string> - Id do novo plano da assinatura
 *  missingNewPlanComponent<string> - Id do componente do novo plano da assinatura
 *  originFlocker?<boolean> - Sinaliza se um upgrade é de origem flocker, por padrão é negativo
 * }
 */

const OPEN_REQUEST_PLAN_CHANGE_STATUS_ID = "67e1bfbd43647c7aa3e6d1e8";
const ERROR_PLAN_CHANGE_STATUS_ID = "685e95e804132767310553b5";
const CLASS_ID = "000000000000000000000000";
const PLAN_CHANGE_REGISTRATION_CLASS_ID = "67e4603437ee107e84f6de2c";
const INACTIVE_INVOICING_STATE_OBJ = { "_id": "59726389ce027221e4453505", "_classId": "59726305ce027221e44534ec" };
const FLOCKER_ACTIVE_SERVICE_STATE_OBJ = { "_id": "681e08492bd1602c4a991696", "_classId": "597262c7ce027221e44534e1" };
const MONTHLY_PERIODICITY_OBJECT_ID = "5cd475cc6535f8784a539c4c";

const moment = require("/_internal/moment");

validateInput();

const planChangeRegistration = _input;

planChangeRegistration.requestDate = new Date();

const newPlanChangeRegistration = br.com.wevets.membershipManagement.PlanChangeRegistration._create(planChangeRegistration);

updateLog(newPlanChangeRegistration);

const planChangeRegistrationUpdated = br.com.wevets.membershipManagement.PlanChangeRegistration.statusUpdate({
  planChangeRegistration: newPlanChangeRegistration._id,
  newStatus: OPEN_REQUEST_PLAN_CHANGE_STATUS_ID,
  extraInformation: "Processo de solicitação de troca de plano aberta."
});

if (newPlanChangeRegistration.originFlocker) {
  let isCanceledOrBroken = false;
  let error;
  try {
    com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
      "sender": { "_id": planChangeRegistrationUpdated._id, "_classId": PLAN_CHANGE_REGISTRATION_CLASS_ID },
      "body": {
        "targetClass": PLAN_CHANGE_REGISTRATION_CLASS_ID,
        "targetMethod": "dealWithUpgradeFlocker",
        "parameter": _utils.stringifyAsJson({
          planChangeRegistration: planChangeRegistrationUpdated
        })
      }
    });
  } catch (e) {
    isCanceledOrBroken = true;
    error = e.message;
  }
  if (isCanceledOrBroken) {
    contractStatusPatch(newPlanChangeRegistration.membership.contract);
    br.com.wevets.membershipManagement.PlanChangeRegistration.statusUpdate({
      planChangeRegistration: newPlanChangeRegistration._id,
      newStatus: ERROR_PLAN_CHANGE_STATUS_ID,
      extraInformation: error || "Solicitação está cancelada na Stripe."
    });
    return;
  }
}

if (planChangeRegistrationUpdated) {
  _output = planChangeRegistrationUpdated;
  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    "sender": { "_id": planChangeRegistrationUpdated._id, "_classId": PLAN_CHANGE_REGISTRATION_CLASS_ID },
    "schedulingDate": new Date(),
    "body": {
      "targetClass": { "_classId": CLASS_ID, "_id": PLAN_CHANGE_REGISTRATION_CLASS_ID },
      "targetMethod": "generateInvoiceAndCollect",
      "parameter": _utils.stringifyAsJson({
        planChangeRegistration: { "_id": planChangeRegistrationUpdated._id }
      })
    }
  })
}

// FUNCTIONS ---------------------------------------------------------------------------------------------------------------------

function validateInput() {
  const messages = {
    noInput: "Não contém os dados de _input.",
    missingMembership: "É obrigatório informar o ID da associação.",
    missingNewPlan: "É obrigatório informar o ID do novo plano.",
    missingNewPlanComponent: "É obrigatório informar o ID novo componente do plano."
  };


  if (!_input) throw new Error(messages.noInput);
  if (!_input.membership) throw new Error(messages.missingMembership);
  if (!_input.newPlan) throw new Error(messages.missingNewPlan);
  if (!_input.newPlanComponent) throw new Error(messages.missingNewPlanComponent);
}

function membershipCanceledOnStripe(membership) {

  let stripeMembership = br.com.wevets.IntegrationFacadeStripe.getMembership({ membershipId: membership._id });

  validatePeriodicity(membership.contract, stripeMembership);
  const timeZoneDate = moment(stripeMembership.stripeResponse.response.current_period_end * 1000).utcOffset(-180);

  br.com.wevets.membershipManagement.Membership._patch({
    _id: membership._id,
    _operationsList: [{ op: 'replace', path: 'validityDate', value: timeZoneDate.toDate() }]
  });

  return stripeMembership.stripeMembershipStatus === "canceled";

}

/**
 * @description Altera o status de faturamento do contrato para o valor enviado e insere o endereço de cobrança
 * 
 * @param {object} contract contrato para alteração
 */
function contractStatusPatch(contract) {

  billing.contract._patch({
    _id: contract._id,
    _operationsList: [
      { op: 'replace', path: 'contractStates/invoicingState', value: INACTIVE_INVOICING_STATE_OBJ },
      { op: 'replace', path: 'contractStates/serviceState', value: FLOCKER_ACTIVE_SERVICE_STATE_OBJ },
    ]
  });

}

function updateLog(newPlanChangeRegistration) {
  if (!newPlanChangeRegistration?.logId) return;
  logs.PortalIntegrationLog._patch({
    _id: newPlanChangeRegistration.logId,
    _operationsList: [{ op: 'replace', path: '/createdObject', value: { "_id": newPlanChangeRegistration._id, "_classId": newPlanChangeRegistration._classId } }]
  });
}

/**
* @description Verifica se a periodicidade do contrato no Sydle One corresponde com a da assinatura na Stripe
* 
* @param {object} contract Objeto de contrato do Sydle One
* @param {object} stripeMembership Objeto que a chamada da stripe retorna
* 
* @throws Dá erro caso no sydle ou na stripe não seja mensal
*/
function validatePeriodicity(contract, stripeMembership) {
  let productData = contract?.productData?.find(elem => elem.active === true);
  let planPeriodicityId = productData?.planComponent?.deal?.periodicity?._id;
  let stripePeriodicity = stripeMembership.stripeResponse.response.plan.interval;

  if (planPeriodicityId !== MONTHLY_PERIODICITY_OBJECT_ID || stripePeriodicity !== 'month') {
    throw new Error("A periodicidade da stripe está diferente do sydle one.");
  }
}