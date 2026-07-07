/**
 * Método de upgrade da assinatura:.
 *  - Permite seleção de novo plano
 *  - Cria registro de alteração de plano onde o fluxo é continuado
 * 
 * @input: {
 *      membership<Object> - assinatura para o upgrade, no método de tela vai ser o _object.
 *      plansAvailableForUpgrade<object> - Novo plano para assinatura
 *      useRecordedCard<boolean> - Indica se cartão já cadastrado ou cartão novo será utilizado
 *      paymentData?<object> - Objeto da classe dados de pagamento de cliente, atualmente deve ser cartão de crédito. Necessário caso useRecordedCard === true
 *      createNewPaymentData?<object> - Objeto da classe dados de pagamento de cliente, atualmente deve ser cartão de crédito. Necessário caso useRecordedCard === false
 *      newPaymentMethod<Object> - Objeto da classe Forma de pagamento. Valor pode ser passado ou será definido automaticamente baseado no ambiente de uso.
 *      validationButton<string> [confirm] - Valor para confirmar consentimento do cliente
 *  }
 * 
 */

/**
* @model Object = {
*  _id<string> - id do objeto
*  _classId<string> - id da classe do objeto
* }
*/
const UPGRADE_PLAN_CHANGE_TYPE_ID = "68b089c7a55342110d80b844";

if (_input.upgradeForm.htmlField) return;

if (!_input.upgradeForm.validationButton) {
  throw new ValidationException('Selecione o botão "Concordo com os termos" para poder continuar.', null, 'upgradeForm.validationButton');
}

if (!_input.upgradeForm.integrationLog.finishedSolicitation && !_object.legacyFlocker) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/success', value: true }]
  });
}

try {
  registerPaymentData();

  const currentPlanPeriodicity = getCurrentPlanPeriodicity(_object.contract.productData);
  const newPlanComponent = getPlanValueByPeriodicity(_input.upgradeForm.plansAvailableForUpgrade, currentPlanPeriodicity);

  const newRequestPlanUpgrade = br.com.wevets.membershipManagement.PlanChangeRegistration.requestPlanUpgrade({
    membership: _object._id,
    newPlan: _input.upgradeForm.plansAvailableForUpgrade._id,
    newPlanComponent: newPlanComponent._id,
    contactPhones: _input.upgradeForm.contactPhones,
    contactEmails: _input.upgradeForm.contactEmails,
    originFlocker: _object.legacyFlocker,
    changeType: UPGRADE_PLAN_CHANGE_TYPE_ID,
    logId: _input.upgradeForm.integrationLog._id,
    previousCoverage: _object.coverage
  });

  if (newRequestPlanUpgrade) {
    _output.htmlResponseField = buildHtmlResponse();
  }

  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/finishedSolicitation', value: true }]
  });
  engineRulePublish('upgradeModal_submit_success');

} catch (e) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'add', path: '/inputHistory/-', value: { "object": _utils.stringifyAsJson(_input), "error": e.message } }]
  });

  engineRulePublish('upgradeModal_submit_fail', e);

}

function getCurrentPlanPeriodicity(productData) {

  const activePlan = getActivePlan(productData);

  const planPeriodicityId = activePlan.deal.periodicity._id;

  return planPeriodicityId;

  function getActivePlan(productData) {
    return productData.find(plan => plan.active === true);
  }
}

function getPlanValueByPeriodicity(plansAvailableForUpgrade, planPeriodicityId) {

  return plansAvailableForUpgrade.items.find(item => item.deal?.periodicity?._id === planPeriodicityId).planComponent || null;

}

function buildHtmlResponse() {

  return `<div style="background-color: #1C7BBA; border-radius: 5px; padding: 10px 20px; color: #FFFFFF;">
                <p dir="ltr" style="line-height: 1.2; font-size: 15px; text-align: justify; color: #FFFFFF;">Sua solicitação de alteração de plano está em progresso. Você será notificado por e-mail assim que houver uma atualização.</p>
        </div>`;
}

/**
 * @description Altera a forma de pagamento do contrato e, caso insira novo cartão, cria o antes de associar.
 * 
 * @throws Pode estourar os erros do billing mesmo
 * 
 */
function registerPaymentData() {
  try {
    let newAccountPaymentData = _input.upgradeForm.useRecordedCard ? _input.upgradeForm.paymentData : billing.accountPaymentData.create(_input.upgradeForm.createNewPaymentData);

    billing.contract.changePaymentMethod({
      _id: _object.contract._id,
      newPaymentData: newAccountPaymentData,
      newPaymentMethod: _input.upgradeForm.newPaymentMethod,
      changeInvoicesPaymentMethod: false,
      collectImmediately: false,
      cancelIssuedRemittances: false
    });

  } catch (e) {
    throw new Error(e.message);
  }
}

function engineRulePublish(eventType, errorReason) {
  if (br.com.wevets.AmplitudeFacade.verifyIfIsPortal()) {
    com.levty.ruleEngine.events.Event.publish({
      'triggerIdentifier': 'closeForms',
      'data': {
        "userId": _user?._id,
        "userIp": _user?.remoteIp,
        "eventType": eventType,
        "eventTime": new Date(),
        "localProperties": {
          ...(errorReason && { errorReason })
        },

      }
    });
  }
}