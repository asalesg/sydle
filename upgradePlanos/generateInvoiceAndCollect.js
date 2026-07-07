/**
 * @description Método gerar a fatura referente ao contrato dentro da assinatura. A fatura é gerada com arrecadação automática.
 *
 * @input
 * {
 *  membership: {
 *      _id: (Obrigatório) (string) - Id referente ao objeto da assinatura que será faturado/arrecadado
 *  }
 *  invoice: {
 *      _id: (Opcional) (string) - Id da fatura caso já tenha uma tentativa de faturação ou uma fatura já criada
 *  }
 *  log: {
 *      _id: (Opcional) (string) - Id do log de envio de inadimplência
 *  }
 * }
 *
 * @output = {
 *  errorMessage: Mensagem caso haja um erro,
 *  returnCode: código de retorno da remessa
 *  returnMessage: mensagem de retorno da remessa
 *  remittanceId: id da remessa
 * }
 */

const INVOICE_STATE_PAID_ID = "5977c246ce027227c4269e3a";
const REMITTANCE_STATE_SEND_TO_BILLING_SYSTEM_ID = "5977c0dace027227c4269e2a";
const DEFAULTING_SUSPENDED_STATUS_ID = "6810e55c2f95da5392e90946";
const MINIMUM_INVOICE_STATE_ID = "5977bfa7ce027227c4269e24";

const INVOICE_STATUS_CONSIDERED_PAID = [
  INVOICE_STATE_PAID_ID,
  MINIMUM_INVOICE_STATE_ID,
];

const financialConfigs = getFinancialConfigs();

let inputValidation = validateInput();

if (!inputValidation) return false;

const paymentConfirmed = _input.paymentConfirmed === true;
const userId = inputValidation.membership?.contract?.buyer?._id ?? null;
let firstCall = true;
let successefullPayment = false;
let invoice = getInvoice(_input.invoice, inputValidation.membership);
let errorMessage;
let remittance;

if (paymentConfirmed) {
  successefullPayment = true;
} else if (
  INVOICE_STATUS_CONSIDERED_PAID.some(
    (paidStatus) => paidStatus === invoice?.invoiceState?._id,
  )
) {
  successefullPayment = true;
} else {
  if (!firstCall) {
    errorMessage = collectAgain(invoice);
  }
  remittance = getRemittanceState(invoice);
  successefullPayment =
    remittance.state._id === REMITTANCE_STATE_SEND_TO_BILLING_SYSTEM_ID;
  invoice = billing.invoice._get(invoice);
}

if (
  successefullPayment ||
  INVOICE_STATUS_CONSIDERED_PAID.some(
    (paidStatus) => paidStatus === invoice?.invoiceState?._id,
  )
) {
  if (
    inputValidation.membership.subscriptionStatus._id !==
    DEFAULTING_SUSPENDED_STATUS_ID
  ) {
    if (!paymentConfirmed) {
      manageMembershipStatus(
        "IN_ACTIVATION_PERIOD",
        inputValidation.membership,
      );
    }
    scheduleMembershipActivation(inputValidation.membership);
    triggerMembershipConfirmedPaymentEvent(inputValidation.membership);

    const MEMBERSHIP_CONFIRMATION_PUSH_TEMPLATE = "69b1cd108942e075bf2a1387";
    sendPushNotification(userId, "all", MEMBERSHIP_CONFIRMATION_PUSH_TEMPLATE);
  }
} else {
  if (
    inputValidation.membership.subscriptionStatus._id !==
    DEFAULTING_SUSPENDED_STATUS_ID
  ) {
    manageMembershipStatus("PAYMENT_REFUSED", inputValidation.membership);
  }
  sendErrorEmail(inputValidation.membership);

  errorMessage = getReturnCodeResponse(remittance.remittanceReturnCode._id);

  if (errorMessage === null) {
    errorMessage = remittance.remittanceReturnCode.name;
  }
}

_output = {
  errorMessage: errorMessage,
  returnCode: remittance?.returnCode,
  returnMessage: remittance?.returnMessage,
  remittanceId: remittance?._id,
};

// FUNCTIONS --------------------------------------

/**
 * @description Valida se campos obrigatórios estão presentes na chamada do método
 *
 * @returns {object} retorna os campos validados e, caso haja um objeto, retorna a versão atual dele através de busca com get
 */
function validateInput() {
  if (!_input) {
    throw new Error("Informe os dados de entrada!");
  }

  const REQUIRED_FIELDS = ["membership"];

  validateArray(
    REQUIRED_FIELDS,
    _input,
    "Os seguintes campos são obrigatórios: ",
  );

  let answerObject = {};

  let membershipObject = br.com.wevets.membershipManagement.Membership._get(
    _input.membership,
  );
  if (!membershipObject) {
    throw new Error(
      "Assinatura de id '" + _input.membership._id + "' não foi encontrada.",
    );
  }
  answerObject.membership = membershipObject;

  return answerObject;
}

/**
 * @description Chama a função responsável por atualizar os status da assinatura
 *
 * @param {string} statusIdentifier identifier do status que será definido na assinatura
 * @param {object} membership objeto da assinatura
 */
function manageMembershipStatus(statusIdentifier, membership) {
  br.com.wevets.membershipManagement.Membership.updateStatus({
    membership: { _id: membership._id },
    statusIdentifier: statusIdentifier,
  });
}

/**
 * @description Verifica se todos os campos obrigatórios para execução estão no _input
 *
 * @param {Array.string} variablesArr nomes dos campos a serem validados
 * @param {Array} inputInfo campos que existem no _input
 * @param {string} messageInput início da mensagem que será exibida caso haja erro
 *
 * @throws Caso algum campo não exista ou campos que não deveriam ser passados existam estoura erro
 */
function validateArray(variablesArr, inputInfo, messageInput) {
  let areFieldsCorrect = true;

  variablesArr.forEach((field) => {
    if (inputInfo[field] === undefined || inputInfo[field] === null) {
      messageInput = messageInput + `${field}; `;
      areFieldsCorrect = false;
    }
  });

  if (!areFieldsCorrect) {
    throw new Error(messageInput);
  }
}

/**
 * @description Envia email de erro no fluxo de criação da assinatura
 *
 * @param {!object} membership objeto da assinatura
 */
function sendErrorEmail(membership) {
  const emailBodyPaymentError = `
    <table width="100%">
        <tr>
        <td>
            <p>Oi, ${membership.contract.buyer.name}.</p>
            <p>Tivemos um problema ao processar o pagamento do plano ${membership.contract.product.name} do pet ${membership.pet.name}. 
            Isso pode ser resolvido com rapidez — é só acessar sua área do cliente e tentar novamente.</p>
            <p>Se precisar de ajuda, estamos por aqui!</p>
        </td>
        </tr>
    </table>
    `;

  const data = {
    notificationConfigurationId: "67e5c35a408b8848297c1280",
    title:
      "Não conseguimos processar o pagamento do " +
      membership.contract.product.name,
    requestBody: emailBodyPaymentError,
    simulateShipping: false,
    receiver: membership.contract.buyer.email,
    attachment: null,
    relatedObjects: membership,
  };

  br.com.wevets.crm.EmailSendingFacade.sendEmail(data);
}

/**
 * @description Dispara o evento de pagamento confirmado da assinatura
 *
 * @param {!object} membership objeto da assinatura
 */
function triggerMembershipConfirmedPaymentEvent(membership) {
  const params = setMembershipConfirmedPaymentParams({ membership });
  triggerMembershipEvent({ params });
}

/**
 * @description Caso a fatura exista vai pegar ela, caso contrário cria uma fatura
 *
 * @param {object} invoice objeto da fatura
 * @param {object} membership objeto da assinatura
 * @returns {object} Objeto de fatura criado ou versão atualizada de um objeto já existente.
 */
function getInvoice(invoice, membership) {
  if (invoice && invoice._id) {
    firstCall = false;
    return billing.invoice._get(invoice);
  } else {
    return makeInvoice(membership);
  }

  function makeInvoice(membership) {
    const NOW = new Date();
    const formatedReferenceMonth = `${(NOW.getMonth() + 1).toString().padStart(2, "0")}/${NOW.getFullYear()}`;
    const INVOICE_STATE_ACTIVE = billing.invoiceState._get(
      "5972637fce027221e4453503",
    );

    return billing.contract.invoice({
      contract: membership.contract,
      invoiceState: INVOICE_STATE_ACTIVE,
      referenceMonth: formatedReferenceMonth,
      simulate: false,
      collectImmediately: true,
    });
  }
}

/**
 * @description Realiza o faturamento de uma fatura específica
 *
 * @param {object} invoice objeto da fatura
 * @returns {?string} mensagem de erro caso haja problema na cobrança ou string vazia se tudo der certo
 */
function collectAgain(invoice) {
  let errorMessage = "";

  try {
    billing.invoice.collect({
      invoices: [invoice],
    });
  } catch (e) {
    errorMessage = e.message;
  }

  return errorMessage;
}

/**
 * @description Busca a remessa mais recente referente a uma fatura específica
 *
 * @param {!object} invoice objeto da fatura
 * @returns {object} objeto da remessa
 * @throws Erro caso não consiga encontrar uma fatura
 */
function getRemittanceState(invoice) {
  let remittance = findLatestRemittance(invoice);

  if (remittance && remittance.hits && remittance.hits[0]._source) {
    return remittance.hits[0]._source;
  } else {
    throw new Error(
      "Não foi possível encontrar a remessa para validar o pagamento.",
    );
  }

  function findLatestRemittance(invoice) {
    return billing.remittance._search({
      query: {
        nested: {
          path: "invoices",
          query: {
            term: {
              "invoices._id": invoice._id,
            },
          },
        },
      },
      sort: [
        {
          _creationDate: {
            order: "desc",
          },
        },
      ],
      size: 1,
    }).hits;
  }
}

/**
 * @description Agenda na fila uma nova tentativa de copbrança da assinatura para 5 min no futuro
 *
 * @param {!object} invoice objeto da fatura
 * @param {!object} membership objeto da assinatura
 */
function recall(invoice, membership) {
  const MEMBERSHIP_CLASS_ID = "67d038dd783db70d0d2650bb";
  const params = {
    membership: { _id: membership._id },
    invoice: { _id: invoice._id },
  };

  let date = new Date();
  date.setMinutes(date.getMinutes() + 5);

  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    sender: membership,
    schedulingDate: date, //DEFINIR DATA
    body: {
      targetClass: MEMBERSHIP_CLASS_ID,
      targetMethod: "generateInvoiceAndCollect",
      parameter: _utils.stringifyAsJson(params),
      invokerUser: _user,
    },
  });
}

/**
 * @description Agenda na fila a ativação da assinatura conforme classe de configuração financeira
 *
 * @param {!object} membership objeto da assinatura
 */
function scheduleMembershipActivation(membership) {
  let date = new Date();
  date.setHours(
    date.getHours() + financialConfigs.subscriptionActivationWaitingPeriod,
  );

  const params = setMembershipActivationParams({
    membershipId: membership._id,
  });

  triggerMembershipEventQueue({ params, membership, date });
}

/**
 * @description Busca o objeto da classe "Configurações financeira" que esteja ativo no momento da busca
 *
 * @return Objeto de configurações financeira encontrado
 */
function getFinancialConfigs() {
  let financialConfigs =
    br.com.wevets.membershipManagement.FinancialSettings._search({
      _source: true,
      query: {
        term: { active: true },
      },
      size: 1,
    });

  return financialConfigs.hits.hits[0]._source;
}

/**
 * @description Pega a resposta que será dada ao clientes WeVets baseado no depara da configurção financeira
 *
 * @param {!string} searchedCode _id do remittanceReturnCode na remessa
 * @returns {?string} Mensagem adequada para o valor passado ou valor nulo caso não esteja configurado
 *
 */
function getReturnCodeResponse(searchedCode) {
  const matchingResponse = financialConfigs?.returnMapping?.find(
    (item) =>
      Array.isArray(item.remittanceReturnCode) &&
      item.remittanceReturnCode.some((code) => code._id === searchedCode),
  );

  return matchingResponse?.messageStandard || null;
}

/**
 * @description Função responsável por realizar o envio do Push notification
 * @param {string} userId - ID da pessoa alvo da notificação
 * @param {string} sendType - Tipo de envio ("all" | "statusBar" | "appBell")
 * @param {string} templateId - Template do push notification
 */
function sendPushNotification(userId, sendType, templateId) {
  if (!userId || !sendType || !templateId) {
    return;
  }

  br.com.wevets.notifications.pushNotificationTemplate.sendPushNotification({
    userId: userId,
    sendType: sendType,
    templateId: templateId,
  });
}

function setMembershipActivationParams({ membershipId }) {
  return {
    triggerIdentifier: "membership-activation",
    data: {
      membershipId,
      statusIdentifier: "ACTIVE",
    },
  };
}

function setMembershipConfirmedPaymentParams({ membership }) {
  return {
    triggerIdentifier: "membership-confirmed-payment",
    data: {
      membership,
    },
  };
}

function triggerMembershipEvent({ params }) {
  com.levty.ruleEngine.events.Event.publish({
    triggerIdentifier: params.triggerIdentifier,
    data: params.data,
  });
}

/**
 * @description Função responsável por realizar o agendamento do gatilho do motor de eventos
 * @param {string} params - Parâmetros contendo o identificador do gatilho e o body
 * @param {string} date - Data de agendamento
 * @param {string} membership - Assinatura
 */
function triggerMembershipEventQueue({ params, date, membership }) {
  const EVENT_RULE_ENGINE_CLASS_ID = "68de71839d6b6a4ae82269a7";
  com.levty.system.PrioritizedQueueConfiguration.createPrioritizedQueue({
    sender: membership,
    schedulingDate: date, //DEFINIR DATA
    body: {
      targetClass: EVENT_RULE_ENGINE_CLASS_ID,
      targetMethod: "publish",
      parameter: _utils.stringifyAsJson(params),
      invokerUser: _user,
    },
  });
}
