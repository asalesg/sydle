const REDE_SANDBOX_PAYMENT_METHOD_OBJECT = { "_id": "68239413ff6d1111fcda2550", "_classId": "597244b8ce027221e44533fe" };
const REDE_PRD_PAYMENT_METHOD_OBJECT = { "_id": "681e359ec1582147b10445b2", "_classId": "597244b8ce027221e44533fe" };
const REDE_SANDBOX_PAYMENT_ACL_GROUP_ID = "68af0f461795014a13714666";
const ACTIVE_INVOICING_STATE_OBJ = { "_id": "5972637fce027221e4453503", "_classId": "59726305ce027221e44534ec" };
const ACTIVE_SERVICE_STATE_OBJ = { "_id": "59726354ce027221e44534fb", "_classId": "597262c7ce027221e44534e1" };

if (_input.upgradeForm.htmlField) return;

if (_input.upgradeForm.validationButton !== "confirm") {
  throw new ValidationException('Selecione o botão "Concordo com os termos" para poder continuar.', null, 'upgradeForm.validationButton');
}

if (!_input.upgradeForm.integrationLog.finishedSolicitation) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/success', value: true }]
  });
}

try {
  let membership = _object || _input.upgradeForm.membership;

  registerPaymentData(membership);
  contractPatch(membership.contract, _input.upgradeForm.address);
  personPatch(_input.upgradeForm.address, membership.tutor.person);
  membership = getMembership(membership);

  const cardId = membership.contract.accountPaymentData._id;
  const currentPlanPeriodicity = getCurrentPlanPeriodicity(_object.contract.productData);
  const newPlanComponent = getPlanValueByPeriodicity(_input.upgradeForm.plansAvailableForUpgrade, currentPlanPeriodicity);
  const planChangeConfiguration = getPlanChangeConfiguration(membership);
  const planAndComponentToBeCarried = getPlanAndComponentToBeCarried(planChangeConfiguration, _input.upgradeForm.plansAvailableForUpgrade._id);

  if (validateCard(cardId, membership).success) {
    requestPortability(membership, newPlanComponent, planAndComponentToBeCarried);
  } else {
    throw new Error("Cartão invalido");
  }

  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'replace', path: '/finishedSolicitation', value: true }]
  });
  engineRulePublish('portabilityModal_submit_success');
} catch (e) {
  logs.PortalIntegrationLog._patch({
    _id: _input.upgradeForm.integrationLog._id,
    _operationsList: [{ op: 'add', path: '/inputHistory/-', value: { "object": _utils.stringifyAsJson(_input), "error": _utils.stringifyAsJson({ "message": e.message, "stack": e.stack }) } }]
  });

  engineRulePublish('portabilityModal_submit_fail', e?.message)

  throw e.message;
}

/*------------------------------------------------Funções Principais------------------------------------------------*/

function registerPaymentData(membership) {
  try {
    let newAccountPaymentData = _input.upgradeForm.useRecordedCard ? _input.upgradeForm.paymentData : billing.accountPaymentData.create(_input.upgradeForm.createNewPaymentData);

    billing.contract.changePaymentMethod({
      _id: membership.contract._id,
      newPaymentData: newAccountPaymentData,
      newPaymentMethod: getPaymentData(),
      changeInvoicesPaymentMethod: false,
      collectImmediately: false,
      cancelIssuedRemittances: false
    });

  } catch (e) {
    throw new Error(e.message);
  }
}

function validateCard(paymentDataDraftId, membership) {
  return billing.accountPaymentData.validateCreditCardAtAcquirer({
    "_id": paymentDataDraftId,
    "agreement": membership.contract.paymentMethod.agreement
  });
}

function requestPortability(membership, newPlanComponent, planAndComponentToBeCarried) {
  br.com.wevets.membershipManagement.PlanChangeRegistration.requestPortability({
    membership: membership._id,
    newPlan: _input.upgradeForm.plansAvailableForUpgrade._id,
    newPlanComponent: newPlanComponent._id,
    startBillingNextMonth: planAndComponentToBeCarried.startBillingNextMonth,
    moveToNewPlanNextMonth: planAndComponentToBeCarried.moveToNewPlanNextMonth,
    contactPhones: _input.upgradeForm.contactPhones,
    contactEmails: _input.upgradeForm.contactEmails,
    originFlocker: membership.legacyFlocker,
    planAndComponentToBeCarried: planAndComponentToBeCarried,
    logId: _input.upgradeForm.integrationLog._id,
    previousCoverage: _object.coverage
  })
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

/*------------------------------------------------Funções Auxiliares------------------------------------------------*/

function getMembership(membership) {
  return br.com.wevets.membershipManagement.Membership._get({ _id: membership._id });
}

function getPaymentData() {

  let newPaymentMethod = getOrg() === "wevets" ? REDE_PRD_PAYMENT_METHOD_OBJECT : REDE_SANDBOX_PAYMENT_METHOD_OBJECT;

  if (_user.aclUserGroups.some(userGroup => userGroup._id === REDE_SANDBOX_PAYMENT_ACL_GROUP_ID)) {
    newPaymentMethod = REDE_SANDBOX_PAYMENT_METHOD_OBJECT;
  }

  return newPaymentMethod;
}

function getOrg() {
  return _user._organization.organizationId;
}

function contractPatch(contract, billingAddress) {

  billing.contract._patch({
    _id: contract._id,
    _operationsList: [
      { op: 'replace', path: 'contractStates/invoicingState', value: ACTIVE_INVOICING_STATE_OBJ },
      { op: 'replace', path: 'contractStates/serviceState', value: ACTIVE_SERVICE_STATE_OBJ },
      { op: 'replace', path: 'billingAddress', value: billingAddress }
    ]
  });

}

function personPatch(newAddress, person) {
  const alreadyRegisteredAddress = person.addresses.some(address =>
    address.zipCode === newAddress?.zipCode && address.number === newAddress?.number);

  if (newAddress && !alreadyRegisteredAddress) {
    crm.person._patch({
      _id: person._id,
      _operationsList: [{ op: 'replace', path: 'addresses', value: [newAddress] }]
    });
  }
}

function getPlanChangeConfiguration(membership) {

  const activePlan = membership.contract.productData.find(product => product.active === true);

  const planChangeConfiguration = br.com.wevets.membershipManagement.PlanChangeConfiguration._search({
    "query": {
      "bool": {
        "must": [
          {
            "term": {
              "currentPlan._id": membership.contract.product._id
            }
          },
          {
            "term": {
              "currentPlanComponent._id": activePlan.planComponent._id
            }
          }
        ]
      }
    }
  }).hits.hits[0]._source;

  return planChangeConfiguration;

}

function getPlanAndComponentToBeCarried(planChangeConfiguration, plan) {
  return planChangeConfiguration.planAndComponentToBeCarried.find(
    item => item.plan._id === plan
  );
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
