const PLAN_CHANGE_TYPE_PORTABILITY_ID = "68b08a6de2824a0188b40961";
const OPEN_REQUEST_PLAN_CHANGE_STATUS_ID = "67e1bfbd43647c7aa3e6d1e8";
const ERROR_PLAN_CHANGE_STATUS_ID = "685e95e804132767310553b5";
const CLASS_ID = "000000000000000000000000";
const PLAN_CHANGE_REGISTRATION_CLASS_ID = "67e4603437ee107e84f6de2c";
const INACTIVE_INVOICING_STATE_OBJ = { "_id": "59726389ce027221e4453505", "_classId": "59726305ce027221e44534ec" };
const FLOCKER_ACTIVE_SERVICE_STATE_OBJ = { "_id": "681e08492bd1602c4a991696", "_classId": "597262c7ce027221e44534e1" };
const MONTHLY_PERIODICITY_OBJECT_ID = "5cd475cc6535f8784a539c4c";
const EMAIL_SEND_FACADE_CLASS_ID = "67e29e807f1b1d48a75b3daf";

const moment = require("/_internal/moment");

validateInput();

const planChangeRegistration = _input;

completePlanChangeRegistration(planChangeRegistration);

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
    isCanceledOrBroken = membershipCanceledOnStripe(newPlanChangeRegistration.membership);
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

const schedulingDate = getSchedulingDate(_input.moveToNewPlanNextMonth, newPlanChangeRegistration.membership);

if (planChangeRegistrationUpdated) {
  _output = planChangeRegistrationUpdated;

  const nowDate = new Date();

  nowDate.setMinutes(nowDate.getMinutes() + 1);

  checkBillingAdjustmentStatus();

  if (newPlanChangeRegistration.originFlocker) {
    com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
      "sender": { "_id": planChangeRegistrationUpdated._id, "_classId": PLAN_CHANGE_REGISTRATION_CLASS_ID },
      "schedulingDate": nowDate,
      "body": {
        "targetClass": { "_classId": CLASS_ID, "_id": PLAN_CHANGE_REGISTRATION_CLASS_ID },
        "targetMethod": "dealWithUpgradeFlocker",
        "parameter": _utils.stringifyAsJson({
          planChangeRegistration: planChangeRegistrationUpdated
        })
      }
    });
  }

  nowDate.setMinutes(nowDate.getMinutes() + 1);

  const today = moment().startOf('day');
  const scheduledDay = moment(schedulingDate).startOf('day');

  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    "sender": { "_id": planChangeRegistrationUpdated._id, "_classId": PLAN_CHANGE_REGISTRATION_CLASS_ID },
    "schedulingDate": scheduledDay.isAfter(today) ? schedulingDate : nowDate,
    "body": {
      "targetClass": { "_classId": CLASS_ID, "_id": PLAN_CHANGE_REGISTRATION_CLASS_ID },
      "targetMethod": "generateInvoiceAndCollect",
      "parameter": _utils.stringifyAsJson({
        planChangeRegistration: { "_id": planChangeRegistrationUpdated._id }
      })
    }
  })

  if (scheduledDay.isAfter(today)) {
    sendPlanMigrationSchedulingEmail(newPlanChangeRegistration, schedulingDate);
  }
}

// FUNCTIONS ---------------------------------------------------------------------------------------------------------------------

function validateInput() {
  const messages = {
    noInput: "Não contém os dados de _input.",
    missingMembership: "É obrigatório informar o ID da assinatura.",
    missingNewPlan: "É obrigatório informar o ID do novo plano.",
    missingNewPlanComponent: "É obrigatório informar o ID do novo componente do plano.",
  };

  if (!_input) throw new Error(messages.noInput);
  if (!_input.membership) throw new Error(messages.missingMembership);
  if (!_input.newPlan) throw new Error(messages.missingNewPlan);
  if (!_input.newPlanComponent) throw new Error(messages.missingNewPlanComponent);
}

function completePlanChangeRegistration(planChangeRegistration) {
  planChangeRegistration.requestDate = new Date();
  planChangeRegistration.changeType = PLAN_CHANGE_TYPE_PORTABILITY_ID;
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

function getSchedulingDate(moveToNewPlanNextMonth, membership) {
  if (moveToNewPlanNextMonth) {
    let validityDate = moment(br.com.wevets.membershipManagement.Membership._get({ "_id": membership._id }).validityDate);
    return validityDate
      .subtract(1, 'days')
      .hour(20)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate();
  } else {
    return new Date();
  }
}

function updateLog(newPlanChangeRegistration) {
  if (!_input?.logId || !newPlanChangeRegistration) return;
  logs.PortalIntegrationLog._patch({
    _id: _input.logId,
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

/**
* @description Envia para a fila de execução o envio do e-mail de agendamento de migração de plano,
* informando ao cliente a data em que a mudança será efetivada e o valor do novo plano (se houver).
* 
* @param {object} planChangeRegistration Objeto de registro de alteração de plano, contendo a assinatura e os dados do novo plano
* @param {Date} schedulingDate Data agendada para a migração de plano
*/
function sendPlanMigrationSchedulingEmail(planChangeRegistration, schedulingDate) {
  const membership = planChangeRegistration.membership;
  const message = buildEmailBody(membership, schedulingDate, planChangeRegistration);
  const emailData = {
    "membership": membership,
    "messageContent": message
  }

  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    "sender": planChangeRegistration,
    "schedulingDate": new Date(),
    "body": {
      "targetClass": { "_classId": CLASS_ID, "_id": EMAIL_SEND_FACADE_CLASS_ID },
      "targetMethod": "sendPlanMigrationSchedulingEmail",
      "parameter": _utils.stringifyAsJson(emailData)
    }
  });

  function buildEmailBody(membership, schedulingDate, planChangeRegistration) {
    const formattedDate = moment(schedulingDate).format('DD/MM/YYYY');
    const newPlanPrice = planChangeRegistration.newPlanComponent?.value ?
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(planChangeRegistration.newPlanComponent.value) : null;
    const newPlanName = planChangeRegistration.newPlanComponent?.name;

    return `
            <p>Olá, ${membership.contract.buyer.name}!</p>
            <p>Sua solicitação de migração para o plano <strong>${newPlanName}</strong> foi registrada com sucesso.</p>
            <p>A alteração será realizada em <strong>${formattedDate}</strong>.</p>
            ${newPlanPrice ? `<p>O valor do novo plano é de <strong>${newPlanPrice}</strong>.</p>` : ""}
            <p>Você receberá um novo e-mail no dia da alteração confirmando a conclusão.</p>
            <p>Estamos felizes em continuar cuidando da saúde do ${membership.pet.name}!</p>
        `
  }

}

/**
* @description Verifica se existe solicitação de reajuste de valor de assinatura em andamento
*/
function checkBillingAdjustmentStatus() {
  const billingAdjustmentRecord = financialManagement.BillingAdjustmentRecord._search({
    "query": {
      "bool": {
        "must": [
          {
            "term": {
              "status.cancelChangingPlan": true
            }
          }, {
            "term": {
              "membership._id": newPlanChangeRegistration.membership._id
            }
          }
        ]
      }
    },
    "size": 1,
    "_source": false
  }).hits.hits;

  if (billingAdjustmentRecord.length) {
    financialManagement.BillingAdjustmentRecord.cancelBillingAdjustment({
      "billingAdjustmentRecordId": billingAdjustmentRecord[0]._id,
      "cancellationDate": new Date()
    });
  }
}