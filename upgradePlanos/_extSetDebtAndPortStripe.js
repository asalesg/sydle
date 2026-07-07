/**
 * Realiza tentativa de pagamento das faturas vencidas de um cliente stripe e, em caso de sucesso, cria o cartão.
 * 
 * @param {object} paymentCardFormToPayment - Formulário para criação de forma de pagamento
 * @param {string} membershipId - Id da assinatura a ser portada
 * @returns {Object} invoice - Fatura gerada
 * @throws Lança uma exceção caso a fatura não seja informada ou o status não permita arrrecadação.
 * 
 */

const LOG_TYPE_ID = "686bffea21ff9c53438c8bda";

let contextUrlSplited = _context?.request?.headers?.referer?.split("+");
contextUrlSplited = contextUrlSplited ? contextUrlSplited[contextUrlSplited.length - 1] : false;
contextUrlSplited = contextUrlSplited ? contextUrlSplited.split("?")[0] : false;

const integrationLog = logs.PortalIntegrationLog._create({
  // service: contextUrlSplited,
  service: '67cb5fbd91bef1265cb14a1a',
  type: LOG_TYPE_ID,
  date: new Date(),
  success: false,
  originClassID: "67d038dd783db70d0d2650bb",
  originObjectID: _input.membershipId,
  originClassID: _input.membershipId._class._id,
  method: "payDebtFromStripe",
  responsable: _user._id,
  inputHistory: [{ object: _utils.stringifyAsJson(_input) }],
  finishedSolicitation: true
});

// Criação do cartão
if (!_input.paymentCardFormToPayment) {
  updatePatch(e, 'Preencha o formulário de cartão para pagamento para prosseguir');
  throw new Error('Preencha o formulário de cartão para pagamento para prosseguir')
}

let accountPaymentData = billing.accountPaymentData._create(_input.paymentCardFormToPayment);

// Obtenção das faturas
let membershipObject = br.com.wevets.membershipManagement.Membership._get({ _id: _input.membershipId });

let invoiceInfo = br.com.wevets.IntegrationFacadeStripe.getInvoices({ tutorId: membershipObject.tutor._id });

if (invoiceInfo.error) {
  updatePatch('Faturas não encontradas', false);
  throw new Error('Faturas não encontradas');
}
invoiceInfo = invoiceInfo.stripeResponse.response.data
let totalDue = invoiceInfo.filter(invoice => invoice.subscription === membershipObject.stripeSubscriptionId).reduce((sum, invoice) => {
  return sum + invoice.amount_due;
}, 0);

const moment = require("/_internal/moment");
const WEVETS_ID = "67cd7f0c91bef1265c883f16";
const paymentMethodByEnv = com.wevets.utils.WeVetsUtils.getEnvironment().toLowerCase() === 'prod' ? "681e359ec1582147b10445b2" : "68239413ff6d1111fcda2550";

let paymentMethod = billing.paymentMethod._get({ _id: paymentMethodByEnv });
let agreement = paymentMethod.agreement;

let expirationDate = getDatetime();

let remittanceData = {
  "_id": paymentMethod._id,
  "type": "A receber",
  "payer": membershipObject.tutor.person._id,
  "beneficiary": { "_id": WEVETS_ID },
  "value": totalDue / 100,
  "expirationDate": expirationDate,
  "agreement": agreement,
  "accountPaymentData": accountPaymentData,
  "currency": { _id: "591b1686116a1f22487aa921" }
};

let rmt;

try {
  rmt = billing.paymentMethod.collect(remittanceData);
} catch (err) {
  updatePatch(err, false);
  throw new Error(err);
}

if (rmt && rmt._id) {
  _output._redirectObject = rmt;
  if (rmt.state && rmt.state.identifier === "BILLING_ERROR") {
    billing.accountPaymentData._patch({
      _id: accountPaymentData._id,
      _operationsList: [{ op: 'replace', path: '/active', value: false }]
    });
    updatePatch(rmt, false);
    _utils.addErrorMessage(rmt.returnMessage);
  } else {
    updateContractPayment(accountPaymentData, membershipObject.contract, paymentMethod);
    let invoices = [];
    invoiceInfo.forEach(defaultInfo => {
      invoices.push(makeInvoice(membershipObject, defaultInfo.amount_due, defaultInfo.created, rmt, accountPaymentData._id))
    })
    billing.redeRemittance._patch({
      _id: rmt._id,
      _operationsList: [{ op: 'replace', path: '/invoices', value: invoices }]
    });
    updatePatch(null, true);
  }
}

// FUNÇÕES

function getDatetime() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return tomorrow;
}

function createPaymentMethod(creditCardForm) {
  const CREDIT_CARD_PAYMENT_METHOD_GROUP_ID = "597243dece027221e44533f0";

  let expirationMonth = Number(creditCardForm.expirationDate.substring(0, 2));
  let expirationYear = Number(creditCardForm.expirationDate.substring(2, 6));

  return billing.accountPaymentData._create({
    "account": _user._id,
    "paymentMethodGroup": CREDIT_CARD_PAYMENT_METHOD_GROUP_ID,
    "accountCreditCardData": {
      "name": creditCardForm.name,
      "number": creditCardForm.number,
      "securityCode": creditCardForm.securityCode,
      "expirationMonth": expirationMonth,
      "expirationYear": expirationYear
    }
  });
}

function updateContractPayment(paymentData, contract, paymentMethod) {
  const CONTRACT_CLASS_ID = "597265a4ce027221e445351a";

  _queues.HighPriority._create(
    {
      "sender": _object,
      "schedulingDate": new Date(), //DEFINIR DATA
      "body": {
        "targetClass": CONTRACT_CLASS_ID,
        "targetMethod": "changePaymentMethod",
        "parameter": _utils.stringifyAsJson({
          "_id": contract._id,
          "newPaymentData": paymentData,
          "newPaymentMethod": paymentMethod,
          "changeInvoicesPaymentMethod": false,
          "collectImmediately": false,
          "cancelIssuedRemittances": false
        }),
        "invokerUser": _user
      }
    },
    {
      "_indexStrategy": "queue"
    }
  );
}

function makeInvoice(membership, amount, created, rmt, accountPaymentDataId) {
  let invoiceObject = {};
  const momentDate = moment(created * 1000);

  const formatedReferenceMonth = momentDate.format("MM/YYYY");
  const INVOICE_STATE_ACTIVE = billing.invoiceState._get("5972637fce027221e4453503");
  const INVOICE_BUY_ORDER = "61a0078739ee51158be17e19";

  invoiceObject.type = membership.contract.type;
  invoiceObject.payer = membership.tutor.person._id;
  invoiceObject.beneficiary = { _id: WEVETS_ID };
  invoiceObject.referenceMonth = formatedReferenceMonth;
  invoiceObject.invoiceState = "5977c246ce027227c4269e3a";
  invoiceObject.classification = { _id: INVOICE_BUY_ORDER };
  invoiceObject.value = amount / 100;
  invoiceObject.expirationDate = new Date();
  invoiceObject.paymentMethod = membership.contract.paymentMethod?._id ?? null;
  invoiceObject.business = [membership.contract];
  invoiceObject.accountPaymentData = accountPaymentDataId;
  invoiceObject.paymentDate = new Date();
  invoiceObject.paidValue = amount / 100;
  invoiceObject.collectingCount = rmt ? 1 : 0;
  invoiceObject.lastCollectingDate = rmt ? new Date() : null;
  invoiceObject.invoiceItem = [];
  invoiceObject.billingGroup = membership.contract.billingGroup;
  invoiceObject.groupCollection = membership.contract.billingGroup ? membership.contract.billingGroup.groupCollection : false;
  invoiceObject.costAssignment = membership.contract.costAssignment;

  return billing.invoice._create(invoiceObject);
}

function updatePatch(error, success) {
  let operationList = [{ op: 'add', path: '/success', value: success }];

  if (error) {
    operationList.push({
      op: 'add', path: '/inputHistory/-', value: _utils.stringifyAsJson({
        "object": _utils.stringifyAsJson(_input),
        "error": error.message ? error.message + error.stack : _utils.stringifyAsJson(error)
      })
    });
  }

  logs.PortalIntegrationLog._patch({
    _id: integrationLog._id,
    _operationsList: operationList
  });
}

function fixContractMembership(contract, membership) {
  const CONTRACT_ACTIVE_SERVICE_ID = "59726354ce027221e44534fb";
  const TIMELY_FINANCIAL_STATUS_ID = "5972639bce027221e4453507";
  const MEMBERSHIP_ACTIVE_ID = "67fe73a0d4ee46169fe33a30";

  billing.contract._patch({
    _id: _id,
    _operationsList: [
      { op: 'replace', path: '/contractStates/serviceState', value: { _id: CONTRACT_ACTIVE_SERVICE_ID } },
      { op: 'replace', path: '/contractStates/financialState', value: { _id: TIMELY_FINANCIAL_STATUS_ID } }
    ]
  });
  br.com.wevets.membershipManagement.Membership._patch({
    _id: _id,
    _operationsList: [
      { op: 'replace', path: '/subscriptionStatus', value: { _id: MEMBERSHIP_ACTIVE_ID } },
      { op: 'replace', path: '/legacyFlocker', value: false },
    ]
  });
}